import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mock next/server after()
let capturedAfterCallbacks: Array<() => Promise<void>> = [];

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: vi.fn((fn: () => Promise<void>) => {
      capturedAfterCallbacks.push(fn);
    }),
  };
});

import prisma from "@/lib/prisma";
import * as eventsServer from "@/lib/push/events.server";
import * as deliveryServer from "@/lib/push/delivery.server";

// Import route handlers directly
import { POST as publicBookPOST } from "@/app/api/public/barbershop/[slug]/book/route";
import { POST as adminAppointmentPOST } from "@/app/api/admin/appointments/route";
import { PATCH as clientAppointmentPATCH } from "@/app/api/client/appointments/route";
import { PATCH as adminAppointmentPATCH } from "@/app/api/admin/appointments/[id]/route";
import { PATCH as memberAgendaPATCH } from "@/app/api/member/agenda/[id]/status/route";
import { POST as adminWaitlistCallNextPOST } from "@/app/api/admin/waitlist/call-next/route";
import { POST as memberWaitlistCallNextPOST } from "@/app/api/member/waitlist/call-next/route";

vi.mock("@/lib/prisma", () => ({
  default: {
    barbershop: { findUnique: vi.fn(), findFirst: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    barberService: { findMany: vi.fn() },
    workingHour: { findFirst: vi.fn() },
    appointment: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
    comanda: { findFirst: vi.fn(), update: vi.fn() },
    financialEntry: { count: vi.fn() },
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    barbershopMember: { findMany: vi.fn(), findFirst: vi.fn() },
    timeOff: { findMany: vi.fn() },
    customerBarbershopLink: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    notification: { create: vi.fn(), findUnique: vi.fn() },
    webPushSubscription: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: vi.fn(),
}));

vi.mock("@/lib/member-api-auth", () => ({
  getMemberSession: vi.fn(),
}));

vi.mock("@/lib/subscription-utils", () => ({
  getTenantSubscription: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
  isSubscriptionActive: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/waitlist/call-next", () => ({
  callNextWaitlistEntry: vi.fn(),
  CallNextWaitlistError: class extends Error {
    code: string;
    statusCode: number;
    preferredMember?: any;
    constructor(code: string, message: string, statusCode = 400, preferredMember?: any) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
      this.preferredMember = preferredMember;
    }
  },
}));

vi.mock("@/lib/push/delivery.server", () => ({
  deliverCreatedNotifications: vi.fn().mockResolvedValue([]),
}));

describe("P0.1C Route Integration Suite (7 Direct Routes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAfterCallbacks = [];
  });

  it("1. Public booking route registers after() hook and triggers delivery on NORMAL booking (no actor exclusion)", async () => {
    const mockBarbershop = { id: "shop-1", slug: "barber-slug", phone: "11999998888", active: true };
    vi.mocked(prisma.barbershop.findUnique).mockResolvedValue(mockBarbershop as any);
    vi.mocked(prisma.barbershop.findFirst).mockResolvedValue(mockBarbershop as any);
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.barbershopMember.findFirst).mockResolvedValue({ id: "member-1", isActive: true, workingHours: [{ startTime: "00:00", endTime: "23:59" }] } as any);
    vi.mocked(prisma.service.findMany).mockResolvedValue([{ id: "s1", name: "Corte", price: 50, durationMin: 30, isActive: true }] as any);
    vi.mocked(prisma.barberService.findMany).mockResolvedValue([{ serviceId: "s1" }] as any);
    vi.mocked(prisma.workingHour.findFirst).mockResolvedValue({ dayOfWeek: 4, isOpen: true, startTime: "08:00", endTime: "20:00" } as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "customer-1", name: "Public Client", phone: "11999998888" } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.appointment.count).mockResolvedValue(0);
    vi.mocked(prisma.timeOff.findMany).mockResolvedValue([]);

    const mockAppt = {
      id: "appt-public-1",
      barbershopId: "shop-1",
      memberId: "member-1",
      bookingMode: "NORMAL",
      customer: { name: "Public Client" },
      dateTime: new Date("2026-09-10T13:00:00.000Z"),
      totalPrice: 50,
      durationMin: 30,
      status: "CONFIRMED",
      barber: { user: { name: "Barber 1" } },
      services: [{ service: { name: "Corte" } }],
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const txMock = {
        ...prisma,
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn().mockResolvedValue([]),
        workingHour: { findFirst: vi.fn().mockResolvedValue({ dayOfWeek: 4, isOpen: true, startTime: "08:00", endTime: "20:00" }) },
        appointment: {
          ...prisma.appointment,
          create: vi.fn().mockResolvedValue(mockAppt),
          findMany: vi.fn().mockResolvedValue([]),
        },
        idempotencyKey: {
          ...prisma.idempotencyKey,
          create: vi.fn().mockResolvedValue({}),
        },
        customerBarbershopLink: {
          findUnique: vi.fn().mockResolvedValue({ whatsappVerifiedAt: new Date() }),
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(txMock);
    });

    vi.mocked(prisma.barbershopMember.findMany).mockResolvedValue([{ userId: "staff-1" }] as any);
    (prisma.notification.create as any).mockResolvedValue({ id: "n-1", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareAppointmentCreatedNotifications");

    const request = new Request("http://localhost/api/public/barbershop/barber-slug/book", {
      method: "POST",
      headers: { "Idempotency-Key": "e8a937a0-1234-4a29-8f0a-111111111111", "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: "member-1",
        serviceIds: ["s1"],
        dateTime: "2026-09-10T10:00:00.000Z",
        date: "2026-09-10",
        time: "10:00",
        customerName: "Public Client",
        customerPhone: "11999998888",
      }),
    });

    const res = await publicBookPOST(request as any, { params: Promise.resolve({ slug: "barber-slug" }) });
    expect(res.status).toBe(201);

    // Verified: prepare function was called without actor exclusion
    expect(prepareSpy).toHaveBeenCalledWith({
      appointment: expect.objectContaining({ id: "appt-public-1" }),
    });

    // Verified: after() callback was registered
    expect(capturedAfterCallbacks).toHaveLength(1);

    // Verified: delivery is NOT called before captured after callback executes
    expect(deliveryServer.deliverCreatedNotifications).not.toHaveBeenCalled();

    // Execute captured after callback
    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("2. Admin appointment create route registers after() hook and excludes admin actor", async () => {
    const { getAdminSession } = await import("@/lib/api-auth");
    vi.mocked(getAdminSession).mockResolvedValueOnce({
      data: { userId: "admin-user-1", barbershopId: "shop-1", role: "OWNER" },
    } as any);

    vi.mocked(prisma.barbershopMember.findFirst).mockResolvedValue({ id: "member-1", isActive: true } as any);
    vi.mocked(prisma.service.findMany).mockResolvedValue([{ id: "s1", name: "Corte", price: 50, durationMin: 30, isActive: true }] as any);
    vi.mocked(prisma.barberService.findMany).mockResolvedValue([{ serviceId: "s1" }] as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "customer-1", name: "Client A", phone: "11999998888" } as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    const mockAppt = {
      id: "appt-admin-1",
      barbershopId: "shop-1",
      memberId: "member-1",
      bookingMode: "NORMAL",
      customer: { name: "Client A" },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const txMock = {
        ...prisma,
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn().mockResolvedValue([]),
        appointment: {
          ...prisma.appointment,
          create: vi.fn().mockResolvedValue(mockAppt),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      return cb(txMock);
    });

    vi.mocked(prisma.barbershopMember.findMany).mockResolvedValue([{ userId: "staff-1" }] as any);
    (prisma.notification.create as any).mockResolvedValue({ id: "n-2", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareAppointmentCreatedNotifications");

    const request = new Request("http://localhost/api/admin/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: "member-1",
        serviceIds: ["s1"],
        dateTime: "2026-09-10T11:00:00.000Z",
        customerName: "Client A",
        customerPhone: "11999998888",
        bookingMode: "NORMAL",
      }),
    });

    const res = await adminAppointmentPOST(request as any);
    expect(res.status).toBe(201);

    expect(prepareSpy).toHaveBeenCalledWith({
      appointment: mockAppt,
      actorUserId: "admin-user-1",
    });
    expect(capturedAfterCallbacks).toHaveLength(1);

    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("3. Client appointment cancel route registers after() hook on cancellation", async () => {
    const { getServerSession } = await import("next-auth");
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: "client-user-1", authLevel: "verified_otp" },
    });

    const mockAppt = {
      id: "appt-client-1",
      barbershopId: "shop-1",
      memberId: "member-1",
      customerId: "client-user-1",
      status: "CONFIRMED",
      dateTime: new Date(Date.now() + 3600_000).toISOString(),
    };

    const updatedAppt = {
      ...mockAppt,
      status: "CANCELLED",
      updatedAt: new Date(),
    };

    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(mockAppt as any);
    vi.mocked(prisma.appointment.update).mockResolvedValueOnce(updatedAppt as any);

    vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce([{ userId: "staff-1" }] as any);
    (prisma.notification.create as any).mockResolvedValue({ id: "n-3", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareAppointmentCancelledByCustomerNotifications");

    const request = new Request("http://localhost/api/client/appointments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "appt-client-1" }),
    });

    const res = await clientAppointmentPATCH(request as any);
    expect(res.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalledWith({
      appointment: updatedAppt,
      previousStatus: "CONFIRMED",
      actorUserId: "client-user-1",
    });
    expect(capturedAfterCallbacks).toHaveLength(1);

    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("4a. Admin appointment cancel (Path A: With Comanda) registers after() hook", async () => {
    const { getAdminSession } = await import("@/lib/api-auth");
    vi.mocked(getAdminSession).mockResolvedValueOnce({
      data: { userId: "admin-user-1", barbershopId: "shop-1", role: "OWNER" },
    } as any);

    const mockExisting = {
      id: "appt-admin-comanda-1",
      barbershopId: "shop-1",
      status: "CONFIRMED",
    };

    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(mockExisting as any);
    vi.mocked(prisma.comanda.findFirst).mockResolvedValueOnce({
      id: "comanda-1",
      status: "OPEN",
      payments: [],
      items: [],
      financialEntries: [],
      commissions: [],
    } as any);
    vi.mocked(prisma.financialEntry.count).mockResolvedValueOnce(0);

    const updatedTxAppt = {
      id: "appt-admin-comanda-1",
      barbershopId: "shop-1",
      customerId: "client-user-99",
      status: "CANCELLED",
      updatedAt: new Date(),
    };

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => {
      const txMock = {
        comanda: { update: vi.fn().mockResolvedValue({}) },
        appointment: { update: vi.fn().mockResolvedValue(updatedTxAppt) },
      };
      return cb(txMock);
    });

    (prisma.notification.create as any).mockResolvedValue({ id: "n-4a", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareAppointmentCancelledByStaffNotifications");

    const request = new Request("http://localhost/api/admin/appointments/appt-admin-comanda-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });

    const res = await adminAppointmentPATCH(request as any, { params: Promise.resolve({ id: "appt-admin-comanda-1" }) });
    expect(res.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalledWith({
      appointment: updatedTxAppt,
      previousStatus: "CONFIRMED",
      actorUserId: "admin-user-1",
    });
    expect(capturedAfterCallbacks).toHaveLength(1);

    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("4b. Admin appointment cancel (Path B: Without Comanda) registers after() hook", async () => {
    const { getAdminSession } = await import("@/lib/api-auth");
    vi.mocked(getAdminSession).mockResolvedValueOnce({
      data: { userId: "admin-user-1", barbershopId: "shop-1", role: "OWNER" },
    } as any);

    const mockExisting = {
      id: "appt-admin-nocomanda-1",
      barbershopId: "shop-1",
      status: "CONFIRMED",
    };

    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(mockExisting as any);
    vi.mocked(prisma.comanda.findFirst).mockResolvedValueOnce(null); // No comanda

    const updatedAppt = {
      id: "appt-admin-nocomanda-1",
      barbershopId: "shop-1",
      customerId: "client-user-99",
      status: "CANCELLED",
      updatedAt: new Date(),
    };

    vi.mocked(prisma.appointment.update).mockResolvedValueOnce(updatedAppt as any);

    (prisma.notification.create as any).mockResolvedValue({ id: "n-4b", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareAppointmentCancelledByStaffNotifications");

    const request = new Request("http://localhost/api/admin/appointments/appt-admin-nocomanda-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });

    const res = await adminAppointmentPATCH(request as any, { params: Promise.resolve({ id: "appt-admin-nocomanda-1" }) });
    expect(res.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalledWith({
      appointment: updatedAppt,
      previousStatus: "CONFIRMED",
      actorUserId: "admin-user-1",
    });
    expect(capturedAfterCallbacks).toHaveLength(1);

    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("5. Member appointment cancel route registers after() hook", async () => {
    const { getMemberSession } = await import("@/lib/member-api-auth");
    vi.mocked(getMemberSession).mockResolvedValueOnce({
      data: { userId: "member-user-1", memberId: "mem-1", barbershopId: "shop-1", role: "BARBER" },
    } as any);

    const mockAppt = {
      id: "appt-member-1",
      memberId: "mem-1",
      status: "CONFIRMED",
    };

    const updatedAppt = {
      id: "appt-member-1",
      barbershopId: "shop-1",
      customerId: "client-user-88",
      status: "CANCELLED",
      updatedAt: new Date(),
    };

    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(mockAppt as any);
    vi.mocked(prisma.appointment.update).mockResolvedValueOnce(updatedAppt as any);

    (prisma.notification.create as any).mockResolvedValue({ id: "n-5", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareAppointmentCancelledByStaffNotifications");

    const request = new Request("http://localhost/api/member/agenda/appt-member-1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });

    const res = await memberAgendaPATCH(request as any, { params: Promise.resolve({ id: "appt-member-1" }) });
    expect(res.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalledWith({
      appointment: updatedAppt,
      previousStatus: "CONFIRMED",
      actorUserId: "member-user-1",
    });
    expect(capturedAfterCallbacks).toHaveLength(1);

    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("6. Admin waitlist call-next route registers after() hook when customerId is present", async () => {
    const { getAdminSession } = await import("@/lib/api-auth");
    vi.mocked(getAdminSession).mockResolvedValueOnce({
      data: { userId: "admin-user-1", barbershopId: "shop-1", role: "OWNER" },
    } as any);

    const { callNextWaitlistEntry } = await import("@/lib/waitlist/call-next");
    const mockEntry = {
      id: "entry-admin-1",
      barbershopId: "shop-1",
      customerId: "client-user-77",
      status: "CALLED",
      calledAt: new Date(),
    };

    vi.mocked(callNextWaitlistEntry).mockResolvedValueOnce({
      entry: mockEntry as any,
      preferredMemberMismatch: false,
    });

    (prisma.notification.create as any).mockResolvedValue({ id: "n-6", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareWaitlistCalledNotifications");

    const request = new Request("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: "mem-1" }),
    });

    const res = await adminWaitlistCallNextPOST(request as any);
    expect(res.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalledWith({ entry: mockEntry });
    expect(capturedAfterCallbacks).toHaveLength(1);

    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("7. Member waitlist call-next route registers after() hook when customerId is present", async () => {
    const { getMemberSession } = await import("@/lib/member-api-auth");
    vi.mocked(getMemberSession).mockResolvedValueOnce({
      data: { userId: "member-user-1", memberId: "mem-1", barbershopId: "shop-1", role: "BARBER" },
    } as any);

    const { callNextWaitlistEntry } = await import("@/lib/waitlist/call-next");
    const mockEntry = {
      id: "entry-member-1",
      barbershopId: "shop-1",
      customerId: "client-user-66",
      status: "CALLED",
      calledAt: new Date(),
    };

    vi.mocked(callNextWaitlistEntry).mockResolvedValueOnce({
      entry: mockEntry as any,
      preferredMemberMismatch: false,
    });

    (prisma.notification.create as any).mockResolvedValue({ id: "n-7", createdAt: new Date() });

    const prepareSpy = vi.spyOn(eventsServer, "prepareWaitlistCalledNotifications");

    const request = new Request("http://localhost/api/member/waitlist/call-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await memberWaitlistCallNextPOST(request as any);
    expect(res.status).toBe(200);

    expect(prepareSpy).toHaveBeenCalledWith({ entry: mockEntry });
    expect(capturedAfterCallbacks).toHaveLength(1);

    await capturedAfterCallbacks[0]!();
    expect(deliveryServer.deliverCreatedNotifications).toHaveBeenCalledTimes(1);
  });

  it("8. Waitlist route with customerId=null produces zero created notifications and registers zero after() hooks", async () => {
    const { getAdminSession } = await import("@/lib/api-auth");
    vi.mocked(getAdminSession).mockResolvedValueOnce({
      data: { userId: "admin-user-1", barbershopId: "shop-1", role: "OWNER" },
    } as any);

    const { callNextWaitlistEntry } = await import("@/lib/waitlist/call-next");
    const mockEntryNullCustomer = {
      id: "entry-admin-null",
      barbershopId: "shop-1",
      customerId: null, // Walk-in with no customerId
      status: "CALLED",
      calledAt: new Date(),
    };

    vi.mocked(callNextWaitlistEntry).mockResolvedValueOnce({
      entry: mockEntryNullCustomer as any,
      preferredMemberMismatch: false,
    });

    const request = new Request("http://localhost/api/admin/waitlist/call-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: "mem-1" }),
    });

    const res = await adminWaitlistCallNextPOST(request as any);
    expect(res.status).toBe(200);

    // Zero after() callbacks registered because created.length === 0
    expect(capturedAfterCallbacks).toHaveLength(0);
  });
});
