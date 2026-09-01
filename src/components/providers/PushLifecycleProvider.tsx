"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { urlBase64ToUint8Array } from "@/lib/push/vapid-key-convert";

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

export interface PushLifecycleContextValue {
  state: PushPermissionState;
  error: string | null;
  publicKey: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  refetchConfig: () => Promise<void>;
}

const PushLifecycleContext = createContext<PushLifecycleContextValue | null>(null);

const PUSH_ELIGIBLE_AUTH_LEVELS = new Set(["admin", "verified_link", "verified_otp"]);

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

  const activationInFlightRef = useRef<boolean>(false);
  const lastPhoneLookupCleanupIdentityRef = useRef<string | null>(null);

  const user = session?.user as PushSessionUser | undefined;
  const userId = user?.id;
  const authLevel = user?.authLevel;

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
      lastPhoneLookupCleanupIdentityRef.current = null;
      return;
    }

    // phone_lookup security cleanup & dedupe
    if (authLevel === "phone_lookup") {
      setState("AUTH_INELIGIBLE");
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
                const res = await fetch("/api/push/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    endpoint: serialized.endpoint,
                    expirationTime: serialized.expirationTime ?? null,
                    keys: {
                      p256dh: serialized.keys.p256dh,
                      auth: serialized.keys.auth,
                    },
                  }),
                });
                if (!isMounted) return;
                if (res.ok) {
                  setState("ACTIVE");
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
        return;
      }

      setState(key ? "DEFAULT" : "CONFIG_LOADING");
    })();

    return () => {
      isMounted = false;
    };
  }, [status, userId, authLevel, fetchConfig, registerServiceWorker]);

  const subscribe = useCallback(async () => {
    if (activationInFlightRef.current) return;
    activationInFlightRef.current = true;

    setError(null);
    try {
      const isSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
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

      const postBody = {
        endpoint: serialized.endpoint,
        expirationTime: serialized.expirationTime ?? null,
        keys: {
          p256dh: serialized.keys.p256dh,
          auth: serialized.keys.auth,
        },
      };

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });

      if (res.ok) {
        setState("ACTIVE");
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

        const recoveryRes = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: freshSerialized.endpoint,
            expirationTime: freshSerialized.expirationTime ?? null,
            keys: {
              p256dh: freshSerialized.keys.p256dh,
              auth: freshSerialized.keys.auth,
            },
          }),
        });

        if (recoveryRes.ok) {
          setState("ACTIVE");
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
  }, [authLevel, publicKey, fetchConfig, registerServiceWorker]);

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
      setState(Notification.permission === "granted" ? "GRANTED_NOT_SUBSCRIBED" : "DEFAULT");
    } catch {
      setState("ERROR");
    }
  }, []);

  return (
    <PushLifecycleContext.Provider
      value={{
        state,
        error,
        publicKey,
        subscribe,
        unsubscribe,
        refetchConfig: async () => {
          await fetchConfig();
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
