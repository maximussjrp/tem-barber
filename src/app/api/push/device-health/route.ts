import { NextResponse } from "next/server";
import {
  getAuthenticatedPushSession,
  isPushEligibleAuthLevel,
  validateCanonicalOrigin,
} from "@/lib/push/push-api.server";
import {
  recordDeviceHealthReport,
  ValidatedDeviceHealthPayload,
  PlatformEnum,
  BrowserEnum,
  DeviceClassEnum,
  NotificationPermissionEnum,
  PushPermissionEnum,
  ServiceWorkerStateEnum,
} from "@/lib/push/device-health.server";

const VALID_PLATFORMS = new Set<PlatformEnum>([
  "ANDROID",
  "IOS",
  "WINDOWS",
  "MACOS",
  "LINUX",
  "CHROMEOS",
  "OTHER",
]);

const VALID_BROWSERS = new Set<BrowserEnum>([
  "CHROME",
  "EDGE",
  "SAFARI",
  "FIREFOX",
  "OTHER",
]);

const VALID_DEVICE_CLASSES = new Set<DeviceClassEnum>([
  "MOBILE",
  "TABLET",
  "DESKTOP",
  "OTHER",
]);

const VALID_PERMISSIONS = new Set<NotificationPermissionEnum>([
  "GRANTED",
  "DENIED",
  "PROMPT",
  "UNAVAILABLE",
]);

const VALID_PUSH_PERMISSIONS = new Set<PushPermissionEnum>([
  "GRANTED",
  "DENIED",
  "PROMPT",
  "UNAVAILABLE",
]);

const VALID_SW_STATES = new Set<ServiceWorkerStateEnum>([
  "UNSUPPORTED",
  "REGISTRATION_MISSING",
  "INSTALLING",
  "WAITING",
  "ACTIVE",
  "REDUNDANT",
  "UNKNOWN",
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "deviceInstanceId",
  "platform",
  "browser",
  "deviceClass",
  "notificationPermission",
  "pushPermission",
  "serviceWorkerState",
  "localSubscriptionPresent",
  "isStandalone",
]);

function parseDeviceHealthBody(body: unknown): ValidatedDeviceHealthPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;

  // Reject unknown fields strictly
  for (const k of Object.keys(record)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) {
      return null;
    }
  }

  // 1. deviceInstanceId
  if (
    typeof record.deviceInstanceId !== "string" ||
    record.deviceInstanceId.length > 64 ||
    !UUID_REGEX.test(record.deviceInstanceId.trim())
  ) {
    return null;
  }
  const deviceInstanceId = record.deviceInstanceId.trim();

  // 2. platform
  if (typeof record.platform !== "string" || !VALID_PLATFORMS.has(record.platform as PlatformEnum)) {
    return null;
  }
  const platform = record.platform as PlatformEnum;

  // 3. browser
  if (typeof record.browser !== "string" || !VALID_BROWSERS.has(record.browser as BrowserEnum)) {
    return null;
  }
  const browser = record.browser as BrowserEnum;

  // 4. deviceClass
  if (typeof record.deviceClass !== "string" || !VALID_DEVICE_CLASSES.has(record.deviceClass as DeviceClassEnum)) {
    return null;
  }
  const deviceClass = record.deviceClass as DeviceClassEnum;

  // 5. notificationPermission
  if (
    typeof record.notificationPermission !== "string" ||
    !VALID_PERMISSIONS.has(record.notificationPermission as NotificationPermissionEnum)
  ) {
    return null;
  }
  const notificationPermission = record.notificationPermission as NotificationPermissionEnum;

  // 6. pushPermission
  if (
    typeof record.pushPermission !== "string" ||
    !VALID_PUSH_PERMISSIONS.has(record.pushPermission as PushPermissionEnum)
  ) {
    return null;
  }
  const pushPermission = record.pushPermission as PushPermissionEnum;

  // 7. serviceWorkerState
  if (
    typeof record.serviceWorkerState !== "string" ||
    !VALID_SW_STATES.has(record.serviceWorkerState as ServiceWorkerStateEnum)
  ) {
    return null;
  }
  const serviceWorkerState = record.serviceWorkerState as ServiceWorkerStateEnum;

  // 8. localSubscriptionPresent
  if (typeof record.localSubscriptionPresent !== "boolean") {
    return null;
  }
  const localSubscriptionPresent = record.localSubscriptionPresent;

  // 9. isStandalone
  if (typeof record.isStandalone !== "boolean") {
    return null;
  }
  const isStandalone = record.isStandalone;

  return {
    deviceInstanceId,
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

export async function POST(req: Request) {
  const rawContentType = req.headers.get("content-type") || "";
  const mediaType = rawContentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  const { user } = await getAuthenticatedPushSession();
  if (!user || !user.id) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  if (!isPushEligibleAuthLevel(user.authLevel)) {
    return NextResponse.json(
      { error: "PUSH_AUTH_LEVEL_NOT_ELIGIBLE" },
      { status: 403 }
    );
  }

  const originCheck = validateCanonicalOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json(
      { error: originCheck.errorCode },
      { status: originCheck.statusCode }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  const payload = parseDeviceHealthBody(body);
  if (!payload) {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  try {
    const result = await recordDeviceHealthReport(user.id, payload);
    if (!result.success) {
      return NextResponse.json(
        { error: "INTERNAL_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
