import { urlBase64ToUint8Array } from "./vapid-key-convert";

export type ClientPlatform =
  | "ANDROID"
  | "IOS"
  | "WINDOWS"
  | "MACOS"
  | "LINUX"
  | "CHROMEOS"
  | "OTHER";

export type ClientBrowser =
  | "CHROME"
  | "EDGE"
  | "SAFARI"
  | "FIREFOX"
  | "OTHER";

export type ClientDeviceClass =
  | "MOBILE"
  | "TABLET"
  | "DESKTOP"
  | "OTHER";

export type ClientNotificationPermission =
  | "GRANTED"
  | "DENIED"
  | "PROMPT"
  | "UNAVAILABLE";

export type ClientPushPermission =
  | "GRANTED"
  | "DENIED"
  | "PROMPT"
  | "UNAVAILABLE";

export type ClientServiceWorkerState =
  | "UNSUPPORTED"
  | "REGISTRATION_MISSING"
  | "INSTALLING"
  | "WAITING"
  | "ACTIVE"
  | "REDUNDANT"
  | "UNKNOWN";

export type ClientLocalReadiness =
  | "UNSUPPORTED"
  | "IOS_INSTALL_REQUIRED"
  | "PERMISSION_PROMPT"
  | "PERMISSION_DENIED"
  | "LOCAL_SUBSCRIPTION_MISSING"
  | "READY";

export interface ClientDeviceHealthPayload {
  deviceInstanceId?: string | null;
  platform: ClientPlatform;
  browser: ClientBrowser;
  deviceClass: ClientDeviceClass;
  notificationPermission: ClientNotificationPermission;
  pushPermission: ClientPushPermission;
  serviceWorkerState: ClientServiceWorkerState;
  localSubscriptionPresent: boolean;
  isStandalone: boolean;
}

export function detectClientPlatform(): ClientPlatform {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "OTHER";
  }

  const ua = (navigator.userAgent || "").toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();

  if (/android/.test(ua)) return "ANDROID";
  if (/ipad|iphone|ipod/.test(ua) || (platform === "macintel" && navigator.maxTouchPoints > 1)) {
    return "IOS";
  }
  if (/cros/.test(ua)) return "CHROMEOS";
  if (/win/.test(platform) || /windows/.test(ua)) return "WINDOWS";
  if (/mac/.test(platform) || /macintosh/.test(ua)) return "MACOS";
  if (/linux/.test(platform) || /linux/.test(ua)) return "LINUX";

  return "OTHER";
}

export function detectClientBrowser(): ClientBrowser {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "OTHER";
  }

  const ua = (navigator.userAgent || "").toLowerCase();

  // Order matters because Edge and Chrome share keywords
  if (/edg\//.test(ua)) return "EDGE";
  if (/chrome|crios/.test(ua) && !/edg\//.test(ua)) return "CHROME";
  if (/safari/.test(ua) && !/chrome|crios|edg\//.test(ua)) return "SAFARI";
  if (/firefox|fxios/.test(ua)) return "FIREFOX";

  return "OTHER";
}

export function detectClientDeviceClass(platform: ClientPlatform): ClientDeviceClass {
  if (typeof window === "undefined") return "OTHER";

  if (platform === "ANDROID") {
    const ua = (navigator.userAgent || "").toLowerCase();
    return /mobile/.test(ua) ? "MOBILE" : "TABLET";
  }

  if (platform === "IOS") {
    const ua = (navigator.userAgent || "").toLowerCase();
    return /ipad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "TABLET"
      : "MOBILE";
  }

  if (platform === "WINDOWS" || platform === "MACOS" || platform === "LINUX" || platform === "CHROMEOS") {
    return "DESKTOP";
  }

  return "OTHER";
}

export function isIosStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const isDisplayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const isNavStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return isDisplayStandalone || isNavStandalone;
}

export function getClientNotificationPermission(): ClientNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "UNAVAILABLE";
  }
  const perm = Notification.permission;
  if (perm === "granted") return "GRANTED";
  if (perm === "denied") return "DENIED";
  if (perm === "default") return "PROMPT";
  return "UNAVAILABLE";
}

