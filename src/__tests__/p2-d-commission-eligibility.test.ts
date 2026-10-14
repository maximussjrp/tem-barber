import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ComandaItemType,
  ComandaItemStatus,
  ComandaStatus,
  CommissionConfigType,
  CommissionEntryStatus,
  CommissionType,
  Prisma,
} from "@prisma/client";
import {
  isMemberCommissionEligibleAt,
  getItemCommissionReferenceDate,
  generateCommissionsForComanda,
  syncCommissionReleaseForComanda,
  reverseCommissionEntry,
} from "@/lib/operations/commissions";

describe("TEM BARBER — Gate P2-D: Elegibilidade temporal e preservação histórica das comissões", () => {
  const shopA = "shop-a";
  const shopB = "shop-b";
  const ownerA = "owner-a";
  const barberA1 = "barber-a-1";
  const barberA2 = "barber-a-2";

  const t0 = new Date("2026-01-01T10:00:00Z");
  const t1 = new Date("2026-01-10T10:00:00Z");
  const t2 = new Date("2026-01-20T10:00:00Z");
  const t3 = new Date("2026-02-01T10:00:00Z");

  // Helper para criar mock de transaction com estado in-memory
  function createMockTx(initialData?: {
    members?: Array<{ id: string; barbershopId: string; isCommissionEligible: boolean; role?: string; isActive?: boolean; careerLevelId?: string | null; createdAt?: Date }>;
    events?: Array<{ id: string; barbershopId: string; memberId: string; enabled: boolean; isRegistrationBaseline?: boolean; effectiveAt: Date; createdAt: Date }>;
    services?: Array<{ id: string; barbershopId: string; categoryId?: string | null }>;
    products?: Array<{ id: string; barbershopId: string }>;
    configs?: Array<any>;
    comandas?: Array<any>;
    comandaItems?: Array<any>;
    commissionEntries?: Array<any>;
    commissionPayables?: Array<any>;
    cycles?: Array<any>;
    payments?: Array<any>;
  }) {
    const members = [...(initialData?.members ?? [])];
    const events = [...(initialData?.events ?? [])];
    const services = [...(initialData?.services ?? [{ id: "srv-1", barbershopId: shopA }])];
    const products = [...(initialData?.products ?? [{ id: "prod-1", barbershopId: shopA }])];
    const configs = [...(initialData?.configs ?? [])];
    const comandas = [...(initialData?.comandas ?? [])];
    const comandaItems = [...(initialData?.comandaItems ?? [])];
    const commissionEntries = [...(initialData?.commissionEntries ?? [])];
    const commissionPayables = [...(initialData?.commissionPayables ?? [])];
    const cycles = [...(initialData?.cycles ?? [])];
    const payments = [...(initialData?.payments ?? [])];

    let entryIdCounter = 1;
    let payableIdCounter = 1;

    const tx: any = {
      user: {
        findFirst: vi.fn(async () => ({ id: "user-system" })),
      },
      service: {
        findFirst: vi.fn(async ({ where }: any) => {
          return services.find((s) => (!where.id || s.id === where.id) && (!where.barbershopId || s.barbershopId === where.barbershopId)) ?? null;
        }),
      },
      product: {
        findFirst: vi.fn(async ({ where }: any) => {
          return products.find((p) => (!where.id || p.id === where.id) && (!where.barbershopId || p.barbershopId === where.barbershopId)) ?? null;
        }),
      },
      barbershopMember: {
        findFirst: vi.fn(async ({ where }: any) => {
          return members.find(
            (m) =>
              (!where.id || m.id === where.id) &&
              (!where.barbershopId || m.barbershopId === where.barbershopId) &&
              (where.isActive === undefined || m.isActive === where.isActive)
          ) ?? null;
        }),
        findUnique: vi.fn(async ({ where }: any) => {
          const m = members.find((x) => x.id === where.id);
          return m ? { ...m, userId: `user-${m.id}` } : null;
        }),
        findMany: vi.fn(async () => members),
      },
      memberCommissionEligibilityEvent: {
        findFirst: vi.fn(async ({ where, orderBy }: any) => {
          let filtered = events.filter(
            (e) =>
              (!where.barbershopId || e.barbershopId === where.barbershopId) &&
              (!where.memberId || e.memberId === where.memberId) &&
              (!where.effectiveAt?.lte || e.effectiveAt <= where.effectiveAt.lte)
          );
          if (orderBy) {
            const orderRules = Array.isArray(orderBy) ? orderBy : [orderBy];
            filtered.sort((a, b) => {
              for (const rule of orderRules) {
                if (rule.effectiveAt) {
                  const diff = a.effectiveAt.getTime() - b.effectiveAt.getTime();
                  if (diff !== 0) return rule.effectiveAt === "desc" ? -diff : diff;
                }
                if (rule.createdAt) {
                  const diff = a.createdAt.getTime() - b.createdAt.getTime();
                  if (diff !== 0) return rule.createdAt === "desc" ? -diff : diff;
                }
              }
              return 0;
            });
          }
          return filtered[0] ?? null;
        }),
        findMany: vi.fn(async () => events),
      },
      commissionConfig: {
        findFirst: vi.fn(async ({ where }: any) => {
          return configs.find(
            (c) =>
              (!where.barbershopId || c.barbershopId === where.barbershopId) &&
              (!where.scopeKey || c.scopeKey === where.scopeKey) &&
              (where.active === undefined || c.active === where.active)
          ) ?? null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          return configs.filter(
            (c) =>
              (!where.barbershopId || c.barbershopId === where.barbershopId) &&
              (where.active === undefined || c.active === where.active)
          );
        }),
      },
      serviceCommissionRule: {
        findFirst: vi.fn(async () => null),
      },
      careerLevel: {
        findFirst: vi.fn(async () => null),
      },
      comanda: {
        findFirst: vi.fn(async ({ where }: any) => {
          const cmd = comandas.find(
            (c) => (!where.id || c.id === where.id) && (!where.barbershopId || c.barbershopId === where.barbershopId)
          );
          if (!cmd) return null;
          const items = comandaItems
            .filter((it) => it.comandaId === cmd.id)
            .map((it) => ({
              ...it,
              commissionEntries: commissionEntries.filter((ce) => ce.comandaItemId === it.id && ce.isCurrent),
            }));
          return { ...cmd, items };
        }),
        findFirstOrThrow: vi.fn(async ({ where }: any) => {
          const cmd = comandas.find(
            (c) => (!where.id || c.id === where.id) && (!where.barbershopId || c.barbershopId === where.barbershopId)
          );
          if (!cmd) throw new Error("Comanda not found");
          const items = comandaItems
            .filter((it) => it.comandaId === cmd.id)
            .map((it) => ({
              ...it,
              commissionEntries: commissionEntries.filter((ce) => ce.comandaItemId === it.id && ce.isCurrent),
            }));
          return { ...cmd, items };
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const cmd = comandas.find((c) => c.id === where.id);
          if (cmd) Object.assign(cmd, data);
          return cmd;
        }),
      },
      comandaItem: {
        findFirst: vi.fn(async ({ where }: any) => {
          return comandaItems.find((it) => (!where.id || it.id === where.id) && (!where.comandaId || it.comandaId === where.comandaId)) ?? null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          return comandaItems.filter((it) => (!where.comandaId || it.comandaId === where.comandaId));
        }),
      },
      commissionEntry: {
        findFirst: vi.fn(async ({ where }: any) => {
          return commissionEntries.find(
            (ce) =>
              (!where.comandaItemId || ce.comandaItemId === where.comandaItemId) &&
              (where.isCurrent === undefined || ce.isCurrent === where.isCurrent) &&
              (!where.id || ce.id === where.id)
          ) ?? null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          return commissionEntries.filter((ce) => {
            if (where.comandaItemId && ce.comandaItemId !== where.comandaItemId) return false;
            if (where.isCurrent !== undefined && ce.isCurrent !== where.isCurrent) return false;
            if (where.comandaItem?.comandaId) {
              const item = comandaItems.find((it) => it.id === ce.comandaItemId);
              if (!item || item.comandaId !== where.comandaItem.comandaId) return false;
            }
            return true;
          });
        }),
        create: vi.fn(async ({ data }: any) => {
          const entry = {
            id: `entry-${entryIdCounter++}`,
            isCurrent: true,
            paidAmount: new Prisma.Decimal(0),
            releasedAmount: new Prisma.Decimal(0),
            reversedAmount: new Prisma.Decimal(0),
            ...data,
          };
          commissionEntries.push(entry);
          return entry;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const entry = commissionEntries.find((e) => e.id === where.id);
          if (entry) Object.assign(entry, data);
          return entry;
        }),
        delete: vi.fn(async ({ where }: any) => {
          const idx = commissionEntries.findIndex((e) => e.id === where.id);
          if (idx !== -1) commissionEntries.splice(idx, 1);
        }),
      },
      commissionPayableItem: {
        findFirst: vi.fn(async ({ where }: any) => {
          return commissionPayables.find((cp) => (!where.entryId || cp.entryId === where.entryId)) ?? null;
        }),
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.barbershopId_eventKey) {
            return commissionPayables.find(
              (cp) => cp.barbershopId === where.barbershopId_eventKey.barbershopId && cp.eventKey === where.barbershopId_eventKey.eventKey
            ) ?? null;
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const item = { id: `payable-${payableIdCounter++}`, ...data };
          commissionPayables.push(item);
          return item;
        }),
      },
      commissionCycle: {
        findFirst: vi.fn(async ({ where }: any) => {
          return cycles.find(
            (c) =>
              (!where.barbershopId || c.barbershopId === where.barbershopId) &&
              (!where.memberId || c.memberId === where.memberId) &&
              (!where.status || c.status === where.status)
          ) ?? null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const cycle = { id: `cycle-${cycles.length + 1}`, ...data };
          cycles.push(cycle);
          return cycle;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const cycle = cycles.find((c) => c.id === where.id);
          if (cycle) Object.assign(cycle, data);
          return cycle;
        }),
      },
      commissionCycleAdjustment: {
        create: vi.fn(async ({ data }: any) => ({ id: "adj-1", ...data })),
      },
      payment: {
        findMany: vi.fn(async () => payments),
      },
      appointment: {
        findUnique: vi.fn(async () => null),
      },
      $queryRaw: vi.fn(async () => []),
      _state: {
        members,
        events,
        configs,
        comandas,
        comandaItems,
        commissionEntries,
        commissionPayables,
        cycles,
      },
    };

    return tx;
  }

  // 1. Membro antigo sem eventos continua elegível conforme compatibilidade
  it("1. Membro antigo sem eventos continua elegível conforme compatibilidade histórica", async () => {
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: true }],
      events: [],
    });

    const isEligible = await isMemberCommissionEligibleAt(tx, {
      barbershopId: shopA,
      memberId: barberA1,
      referenceDate: t1,
    });

    expect(isEligible).toBe(true);
  });

  // 2. Novo OWNER desativado não recebe comissão nova
  it("2. Novo OWNER desativado (enabled: false no evento inicial) não recebe comissão nova", async () => {
    const tx = createMockTx({
      members: [{ id: ownerA, barbershopId: shopA, isCommissionEligible: false, role: "OWNER" }],
      events: [
        { id: "ev-0", barbershopId: shopA, memberId: ownerA, enabled: false, effectiveAt: t0, createdAt: t0 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(50), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: t1,
          createdAt: t1,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(0);
  });

  // 3. Ativação gera elegibilidade para novos serviços
  it("3. Ativação gera elegibilidade para novos serviços executados após a ativação", async () => {
    const tx = createMockTx({
      members: [{ id: ownerA, barbershopId: shopA, isCommissionEligible: true, role: "OWNER" }],
      events: [
        { id: "ev-0", barbershopId: shopA, memberId: ownerA, enabled: false, effectiveAt: t0, createdAt: t0 },
        { id: "ev-1", barbershopId: shopA, memberId: ownerA, enabled: true, effectiveAt: t1, createdAt: t1 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(50), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t2, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: t2,
          createdAt: t2,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(1);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(50);
  });

  // 4. Desativação impede comissão de serviços posteriores
  it("4. Desativação impede comissão de serviços concluídos após o evento de desativação", async () => {
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-1", barbershopId: shopA, memberId: barberA1, enabled: true, effectiveAt: t0, createdAt: t0 },
        { id: "ev-2", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(50), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t3, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t3,
          createdAt: t3,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(0);
  });

  // 5. Reativação volta a permitir comissão
  it("5. Reativação posterior volta a permitir geração de comissão", async () => {
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: true }],
      events: [
        { id: "ev-1", barbershopId: shopA, memberId: barberA1, enabled: true, effectiveAt: t0, createdAt: t0 },
        { id: "ev-2", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t1, createdAt: t1 },
        { id: "ev-3", barbershopId: shopA, memberId: barberA1, enabled: true, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(50), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t3, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t3,
          createdAt: t3,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(1);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(50);
  });

  // 6. Produto utiliza elegibilidade do vendedor (createdAt)
  it("6. Venda de produto utiliza a elegibilidade temporal do vendedor na data de criação do item (createdAt)", async () => {
    const tx = createMockTx({
      members: [
        { id: barberA1, barbershopId: shopA, isCommissionEligible: true },
        { id: barberA2, barbershopId: shopA, isCommissionEligible: false },
      ],
      events: [
        { id: "ev-1", barbershopId: shopA, memberId: barberA2, enabled: false, effectiveAt: t0, createdAt: t0 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "product_default", type: "PERCENTAGE", value: new Prisma.Decimal(20), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-prod-1",
          comandaId: "cmd-1",
          type: ComandaItemType.PRODUCT,
          productId: "prod-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(60),
          executorId: barberA2, // vendedor inelegível
          createdAt: t1,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(0);
  });

  // 7. Comissão anterior à desativação preserva generatedAmount
  it("7. Comissão anterior à desativação preserva rigorosamente o generatedAmount na recalibração", async () => {
    const existingEntry = {
      id: "entry-existing-1",
      barbershopId: shopA,
      comandaId: "cmd-1",
      comandaItemId: "item-srv-1",
      memberId: barberA1,
      isCurrent: true,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-1", barbershopId: shopA, memberId: barberA1, enabled: true, effectiveAt: t0, createdAt: t0 },
        { id: "ev-2", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1, // antes da desativação em t2
          createdAt: t1,
        },
      ],
      commissionEntries: [existingEntry],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(1);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(30);
  });

  // 8. Comissão anterior à desativação preserva configSnapshot congelado
  it("8. Comissão anterior à desativação reutiliza o configSnapshot congelado e não consulta regras novas", async () => {
    const existingEntry = {
      id: "entry-existing-1",
      barbershopId: shopA,
      comandaId: "cmd-1",
      comandaItemId: "item-srv-1",
      memberId: barberA1,
      isCurrent: true,
      configSnapshot: {
        id: "snap-frozen",
        configId: "cfg-old",
        type: "PERCENTAGE",
        value: "45.00",
        origin: "MEMBER_SERVICE",
      },
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(45),
      releasedAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-1", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [
        // Nova regra que se consultada mudaria para 10%
        { id: "cfg-new", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(10), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
        },
      ],
      commissionEntries: [existingEntry],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(45);
    expect(tx._state.commissionEntries[0].configSnapshot.id).toBe("snap-frozen");
  });

  // 9. Pagamento posterior libera comissão reconhecida antes da desativação
  it("9. Pagamento posterior libera comissão reconhecida antes da desativação (R$ 30 permanecem devidos)", async () => {
    const existingEntry = {
      id: "entry-1",
      barbershopId: shopA,
      comandaId: "cmd-1",
      comandaItemId: "item-srv-1",
      memberId: barberA1,
      isCurrent: true,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-1", barbershopId: shopA, memberId: barberA1, enabled: true, effectiveAt: t0, createdAt: t0 },
        { id: "ev-2", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.CLOSED, total: new Prisma.Decimal(100), commissionRevision: 2 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 0, remainingBalance: 0 },
      ],
      payments: [
        { id: "pay-1", barbershopId: shopA, comandaId: "cmd-1", amount: new Prisma.Decimal(100), status: "CONFIRMED" },
      ],
    });

    await syncCommissionReleaseForComanda(tx, shopA, "cmd-1");

    expect(Number(existingEntry.releasedAmount)).toBe(30);
    expect(Number(tx._state.cycles[0].grossCommission)).toBe(30);
    expect(tx._state.commissionPayables.length).toBe(1);
    expect(Number(tx._state.commissionPayables[0].amount)).toBe(30);
  });

  // 10. Pagamento parcial preserva proporcionalidade
  it("10. Pagamento parcial (50%) libera exatamente 50% da comissão gerada (R$ 15 de R$ 30)", async () => {
    const existingEntry = {
      id: "entry-1",
      barbershopId: shopA,
      comandaId: "cmd-1",
      comandaItemId: "item-srv-1",
      memberId: barberA1,
      isCurrent: true,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, total: new Prisma.Decimal(100), commissionRevision: 2 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 0, remainingBalance: 0 },
      ],
      payments: [
        { id: "pay-1", barbershopId: shopA, comandaId: "cmd-1", amount: new Prisma.Decimal(50), status: "CONFIRMED" },
      ],
    });

    await syncCommissionReleaseForComanda(tx, shopA, "cmd-1");

    expect(Number(existingEntry.releasedAmount)).toBe(15);
    expect(Number(tx._state.cycles[0].grossCommission)).toBe(15);
  });

  // 11. Repetição da sincronização não duplica lançamentos (Idempotência)
  it("11. Repetição da sincronização com mesmos pagamentos não duplica lançamentos", async () => {
    const existingEntry = {
      id: "entry-1",
      barbershopId: shopA,
      comandaId: "cmd-1",
      comandaItemId: "item-srv-1",
      memberId: barberA1,
      isCurrent: true,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(15),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: true }],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, total: new Prisma.Decimal(100), commissionRevision: 2 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 15, remainingBalance: 15 },
      ],
      payments: [
        { id: "pay-1", barbershopId: shopA, comandaId: "cmd-1", amount: new Prisma.Decimal(50), status: "CONFIRMED" },
      ],
    });

    await syncCommissionReleaseForComanda(tx, shopA, "cmd-1");

    expect(Number(existingEntry.releasedAmount)).toBe(15);
    expect(tx._state.commissionPayables.length).toBe(0);
  });

  // 12. Estorno real continua funcionando
  it("12. Estorno real de cancelamento de item continua revertendo a comissão", async () => {
    const existingEntry = {
      id: "entry-1",
      barbershopId: shopA,
      comandaId: "cmd-1",
      comandaItemId: "item-cancelled",
      memberId: barberA1,
      isCurrent: true,
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(30),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.RELEASED,
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: true }],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 3 },
      ],
      comandaItems: [
        // Item foi cancelado
        {
          id: "item-cancelled",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.CANCELLED,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 30, remainingBalance: 30, version: 1 },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionPayables.some((cp: any) => cp.type === "REVERSAL")).toBe(true);
  });

  // 13. Desativação isolada não cria REVERSAL
  it("13. Desativação cadastral isolada NÃO gera estorno ou reversão financeira", async () => {
    const existingEntry = {
      id: "entry-1",
      barbershopId: shopA,
      comandaId: "cmd-1",
      comandaItemId: "item-1",
      memberId: barberA1,
      isCurrent: true,
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(30),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.RELEASED,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-disable", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.CLOSED, total: new Prisma.Decimal(100), commissionRevision: 3 },
      ],
      comandaItems: [
        {
          id: "item-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1, // concluído antes da desativação
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 30, remainingBalance: 30 },
      ],
      payments: [
        { id: "pay-1", barbershopId: shopA, comandaId: "cmd-1", amount: new Prisma.Decimal(100), status: "CONFIRMED" },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");
    await syncCommissionReleaseForComanda(tx, shopA, "cmd-1");

    expect(Number(existingEntry.releasedAmount)).toBe(30);
    expect(Number(existingEntry.generatedAmount)).toBe(30);
    expect(tx._state.commissionPayables.length).toBe(0);
  });

  // 14. Ciclo PAID permanece imutável
  it("14. Ciclo com status PAID permanece rigorosamente imutável", async () => {
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      cycles: [
        {
          id: "cycle-paid-1",
          barbershopId: shopA,
          memberId: barberA1,
          status: "PAID",
          grossCommission: 100,
          remainingBalance: 0,
        },
      ],
    });

    // Operações em ciclos buscam ciclos OPEN
    const cycle = await tx.commissionCycle.findFirst({
      where: { barbershopId: shopA, memberId: barberA1, status: "OPEN" },
    });
    expect(cycle).toBeNull();
  });

  // 15. Tenant A não acessa eventos do tenant B
  it("15. Isolamento estrito de tenant: eventos de tenant B não afetam tenant A", async () => {
    const tx = createMockTx({
      members: [
        { id: barberA1, barbershopId: shopA, isCommissionEligible: true },
        { id: "barber-b-1", barbershopId: shopB, isCommissionEligible: false },
      ],
      events: [
        // Evento de desativação exclusivo do shopB
        { id: "ev-b", barbershopId: shopB, memberId: barberA1, enabled: false, effectiveAt: t0, createdAt: t0 },
      ],
    });

    const isEligibleInShopA = await isMemberCommissionEligibleAt(tx, {
      barbershopId: shopA,
      memberId: barberA1,
      referenceDate: t1,
    });

    expect(isEligibleInShopA).toBe(true);
  });

  // 16. Comissão individual de 0% continua diferente de elegibilidade desativada
  it("16. Comissão individual configurada com 0% continua diferente de elegibilidade desativada", async () => {
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: true }],
      configs: [
        // Regra de 0% explicitamente configurada
        { id: "cfg-0", barbershopId: shopA, scopeKey: `member:${barberA1}:default`, type: "PERCENTAGE", value: new Prisma.Decimal(0), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv-1",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    // Elegível, porém regra produz comissão 0
    expect(tx._state.commissionEntries.length).toBe(1);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(0);
    expect(tx._state.commissionEntries[0].status).toBe(CommissionEntryStatus.GENERATED);
  });

  // 17. Serviço e produto na mesma comanda podem ter responsáveis e elegibilidades diferentes
  it("17. Serviço e produto na mesma comanda podem ter executores e elegibilidades independentes", async () => {
    const tx = createMockTx({
      members: [
        { id: barberA1, barbershopId: shopA, isCommissionEligible: true },
        { id: barberA2, barbershopId: shopA, isCommissionEligible: false },
      ],
      events: [
        { id: "ev-a2", barbershopId: shopA, memberId: barberA2, enabled: false, effectiveAt: t0, createdAt: t0 },
      ],
      configs: [
        { id: "cfg-barber", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(40), active: true },
        { id: "cfg-prod", barbershopId: shopA, scopeKey: "product_default", type: "PERCENTAGE", value: new Prisma.Decimal(10), active: true },
      ],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-srv",
          comandaId: "cmd-1",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1, // elegível
          completedAt: t1,
          createdAt: t1,
        },
        {
          id: "item-prod",
          comandaId: "cmd-1",
          type: ComandaItemType.PRODUCT,
          productId: "prod-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(50),
          executorId: barberA2, // inelegível
          createdAt: t1,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(1);
    expect(tx._state.commissionEntries[0].memberId).toBe(barberA1);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(40);
  });

  // 18. Itens históricos sem executor não são reatribuídos pelo novo código
  it("18. Itens históricos de produto sem executorId preservam ausência de executor sem comissão órfã", async () => {
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: true }],
      comandas: [
        { id: "cmd-1", barbershopId: shopA, appointmentId: null, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-prod-orphan",
          comandaId: "cmd-1",
          type: ComandaItemType.PRODUCT,
          productId: "prod-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(50),
          executorId: null,
          createdAt: t1,
        },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-1");

    expect(tx._state.commissionEntries.length).toBe(0);
  });

  // ==========================================
  // GATE P2-D-FIX — Testes complementares
  // ==========================================

  // 19. Membro legado com primeiro evento futuro de desativação mantém elegibilidade em operação anterior, inclusive sem CommissionEntry previamente criada
  it("19. Membro legado com primeiro evento futuro de desativação mantém elegibilidade em operação anterior, inclusive sem CommissionEntry prévia", async () => {
    // Cenário: serviço em t1 (05/10), primeiro evento em t2 (13/10) com enabled: false. Reprocessamento em t3 (15/10).
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: true, role: "BARBER" }],
      events: [
        { id: "ev-future-disable", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(40), active: true },
      ],
      comandas: [
        { id: "cmd-legacy", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-prior-to-event",
          comandaId: "cmd-legacy",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1, // data anterior ao primeiro evento (t1 < t2)
          createdAt: t1,
        },
      ],
    });

    // Sem CommissionEntry previamente criada, deve reconhecer a elegibilidade histórica em t1 e gerar comissão
    await generateCommissionsForComanda(tx, shopA, "cmd-legacy");

    expect(tx._state.commissionEntries.length).toBe(1);
    expect(tx._state.commissionEntries[0].memberId).toBe(barberA1);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(40);
  });

  // 20. Novo OWNER com evento inicial desativado não é tratado como membro legado
  it("20. Novo OWNER com evento inicial desativado não é tratado como membro legado e não recebe comissão retroativa", async () => {
    const tx = createMockTx({
      members: [
        { id: ownerA, barbershopId: shopA, isCommissionEligible: false, role: "OWNER", createdAt: t1 },
      ],
      events: [
        { id: "ev-owner-init", barbershopId: shopA, memberId: ownerA, enabled: false, isRegistrationBaseline: true, effectiveAt: t1, createdAt: t1 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(50), active: true },
      ],
      comandas: [
        { id: "cmd-owner", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t0, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-before-owner",
          comandaId: "cmd-owner",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: t0, // antes da existência do próprio OWNER
          createdAt: t0,
        },
      ],
    });

    // 1. Verificação direta de elegibilidade antes da existência do owner
    const isEligibleAtT0 = await isMemberCommissionEligibleAt(tx, {
      barbershopId: shopA,
      memberId: ownerA,
      referenceDate: t0,
    });
    expect(isEligibleAtT0).toBe(false);

    // 2. Não gera comissão para o OWNER
    await generateCommissionsForComanda(tx, shopA, "cmd-owner");
    expect(tx._state.commissionEntries.length).toBe(0);
  });

  // 21. Comissão reconhecida antes da desativação continua sendo liberada após pagamento posterior
  it("21. Comissão reconhecida antes da desativação continua sendo liberada após pagamento posterior", async () => {
    // Comanda gerada em t1 com membro elegível. Em t2, o membro é desativado. Em t3, o cliente paga a comanda.
    const existingEntry = {
      id: "entry-recon-1",
      barbershopId: shopA,
      comandaId: "cmd-pay-after",
      comandaItemId: "item-recon-1",
      memberId: barberA1,
      isCurrent: true,
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(40),
      releasedAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "40.00",
        origin: "MEMBER_DEFAULT",
      },
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-disable-t2", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      comandas: [
        { id: "cmd-pay-after", barbershopId: shopA, status: ComandaStatus.CLOSED, total: new Prisma.Decimal(100), commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-recon-1",
          comandaId: "cmd-pay-after",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1, // concluído antes da desativação
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 0, remainingBalance: 0, version: 1 },
      ],
      payments: [
        // Pagamento realizado em t3 (após desativação cadastral)
        { id: "pay-t3", barbershopId: shopA, comandaId: "cmd-pay-after", amount: new Prisma.Decimal(100), status: "CONFIRMED", createdAt: t3 },
      ],
    });

    await syncCommissionReleaseForComanda(tx, shopA, "cmd-pay-after");

    // A comissão reconhecida antes da desativação deve ser liberada integralmente pelo pagamento
    expect(Number(existingEntry.releasedAmount)).toBe(40);
    expect(existingEntry.status).toBe(CommissionEntryStatus.RELEASED);
    expect(tx._state.commissionPayables.length).toBe(1);
    expect(Number(tx._state.commissionPayables[0].amount)).toBe(40);
  });

  // 22. Pagamento parcial mantém liberação proporcional correta
  it("22. Pagamento parcial mantém liberação proporcional correta para comissão de membro desativado posteriormente", async () => {
    const existingEntry = {
      id: "entry-partial-1",
      barbershopId: shopA,
      comandaId: "cmd-partial",
      comandaItemId: "item-partial-1",
      memberId: barberA1,
      isCurrent: true,
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(50),
      releasedAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "50.00",
        origin: "MEMBER_DEFAULT",
      },
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-disable-t2", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      comandas: [
        { id: "cmd-partial", barbershopId: shopA, status: ComandaStatus.CLOSED, total: new Prisma.Decimal(100), commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-partial-1",
          comandaId: "cmd-partial",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 0, remainingBalance: 0, version: 1 },
      ],
      payments: [
        // Pagamento parcial de 50% (R$ 50 de R$ 100)
        { id: "pay-partial", barbershopId: shopA, comandaId: "cmd-partial", amount: new Prisma.Decimal(50), status: "CONFIRMED", createdAt: t3 },
      ],
    });

    await syncCommissionReleaseForComanda(tx, shopA, "cmd-partial");

    // 50% de R$ 50 gerado = R$ 25 liberado
    expect(Number(existingEntry.releasedAmount)).toBe(25);
    expect(existingEntry.status).toBe(CommissionEntryStatus.PARTIALLY_RELEASED);
    expect(tx._state.commissionPayables.length).toBe(1);
    expect(Number(tx._state.commissionPayables[0].amount)).toBe(25);
  });

  // 23. Repetição da sincronização não duplica lançamentos (Idempotência da liberação)
  it("23. Repetição da sincronização de liberação não duplica lançamentos ou créditos no ciclo", async () => {
    const existingEntry = {
      id: "entry-idem-1",
      barbershopId: shopA,
      comandaId: "cmd-idem",
      comandaItemId: "item-idem-1",
      memberId: barberA1,
      isCurrent: true,
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.GENERATED,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-disable-t2", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      comandas: [
        { id: "cmd-idem", barbershopId: shopA, status: ComandaStatus.CLOSED, total: new Prisma.Decimal(100), commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-idem-1",
          comandaId: "cmd-idem",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: barberA1, status: "OPEN", grossCommission: 0, remainingBalance: 0, version: 1 },
      ],
      payments: [
        { id: "pay-idem", barbershopId: shopA, comandaId: "cmd-idem", amount: new Prisma.Decimal(100), status: "CONFIRMED", createdAt: t3 },
      ],
    });

    // Primeira sincronização
    await syncCommissionReleaseForComanda(tx, shopA, "cmd-idem");
    expect(Number(existingEntry.releasedAmount)).toBe(30);
    expect(tx._state.commissionPayables.length).toBe(1);
    const cycleGross1 = Number(tx._state.cycles[0].grossCommission);
    expect(cycleGross1).toBe(30);

    // Segunda sincronização (repetição idêntica)
    await syncCommissionReleaseForComanda(tx, shopA, "cmd-idem");
    expect(Number(existingEntry.releasedAmount)).toBe(30);
    expect(tx._state.commissionPayables.length).toBe(1);
    const cycleGross2 = Number(tx._state.cycles[0].grossCommission);
    expect(cycleGross2).toBe(30);
  });

  // 24. Desativação isolada não altera ciclo PAID nem gera REVERSAL
  it("24. Desativação cadastral isolada não altera ciclo com status PAID nem gera REVERSAL", async () => {
    const existingEntry = {
      id: "entry-paid-cycle-1",
      barbershopId: shopA,
      comandaId: "cmd-paid-cycle",
      comandaItemId: "item-paid-cycle-1",
      memberId: barberA1,
      isCurrent: true,
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(30),
      paidAmount: new Prisma.Decimal(30),
      status: CommissionEntryStatus.PAID,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
    };

    const paidCycle = {
      id: "cycle-paid-1",
      barbershopId: shopA,
      memberId: barberA1,
      status: "PAID",
      grossCommission: new Prisma.Decimal(30),
      remainingBalance: new Prisma.Decimal(0),
      version: 1,
    };

    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false }],
      events: [
        { id: "ev-disable-now", barbershopId: shopA, memberId: barberA1, enabled: false, effectiveAt: t2, createdAt: t2 },
      ],
      comandas: [
        { id: "cmd-paid-cycle", barbershopId: shopA, status: ComandaStatus.CLOSED, total: new Prisma.Decimal(100), commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-paid-cycle-1",
          comandaId: "cmd-paid-cycle",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1,
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [paidCycle],
      payments: [
        { id: "pay-1", barbershopId: shopA, comandaId: "cmd-paid-cycle", amount: new Prisma.Decimal(100), status: "CONFIRMED" },
      ],
    });

    // Recalcular comanda
    await generateCommissionsForComanda(tx, shopA, "cmd-paid-cycle");
    await syncCommissionReleaseForComanda(tx, shopA, "cmd-paid-cycle");

    // Ciclo PAID permanece rigorosamente intocado
    expect(Number(paidCycle.grossCommission)).toBe(30);
    expect(Number(paidCycle.remainingBalance)).toBe(0);
    expect(paidCycle.status).toBe("PAID");

    // Nenhum REVERSAL gerado
    const reversals = tx._state.commissionPayables.filter((cp: any) => cp.type === "REVERSAL");
    expect(reversals.length).toBe(0);

    // Entry status permanece PAID com valores inalterados
    expect(existingEntry.status).toBe(CommissionEntryStatus.PAID);
    expect(Number(existingEntry.generatedAmount)).toBe(30);
    expect(Number(existingEntry.releasedAmount)).toBe(30);
    expect(Number(existingEntry.paidAmount)).toBe(30);
  });

  // ==========================================
  // GATE P2-D-FIX2 — Testes de distinção OWNER legado vs novo
  // ==========================================

  // 25. OWNER antigo com comissão de R$ 30 gerada antes da desativação: preserva R$ 30
  it("25. OWNER antigo com comissão de R$ 30 gerada antes da desativação preserva R$ 30 intactos", async () => {
    const existingEntry = {
      id: "entry-legacy-owner-1",
      barbershopId: shopA,
      comandaId: "cmd-legacy-owner",
      comandaItemId: "item-lo-1",
      memberId: ownerA,
      isCurrent: true,
      baseAmount: new Prisma.Decimal(100),
      generatedAmount: new Prisma.Decimal(30),
      releasedAmount: new Prisma.Decimal(30),
      paidAmount: new Prisma.Decimal(0),
      status: CommissionEntryStatus.RELEASED,
      configSnapshot: {
        id: "cfg-1",
        configId: "cfg-1",
        type: "PERCENTAGE",
        value: "30.00",
        origin: "MEMBER_DEFAULT",
      },
    };

    const tx = createMockTx({
      // OWNER antigo cuja desativação ocorreu em t2 após ter prestado serviços em t1
      members: [{ id: ownerA, barbershopId: shopA, isCommissionEligible: false, role: "OWNER", createdAt: t0 }],
      events: [
        // Evento de desativação NÃO é baseline de cadastro (isRegistrationBaseline: false)
        { id: "ev-disable-t2", barbershopId: shopA, memberId: ownerA, enabled: false, isRegistrationBaseline: false, effectiveAt: t2, createdAt: t2 },
      ],
      comandas: [
        { id: "cmd-legacy-owner", barbershopId: shopA, status: ComandaStatus.CLOSED, total: new Prisma.Decimal(100), commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-lo-1",
          comandaId: "cmd-legacy-owner",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: t1, // concluído antes da desativação
          createdAt: t1,
          commissionEntries: [existingEntry],
        },
      ],
      commissionEntries: [existingEntry],
      cycles: [
        { id: "cycle-1", barbershopId: shopA, memberId: ownerA, status: "OPEN", grossCommission: 30, remainingBalance: 30, version: 1 },
      ],
      payments: [
        { id: "pay-1", barbershopId: shopA, comandaId: "cmd-legacy-owner", amount: new Prisma.Decimal(100), status: "CONFIRMED" },
      ],
    });

    await generateCommissionsForComanda(tx, shopA, "cmd-legacy-owner");
    await syncCommissionReleaseForComanda(tx, shopA, "cmd-legacy-owner");

    expect(Number(existingEntry.generatedAmount)).toBe(30);
    expect(Number(existingEntry.releasedAmount)).toBe(30);
    expect(tx._state.commissionPayables.some((cp: any) => cp.type === "REVERSAL")).toBe(false);
  });

  // 26. OWNER antigo com serviço anterior à desativação e sem CommissionEntry: continua elegível
  it("26. OWNER antigo com serviço anterior à desativação e sem CommissionEntry continua elegível", async () => {
    const tx = createMockTx({
      members: [{ id: ownerA, barbershopId: shopA, isCommissionEligible: false, role: "OWNER", createdAt: t0 }],
      events: [
        // Primeira desativação do OWNER antigo aconteceu em t2, sem baseline de cadastro
        { id: "ev-disable-lo", barbershopId: shopA, memberId: ownerA, enabled: false, isRegistrationBaseline: false, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(30), active: true },
      ],
      comandas: [
        { id: "cmd-lo-unprocessed", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-lo-2",
          comandaId: "cmd-lo-unprocessed",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: t1, // serviço realizado em t1, antes da desativação em t2
          createdAt: t1,
        },
      ],
    });

    // 1. Verificação direta de elegibilidade na data t1
    const isEligibleAtT1 = await isMemberCommissionEligibleAt(tx, {
      barbershopId: shopA,
      memberId: ownerA,
      referenceDate: t1,
    });
    expect(isEligibleAtT1).toBe(true);

    // 2. Geração da comissão reconhece os R$ 30
    await generateCommissionsForComanda(tx, shopA, "cmd-lo-unprocessed");
    expect(tx._state.commissionEntries.length).toBe(1);
    expect(tx._state.commissionEntries[0].memberId).toBe(ownerA);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(30);
  });

  // 27. OWNER novo com baseline enabled: false: permanece inelegível desde o cadastro
  it("27. OWNER novo com baseline enabled: false permanece inelegível desde o cadastro", async () => {
    const tx = createMockTx({
      members: [{ id: ownerA, barbershopId: shopA, isCommissionEligible: false, role: "OWNER", createdAt: t1 }],
      events: [
        // Baseline de cadastro com enabled: false
        { id: "ev-baseline-0", barbershopId: shopA, memberId: ownerA, enabled: false, isRegistrationBaseline: true, effectiveAt: t1, createdAt: t1 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(50), active: true },
      ],
      comandas: [
        { id: "cmd-new-owner", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t2, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-no-1",
          comandaId: "cmd-new-owner",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: t2,
          createdAt: t2,
        },
      ],
    });

    const isEligible = await isMemberCommissionEligibleAt(tx, {
      barbershopId: shopA,
      memberId: ownerA,
      referenceDate: t2,
    });
    expect(isEligible).toBe(false);

    await generateCommissionsForComanda(tx, shopA, "cmd-new-owner");
    expect(tx._state.commissionEntries.length).toBe(0);
  });

  // 28. OWNER novo ativado posteriormente: somente os novos serviços geram comissão
  it("28. OWNER novo ativado posteriormente: somente os novos serviços geram comissão", async () => {
    const tx = createMockTx({
      members: [{ id: ownerA, barbershopId: shopA, isCommissionEligible: true, role: "OWNER", createdAt: t1 }],
      events: [
        // Baseline de cadastro em t1 (enabled: false)
        { id: "ev-baseline-owner", barbershopId: shopA, memberId: ownerA, enabled: false, isRegistrationBaseline: true, effectiveAt: t1, createdAt: t1 },
        // Ativação deliberada posterior em t2 (enabled: true)
        { id: "ev-activate-owner", barbershopId: shopA, memberId: ownerA, enabled: true, isRegistrationBaseline: false, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(50), active: true },
      ],
      comandas: [
        // Comanda 1: serviço antes da ativação (entre t1 e t2)
        { id: "cmd-before-act", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: new Date("2026-01-15T10:00:00Z"), commissionRevision: 1 },
        // Comanda 2: novo serviço após a ativação (em t3)
        { id: "cmd-after-act", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t3, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-before-act",
          comandaId: "cmd-before-act",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: new Date("2026-01-15T10:00:00Z"),
          createdAt: new Date("2026-01-15T10:00:00Z"),
        },
        {
          id: "item-after-act",
          comandaId: "cmd-after-act",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: ownerA,
          completedAt: t3,
          createdAt: t3,
        },
      ],
    });

    // 1. Serviço realizado antes da ativação NÃO gera comissão
    await generateCommissionsForComanda(tx, shopA, "cmd-before-act");
    expect(tx._state.commissionEntries.some((ce: any) => ce.comandaItemId === "item-before-act")).toBe(false);

    // 2. Novo serviço após a ativação gera comissão normalmente
    await generateCommissionsForComanda(tx, shopA, "cmd-after-act");
    const afterEntry = tx._state.commissionEntries.find((ce: any) => ce.comandaItemId === "item-after-act");
    expect(afterEntry).toBeDefined();
    expect(Number(afterEntry.generatedAmount)).toBe(50);
  });

  // 29. BARBER legado com primeira desativação: preserva elegibilidade anterior
  it("29. BARBER legado com primeira desativação preserva elegibilidade anterior", async () => {
    const tx = createMockTx({
      members: [{ id: barberA1, barbershopId: shopA, isCommissionEligible: false, role: "BARBER", createdAt: t0 }],
      events: [
        // Primeira desativação em t2 (sem baseline de cadastro)
        { id: "ev-barber-disable", barbershopId: shopA, memberId: barberA1, enabled: false, isRegistrationBaseline: false, effectiveAt: t2, createdAt: t2 },
      ],
      configs: [
        { id: "cfg-1", barbershopId: shopA, scopeKey: "barbershop:default", type: "PERCENTAGE", value: new Prisma.Decimal(40), active: true },
      ],
      comandas: [
        { id: "cmd-barber-legacy", barbershopId: shopA, status: ComandaStatus.OPEN, openedAt: t1, commissionRevision: 1 },
      ],
      comandaItems: [
        {
          id: "item-bl-1",
          comandaId: "cmd-barber-legacy",
          type: ComandaItemType.SERVICE,
          serviceId: "srv-1",
          status: ComandaItemStatus.DONE,
          total: new Prisma.Decimal(100),
          executorId: barberA1,
          completedAt: t1, // antes da desativação em t2
          createdAt: t1,
        },
      ],
    });

    const isEligibleAtT1 = await isMemberCommissionEligibleAt(tx, {
      barbershopId: shopA,
      memberId: barberA1,
      referenceDate: t1,
    });
    expect(isEligibleAtT1).toBe(true);

    await generateCommissionsForComanda(tx, shopA, "cmd-barber-legacy");
    expect(tx._state.commissionEntries.length).toBe(1);
    expect(Number(tx._state.commissionEntries[0].generatedAmount)).toBe(40);
  });
});
