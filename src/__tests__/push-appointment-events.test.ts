import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  prepareAppointmentCancelledByCustomerNotifications,
  prepareAppointmentCancelledByStaffNotifications,
} from "@/lib/push/events.server";

vi.mock("@/lib/prisma", () => ({
  default: {
    barbershopMember: {
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe("Push Appointment Events (src/lib/push/events.server.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("APPOINTMENT_CANCELLED_BY_CUSTOMER", () => {
    it("1. Creates notifications for staff when client cancels an active appointment", async () => {
      const mockMembers = [{ userId: "user-barber" }, { userId: "user-owner" }];
      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce(mockMembers as any);
      (prisma.notification.create as any).mockImplementation(async (args: any) => ({
        id: "notif-c1",
        ...args.data,
        createdAt: new Date(),
      }));

      const updatedAt = new Date("2026-09-02T12:00:00.000Z");
      const res = await prepareAppointmentCancelledByCustomerNotifications({
        appointment: {
          id: "appt-200",
          barbershopId: "shop-1",
          memberId: "member-barber",
          status: "CANCELLED",
          updatedAt,
          customer: { name: "Lucas Lima" },
        },
        previousStatus: "CONFIRMED",
        actorUserId: "user-client-123",
      });

      expect(res.created).toHaveLength(2);
      expect(res.created[0]?.eventKey).toBe(
        `APPOINTMENT_CANCELLED_BY_CUSTOMER:appt-200:${updatedAt.toISOString()}:user-barber`
      );
      expect(res.created[0]?.target).toBe("MEMBER_AGENDA");
    });

    it("2. Returns 0 notifications if previousStatus was already CANCELLED", async () => {
      const res = await prepareAppointmentCancelledByCustomerNotifications({
        appointment: {
          id: "appt-200",
          barbershopId: "shop-1",
          memberId: "member-barber",
          status: "CANCELLED",
          updatedAt: new Date(),
          customer: { name: "Lucas Lima" },
        },
        previousStatus: "CANCELLED",
        actorUserId: "user-client-123",
      });

      expect(res.created).toHaveLength(0);
      expect(prisma.barbershopMember.findMany).not.toHaveBeenCalled();
    });

    it("3. Partial failure: recipient A fails, recipient B creation still succeeds", async () => {
      const mockMembers = [{ userId: "user-a" }, { userId: "user-b" }];
      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce(mockMembers as any);

      (prisma.notification.create as any)
        .mockRejectedValueOnce(new Error("DB error for A")) // User A fails
        .mockResolvedValueOnce({
          id: "notif-b",
          userId: "user-b",
          eventKey: "key-b",
          createdAt: new Date(),
        }); // User B succeeds

      const updatedAt = new Date("2026-09-02T12:00:00.000Z");
      const res = await prepareAppointmentCancelledByCustomerNotifications({
        appointment: {
          id: "appt-201",
          barbershopId: "shop-1",
          memberId: "member-barber",
          status: "CANCELLED",
          updatedAt,
          customer: { name: "Lucas Lima" },
        },
        previousStatus: "CONFIRMED",
        actorUserId: "user-client-123",
      });

      expect(res.created).toHaveLength(1);
      expect(res.created[0]?.userId).toBe("user-b");
      expect(res.failureCount).toBe(1);
      expect(res.duplicateCount).toBe(0);
    });
  });

  describe("APPOINTMENT_CANCELLED_BY_STAFF", () => {
    it("4. Creates notification for client when staff cancels appointment", async () => {
      (prisma.notification.create as any).mockImplementation(async (args: any) => ({
        id: "notif-s1",
        ...args.data,
        createdAt: new Date(),
      }));

      const updatedAt = new Date("2026-09-02T14:30:00.000Z");
      const res = await prepareAppointmentCancelledByStaffNotifications({
        appointment: {
          id: "appt-300",
          barbershopId: "shop-1",
          customerId: "user-client-456",
          status: "CANCELLED",
          updatedAt,
        },
        previousStatus: "CONFIRMED",
        actorUserId: "user-staff-admin",
      });

      expect(res.created).toHaveLength(1);
      expect(res.created[0]?.userId).toBe("user-client-456");
      expect(res.created[0]?.eventKey).toBe(
        `APPOINTMENT_CANCELLED_BY_STAFF:appt-300:${updatedAt.toISOString()}:user-client-456`
      );
      expect(res.created[0]?.target).toBe("CLIENT_APPOINTMENTS");
    });

    it("5. Returns 0 notifications if customerId is missing/null", async () => {
      const res = await prepareAppointmentCancelledByStaffNotifications({
        appointment: {
          id: "appt-301",
          barbershopId: "shop-1",
          customerId: null,
          status: "CANCELLED",
          updatedAt: new Date(),
        },
        previousStatus: "CONFIRMED",
        actorUserId: "user-staff-admin",
      });

      expect(res.created).toHaveLength(0);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("6. Handles P2002 duplicate by re-reading existing row and returning duplicateCount = 1", async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
      });

      (prisma.notification.create as any).mockRejectedValueOnce(p2002Error);
      (prisma.notification.findUnique as any).mockResolvedValueOnce({
        id: "existing-notif-id",
        userId: "user-client-456",
        barbershopId: "shop-1",
        eventKey: "APPOINTMENT_CANCELLED_BY_STAFF:appt-300:2026-09-02T14:30:00.000Z:user-client-456",
        title: "Agendamento cancelado",
        content: "Seu agendamento foi cancelado.",
        type: "APPOINTMENT_CANCELLED_BY_STAFF",
        target: "CLIENT_APPOINTMENTS",
        readAt: null,
        createdAt: new Date(),
      });

      const updatedAt = new Date("2026-09-02T14:30:00.000Z");
      const res = await prepareAppointmentCancelledByStaffNotifications({
        appointment: {
          id: "appt-300",
          barbershopId: "shop-1",
          customerId: "user-client-456",
          status: "CANCELLED",
          updatedAt,
        },
        previousStatus: "CONFIRMED",
        actorUserId: "user-staff-admin",
      });

      expect(res.created).toHaveLength(0);
      expect(res.duplicateCount).toBe(1);
      expect(res.failureCount).toBe(0);
    });

    it("7. Handles P2002 when re-reading existing row returns null (NO matching eventKey)", async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
      });

      (prisma.notification.create as any).mockRejectedValueOnce(p2002Error);
      (prisma.notification.findUnique as any).mockResolvedValueOnce(null); // No existing match found on re-read

      const updatedAt = new Date("2026-09-02T14:30:00.000Z");
      const res = await prepareAppointmentCancelledByStaffNotifications({
        appointment: {
          id: "appt-302",
          barbershopId: "shop-1",
          customerId: "user-client-456",
          status: "CANCELLED",
          updatedAt,
        },
        previousStatus: "CONFIRMED",
        actorUserId: "user-staff-admin",
      });

      expect(res.created).toHaveLength(0);
      expect(res.duplicateCount).toBe(0);
      expect(res.failureCount).toBe(1);
    });
  });
});
