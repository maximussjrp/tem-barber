/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimitStore } from "@/lib/public-rate-limit";

const txMock = {
  idempotencyKey: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  barbershop: { findFirst: vi.fn() },
  barbershopMember: { findFirst: vi.fn(), findMany: vi.fn() },
  service: { findMany: vi.fn() },
  barberService: { findMany: vi.fn() },
  appointmentWhatsappConfirmation: { create: vi.fn() },
  appointment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  timeOff: { findMany: vi.fn() },
  user: { findFirst: vi.fn(), create: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
};

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn(), findFirst: vi.fn() },
    tenantSubscription: { findUnique: vi.fn() },
    idempotencyKey: { findUnique: vi.fn() },
    service: { findMany: vi.fn() },
    barberService: { findMany: vi.fn() },
    barbershopMember: { findMany: vi.fn(), findFirst: vi.fn() },
    appointment: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    review: { findMany: vi.fn(), aggregate: vi.fn() },
    $transaction: vi.fn(),
  },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { GET as getBarbershop } from "@/app/api/public/barbershop/[slug]/route";
import { GET as getAvailability } from "@/app/api/public/barbershop/[slug]/availability/route";
import { POST as bookAppointment } from "@/app/api/public/barbershop/[slug]/book/route";

const slugParams = { params: Promise.resolve({ slug: "barbearia-v2" }) };

