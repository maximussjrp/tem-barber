import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { buildPayableEventKey } from "@/lib/operations/commissions";

const {
  prismaMock,
  sessionMock,
  recalculateMock,
  syncCommissionReleaseMock,
  syncStockMock,
  reverseClubBenefitMock,
  runSerializableTransactionMock,
} = vi.hoisted(() => ({
  prismaMock: {
    comandaItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    comanda: {
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    commissionEntry: {
      findFirst: vi.fn(),
    },
    clubPointEntry: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  sessionMock: vi.fn(),
  recalculateMock: vi.fn(),
  syncCommissionReleaseMock: vi.fn(),
  syncStockMock: vi.fn(),
  reverseClubBenefitMock: vi.fn(),
  runSerializableTransactionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return { ...original, requireOperationalSession: sessionMock };
});
vi.mock("@/lib/operations/comandas", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operations/comandas")>();
  return {
    ...original,
    recalculateComandaTotals: recalculateMock,
  };
});
vi.mock("@/lib/operations/commissions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/operations/commissions")>();
  return {
    ...original,
    syncCommissionReleaseForComanda: syncCommissionReleaseMock,
  };
});
vi.mock("@/lib/operations/stock", () => ({
  runSerializableTransaction: runSerializableTransactionMock,
  syncStockForComandaItem: syncStockMock,
}));
vi.mock("@/lib/operations/club", () => ({
  reverseClubBenefitUsage: reverseClubBenefitMock,
}));

import { PATCH, DELETE } from "@/app/api/admin/comandas/[id]/items/[itemId]/route";

function operationalSession(role: "OWNER" | "MANAGER" | "BARBER" | "RECEPTIONIST", memberId = "barber-1", barbershopId = "shop-1") {
  return {
    error: null,
    data: { userId: `${memberId}-user`, role, memberId, barbershopId },
  };
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/comandas/comanda-1/items/item-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/admin/comandas/comanda-1/items/item-1", {
    method: "DELETE",
  });
}

const params = Promise.resolve({ id: "comanda-1", itemId: "item-1" });

beforeEach(() => {
  vi.clearAllMocks();
  runSerializableTransactionMock.mockImplementation((cb: (tx: typeof prismaMock) => unknown) =>
    cb(prismaMock)
  );
  recalculateMock.mockResolvedValue({ id: "comanda-1", total: "50.00" });
  syncCommissionReleaseMock.mockResolvedValue(undefined);
  syncStockMock.mockResolvedValue(undefined);
  reverseClubBenefitMock.mockResolvedValue({ success: true });
  prismaMock.comanda.update.mockResolvedValue({ id: "comanda-1", commissionRevision: 2 });
  prismaMock.comanda.findUnique.mockResolvedValue({ id: "comanda-1", total: "50.00" });
});

