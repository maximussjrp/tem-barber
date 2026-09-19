/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  adjustCustomerCredit,
  consumeCustomerCredit,
  getCustomerCreditAccount,
  grantCustomerCredit,
  reconcileCustomerCreditBalance,
  refundToCustomerCredit,
} from "@/lib/operations/customer-credit";
import { refundPayment, registerPayment, payComandaWithCustomerCredit } from "@/lib/operations/payments";
import { fromCents, toCents } from "@/lib/operations/money";
import {
  canAdjustCustomerCredit,
  canConsumeCustomerCredit,
  canGrantCustomerCredit,
  canReverseCustomerCredit,
  canViewCustomerCredit,
} from "@/lib/operations/permissions";
import { GET as clientCreditGet, POST as clientCreditPost } from "@/app/api/admin/clients/[id]/credit/route";
import { GET as financialSummaryGet } from "@/app/api/admin/financial/summary/route";
import { GET as dailySummaryGet } from "@/app/api/admin/financial/daily-summary/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/operations/commissions", () => ({ syncCommissionReleaseForComanda: vi.fn() }));
vi.mock("@/lib/operations/stock", () => ({
  syncStockForComanda: vi.fn(),
  runSerializableTransaction: (fn: any) => fn({}),
}));

const { getAdminSessionMock, requireFinancialSessionMock, requireOperationalSessionMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  requireFinancialSessionMock: vi.fn(),
  requireOperationalSessionMock: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: getAdminSessionMock,
}));

vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return {
    ...actual,
    requireOperationalSession: requireOperationalSessionMock,
  };
});

vi.mock("@/lib/financial/permissions", () => ({
  requireFinancialSession: requireFinancialSessionMock,
}));

