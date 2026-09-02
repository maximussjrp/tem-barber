import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import prisma from "@/lib/prisma";
import { prepareWaitlistCalledNotifications } from "@/lib/push/events.server";

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe("Push Waitlist Events (src/lib/push/events.server.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Creates WAITLIST_CALLED notification when entry status is CALLED and customerId is non-null", async () => {
    (prisma.notification.create as any).mockImplementation(async (args: any) => ({
      id: "notif-w1",
      ...args.data,
      createdAt: new Date(),
    }));

    const calledAt = new Date("2026-09-02T16:00:00.000Z");
    const res = await prepareWaitlistCalledNotifications({
      entry: {
        id: "entry-99",
        barbershopId: "shop-1",
        customerId: "user-client-789",
        status: "CALLED",
        calledAt,
      },
    });

    expect(res.created).toHaveLength(1);
    expect(res.created[0]?.userId).toBe("user-client-789");
    expect(res.created[0]?.target).toBe("WAITLIST");
    expect(res.created[0]?.eventKey).toBe(
      `WAITLIST_CALLED:entry-99:${calledAt.toISOString()}:user-client-789`
    );
  });

  it("2. Returns 0 notifications when customerId is null", async () => {
    const calledAt = new Date();
    const res = await prepareWaitlistCalledNotifications({
      entry: {
        id: "entry-100",
        barbershopId: "shop-1",
        customerId: null,
        status: "CALLED",
        calledAt,
      },
    });

    expect(res.created).toHaveLength(0);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("3. Returns 0 notifications when calledAt is null", async () => {
    const res = await prepareWaitlistCalledNotifications({
      entry: {
        id: "entry-101",
        barbershopId: "shop-1",
        customerId: "user-client-789",
        status: "CALLED",
        calledAt: null,
      },
    });

    expect(res.created).toHaveLength(0);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("4. Re-calling an entry (after pass-turn) generates a new eventKey with updated calledAt", async () => {
    (prisma.notification.create as any).mockImplementation(async (args: any) => ({
      id: "notif-w2",
      ...args.data,
      createdAt: new Date(),
    }));

    const firstCalledAt = new Date("2026-09-02T16:00:00.000Z");
    const secondCalledAt = new Date("2026-09-02T16:20:00.000Z");

    const res1 = await prepareWaitlistCalledNotifications({
      entry: {
        id: "entry-99",
        barbershopId: "shop-1",
        customerId: "user-client-789",
        status: "CALLED",
        calledAt: firstCalledAt,
      },
    });

    const res2 = await prepareWaitlistCalledNotifications({
      entry: {
        id: "entry-99",
        barbershopId: "shop-1",
        customerId: "user-client-789",
        status: "CALLED",
        calledAt: secondCalledAt,
      },
    });

    expect(res1.created[0]?.eventKey).toBe(
      `WAITLIST_CALLED:entry-99:${firstCalledAt.toISOString()}:user-client-789`
    );
    expect(res2.created[0]?.eventKey).toBe(
      `WAITLIST_CALLED:entry-99:${secondCalledAt.toISOString()}:user-client-789`
    );
    expect(res1.created[0]?.eventKey).not.toBe(res2.created[0]?.eventKey);
  });
});
