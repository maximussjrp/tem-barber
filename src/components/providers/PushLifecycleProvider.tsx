"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { urlBase64ToUint8Array } from "@/lib/push/vapid-key-convert";
import { getOrGenerateDeviceInstanceId } from "@/lib/push/device-identity.client";
import {
  collectClientDeviceHealth,
  sendDeviceHealthReport,
  diagnoseClientLocalReadiness,
  ClientLocalReadiness,
  detectClientBrowser,
  detectClientPlatform,
  deriveClientDeviceDisplayName,
} from "@/lib/push/device-health.client";

export type PushPermissionState =
  | "UNSUPPORTED"
  | "NOT_INSTALLED_IOS"
  | "SIGNED_OUT"
  | "AUTH_INELIGIBLE"
  | "CONFIG_LOADING"
  | "DEFAULT"
  | "REQUESTING"
  | "GRANTED_NOT_SUBSCRIBED"
  | "SUBSCRIBING"
  | "ACTIVE"
  | "DENIED"
  | "ERROR";

export interface PushSessionUser {
  id?: string;
  authLevel?: string;
}

export interface DeviceHealthSnapshot {
  deviceInstanceId: string | null;
  displayName: string | null;
  localReadiness: ClientLocalReadiness;
  notificationPermission: string;
  pushPermission: string;
  serviceWorkerState: string;
  localSubscriptionPresent: boolean;
  serverLinked: boolean;
  lastVerifiedAt: Date | null;
  healthReportStatus: "IDLE" | "REPORTING" | "REPORTED" | "FAILED";
  isStorageAvailable: boolean;
}

export interface PushLifecycleContextValue {
  state: PushPermissionState;
  error: string | null;
  publicKey: string | null;
  deviceHealth: DeviceHealthSnapshot | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  refetchConfig: () => Promise<void>;
  reportDeviceHealth: () => Promise<void>;
}

const PushLifecycleContext = createContext<PushLifecycleContextValue | null>(null);

const PUSH_ELIGIBLE_AUTH_LEVELS = new Set(["admin", "verified_link", "verified_otp"]);
const HEALTH_REPORT_REFRESH_MAX_STALE = 6 * 60 * 60 * 1000; // 6 hours (21,600,000 ms)

function isIosBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIosDevice = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIosDevice;
}

function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const isDisplayStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const isNavStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return isDisplayStandalone || isNavStandalone;
}