function createPostRequest(body: unknown, key = "11111111-1111-4111-8111-111111111111") {
  return new NextRequest("http://localhost/api/public/barbershop/barbearia-v2/book", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function createGetAvailabilityRequest(query: string) {
  return new NextRequest(`http://localhost/api/public/barbershop/barbearia-v2/availability?${query}`);
}

describe("Public Booking 2.0 API Suite", () => {
  const memberA = {
    id: "member-aaa",
    barbershopId: "shop-v2",
    role: "BARBER",
    isActive: true,
    user: { name: "Barber Alpha" },
    workingHours: [
      { dayOfWeek: 1, startTime: "09:00", endTime: "18:00", breakStart: null, breakEnd: null, isActive: true },
    ],
    timeOffs: [],
    services: [{ service: { id: "svc-1" } }],
  };

  const memberB = {
    id: "member-bbb",
    barbershopId: "shop-v2",
    role: "BARBER",
    isActive: true,
    user: { name: "Barber Beta" },
    workingHours: [
      { dayOfWeek: 1, startTime: "09:00", endTime: "18:00", breakStart: null, breakEnd: null, isActive: true },
    ],
    timeOffs: [],
    services: [{ service: { id: "svc-1" } }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    getServerSessionMock.mockResolvedValue(null);

    const baseBarbershop = {
      id: "shop-v2",
      slug: "barbearia-v2",
      name: "Barbearia V2",
      phone: "11988887777",
      active: true,
      categories: [],
      members: [],
    };

    prismaMock.barbershop.findUnique.mockResolvedValue(baseBarbershop);
    prismaMock.barbershop.findFirst = prismaMock.barbershop.findUnique;
    prismaMock.tenantSubscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      plan: "PRO",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    });
    prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
    txMock.idempotencyKey.findUnique.mockResolvedValue(null);
    txMock.idempotencyKey.create.mockResolvedValue({ id: "idem-a" });
    txMock.idempotencyKey.update.mockResolvedValue({ id: "idem-a" });
    txMock.barbershop.findFirst.mockResolvedValue(baseBarbershop);
    txMock.appointmentWhatsappConfirmation.create.mockResolvedValue({ id: "wa-conf-1" });
    txMock.$executeRaw.mockResolvedValue(0);
    txMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => cb(txMock));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Public Barbershop Profile & Team Filtering", () => {
    it("excludes RECEPTIONIST and inactive members from public team list", async () => {
      prismaMock.barbershop.findUnique.mockResolvedValue({
        id: "shop-v2",
        slug: "barbearia-v2",
        name: "Barbearia V2",
        phone: "11988887777",
        active: true,
        categories: [],
        members: [
          {
            id: "m-barber",
            role: "BARBER",
            isActive: true,
            user: { name: "Barbeiro João", avatarUrl: "/avatar-joao.png" },
            services: [],
            workingHours: [],
          },
          {
            id: "m-owner",
            role: "OWNER",
            isActive: true,
            user: { name: "Dono Carlos", avatarUrl: null },
            services: [],
            workingHours: [],
          },
        ],
      });
      prismaMock.category.findMany.mockResolvedValue([]);
      prismaMock.review.findMany.mockResolvedValue([]);
      prismaMock.review.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _avg: { rating: null },
      });

      const res = await getBarbershop(
        new NextRequest("http://localhost/api/public/barbershop/barbearia-v2"),
        slugParams
      );
      expect(res.status).toBe(200);
      const data = await res.json();

      // Check query filters sent to prisma
      expect(prismaMock.barbershop.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            members: expect.objectContaining({
              where: {
                isActive: true,
                role: { in: ["BARBER", "MANAGER", "OWNER"] },
              },
            }),
          }),
        })
      );
      expect(data.members).toHaveLength(2);
    });
  });

  describe("Availability & unionSlots", () => {
    it("returns unionSlots across all available barbers when memberId is 'any'", async () => {
      // Monday 2026-07-20
      prismaMock.service.findMany.mockResolvedValue([
        { id: "svc-hair", durationMin: 30, price: "50.00", isActive: true },
      ]);
      prismaMock.barberService.findMany.mockResolvedValue([
        { barberId: "barber-1", serviceId: "svc-hair" },
        { barberId: "barber-2", serviceId: "svc-hair" },
      ]);
      prismaMock.barbershopMember.findMany.mockImplementation((args: any) => {
        return Promise.resolve([{ id: "barber-1" }, { id: "barber-2" }]);
      });

      const barber1 = {
        id: "barber-1",
        barbershopId: "shop-v2",
        role: "BARBER",
        isActive: true,
        user: { name: "Barber One" },
        workingHours: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "11:00", breakStart: null, breakEnd: null, isActive: true },
        ],
        timeOffs: [],
      };

      const barber2 = {
        id: "barber-2",
        barbershopId: "shop-v2",
        role: "BARBER",
        isActive: true,
        user: { name: "Barber Two" },
        workingHours: [
          { dayOfWeek: 1, startTime: "10:30", endTime: "12:00", breakStart: null, breakEnd: null, isActive: true },
        ],
        timeOffs: [],
      };

      prismaMock.barbershopMember.findFirst.mockImplementation((args: any) => {
        if (args?.where?.id === "barber-1") return Promise.resolve(barber1);
        if (args?.where?.id === "barber-2") return Promise.resolve(barber2);
        return Promise.resolve(barber1);
      });
      prismaMock.appointment.findMany.mockResolvedValue([]);

      const res = await getAvailability(
        createGetAvailabilityRequest("memberId=any&serviceIds=svc-hair&date=2026-07-20"),
        slugParams
      );
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveProperty("unionSlots");
      expect(Array.isArray(data.unionSlots)).toBe(true);
      // unionSlots should contain sorted unique times from 09:00 to 11:30
      expect(data.unionSlots).toContain("09:00");
      expect(data.unionSlots).toContain("09:30");
      expect(data.unionSlots).toContain("10:00");
      expect(data.unionSlots).toContain("10:30");
      expect(data.unionSlots).toContain("11:00");
      expect(data.unionSlots).toContain("11:30");
      // Check results has both barbers
      expect(data.results).toHaveLength(2);
    });

    it("excludes RECEPTIONIST and includes OWNER in public availability", async () => {
      prismaMock.service.findMany.mockResolvedValue([
        { id: "svc-hair", durationMin: 30, price: "50.00", isActive: true },
      ]);
      prismaMock.barberService.findMany.mockResolvedValue([
        { barberId: "owner-1", serviceId: "svc-hair" },
        { barberId: "rec-1", serviceId: "svc-hair" },
      ]);
      prismaMock.barbershopMember.findMany.mockImplementation((args: any) => {
        return Promise.resolve([{ id: "owner-1" }, { id: "rec-1" }]);
      });

      const ownerMember = {
        id: "owner-1",
        barbershopId: "shop-v2",
        role: "OWNER",
        isActive: true,
        user: { name: "Dono Carlos" },
        workingHours: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", breakStart: null, breakEnd: null, isActive: true },
        ],
        timeOffs: [],
      };

      const recMember = {
        id: "rec-1",
        barbershopId: "shop-v2",
        role: "RECEPTIONIST",
        isActive: true,
        user: { name: "Recepcionista Rita" },
        workingHours: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", breakStart: null, breakEnd: null, isActive: true },
        ],
        timeOffs: [],
      };

      prismaMock.barbershopMember.findFirst.mockImplementation((args: any) => {
        if (args?.where?.id === "owner-1") return Promise.resolve(ownerMember);
        if (args?.where?.id === "rec-1") return Promise.resolve(recMember);
        return Promise.resolve(null);
      });
      prismaMock.appointment.findMany.mockResolvedValue([]);

      const res = await getAvailability(
        createGetAvailabilityRequest("memberId=any&serviceIds=svc-hair&date=2026-07-20"),
        slugParams
      );
      expect(res.status).toBe(200);
      const data = await res.json();

      // Only OWNER should be in results; RECEPTIONIST is excluded
      expect(data.results.map((r: any) => r.memberId)).toContain("owner-1");
      expect(data.results.map((r: any) => r.memberId)).not.toContain("rec-1");
    });
  });

  describe("Booking Validation & Notes Limit", () => {
    it("rejects booking if notes exceed 500 characters with NOTES_TOO_LONG", async () => {
      const longNotes = "A".repeat(501);
      const res = await bookAppointment(
        createPostRequest({
          memberId: "any",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
          notes: longNotes,
        }),
        slugParams
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("NOTES_TOO_LONG");
    });

    it("SPECIFIC booking respects requested memberId", async () => {
      txMock.service.findMany.mockResolvedValue([
        { id: "svc-1", price: "50.00", durationMin: 30, isActive: true },
      ]);
      txMock.barberService.findMany.mockResolvedValue([{ serviceId: "svc-1", barberId: "member-aaa" }]);
      txMock.barbershopMember.findFirst.mockResolvedValue(memberA);
      txMock.appointment.count.mockResolvedValue(0);
      txMock.appointment.findFirst.mockResolvedValue(null);
      txMock.appointment.findMany.mockResolvedValue([]);
      txMock.timeOff.findMany.mockResolvedValue([]);
      txMock.user.findFirst.mockResolvedValue(null);
      txMock.user.create.mockResolvedValue({ id: "cust-1", phone: "11988888888", name: "Cliente" });
      txMock.appointment.create.mockImplementation(async ({ data }: any) => ({
        id: "apt-specific-1",
        ...data,
        customer: { id: data.customerId, name: "Cliente Teste", phone: "11988888888" },
        barber: { user: { name: "Barber Alpha" } },
        services: [{ service: { name: "Corte", durationMin: 30 } }],
      }));

      const res = await bookAppointment(
        createPostRequest({
          memberId: "member-aaa",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }),
        slugParams
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.appointment.barberName).toBe("Barber Alpha");
      expect(txMock.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memberId: "member-aaa",
          }),
        })
      );
    });

    it("rejects booking when memberId belongs to another barbershop (cross-tenant)", async () => {
      txMock.service.findMany.mockResolvedValue([
        { id: "svc-1", price: "50.00", durationMin: 30, isActive: true },
      ]);
      txMock.barbershopMember.findFirst.mockResolvedValue(null); // not found in shop-v2

      const res = await bookAppointment(
        createPostRequest({
          memberId: "member-cross-tenant",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }),
        slugParams
      );

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("PROFESSIONAL_NOT_AVAILABLE");
    });
  });

  describe("Automatic Professional Assignment (ANY) with Workload Balancing", () => {
    const services = [{ id: "svc-1", price: "50.00", durationMin: 30, isActive: true }];

    beforeEach(() => {
      txMock.service.findMany.mockResolvedValue(services);
      txMock.barberService.findMany.mockImplementation((args: any) => {
        const barberId = args?.where?.barberId;
        if (typeof barberId === "string") {
          return Promise.resolve([{ serviceId: "svc-1", barberId }]);
        }
        return Promise.resolve([
          { barberId: "member-aaa", serviceId: "svc-1" },
          { barberId: "member-bbb", serviceId: "svc-1" },
        ]);
      });
      txMock.barbershopMember.findFirst.mockImplementation((args: any) => {
        const id = args?.where?.id;
        if (id === "member-aaa") return Promise.resolve(memberA);
        if (id === "member-bbb") return Promise.resolve(memberB);
        return Promise.resolve(memberA);
      });
      txMock.timeOff.findMany.mockResolvedValue([]);
      txMock.user.findFirst.mockResolvedValue(null);
      txMock.user.create.mockResolvedValue({ id: "cust-1", phone: "11988888888", name: "Cliente" });
      txMock.appointment.count.mockResolvedValue(0);
      txMock.appointment.create.mockImplementation(async ({ data }: any) => ({
        id: "apt-new-1",
        ...data,
        customer: { id: data.customerId, name: "Cliente Teste", phone: "11988888888" },
        barber: { user: { name: data.memberId === "member-aaa" ? "Barber Alpha" : "Barber Beta" } },
        services: [{ service: { name: "Corte", durationMin: 30 } }],
      }));
    });

    it("assigns the barber with lowest workload (minutes scheduled on the day)", async () => {
      // Both are available at 2026-07-20 10:00 (Monday)
      // Member AAA has 90 minutes of appointments on that day
      // Member BBB has 30 minutes of appointments on that day
      txMock.barbershopMember.findMany.mockImplementation((args: any) => {
        if (args?.select?.id) {
          return Promise.resolve([{ id: "member-aaa" }, { id: "member-bbb" }]);
        }
        return Promise.resolve([memberA, memberB]);
      });
      txMock.appointment.findMany.mockImplementation((args: any) => {
        if (args?.select?.customer) {
          return Promise.resolve([
            { customer: { id: "cust-1", name: "Cliente Teste", phone: "11988888888" } },
          ]);
        }
        const memberId = args?.where?.memberId;
        if (memberId === "member-aaa") {
          return Promise.resolve([
            { dateTime: "2026-07-20T14:00:00.000Z", durationMin: 60, status: "CONFIRMED" },
            { dateTime: "2026-07-20T15:00:00.000Z", durationMin: 30, status: "PENDING" },
          ]);
        }
        if (memberId === "member-bbb") {
          return Promise.resolve([
            { dateTime: "2026-07-20T14:00:00.000Z", durationMin: 30, status: "CONFIRMED" },
          ]);
        }
        return Promise.resolve([]);
      });

      // No conflict at 10:00 for either member
      txMock.appointment.findFirst.mockResolvedValue(null);

      const res = await bookAppointment(
        createPostRequest({
          memberId: "any",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
          notes: "Gostaria de corte degradê",
        }),
        slugParams
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.appointment.barberName).toBe("Barber Beta");
      expect(txMock.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memberId: "member-bbb",
            notes: "Gostaria de corte degradê",
          }),
        })
      );
    });

    it("uses deterministic tie-breaker (memberId asc) when workloads are equal", async () => {
      txMock.barbershopMember.findMany.mockImplementation((args: any) => {
        if (args?.select?.id) {
          return Promise.resolve([{ id: "member-bbb" }, { id: "member-aaa" }]);
        }
        return Promise.resolve([memberB, memberA]);
      });
      // Equal workload: 0 minutes each
      txMock.appointment.findMany.mockImplementation((args: any) => {
        if (args?.select?.customer) {
          return Promise.resolve([
            { customer: { id: "cust-1", name: "Cliente Teste", phone: "11988888888" } },
          ]);
        }
        return Promise.resolve([]);
      });
      txMock.appointment.findFirst.mockResolvedValue(null);

      const res = await bookAppointment(
        createPostRequest({
          memberId: "any",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }),
        slugParams
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      // member-aaa < member-bbb alphabetically
      expect(data.appointment.barberName).toBe("Barber Alpha");
      expect(txMock.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memberId: "member-aaa",
          }),
        })
      );
    });

    it("returns 409 SLOT_NOT_AVAILABLE if no barber is available at that slot", async () => {
      txMock.barbershopMember.findMany.mockImplementation((args: any) => {
        if (args?.select?.id) {
          return Promise.resolve([{ id: "member-aaa" }]);
        }
        return Promise.resolve([memberA]);
      });
      // Conflict exists
      txMock.appointment.findMany.mockResolvedValue([
        { dateTime: "2026-07-20T10:00:00.000Z", durationMin: 30 },
      ]);
      txMock.appointment.findFirst.mockResolvedValue({ id: "apt-conflict" });

      const res = await bookAppointment(
        createPostRequest({
          memberId: "any",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }),
        slugParams
      );

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe("SLOT_UNAVAILABLE");
    });
    it("CONTRATO A: ANY envia memberId='any' e professionalPreference='ANY' e tem sucesso", async () => {
      txMock.barbershopMember.findMany.mockImplementation((args: any) => {
        if (args?.select?.id) {
          return Promise.resolve([{ id: "member-aaa" }]);
        }
        return Promise.resolve([memberA]);
      });
      txMock.appointment.findMany.mockResolvedValue([]);
      txMock.appointment.findFirst.mockResolvedValue(null);

      const res = await bookAppointment(
        createPostRequest({
          memberId: "any",
          professionalPreference: "ANY",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }, "aaaa1111-1111-4111-8111-111111111111"),
        slugParams
      );

      expect(res.status).toBe(201);
    });

    it("CONTRATO C: SPECIFIC envia memberId real e professionalPreference='SPECIFIC' e tem sucesso", async () => {
      txMock.barbershopMember.findMany.mockImplementation((args: any) => {
        if (args?.select?.id) {
          return Promise.resolve([{ id: "member-aaa" }]);
        }
        return Promise.resolve([memberA]);
      });
      txMock.appointment.findMany.mockResolvedValue([]);
      txMock.appointment.findFirst.mockResolvedValue(null);

      const res = await bookAppointment(
        createPostRequest({
          memberId: "member-aaa",
          professionalPreference: "SPECIFIC",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }, "bbbb1111-1111-4111-8111-111111111111"),
        slugParams
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.appointment.barberName).toBe("Barber Alpha");
    });

    it("CONTRATO D: SPECIFIC sem memberId retorna 400 controlado", async () => {
      const res = await bookAppointment(
        createPostRequest({
          professionalPreference: "SPECIFIC",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }, "cccc1111-1111-4111-8111-111111111111"),
        slugParams
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("INVALID_PROFESSIONAL_PREFERENCE");
    });

    it("CONTRATO E: SPECIFIC + memberId='any' retorna 400 controlado", async () => {
      const res = await bookAppointment(
        createPostRequest({
          memberId: "any",
          professionalPreference: "SPECIFIC",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }, "dddd1111-1111-4111-8111-111111111111"),
        slugParams
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("INVALID_PROFESSIONAL_PREFERENCE");
    });

    it("CONTRATO ADICIONAL: ANY + memberId específico retorna 400 controlado", async () => {
      const res = await bookAppointment(
        createPostRequest({
          memberId: "member-aaa",
          professionalPreference: "ANY",
          serviceIds: ["svc-1"],
          dateTime: "2026-07-20T10:00:00.000Z",
          customerName: "Cliente Teste",
          customerPhone: "(11) 98888-8888",
        }, "eeee1111-1111-4111-8111-111111111111"),
        slugParams
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("INVALID_PROFESSIONAL_PREFERENCE");
    });
  });
});
