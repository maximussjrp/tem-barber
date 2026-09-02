import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import prisma from "@/lib/prisma";
import {
  getSafeFirstName,
  prepareAppointmentCreatedNotifications,
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

describe("Push Event Recipients & Helper Logic (src/lib/push/events.server.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSafeFirstName()", () => {
    it("extracts first token, strips control chars, and enforces length bounds", () => {
      expect(getSafeFirstName("  Carlos   Eduardo  ")).toBe("Carlos");
      expect(getSafeFirstName("Ana-Maria")).toBe("Ana-Maria");
      expect(getSafeFirstName("João\x07Silva")).toBe("JoãoSilva");
      expect(getSafeFirstName(null)).toBeNull();
      expect(getSafeFirstName("")).toBeNull();
      expect(getSafeFirstName("   ")).toBeNull();
    });

    it("truncates extremely long single token to 40 chars max", () => {
      const longName = "A".repeat(50);
      const res = getSafeFirstName(longName);
      expect(res).toHaveLength(40);
      expect(res).toBe("A".repeat(40));
    });
  });

  describe("Recipient Resolution & Deduplication", () => {
    it("1. Resolves active OWNER, MANAGER, and assigned BARBER deduplicated by userId", async () => {
      const mockMembers = [
        { userId: "user-barber" },
        { userId: "user-owner" },
        { userId: "user-owner" }, // Duplicate userId
        { userId: "user-manager" },
      ];

      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce(mockMembers as any);
      (prisma.notification.create as any).mockImplementation(async (args: any) => ({
        id: "notif-id",
        ...args.data,
        createdAt: new Date(),
      }));

      const res = await prepareAppointmentCreatedNotifications({
        appointment: {
          id: "appt-100",
          barbershopId: "shop-1",
          memberId: "member-barber",
          bookingMode: "NORMAL",
          customer: { name: "Maria Santos" },
        },
      });

      expect(prisma.barbershopMember.findMany).toHaveBeenCalledWith({
        where: {
          barbershopId: "shop-1",
          isActive: true,
          OR: [
            { id: "member-barber" },
            { role: { in: ["OWNER", "MANAGER"] } },
          ],
        },
        select: { userId: true },
      });

      expect(res.created).toHaveLength(3); // user-barber, user-owner, user-manager
      expect(res.duplicateCount).toBe(0);
      expect(res.failureCount).toBe(0);
    });

    it("2. Public booking has NO actor exclusion: includes user even if sessionUserId matches member", async () => {
      const mockMembers = [
        { userId: "user-public-customer-and-owner" },
        { userId: "user-barber" },
      ];

      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce(mockMembers as any);
      (prisma.notification.create as any).mockImplementation(async (args: any) => ({
        id: "notif-id",
        ...args.data,
        createdAt: new Date(),
      }));

      const res = await prepareAppointmentCreatedNotifications({
        appointment: {
          id: "appt-public-1",
          barbershopId: "shop-1",
          memberId: "member-barber",
          bookingMode: "NORMAL",
          customer: { name: "Cliente Publico" },
        },
        // NO actorUserId passed for public booking
      });

      expect(res.created).toHaveLength(2); // Retains user-public-customer-and-owner
      expect(res.created.map((c) => c.userId)).toContain("user-public-customer-and-owner");
    });

    it("3. Admin booking applies actor exclusion when actorUserId is provided", async () => {
      const mockMembers = [
        { userId: "user-admin-owner" },
        { userId: "user-barber" },
      ];

      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce(mockMembers as any);
      (prisma.notification.create as any).mockImplementation(async (args: any) => ({
        id: "notif-id",
        ...args.data,
        createdAt: new Date(),
      }));

      const res = await prepareAppointmentCreatedNotifications({
        appointment: {
          id: "appt-101",
          barbershopId: "shop-1",
          memberId: "member-barber",
          bookingMode: "NORMAL",
          customer: { name: "Pedro Silva" },
        },
        actorUserId: "user-admin-owner", // Admin actor excluded
      });

      expect(res.created).toHaveLength(1);
      expect(res.created[0]?.userId).toBe("user-barber");
    });

    it("4. Inactive members (isActive=false) are excluded by query filter", async () => {
      // Query filter enforces isActive: true
      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce([]);

      const res = await prepareAppointmentCreatedNotifications({
        appointment: {
          id: "appt-102",
          barbershopId: "shop-1",
          memberId: "member-inactive",
          bookingMode: "NORMAL",
          customer: { name: "Lucas" },
        },
      });

      expect(prisma.barbershopMember.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ isActive: true }),
        select: { userId: true },
      });
      expect(res.created).toHaveLength(0);
    });

    it("5. Does NOT emit APPOINTMENT_CREATED event for FIT_IN booking mode", async () => {
      const res = await prepareAppointmentCreatedNotifications({
        appointment: {
          id: "appt-fitin-1",
          barbershopId: "shop-1",
          memberId: "member-barber",
          bookingMode: "FIT_IN",
          customer: { name: "Marcos" },
        },
      });

      expect(res.created).toHaveLength(0);
      expect(prisma.barbershopMember.findMany).not.toHaveBeenCalled();
    });

    it("6. Uses fallback text when customer name is blank or malformed", async () => {
      const mockMembers = [{ userId: "user-barber" }];
      vi.mocked(prisma.barbershopMember.findMany).mockResolvedValueOnce(mockMembers as any);
      (prisma.notification.create as any).mockImplementation(async (args: any) => ({
        id: "notif-id",
        ...args.data,
        createdAt: new Date(),
      }));

      const res = await prepareAppointmentCreatedNotifications({
        appointment: {
          id: "appt-blank-name",
          barbershopId: "shop-1",
          memberId: "member-barber",
          bookingMode: "NORMAL",
          customer: { name: "   \x07  " }, // Blank / control chars
        },
      });

      expect(res.created).toHaveLength(1);
      expect(res.created[0]?.content).toBe("Novo agendamento recebido. Confira sua agenda.");
    });
  });
});