export function PushLifecycleProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [state, setState] = useState<PushPermissionState>("DEFAULT");
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [deviceHealth, setDeviceHealth] = useState<DeviceHealthSnapshot | null>(null);

  const activationInFlightRef = useRef<boolean>(false);
  const reportInFlightIdentityRef = useRef<string | null>(null);
  const lastReportTimestampRef = useRef<number>(0);
  const lastPhoneLookupCleanupIdentityRef = useRef<string | null>(null);
  const serverLinkedRef = useRef<boolean>(false);

  const user = session?.user as PushSessionUser | undefined;
  const userId = user?.id;
  const authLevel = user?.authLevel;

  const currentIdentityToken = userId && authLevel ? `${userId}:${authLevel}` : null;
  const currentIdentityRef = useRef<string | null>(currentIdentityToken);

  useEffect(() => {
    currentIdentityRef.current = currentIdentityToken;
    if (!currentIdentityToken || !authLevel || !PUSH_ELIGIBLE_AUTH_LEVELS.has(authLevel)) {
      serverLinkedRef.current = false;
    }
  }, [currentIdentityToken, authLevel]);

  const fetchConfig = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/push/config");
      if (!res.ok) {
        if (res.status === 503) {
          setError("PUSH_NOT_CONFIGURED");
        } else {
          setError("CONFIG_FETCH_FAILED");
        }
        return null;
      }
      const data = await res.json();
      if (data.publicKey && typeof data.publicKey === "string") {
        setPublicKey(data.publicKey);
        setError(null);
        return data.publicKey;
      }
      return null;
    } catch {
      setError("CONFIG_FETCH_FAILED");
      return null;
    }
  }, []);

  const registerServiceWorker = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      return reg;
    } catch {
      return null;
    }
  }, []);

  const reportDeviceHealth = useCallback(
    async (forcedDeviceId?: string | null, knownServerLinked?: boolean) => {
      const activeIdentity = currentIdentityRef.current;
      if (!activeIdentity || !userId || !authLevel || !PUSH_ELIGIBLE_AUTH_LEVELS.has(authLevel)) {
        return;
      }

      if (reportInFlightIdentityRef.current === activeIdentity) {
        return;
      }
      reportInFlightIdentityRef.current = activeIdentity;

      if (knownServerLinked !== undefined) {
        serverLinkedRef.current = knownServerLinked;
      }

      const deviceInstanceId =
        forcedDeviceId !== undefined
          ? forcedDeviceId
          : getOrGenerateDeviceInstanceId(userId, authLevel);

      const isStorageAvailable = Boolean(deviceInstanceId);

      setDeviceHealth((prev) => (prev ? { ...prev, healthReportStatus: "REPORTING" } : null));

      try {
        if (!deviceInstanceId) {
          // Storage unavailable: collect local telemetry only. No fabricated UUID, do not POST to server.
          const localTelemetry = await collectClientDeviceHealth(null, { publicKey });
          if (currentIdentityRef.current !== activeIdentity) return;

          const readiness = diagnoseClientLocalReadiness(localTelemetry);
          const browser = detectClientBrowser();
          const platform = detectClientPlatform();

          setDeviceHealth({
            deviceInstanceId: null,
            displayName: deriveClientDeviceDisplayName(platform, browser),
            localReadiness: readiness,
            notificationPermission: localTelemetry.notificationPermission,
            pushPermission: localTelemetry.pushPermission,
            serviceWorkerState: localTelemetry.serviceWorkerState,
            localSubscriptionPresent: localTelemetry.localSubscriptionPresent,
            serverLinked: false,
            lastVerifiedAt: new Date(),
            healthReportStatus: "IDLE",
            isStorageAvailable: false,
          });
          return;
        }

        const telemetry = await collectClientDeviceHealth(deviceInstanceId, { publicKey });
        if (currentIdentityRef.current !== activeIdentity) return;

        const ok = await sendDeviceHealthReport(telemetry);
        if (currentIdentityRef.current !== activeIdentity) return;

        if (ok) {
          lastReportTimestampRef.current = Date.now();
        }

        const readiness = diagnoseClientLocalReadiness(telemetry);
        const browser = detectClientBrowser();
        const platform = detectClientPlatform();

        setDeviceHealth({
          deviceInstanceId,
          displayName: deriveClientDeviceDisplayName(platform, browser),
          localReadiness: readiness,
          notificationPermission: telemetry.notificationPermission,
          pushPermission: telemetry.pushPermission,
          serviceWorkerState: telemetry.serviceWorkerState,
          localSubscriptionPresent: telemetry.localSubscriptionPresent,
          serverLinked: serverLinkedRef.current,
          lastVerifiedAt: new Date(),
          healthReportStatus: ok ? "REPORTED" : "FAILED",
          isStorageAvailable: true,
        });
      } catch {
        if (currentIdentityRef.current === activeIdentity) {
          setDeviceHealth((prev) => (prev ? { ...prev, healthReportStatus: "FAILED" } : null));
        }
      } finally {
        if (reportInFlightIdentityRef.current === activeIdentity) {
          reportInFlightIdentityRef.current = null;
        }
      }
    },
    [userId, authLevel, publicKey]
  );

  // Main lifecycle effect using stable primitive dependencies
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!isSupported) {
      setState("UNSUPPORTED");
      return;
    }

    if (isIosBrowser() && !isStandaloneMode()) {
      setState("NOT_INSTALLED_IOS");
      return;
    }

    if (status === "loading") {
      return;
    }

    if (status === "unauthenticated" || !userId || !authLevel) {
      setState("SIGNED_OUT");
      setDeviceHealth(null);
      serverLinkedRef.current = false;
      lastPhoneLookupCleanupIdentityRef.current = null;
      return;
    }

    // phone_lookup security cleanup & dedupe
    if (authLevel === "phone_lookup") {
      setState("AUTH_INELIGIBLE");
      setDeviceHealth(null);
      serverLinkedRef.current = false;
      const currentIdentity = `${userId}:phone_lookup`;
      if (lastPhoneLookupCleanupIdentityRef.current !== currentIdentity) {
        lastPhoneLookupCleanupIdentityRef.current = currentIdentity;
        (async () => {
          try {
            if (Notification.permission === "granted") {
              const reg = await navigator.serviceWorker.getRegistration("/");
              if (reg && reg.pushManager) {
                const sub = await reg.pushManager.getSubscription();
                if (sub) {
                  const serialized = sub.toJSON();
                  if (serialized.endpoint && serialized.keys?.p256dh && serialized.keys?.auth) {
                    try {
                      await fetch("/api/push/unsubscribe", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          endpoint: serialized.endpoint,
                          keys: {
                            p256dh: serialized.keys.p256dh,
                            auth: serialized.keys.auth,
                          },
                        }),
                      });
                    } catch {
                      // ignore
                    }
                  }
                  try {
                    await sub.unsubscribe();
                  } catch {
                    // ignore
                  }
                }
              }
            }
          } catch {
            // ignore
          }
        })();
      }
      return;
    }

    lastPhoneLookupCleanupIdentityRef.current = null;

    if (!PUSH_ELIGIBLE_AUTH_LEVELS.has(authLevel)) {
      setState("AUTH_INELIGIBLE");
      setDeviceHealth(null);
      serverLinkedRef.current = false;
      return;
    }

    // Eligible session flow
    let isMounted = true;
    (async () => {
      setState("CONFIG_LOADING");
      const key = await fetchConfig();
      await registerServiceWorker();

      if (!isMounted) return;

      if (!key) {
        setState("ERROR");
        return;
      }

      const perm = Notification.permission;
      if (perm === "denied") {
        setState("DENIED");
        void reportDeviceHealth();
        return;
      }

      if (perm === "granted") {
        const reg = await navigator.serviceWorker.getRegistration("/");
        if (reg && reg.pushManager) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            const serialized = sub.toJSON();
            if (serialized.endpoint && serialized.keys?.p256dh && serialized.keys?.auth) {
              try {
                const deviceInstanceId = getOrGenerateDeviceInstanceId(userId, authLevel);
                const postBody: {
                  endpoint: string;
                  expirationTime: number | null;
                  keys: { p256dh: string; auth: string };
                  deviceInstanceId?: string;
                } = {
                  endpoint: serialized.endpoint,
                  expirationTime: serialized.expirationTime ?? null,
                  keys: {
                    p256dh: serialized.keys.p256dh,
                    auth: serialized.keys.auth,
                  },
                };
                if (deviceInstanceId) {
                  postBody.deviceInstanceId = deviceInstanceId;
                }

                const res = await fetch("/api/push/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(postBody),
                });
                if (!isMounted) return;
                if (res.ok) {
                  const data = await res.json().catch(() => ({}));
                  const isDeviceLinked = data?.deviceLinked === true;
                  setState("ACTIVE");
                  void reportDeviceHealth(deviceInstanceId, isDeviceLinked);
                  return;
                }
                if (res.status === 409) {
                  setError("SUBSCRIPTION_ENDPOINT_CONFLICT");
                  setState("ERROR");
                  return;
                }
                setError("STARTUP_RECONCILE_FAILED");
                setState("ERROR");
                return;
              } catch {
                if (!isMounted) return;
                setError("STARTUP_RECONCILE_FAILED");
                setState("ERROR");
                return;
              }
            }
            setError("INVALID_SUBSCRIPTION");
            setState("ERROR");
            return;
          }
        }
        setState("GRANTED_NOT_SUBSCRIBED");
        void reportDeviceHealth();
        return;
      }

      setState(key ? "DEFAULT" : "CONFIG_LOADING");
      void reportDeviceHealth();
    })();

    return () => {
      isMounted = false;
    };
  }, [status, userId, authLevel, fetchConfig, registerServiceWorker, reportDeviceHealth]);

  // Permission monitoring and visibility/focus telemetry refreshes
  useEffect(() => {
    if (typeof window === "undefined" || !userId || !authLevel || !PUSH_ELIGIBLE_AUTH_LEVELS.has(authLevel)) {
      return;
    }

    let isDisposed = false;
    let permStatus: PermissionStatus | null = null;
    const handlePermChange = () => {
      void reportDeviceHealth();
    };

    if ("permissions" in navigator && typeof navigator.permissions.query === "function") {
      navigator.permissions
        .query({ name: "notifications" as PermissionName })
        .then((status) => {
          if (isDisposed) return;
          permStatus = status;
          permStatus.addEventListener("change", handlePermChange);
        })
        .catch(() => {
          // Safe fallback
        });
    }

    const handleFocus = () => {
      const now = Date.now();
      if (now - lastReportTimestampRef.current > HEALTH_REPORT_REFRESH_MAX_STALE) {
        void reportDeviceHealth();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastReportTimestampRef.current > HEALTH_REPORT_REFRESH_MAX_STALE) {
        void reportDeviceHealth();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isDisposed = true;
      if (permStatus) {
        permStatus.removeEventListener("change", handlePermChange);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [userId, authLevel, reportDeviceHealth]);

  const subscribe = useCallback(async () => {
    if (activationInFlightRef.current) return;
    activationInFlightRef.current = true;

    setError(null);
    try {
      const isSupported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!isSupported) {
        setState("UNSUPPORTED");
        return;
      }

      if (isIosBrowser() && !isStandaloneMode()) {
        setState("NOT_INSTALLED_IOS");
        return;
      }

      if (!authLevel || !PUSH_ELIGIBLE_AUTH_LEVELS.has(authLevel)) {
        setState("AUTH_INELIGIBLE");
        return;
      }

      // Check config readiness BEFORE requesting permission. NEVER await network in click handler prior to requestPermission.
      if (!publicKey) {
        setState("CONFIG_LOADING");
        setError("PUSH_NOT_CONFIGURED");
        void fetchConfig();
        return;
      }

      setState("REQUESTING");
      let permission: NotificationPermission;
      try {
        permission = await Notification.requestPermission();
      } catch {
        setState("ERROR");
        return;
      }

      if (permission !== "granted") {
        setState(permission === "denied" ? "DENIED" : "DEFAULT");
        void reportDeviceHealth();
        return;
      }

      setState("SUBSCRIBING");
      const reg = await registerServiceWorker();
      if (!reg) {
        setState("ERROR");
        return;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const applicationServerKey = urlBase64ToUint8Array(publicKey) as unknown as BufferSource;
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      const serialized = sub.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
        setState("ERROR");
        return;
      }

      const deviceInstanceId = getOrGenerateDeviceInstanceId(userId, authLevel);
      const postBody = {
        endpoint: serialized.endpoint,
        expirationTime: serialized.expirationTime ?? null,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
        ...(deviceInstanceId ? { deviceInstanceId } : {}),
      };

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const isDeviceLinked = data?.deviceLinked === true;
        setState("ACTIVE");
        void reportDeviceHealth(deviceInstanceId, isDeviceLinked);
        return;
      }

      // Explicit 1-cycle recovery on 409 conflict during user activation
      if (res.status === 409) {
        try {
          await fetch("/api/push/unsubscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              endpoint: serialized.endpoint,
              keys: {
                p256dh: serialized.keys.p256dh,
                auth: serialized.keys.auth,
              },
            }),
          });
        } catch {
          // ignore
        }
        try {
          await sub.unsubscribe();
        } catch {
          // ignore
        }

        const applicationServerKey = urlBase64ToUint8Array(publicKey) as unknown as BufferSource;
        const freshSub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        const freshSerialized = freshSub.toJSON();
        if (!freshSerialized.endpoint || !freshSerialized.keys?.p256dh || !freshSerialized.keys?.auth) {
          setError("SUBSCRIPTION_ENDPOINT_CONFLICT");
          setState("ERROR");
          return;
        }

        const recoveryPostBody = {
          endpoint: freshSerialized.endpoint,
          expirationTime: freshSerialized.expirationTime ?? null,
          keys: {
            p256dh: freshSerialized.keys.p256dh,
            auth: freshSerialized.keys.auth,
          },
          ...(deviceInstanceId ? { deviceInstanceId } : {}),
        };

        const recoveryRes = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recoveryPostBody),
        });

        if (recoveryRes.ok) {
          const recoveryData = await recoveryRes.json().catch(() => ({}));
          const recoveryDeviceLinked = recoveryData?.deviceLinked === true;
          setState("ACTIVE");
          void reportDeviceHealth(deviceInstanceId, recoveryDeviceLinked);
          return;
        }

        setError("SUBSCRIPTION_ENDPOINT_CONFLICT");
        setState("ERROR");
        return;
      }

      setState("ERROR");
    } catch {
      setState("ERROR");
    } finally {
      activationInFlightRef.current = false;
    }
  }, [authLevel, publicKey, userId, fetchConfig, registerServiceWorker, reportDeviceHealth]);

  const unsubscribe = useCallback(async () => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (reg && reg.pushManager) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const serialized = sub.toJSON();
          if (serialized.endpoint && serialized.keys?.p256dh && serialized.keys?.auth) {
            try {
              await fetch("/api/push/unsubscribe", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  endpoint: serialized.endpoint,
                  keys: {
                    p256dh: serialized.keys.p256dh,
                    auth: serialized.keys.auth,
                  },
                }),
              });
            } catch {
              // ignore
            }
          }
          await sub.unsubscribe();
        }
      }
      serverLinkedRef.current = false;
      setState(Notification.permission === "granted" ? "GRANTED_NOT_SUBSCRIBED" : "DEFAULT");
      void reportDeviceHealth();
    } catch {
      setState("ERROR");
    }
  }, [reportDeviceHealth]);

  return (
    <PushLifecycleContext.Provider
      value={{
        state,
        error,
        publicKey,
        deviceHealth,
        subscribe,
        unsubscribe,
        refetchConfig: async () => {
          await fetchConfig();
        },
        reportDeviceHealth: async () => {
          await reportDeviceHealth();
        },
      }}
    >
      {children}
    </PushLifecycleContext.Provider>
  );
}

export function usePushLifecycle(): PushLifecycleContextValue {
  const ctx = useContext(PushLifecycleContext);
  if (!ctx) {
    throw new Error("usePushLifecycle must be used within PushLifecycleProvider");
  }
  return ctx;
}
