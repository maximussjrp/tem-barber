import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import prisma from "@/lib/prisma";
import webpush from "web-push";
import {
  deliverSingleNotification,
  deliverCreatedNotifications,
  parseRetryAfterHeader,
} from "@/lib/push/delivery.server";
import { Notification } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  default: {
    webPushSubscription: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

describe("Push Delivery Engine (src/lib/push/delivery.server.ts)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      VAPID_PUBLIC_KEY: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-Skv69yViEuiBIa",
      VAPID_PRIVATE_KEY: "secret_vapid_private_key_test_1234567890123456",
      VAPID_SUBJECT: "mailto:admin@tembarber.com",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  it("1. parseRetryAfterHeader supports seconds integer and HTTP-date", () => {
    expect(parseRetryAfterHeader("120")).toBe(120);
    expect(parseRetryAfterHeader("0")).toBe(0);
    expect(parseRetryAfterHeader(null)).toBeNull();
    expect(parseRetryAfterHeader("invalid")).toBeNull();

    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const parsedDateSeconds = parseRetryAfterHeader(futureDate);
    expect(parsedDateSeconds).toBeGreaterThanOrEqual(9);
    expect(parsedDateSeconds).toBeLessThanOrEqual(11);
  });

  it("2. Returns INTERNAL_PAYLOAD_ERROR for invalid target or title bounds", async () => {
    const invalidNotif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "", // Empty title
      content: "Valid content",
      type: "APPOINTMENT_CREATED",
      target: "INVALID_TARGET",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(invalidNotif);
    expect(res.results[0]?.classification).toBe("INTERNAL_PAYLOAD_ERROR");
    expect(prisma.webPushSubscription.findMany).not.toHaveBeenCalled();
  });

  it("3. Returns NO_SUBSCRIPTIONS only when query succeeds and returns empty array", async () => {
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([]);

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento recebido.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.deviceCount).toBe(0);
    expect(res.results[0]?.classification).toBe("NO_SUBSCRIPTIONS");
  });

  it("4. Returns STORAGE_ERROR when subscription DB query throws error", async () => {
    vi.mocked(prisma.webPushSubscription.findMany).mockRejectedValueOnce(new Error("DB read error"));

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento recebido.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.deviceCount).toBe(0);
    expect(res.results[0]?.classification).toBe("STORAGE_ERROR");
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(prisma.webPushSubscription.updateMany).not.toHaveBeenCalled();
    expect(prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("5. One-device SUCCESS updates success metadata with exact snapshot", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento recebido.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.deviceCount).toBe(1);
    expect(res.results[0]?.classification).toBe("SUCCESS");
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        id: "sub-1",
        userId: "user-1",
        endpoint: "https://push.example.com/sub-1",
        p256dh: "key-1",
        auth: "auth-1",
      },
      data: {
        lastSuccessfulAt: expect.any(Date),
        failureCount: 0,
        lastFailureAt: null,
      },
    });
  });

  it("6. Multi-device fanout (Device A final failure / Device B success)", async () => {
    const mockSubs = [
      {
        id: "sub-1",
        userId: "user-1",
        endpoint: "https://push.example.com/sub-1",
        p256dh: "key-1",
        auth: "auth-1",
        expirationTime: null,
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessfulAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-2",
        userId: "user-1",
        endpoint: "https://push.example.com/sub-2",
        p256dh: "key-2",
        auth: "auth-2",
        expirationTime: null,
        failureCount: 0,
        lastFailureAt: null,
        lastSuccessfulAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce(mockSubs as any);
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce({ statusCode: 410 }) // sub-1 410 invalid
      .mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} }); // sub-2 success

    vi.mocked(prisma.webPushSubscription.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.deviceCount).toBe(2);
    expect(res.results.find((r) => r.subscriptionId === "sub-1")?.classification).toBe("INVALID_SUBSCRIPTION");
    expect(res.results.find((r) => r.subscriptionId === "sub-2")?.classification).toBe("SUCCESS");

    expect(prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "sub-1",
        userId: "user-1",
        endpoint: "https://push.example.com/sub-1",
        p256dh: "key-1",
        auth: "auth-1",
      },
    });
  });

  it("7. Auto-deletes subscription on 404/410 errors with exact snapshot where", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 404 });
    vi.mocked(prisma.webPushSubscription.deleteMany).mockResolvedValue({ count: 0 }); // Stale delete count=0 safe

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "É a sua vez",
      content: "Você foi chamado.",
      type: "WAITLIST_CALLED",
      target: "WAITLIST",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.results[0]?.classification).toBe("INVALID_SUBSCRIPTION");
    expect(prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "sub-1",
        userId: "user-1",
        endpoint: "https://push.example.com/sub-1",
        p256dh: "key-1",
        auth: "auth-1",
      },
    });
  });

  it("8. Retains subscription and does NOT mutate metadata on 401, 403, or CONFIG_ERROR", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Test 403
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 403 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Agendamento cancelado",
      content: "Agendamento cancelado.",
      type: "APPOINTMENT_CANCELLED_BY_STAFF",
      target: "CLIENT_APPOINTMENTS",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.results[0]?.classification).toBe("CONFIG_OR_AUTH_ERROR");
    expect(prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled();
    expect(prisma.webPushSubscription.updateMany).not.toHaveBeenCalled();
  });

  it("9. Handles 429 Retry-After > 5s by classifying RATE_LIMITED_DEFERRED without sleeping", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({
      statusCode: 429,
      headers: { "retry-after": "60" },
    });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Agendamento cancelado",
      content: "Agendamento cancelado.",
      type: "APPOINTMENT_CANCELLED_BY_CUSTOMER",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.results[0]?.classification).toBe("RATE_LIMITED_DEFERRED");
    expect(res.results[0]?.attempts).toBe(1);
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledWith({
      where: expect.any(Object),
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: expect.any(Date),
      },
    });
  });

  it("10. Retries 500, 502, 503, 504 and network errors up to MAX_TOTAL_ATTEMPTS = 3", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce({ statusCode: 502 })
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockRejectedValueOnce({ statusCode: 504 });

    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Agendamento cancelado",
      content: "Agendamento cancelado.",
      type: "APPOINTMENT_CANCELLED_BY_CUSTOMER",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.results[0]?.attempts).toBe(3); // Hard bounded to max 3 attempts
    expect(res.results[0]?.classification).toBe("RETRYABLE_SERVER");
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    // Failure count incremented ONCE on final exhaustion
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledTimes(1);
  });

  it("11. Retry failure on attempt 1 then success on attempt 2 never increments failureCount", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 2,
      lastFailureAt: new Date(),
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce({ statusCode: 500 }) // Attempt 1 fails
      .mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} }); // Attempt 2 succeeds

    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.results[0]?.classification).toBe("SUCCESS");
    expect(res.results[0]?.attempts).toBe(2);

    // Metadata update sets failureCount = 0 and lastSuccessfulAt
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledWith({
      where: expect.any(Object),
      data: {
        lastSuccessfulAt: expect.any(Date),
        failureCount: 0,
        lastFailureAt: null,
      },
    });
  });

  it("12. Success metadata update with count=0 (stale snapshot) sets METADATA_STALE safely without crashing", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValueOnce({ count: 0 }); // Count 0 stale update

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.results[0]?.classification).toBe("METADATA_STALE");
  });

  it("13. Verifies TTL, urgency, and timeout parameters for all event types", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 1. WAITLIST_CALLED -> TTL 300, urgency high, timeout 5000
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });

    const waitlistNotif = {
      id: "notif-w",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-w",
      title: "É a sua vez",
      content: "Você foi chamado.",
      type: "WAITLIST_CALLED",
      target: "WAITLIST",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    await deliverSingleNotification(waitlistNotif);
    expect(webpush.sendNotification).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(String),
      { TTL: 300, urgency: "high", timeout: 5000 }
    );

    // 2. APPOINTMENT_CREATED -> TTL 3600, urgency normal, timeout 5000
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });

    const createdNotif = {
      id: "notif-c",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-c",
      title: "Novo agendamento",
      content: "Novo agendamento.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    await deliverSingleNotification(createdNotif);
    expect(webpush.sendNotification).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(String),
      { TTL: 3600, urgency: "normal", timeout: 5000 }
    );

    // 3. APPOINTMENT_CANCELLED_BY_CUSTOMER -> TTL 3600, urgency high, timeout 5000
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });

    const customerCancelNotif = {
      id: "notif-cc",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-cc",
      title: "Agendamento cancelado",
      content: "Cancelado pelo cliente.",
      type: "APPOINTMENT_CANCELLED_BY_CUSTOMER",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    await deliverSingleNotification(customerCancelNotif);
    expect(webpush.sendNotification).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(String),
      { TTL: 3600, urgency: "high", timeout: 5000 }
    );

    // 4. APPOINTMENT_CANCELLED_BY_STAFF -> TTL 3600, urgency high, timeout 5000
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });

    const staffCancelNotif = {
      id: "notif-sc",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-sc",
      title: "Agendamento cancelado",
      content: "Cancelado pela barbearia.",
      type: "APPOINTMENT_CANCELLED_BY_STAFF",
      target: "CLIENT_APPOINTMENTS",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    await deliverSingleNotification(staffCancelNotif);
    expect(webpush.sendNotification).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(String),
      { TTL: 3600, urgency: "high", timeout: 5000 }
    );
  });

  it("14. deliverCreatedNotifications processes batch of notifications", async () => {
    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValue([]);

    const notif1 = { id: "n1", userId: "u1", title: "T1", content: "C1", target: "WAITLIST", type: "WAITLIST_CALLED" } as Notification;
    const notif2 = { id: "n2", userId: "u2", title: "T2", content: "C2", target: "MEMBER_AGENDA", type: "APPOINTMENT_CREATED" } as Notification;

    const results = await deliverCreatedNotifications([notif1, notif2]);
    expect(results).toHaveLength(2);
    expect(results[0]?.notificationId).toBe("n1");
    expect(results[1]?.notificationId).toBe("n2");
  });

  it("15. Handles 429 Retry-After delay-seconds <= 5s by retrying and completing as SUCCESS", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce({
        statusCode: 429,
        headers: { "retry-after": "1" },
      })
      .mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Agendamento cancelado",
      content: "Agendamento cancelado.",
      type: "APPOINTMENT_CANCELLED_BY_CUSTOMER",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);

    expect(res.results[0]?.classification).toBe("SUCCESS");
    expect(res.results[0]?.attempts).toBe(2);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    // Success metadata executes (failureCount set to 0)
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        id: "sub-1",
        userId: "user-1",
        endpoint: "https://push.example.com/sub-1",
        p256dh: "key-1",
        auth: "auth-1",
      },
      data: {
        lastSuccessfulAt: expect.any(Date),
        failureCount: 0,
        lastFailureAt: null,
      },
    });
  });

  it("16. Handles 429 Retry-After HTTP-date <= 5s in future by retrying and completing as SUCCESS", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const futureHttpDate = new Date(Date.now() + 2000).toUTCString();

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce({
        statusCode: 429,
        headers: { "retry-after": futureHttpDate },
      })
      .mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Agendamento cancelado",
      content: "Agendamento cancelado.",
      type: "APPOINTMENT_CANCELLED_BY_CUSTOMER",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);

    expect(res.results[0]?.classification).toBe("SUCCESS");
    expect(res.results[0]?.attempts).toBe(2);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("17. Retries socket TimeoutError rejections as RETRYABLE_NETWORK up to MAX_TOTAL_ATTEMPTS = 3", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockRejectedValue({ name: "TimeoutError" });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);

    expect(res.results[0]?.classification).toBe("RETRYABLE_NETWORK");
    expect(res.results[0]?.attempts).toBe(3);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("18. Retries network errors (ECONNRESET) as RETRYABLE_NETWORK up to MAX_TOTAL_ATTEMPTS = 3", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockRejectedValue({ code: "ECONNRESET" });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 1 });

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);

    expect(res.results[0]?.classification).toBe("RETRYABLE_NETWORK");
    expect(res.results[0]?.attempts).toBe(3);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it("19. Stale snapshot on final failure updateMany count=0 handles update safely without exception", async () => {
    const mockSub = {
      id: "sub-1",
      userId: "user-1",
      endpoint: "https://push.example.com/sub-1",
      p256dh: "key-1",
      auth: "auth-1",
      expirationTime: null,
      failureCount: 0,
      lastFailureAt: null,
      lastSuccessfulAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webPushSubscription.findMany).mockResolvedValueOnce([mockSub] as any);
    vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 503 });
    vi.mocked(prisma.webPushSubscription.updateMany).mockResolvedValue({ count: 0 }); // Stale snapshot update

    const notif = {
      id: "notif-1",
      userId: "user-1",
      barbershopId: "shop-1",
      eventKey: "key-1",
      title: "Novo agendamento",
      content: "Novo agendamento.",
      type: "APPOINTMENT_CREATED",
      target: "MEMBER_AGENDA",
      readAt: null,
      createdAt: new Date(),
    } as Notification;

    const res = await deliverSingleNotification(notif);
    expect(res.results[0]?.classification).toBe("RETRYABLE_SERVER");
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.webPushSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        id: "sub-1",
        userId: "user-1",
        endpoint: "https://push.example.com/sub-1",
        p256dh: "key-1",
        auth: "auth-1",
      },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: expect.any(Date),
      },
    });
  });
});