describe("TEMBARBER_UX1_1_COMMISSION_IDEMPOTENCY_FIX — Backend & Idempotency", () => {
  const baseServiceItem = {
    id: "item-1",
    comandaId: "comanda-1",
    barbershopId: "shop-1",
    type: "SERVICE",
    status: "DONE",
    description: "Corte Clássico",
    quantity: new Prisma.Decimal("1.000"),
    unitPrice: new Prisma.Decimal("50.00"),
    discountAmount: new Prisma.Decimal("0.00"),
    surchargeAmount: new Prisma.Decimal("0.00"),
    total: new Prisma.Decimal("50.00"),
    serviceId: "svc-1",
    executorId: "barber-1",
    completedAt: new Date("2026-10-22T10:00:00.000Z"),
    cancelledAt: null,
    comanda: {
      id: "comanda-1",
      status: "OPEN",
      commissionRevision: 1,
    },
  };

  const baseProductItem = {
    id: "item-prod-1",
    comandaId: "comanda-1",
    barbershopId: "shop-1",
    type: "PRODUCT",
    status: "DONE",
    description: "Pomada Matte",
    quantity: new Prisma.Decimal("1.000"),
    unitPrice: new Prisma.Decimal("40.00"),
    discountAmount: new Prisma.Decimal("0.00"),
    surchargeAmount: new Prisma.Decimal("0.00"),
    total: new Prisma.Decimal("40.00"),
    productId: "prod-1",
    executorId: "barber-1",
    completedAt: new Date("2026-10-22T10:00:00.000Z"),
    cancelledAt: null,
    comanda: {
      id: "comanda-1",
      status: "OPEN",
      commissionRevision: 1,
    },
  };

  it("1. Cenário A — Sem pagamento: DONE -> PENDING -> DONE incrementa comanda.commissionRevision a cada transição real", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));

    // Passo 1: DONE -> PENDING
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);
    prismaMock.commissionEntry.findFirst.mockResolvedValue(null);
    prismaMock.clubPointEntry.findUnique.mockResolvedValue(null);
    prismaMock.comandaItem.update.mockResolvedValue({ ...baseServiceItem, status: "PENDING", completedAt: null });

    let res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(200);

    // Deve ter incrementado commissionRevision
    expect(prismaMock.comanda.update).toHaveBeenCalledWith({
      where: { id: "comanda-1" },
      data: { commissionRevision: { increment: 1 } },
    });

    vi.clearAllMocks();

    // Passo 2: PENDING -> DONE
    const pendingItem = { ...baseServiceItem, status: "PENDING", completedAt: null, comanda: { ...baseServiceItem.comanda, commissionRevision: 2 } };
    prismaMock.comandaItem.findFirst.mockResolvedValue(pendingItem);
    prismaMock.comandaItem.update.mockResolvedValue({ ...baseServiceItem, status: "DONE" });

    res = await PATCH(patchRequest({ status: "DONE" }), { params });
    expect(res.status).toBe(200);

    // Deve ter incrementado commissionRevision novamente
    expect(prismaMock.comanda.update).toHaveBeenCalledWith({
      where: { id: "comanda-1" },
      data: { commissionRevision: { increment: 1 } },
    });
  });

  it("2. Cenário B — Pagamento parcial: Prevenção de colisão de eventKey em RELEASE -> REVERSAL -> RELEASE", () => {
    const comandaId = "comanda-1";
    const entryId = "entry-1";
    const targetReleasedCents = 1500;

    // Release 1 inicial (rev 1)
    const releaseKey1 = buildPayableEventKey({
      comandaId,
      revision: 1,
      entryId,
      targetReleasedCents,
      type: "RELEASE",
    });

    // Reversal ao voltar para PENDING (rev 2)
    const reversalKey = buildPayableEventKey({
      comandaId,
      revision: 2,
      entryId,
      targetReleasedCents: 0,
      type: "REVERSAL",
    });

    // Release 2 ao concluir novamente (rev 3)
    const releaseKey2 = buildPayableEventKey({
      comandaId,
      revision: 3,
      entryId,
      targetReleasedCents,
      type: "RELEASE",
    });

    // As três chaves de evento são estritamente distintas
    expect(releaseKey1).toBe("comanda:comanda-1:rev:1:entry:entry-1:target:1500:RELEASE");
    expect(reversalKey).toBe("comanda:comanda-1:rev:2:entry:entry-1:target:0:REVERSAL");
    expect(releaseKey2).toBe("comanda:comanda-1:rev:3:entry:entry-1:target:1500:RELEASE");
    expect(releaseKey1).not.toBe(releaseKey2);
  });

  it("3. Cenário C — Repetição / Idempotência: requisição repetida sem mudança de estado NÃO incrementa commissionRevision", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));

    // Já está DONE, recebe DONE novamente
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);
    prismaMock.comandaItem.update.mockResolvedValue(baseServiceItem);

    let res = await PATCH(patchRequest({ status: "DONE" }), { params });
    expect(res.status).toBe(200);
    // NÃO deve incrementar commissionRevision
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // Já está PENDING, recebe PENDING novamente
    const pendingItem = { ...baseServiceItem, status: "PENDING", completedAt: null };
    prismaMock.comandaItem.findFirst.mockResolvedValue(pendingItem);
    prismaMock.comandaItem.update.mockResolvedValue(pendingItem);

    res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(200);
    // NÃO deve incrementar commissionRevision
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
  });

  it("4. Cenário D — Concorrência: runSerializableTransaction gerencia transações com isolamento Serializable", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);
    prismaMock.commissionEntry.findFirst.mockResolvedValue(null);
    prismaMock.clubPointEntry.findUnique.mockResolvedValue(null);
    prismaMock.comandaItem.update.mockResolvedValue({ ...baseServiceItem, status: "PENDING" });

    const res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(200);
    expect(runSerializableTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("5. Cenário E — Comissão Paga: reversão bloqueada e comanda.commissionRevision inalterada", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);
    prismaMock.commissionEntry.findFirst.mockResolvedValue({
      id: "comm-1",
      paidAmount: new Prisma.Decimal("15.00"),
      status: "PAID",
    });

    const res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("COMMISSION_ALREADY_PAID");

    // Nenhuma alteração persistida
    expect(prismaMock.comandaItem.update).not.toHaveBeenCalled();
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
  });

  it("6. Cenário F — Isolamento Multi-Tenant: acesso a comanda de outra barbearia é rejeitado", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER", "barber-1", "other-shop"));
    prismaMock.comandaItem.findFirst.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(404);
    expect(prismaMock.comandaItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", comandaId: "comanda-1", barbershopId: "other-shop" },
      include: { comanda: true },
    });
  });

  it("7. Cenário G — Clube e Estoque: reversão de serviço preserva estoque e não reverte benefício indevidamente", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);
    prismaMock.commissionEntry.findFirst.mockResolvedValue(null);
    prismaMock.clubPointEntry.findUnique.mockResolvedValue(null);
    prismaMock.comandaItem.update.mockResolvedValue({ ...baseServiceItem, status: "PENDING" });

    const res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(200);

    // reversão de clube (como se fosse cancelamento) NÃO deve ter sido chamada
    expect(reverseClubBenefitMock).not.toHaveBeenCalled();
  });

  it("8. DELETE do item: cancelamento do item incrementa commissionRevision para sincronização de cancelamento", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);
    prismaMock.comandaItem.update.mockResolvedValue({ ...baseServiceItem, status: "CANCELLED" });

    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(200);

    expect(prismaMock.comanda.update).toHaveBeenCalledWith({
      where: { id: "comanda-1" },
      data: { commissionRevision: { increment: 1 } },
    });
  });

  it("9. Validações de Transição: CANCELLED -> PENDING e CANCELLED -> DONE bloqueados (422)", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    const cancelledItem = { ...baseServiceItem, status: "CANCELLED" };
    prismaMock.comandaItem.findFirst.mockResolvedValue(cancelledItem);

    let res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(422);
    let body = await res.json();
    expect(body.error).toBe("INVALID_STATUS_TRANSITION");

    res = await PATCH(patchRequest({ status: "DONE" }), { params });
    expect(res.status).toBe(422);
    body = await res.json();
    expect(body.error).toBe("INVALID_STATUS_TRANSITION");
  });

  it("10. Validações de Transição: PRODUCT DONE -> PENDING bloqueado (422)", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseProductItem);

    const res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("INVALID_STATUS_TRANSITION");
  });

  it("11. Permissões RBAC: BARBER só pode alterar o próprio item e não pode cancelar", async () => {
    sessionMock.mockResolvedValue(operationalSession("BARBER", "other-barber"));
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);

    // Tentando alterar item de outro barbeiro
    let res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(403);

    // Tentando cancelar item
    sessionMock.mockResolvedValue(operationalSession("BARBER", "barber-1"));
    res = await PATCH(patchRequest({ status: "CANCELLED" }), { params });
    expect(res.status).toBe(403);
  });

  it("12. Comanda CLOSED ou CANCELLED bloqueia qualquer edição (422)", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    const closedComandaItem = { ...baseServiceItem, comanda: { id: "comanda-1", status: "CLOSED" } };
    prismaMock.comandaItem.findFirst.mockResolvedValue(closedComandaItem);

    const res = await PATCH(patchRequest({ status: "PENDING" }), { params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("COMANDA_CLOSED");
  });

  it("13. Proteção Bloqueador 3: Item CANCELLED bloqueia alteração de quantidade sem status (422 INVALID_OPERATION)", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    const cancelledItem = { ...baseServiceItem, status: "CANCELLED" };
    prismaMock.comandaItem.findFirst.mockResolvedValue(cancelledItem);

    const res = await PATCH(patchRequest({ quantity: 2 }), { params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("INVALID_OPERATION");
  });

  it("14. Proteção Bloqueador 3: DELETE repetido em item CANCELLED é idempotente e seguro (não incrementa revisão nem muta)", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    const cancelledItem = { ...baseServiceItem, status: "CANCELLED" };
    prismaMock.comandaItem.findFirst.mockResolvedValue(cancelledItem);
    prismaMock.comanda.findUnique.mockResolvedValue({ id: "comanda-1", total: "50.00" });

    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(200);

    // Confirma retorno via consulta de leitura pura
    expect(prismaMock.comanda.findUnique).toHaveBeenCalled();
    // Confirma ausência total de operações de escrita ou recálculo
    expect(prismaMock.comandaItem.update).not.toHaveBeenCalled();
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
    expect(recalculateMock).not.toHaveBeenCalled();
    expect(syncCommissionReleaseMock).not.toHaveBeenCalled();
    expect(syncStockMock).not.toHaveBeenCalled();
    expect(reverseClubBenefitMock).not.toHaveBeenCalled();
  });

  it("15. Proteção Bloqueador 3: PATCH repetido sem alterações operacionais não muta dados nem revisão", async () => {
    sessionMock.mockResolvedValue(operationalSession("OWNER"));
    // baseServiceItem tem status DONE
    prismaMock.comandaItem.findFirst.mockResolvedValue(baseServiceItem);
    prismaMock.comanda.findUnique.mockResolvedValue({ id: "comanda-1", total: "50.00" });

    // Envia o mesmo status DONE sem outras alterações (repetição idempotente)
    const res = await PATCH(patchRequest({ status: "DONE" }), { params });
    expect(res.status).toBe(200);

    // Confirma retorno via consulta de leitura pura
    expect(prismaMock.comanda.findUnique).toHaveBeenCalled();
    // Confirma ausência total de operações de escrita ou recálculo
    expect(prismaMock.comandaItem.update).not.toHaveBeenCalled();
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
    expect(recalculateMock).not.toHaveBeenCalled();
    expect(syncCommissionReleaseMock).not.toHaveBeenCalled();
    expect(syncStockMock).not.toHaveBeenCalled();
    expect(reverseClubBenefitMock).not.toHaveBeenCalled();
  });
});