export async function getClientPushPermission(
  registration: ServiceWorkerRegistration | null,
  publicKey?: string | null
): Promise<ClientPushPermission> {
  if (!registration || !registration.pushManager) {
    return "UNAVAILABLE";
  }

  if (typeof registration.pushManager.permissionState !== "function") {
    return "UNAVAILABLE";
  }

  try {
    const options: PushSubscriptionOptionsInit = {
      userVisibleOnly: true,
    };
    if (publicKey) {
      options.applicationServerKey = urlBase64ToUint8Array(publicKey) as unknown as BufferSource;
    }
    const state = await registration.pushManager.permissionState(options);
    if (state === "granted") return "GRANTED";
    if (state === "denied") return "DENIED";
    if (state === "prompt") return "PROMPT";
    return "UNAVAILABLE";
  } catch {
    return "UNAVAILABLE";
  }
}

export function getClientServiceWorkerState(
  registration: ServiceWorkerRegistration | null
): ClientServiceWorkerState {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return "UNSUPPORTED";
  }

  if (!registration) {
    return "REGISTRATION_MISSING";
  }

  if (registration.active) return "ACTIVE";
  if (registration.installing) return "INSTALLING";
  if (registration.waiting) return "WAITING";

  return "UNKNOWN";
}

export function diagnoseClientLocalReadiness(params: {
  platform: ClientPlatform;
  notificationPermission: ClientNotificationPermission;
  pushPermission: ClientPushPermission;
  serviceWorkerState: ClientServiceWorkerState;
  localSubscriptionPresent: boolean;
  isStandalone: boolean;
}): ClientLocalReadiness {
  // A. Unsupported capability / SW unsupported
  if (params.serviceWorkerState === "UNSUPPORTED") {
    return "UNSUPPORTED";
  }

  // B. iOS not installed standalone
  if (params.platform === "IOS" && !params.isStandalone) {
    return "IOS_INSTALL_REQUIRED";
  }

  // C. Notification DENIED or Push DENIED
  if (params.notificationPermission === "DENIED" || params.pushPermission === "DENIED") {
    return "PERMISSION_DENIED";
  }

  // D. Notification PROMPT or Push PROMPT
  if (params.notificationPermission === "PROMPT" || params.pushPermission === "PROMPT") {
    return "PERMISSION_PROMPT";
  }

  // E & F. Notification must be GRANTED
  if (params.notificationPermission === "GRANTED") {
    if (params.serviceWorkerState !== "ACTIVE" || !params.localSubscriptionPresent) {
      return "LOCAL_SUBSCRIPTION_MISSING";
    }
    return "READY";
  }

  return "UNSUPPORTED";
}

/**
 * Collects fresh diagnostic telemetry from the client environment.
 */
export async function collectClientDeviceHealth(
  deviceInstanceId?: string | null,
  options?: { publicKey?: string | null }
): Promise<ClientDeviceHealthPayload> {
  const platform = detectClientPlatform();
  const browser = detectClientBrowser();
  const deviceClass = detectClientDeviceClass(platform);
  const isStandalone = isIosStandalone();

  let registration: ServiceWorkerRegistration | null = null;
  let localSubscriptionPresent = false;

  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      registration = (await navigator.serviceWorker.getRegistration("/")) || null;
      if (registration && registration.pushManager) {
        const sub = await registration.pushManager.getSubscription();
        localSubscriptionPresent = sub !== null;
      }
    } catch {
      // Safe fallback
    }
  }

  const notificationPermission = getClientNotificationPermission();
  const pushPermission = await getClientPushPermission(registration, options?.publicKey);
  const serviceWorkerState = getClientServiceWorkerState(registration);

  return {
    deviceInstanceId: deviceInstanceId ?? null,
    platform,
    browser,
    deviceClass,
    notificationPermission,
    pushPermission,
    serviceWorkerState,
    localSubscriptionPresent,
    isStandalone,
  };
}

/**
 * Sends device health telemetry to POST /api/push/device-health.
 * Returns true on 200, false otherwise.
 */
export async function sendDeviceHealthReport(
  payload: ClientDeviceHealthPayload
): Promise<boolean> {
  if (!payload.deviceInstanceId) {
    return false;
  }

  try {
    const res = await fetch("/api/push/device-health", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