function createFixture() {
  const users = [
    { id: "cust-1", name: "Cliente Um", phone: "11999999991", email: "cust1@test.com" },
    { id: "cust-2", name: "Cliente Dois", phone: "11999999992", email: "cust2@test.com" },
  ];

  const links: any[] = [
    { barbershopId: "shop-1", customerId: "cust-1", createdAt: new Date() },
    { barbershopId: "shop-2", customerId: "cust-2", createdAt: new Date() },
  ];

  const creditAccounts: any[] = [
    { id: "acc-1", barbershopId: "shop-1", customerId: "cust-1", balance: fromCents(0), createdAt: new Date(), updatedAt: new Date() },
  ];

  const creditEntries: any[] = [];
  const comandas: any[] = [
    {
      id: "cmd-1",
      barbershopId: "shop-1",
      status: "OPEN",
      customerId: "cust-1",
      appointmentId: "appt-1",
      openedAt: new Date("2026-09-18T10:00:00Z"),
      closedAt: null,
      subtotal: fromCents(10000),
      discountTotal: fromCents(0),
      surchargeTotal: fromCents(0),
      total: fromCents(10000),
      paidTotal: fromCents(0),
      remainingTotal: fromCents(10000),
    },
    {
      id: "cmd-no-cust",
      barbershopId: "shop-1",
      status: "OPEN",
      customerId: null,
      appointmentId: null,
      openedAt: new Date("2026-09-18T10:00:00Z"),
      closedAt: null,
      subtotal: fromCents(5000),
      discountTotal: fromCents(0),
      surchargeTotal: fromCents(0),
      total: fromCents(5000),
      paidTotal: fromCents(0),
      remainingTotal: fromCents(5000),
    },
  ];

  const items: any[] = [
    {
      id: "item-1",
      comandaId: "cmd-1",
      barbershopId: "shop-1",
      type: "SERVICE",
      status: "DONE",
      total: fromCents(10000),
      quantity: 1,
      unitPrice: fromCents(10000),
      serviceId: "srv-1",
      executorId: "member-1",
      description: "Corte",
    },
  ];

  const payments: any[] = [];
  const entries: any[] = [];
  const movements: any[] = [];
  const sessions: any[] = [
    { id: "cash-1", barbershopId: "shop-1", status: "OPEN", expectedAmount: fromCents(1000) },
  ];

  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]: any) => {
      if (typeof value === "object" && value !== null) {
        if ("not" in value) return row[key] !== value.not;
        if ("in" in value) return value.in.includes(row[key]);
        if ("gt" in value) return toCents(row[key] ?? 0) > value.gt;
        if ("gte" in value || "lt" in value) {
          const valDate = row[key] instanceof Date ? row[key].getTime() : new Date(row[key]).getTime();
          if ("gte" in value) {
            const gteTime = value.gte instanceof Date ? value.gte.getTime() : new Date(value.gte).getTime();
            if (valDate < gteTime) return false;
          }
          if ("lt" in value) {
            const ltTime = value.lt instanceof Date ? value.lt.getTime() : new Date(value.lt).getTime();
            if (valDate >= ltTime) return false;
          }
          return true;
        }
      }
      return row[key] === value;
    });

  const tx: any = {
    $queryRaw: vi.fn(async () => [{ id: "acc-1", balance: "0" }]),
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
    },
    customerBarbershopLink: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { barbershopId, customerId } = where.barbershopId_customerId || {};
        return links.find((l) => l.barbershopId === barbershopId && l.customerId === customerId) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const link = { ...data, createdAt: new Date() };
        links.push(link);
        return link;
      }),
    },
    customerCreditAccount: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        let acc: any;
        if (where.barbershopId_customerId) {
          const { barbershopId, customerId } = where.barbershopId_customerId;
          acc = creditAccounts.find((a) => a.barbershopId === barbershopId && a.customerId === customerId);
        } else if (where.id) {
          acc = creditAccounts.find((a) => a.id === where.id);
        }
        if (!acc) return null;
        if (include?.entries) {
          return { ...acc, entries: creditEntries.filter((e) => e.accountId === acc.id) };
        }
        return acc;
      }),
      create: vi.fn(async ({ data }: any) => {
        const acc = {
          id: `acc-${creditAccounts.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        creditAccounts.push(acc);
        return acc;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const acc = creditAccounts.find((a) => a.id === where.id);
        if (acc) Object.assign(acc, { ...data, updatedAt: new Date() });
        return acc;
      }),
    },
    customerCreditEntry: {
      findFirst: vi.fn(async ({ where }: any) =>
        creditEntries.find((e) => matches(e, where)) ?? null
      ),
      findMany: vi.fn(async ({ where, take }: any) => {
        let res = creditEntries.filter((e) => matches(e, where));
        if (take) res = res.slice(0, take);
        return res;
      }),
      create: vi.fn(async ({ data }: any) => {
        const entry = {
          id: `centry-${creditEntries.length + 1}`,
          createdAt: new Date(),
          createdByUser: users.find((u) => u.id === data.createdByUserId) || null,
          ...data,
        };
        creditEntries.push(entry);
        return entry;
      }),
    },
    comanda: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const c = comandas.find((c) => matches(c, where));
        if (!c) return null;
        if (select) return { ...c };
        return { ...c, items: items.filter((i) => i.comandaId === c.id) };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const c = comandas.find((c) => c.id === where.id);
        if (!c) return null;
        return { ...c, items: items.filter((i) => i.comandaId === c.id), payments: payments.filter((p) => p.comandaId === c.id) };
      }),
      findMany: vi.fn(async ({ where }: any) =>
        comandas.filter((c) => matches(c, where)).map((c) => ({
          ...c,
          items: items.filter((i) => i.comandaId === c.id),
          payments: payments.filter((p) => p.comandaId === c.id),
        }))
      ),
      aggregate: vi.fn(async ({ where }: any) => {
        const filtered = comandas.filter((c) => matches(c, where));
        const sum = filtered.reduce((acc, c) => acc + toCents(c.remainingTotal), 0);
        return { _sum: { remainingTotal: fromCents(sum) } };
      }),
      groupBy: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: any) => {
        const c = comandas.find((c) => c.id === where.id);
        if (!c) throw new Error("Comanda not found");
        Object.assign(c, data);
        return { ...c, items: items.filter((i) => i.comandaId === c.id), payments: payments.filter((p) => p.comandaId === c.id) };
      }),
    },
    comandaItem: {
      findMany: vi.fn(async ({ where }: any) => items.filter((i) => matches(i, where))),
    },
    payment: {
      findUnique: vi.fn(async ({ where }: any) =>
        payments.find((p) => matches(p, where.barbershopId_idempotencyKey)) ?? null
      ),
      findFirst: vi.fn(async ({ where }: any) => payments.find((p) => matches(p, where)) ?? null),
      findMany: vi.fn(async ({ where }: any) => payments.filter((p) => matches(p, where))),
      create: vi.fn(async ({ data }: any) => {
        const p = { id: `pay-${payments.length + 1}`, status: "CONFIRMED", paidAt: new Date(), createdAt: new Date(), refundedAmount: fromCents(0), ...data };
        payments.push(p);
        return p;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const p = payments.find((p) => p.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      }),
    },
    financialEntry: {
      create: vi.fn(async ({ data }: any) => {
        const e = { id: `fe-${entries.length + 1}`, entryDate: new Date(), createdAt: new Date(), ...data };
        entries.push(e);
        return e;
      }),
      findMany: vi.fn(async ({ where }: any) => entries.filter((e) => matches(e, where))),
    },
    cashMovement: {
      create: vi.fn(async ({ data }: any) => {
        const m = { id: `cm-${movements.length + 1}`, createdAt: new Date(), ...data };
        movements.push(m);
        return m;
      }),
    },
    cashSession: {
      findFirst: vi.fn(async ({ where }: any) => sessions.find((s) => matches(s, where)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => {
        const s = sessions.find((s) => s.id === where.id);
        return s ? { ...s, movements: movements.filter((m) => m.cashSessionId === s.id) } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(sessions.find((s) => s.id === where.id), data)),
    },
    customerClubSubscription: { findMany: vi.fn(async () => []) },
    financialSettlement: { findMany: vi.fn(async () => []) },
    financialSettlementReversal: { findMany: vi.fn(async () => []) },
    commissionPayableItem: { findMany: vi.fn(async () => []) },
    commissionCycleAdjustment: { findMany: vi.fn(async () => []) },
  };

  const prismaMock = {
    ...tx,
    $transaction: vi.fn(async (cb: any) => cb(tx)),
  };

  return {
    tx,
    client: tx as unknown as Prisma.TransactionClient,
    prismaMock,
    users,
    links,
    creditAccounts,
    creditEntries,
    comandas,
    payments,
    entries,
    movements,
  };
}

describe("FASE 5B — Customer Credit Integration Test Suite", () => {
  let f: ReturnType<typeof createFixture>;

  beforeEach(() => {
    vi.clearAllMocks();
    f = createFixture();
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", barbershopId: "shop-1" },
    });
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", memberId: "mgr-1", role: "OWNER", barbershopId: "shop-1" },
    });
    requireFinancialSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", memberId: "mgr-1", role: "OWNER", barbershopId: "shop-1" },
    });
  });

  // 1. Core Account & Tenant Link
  it("1. getCustomerCreditAccount returns or creates credit account scoped by barbershopId + customerId", async () => {
    const acc = await getCustomerCreditAccount("shop-1", "cust-1", f.client);
    expect(acc.barbershopId).toBe("shop-1");
    expect(acc.customerId).toBe("cust-1");
    expect(toCents(acc.balance)).toBe(0);

    // Creates link if not existing
    const acc2 = await getCustomerCreditAccount("shop-1", "cust-2", f.client);
    expect(acc2.barbershopId).toBe("shop-1");
    expect(acc2.customerId).toBe("cust-2");
  });

  // 2. Grant Credit & Idempotency
  it("2. grantCustomerCredit increases balance and records CREDIT ledger entry with MANUAL_GRANT sourceKind", async () => {
    const updated = await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "50.00",
      description: "Cortesia de aniversário",
      createdByUserId: "user-owner",
      idempotencyKey: "grant-idem-1",
    });

    expect(toCents(updated!.balance)).toBe(5000);
    expect(f.creditEntries).toHaveLength(1);
    expect(f.creditEntries[0].type).toBe("CREDIT");
    expect(f.creditEntries[0].sourceKind).toBe("MANUAL_GRANT");
    expect(toCents(f.creditEntries[0].amount)).toBe(5000);
    expect(toCents(f.creditEntries[0].balanceAfter)).toBe(5000);

    // Replay idempotency key
    const replay = await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "50.00",
      description: "Cortesia de aniversário",
      createdByUserId: "user-owner",
      idempotencyKey: "grant-idem-1",
    });
    expect(toCents(replay!.balance)).toBe(5000);
    expect(f.creditEntries).toHaveLength(1);
  });

  // 3. Adjust Credit Up & Down and Insufficient Balance Error
  it("3. adjustCustomerCredit modifies balance up or down and throws INSUFFICIENT_CREDIT_BALANCE on overdraft", async () => {
    // Add 100.00
    await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "100.00",
      description: "Aporte",
      createdByUserId: "user-owner",
    });

    // Debit 40.00
    const adjDebit = await adjustCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      type: "DEBIT",
      amount: "40.00",
      description: "Ajuste administrativo",
      createdByUserId: "user-owner",
    });
    expect(toCents(adjDebit!.balance)).toBe(6000);

    // Try to debit 70.00 (exceeds 60.00)
    await expect(
      adjustCustomerCredit(f.client, {
        barbershopId: "shop-1",
        customerId: "cust-1",
        type: "DEBIT",
        amount: "70.00",
        description: "Ajuste excessivo",
        createdByUserId: "user-owner",
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDIT_BALANCE", status: 422 });
  });

  // 4. Consume Credit via Dedicated Flow payComandaWithCustomerCredit
  it("4. payComandaWithCustomerCredit consumes credit, settles comanda, and DOES NOT create CashMovement", async () => {
    // Grant 100.00 credit to cust-1
    await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "100.00",
      description: "Aporte inicial",
      createdByUserId: "user-owner",
    });

    // Pay 60.00 via payComandaWithCustomerCredit
    const res = await payComandaWithCustomerCredit(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      amount: "60.00",
      userId: "user-owner",
    });

    expect(toCents(res.paidTotal)).toBe(6000);
    expect(toCents(res.remainingTotal)).toBe(4000);

    // Check account balance updated to 40.00
    const acc = await getCustomerCreditAccount("shop-1", "cust-1", f.client);
    expect(toCents(acc.balance)).toBe(4000);

    // Check NO CashMovement generated
    expect(f.movements).toHaveLength(0);

    // Check FinancialEntry of type COMMAND_REVENUE created for CUSTOMER_CREDIT
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0].type).toBe("COMMAND_REVENUE");
    expect(f.entries[0].category).toBe("CUSTOMER_CREDIT");
  });

  // 4B. registerPayment rejects CUSTOMER_CREDIT method
  it("4B. registerPayment with CUSTOMER_CREDIT throws CUSTOMER_CREDIT_REQUIRES_DEDICATED_FLOW", async () => {
    await expect(
      registerPayment(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        method: "CUSTOMER_CREDIT",
        amount: "50.00",
        userId: "user-owner",
      })
    ).rejects.toMatchObject({ code: "CUSTOMER_CREDIT_REQUIRES_DEDICATED_FLOW", status: 422 });
  });

  // 5. Customer Credit Payment without customerId throws error
  it("5. payComandaWithCustomerCredit on comanda without customerId throws CUSTOMER_REQUIRED_FOR_CREDIT", async () => {
    await expect(
      payComandaWithCustomerCredit(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-no-cust",
        amount: "50.00",
        userId: "user-owner",
      })
    ).rejects.toMatchObject({ code: "CUSTOMER_REQUIRED_FOR_CREDIT", status: 422 });
  });

  // 6. Insufficient Credit Balance in Comanda Payment
  it("6. payComandaWithCustomerCredit exceeding balance throws INSUFFICIENT_CREDIT_BALANCE", async () => {
    await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "30.00",
      description: "Aporte parcial",
      createdByUserId: "user-owner",
    });

    await expect(
      payComandaWithCustomerCredit(f.client, {
        barbershopId: "shop-1",
        comandaId: "cmd-1",
        amount: "50.00",
        userId: "user-owner",
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDIT_BALANCE", status: 422 });
  });

  // 7. Refund CUSTOMER_CREDIT Payment Restores Store Credit
  it("7. refundPayment on CUSTOMER_CREDIT payment restores store credit", async () => {
    // Grant 100.00 credit
    await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "100.00",
      description: "Aporte",
      createdByUserId: "user-owner",
    });

    // Pay 60.00 via CUSTOMER_CREDIT -> balance becomes 40.00
    await payComandaWithCustomerCredit(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      amount: "60.00",
      userId: "user-owner",
    });

    // Refund 60.00 CUSTOMER_CREDIT payment -> balance restored to 100.00
    await refundPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      paymentId: f.payments[0].id,
      amount: "60.00",
      reason: "Estorno de pagamento via crédito",
      userId: "user-owner",
    });

    const acc = await getCustomerCreditAccount("shop-1", "cust-1", f.client);
    expect(toCents(acc.balance)).toBe(10000);
  });

  // 8. Reconciliation / Anti-drift helper
  it("8. reconcileCustomerCreditBalance reports isBalanced=true when balance matches ledger sum", async () => {
    await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "100.00",
      description: "Aporte",
      createdByUserId: "user-owner",
    });

    await adjustCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      type: "DEBIT",
      amount: "30.00",
      description: "Ajuste",
      createdByUserId: "user-owner",
    });

    const rec = await reconcileCustomerCreditBalance("shop-1", "cust-1", f.client);
    expect(rec.isBalanced).toBe(true);
    expect(rec.accountBalance).toBe(70);
    expect(rec.ledgerBalance).toBe(70);
    expect(rec.drift).toBe(0);
  });

  // 9. RBAC Rules Verification
  it("9. RBAC permission functions correctly restrict access by role", () => {
    // CREDIT_VIEW: OWNER, MANAGER, BARBER
    expect(canViewCustomerCredit("OWNER")).toBe(true);
    expect(canViewCustomerCredit("MANAGER")).toBe(true);
    expect(canViewCustomerCredit("BARBER")).toBe(true);

    // CREDIT_CONSUME: OWNER, MANAGER, BARBER
    expect(canConsumeCustomerCredit("OWNER")).toBe(true);
    expect(canConsumeCustomerCredit("MANAGER")).toBe(true);
    expect(canConsumeCustomerCredit("BARBER")).toBe(true);

    // CREDIT_MANUAL_GRANT: OWNER, MANAGER allowed, BARBER denied
    expect(canGrantCustomerCredit("OWNER")).toBe(true);
    expect(canGrantCustomerCredit("MANAGER")).toBe(true);
    expect(canGrantCustomerCredit("BARBER")).toBe(false);

    // CREDIT_ADJUST: OWNER, MANAGER allowed, BARBER denied
    expect(canAdjustCustomerCredit("OWNER")).toBe(true);
    expect(canAdjustCustomerCredit("MANAGER")).toBe(true);
    expect(canAdjustCustomerCredit("BARBER")).toBe(false);

    // CREDIT_REVERSE: OWNER, MANAGER allowed, BARBER denied
    expect(canReverseCustomerCredit("OWNER")).toBe(true);
    expect(canReverseCustomerCredit("MANAGER")).toBe(true);
    expect(canReverseCustomerCredit("BARBER")).toBe(false);
  });

  // 10. Client Credit Route API Integration GET & POST
  it("10. Client credit GET and POST API routes execute RBAC and credit operations", async () => {
    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    // Grant via POST API route as OWNER
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-owner", role: "OWNER", barbershopId: "shop-1" },
    });

    const postReq = new NextRequest("http://localhost/api/admin/clients/cust-1/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "GRANT", amount: 75.5, description: "Bônus via API" }),
    });

    const postRes = await clientCreditPost(postReq, { params: Promise.resolve({ id: "cust-1" }) });
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.success).toBe(true);
    expect(postBody.account.balance).toBe(75.5);

    // GET credit details via API route
    const getReq = new NextRequest("http://localhost/api/admin/clients/cust-1/credit");
    const getRes = await clientCreditGet(getReq, { params: Promise.resolve({ id: "cust-1" }) });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.account.balance).toBe(75.5);
    expect(getBody.entries).toHaveLength(1);
    expect(getBody.reconciliation.isBalanced).toBe(true);

    // Test BARBER role attempting GRANT -> 403 CREDIT_GRANT_FORBIDDEN
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-barber", role: "BARBER", barbershopId: "shop-1" },
    });
    const postReqBarber = new NextRequest("http://localhost/api/admin/clients/cust-1/credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "GRANT", amount: 10, description: "Tentativa barbeiro" }),
    });
    const postResBarber = await clientCreditPost(postReqBarber, { params: Promise.resolve({ id: "cust-1" }) });
    expect(postResBarber.status).toBe(403);
    const bodyBarber = await postResBarber.json();
    expect(bodyBarber.error).toBe("CREDIT_GRANT_FORBIDDEN");
  });

  // 11. Financial Summary & Daily Summary Exclude CUSTOMER_CREDIT from Cash Inflow
  it("11. Financial summary and daily summary report CUSTOMER_CREDIT separately and exclude it from cash inflow", async () => {
    const { default: prisma } = await import("@/lib/prisma");
    Object.assign(prisma, f.prismaMock);

    // Register a PIX payment of 40.00 and CUSTOMER_CREDIT payment of 60.00
    await registerPayment(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      method: "PIX",
      amount: "40.00",
      userId: "user-owner",
    });

    await grantCustomerCredit(f.client, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      amount: "60.00",
      description: "Crédito inicial",
      createdByUserId: "user-owner",
    });

    await payComandaWithCustomerCredit(f.client, {
      barbershopId: "shop-1",
      comandaId: "cmd-1",
      amount: "60.00",
      userId: "user-owner",
    });

    const todayStr = new Date().toISOString().slice(0, 10);

    // Daily summary GET
    const dailyReq = new NextRequest(`http://localhost/api/admin/financial/daily-summary?date=${todayStr}`);
    const dailyRes = await dailySummaryGet(dailyReq);
    expect(dailyRes.status).toBe(200);
    const dailyData = await dailyRes.json();

    // cash inflow totalReceived is 40.00 (from PIX), CUSTOMER_CREDIT is 60.00 separately
    expect(dailyData.pix).toBe(40);
    expect(dailyData.customerCredit).toBe(60);
    expect(dailyData.totalReceived).toBe(40);

    // Financial summary GET
    const summaryReq = new NextRequest(`http://localhost/api/admin/financial/summary?startDate=${todayStr}&endDate=${todayStr}`);
    const summaryRes = await financialSummaryGet(summaryReq);
    expect(summaryRes.status).toBe(200);
    const summaryData = await summaryRes.json();

    expect(summaryData.totals.commandReceived).toBe(40);
    const creditMethod = summaryData.paymentMethods.find((m: any) => m.method === "CUSTOMER_CREDIT");
    expect(creditMethod).toBeDefined();
    expect(creditMethod.amount).toBe(60);
  });
});
