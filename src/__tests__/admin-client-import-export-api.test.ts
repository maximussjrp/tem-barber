import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    customerBarbershopLink: { findMany: vi.fn(), create: vi.fn() },
    appointment: { findMany: vi.fn() },
    comanda: { findMany: vi.fn() },
    customerClubSubscription: { findMany: vi.fn() },
    user: { findMany: vi.fn(), create: vi.fn() },
    barbershop: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { POST as previewImport } from "@/app/api/admin/clients/import/preview/route";
import { POST as confirmImport } from "@/app/api/admin/clients/import/confirm/route";
import { GET as exportClients } from "@/app/api/admin/clients/export/route";

function uploadRequest(path: string, content: string, name = "clientes.csv", extra?: Record<string, string>) {
  const form = new FormData();
  form.append("file", new File([content], name, { type: "text/csv" }));
  for (const [key, value] of Object.entries(extra ?? {})) form.append(key, value);
  return new NextRequest(`http://localhost${path}`, { method: "POST", body: form });
}

function emptyTenantSources() {
  prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([]);
  prismaMock.appointment.findMany.mockResolvedValueOnce([]);
  prismaMock.comanda.findMany.mockResolvedValueOnce([]);
  prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
}

describe("admin customer import API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-a", memberId: "member-a", role: "OWNER", barbershopId: "shop-a" },
    });
    prismaMock.customerBarbershopLink.findMany.mockResolvedValue([]);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.comanda.findMany.mockResolvedValue([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.customerBarbershopLink.create.mockResolvedValue({ id: "link-new" });
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) =>
      callback(prismaMock)
    );
  });

  it("preview classifica tenant, arquivo e invalidos sem escrever nem confiar no barbershopId", async () => {
    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([{ customerId: "existing-a" }]);
    prismaMock.user.findMany.mockResolvedValueOnce([{ phone: "5517991089190" }]);
    const response = await previewImport(uploadRequest(
      "/api/admin/clients/import/preview",
      "Nome,Telefone\nExistente,17991089190\nNovo,17991089191\nRepetido,+55 17 99108-9191\nInvalido,123",
      "clientes.csv",
      { barbershopId: "shop-b" }
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ totalRows: 4, valid: 1, duplicates: 2, invalid: 1 });
    expect(data.rows.map((row: { status: string }) => row.status)).toEqual([
      "DUPLICATE",
      "VALID",
      "DUPLICATE_IN_FILE",
      "INVALID",
    ]);
    expect(prismaMock.customerBarbershopLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { barbershopId: "shop-a" } })
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.customerBarbershopLink.create).not.toHaveBeenCalled();
  });

  it("confirm reutiliza User global de outro tenant, cria somente link A e preserva identidade global", async () => {
    emptyTenantSources();
    prismaMock.user.findMany.mockResolvedValueOnce([{
      id: "shared-user",
      name: "Nome global B",
      email: "global@b.test",
      phone: "5517991089190",
    }]);
    prismaMock.user.findMany.mockResolvedValueOnce([{
      id: "shared-user",
      name: "Nome global B",
      email: "global@b.test",
      phone: "5517991089190",
    }]);

    const response = await confirmImport(uploadRequest(
      "/api/admin/clients/import/confirm",
      "Nome,Telefone,E-mail,Data de nascimento,Observacoes\nNome importado,17991089190,novo@a.test,10/05/1990,Cliente A",
      "clientes.csv",
      { barbershopId: "shop-b" }
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.imported).toBe(1);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.customerBarbershopLink.create).toHaveBeenCalledWith({
      data: {
        barbershopId: "shop-a",
        customerId: "shared-user",
        birthDate: new Date("1990-05-10T00:00:00.000Z"),
        notes: "Cliente A",
      },
      select: { id: true },
    });
  });

  it("classifica conflito global de email como invalido sem reutilizar ou alterar User", async () => {
    emptyTenantSources();
    prismaMock.user.findMany.mockResolvedValueOnce([{
      phone: "5517991089199",
      email: "usado@global.test",
    }]);

    const response = await confirmImport(uploadRequest(
      "/api/admin/clients/import/confirm",
      "Nome,Telefone,E-mail\nNovo,17991089190,usado@global.test"
    ));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ imported: 0, duplicates: 0, invalid: 1, failed: 0 });
    expect(data.rows[0]).toMatchObject({ status: "INVALID", reason: "E-mail ja utilizado por outro usuario." });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.customerBarbershopLink.create).not.toHaveBeenCalled();
  });

  it("confirm cria User novo e link tenant em transacao serializable", async () => {
    emptyTenantSources();
    prismaMock.user.findMany.mockResolvedValueOnce([]);
    prismaMock.user.create.mockResolvedValueOnce({
      id: "new-user",
      name: "Novo",
      email: null,
      phone: "5517991089190",
    });
    const response = await confirmImport(uploadRequest(
      "/api/admin/clients/import/confirm",
      "Nome,Telefone\nNovo,17991089190"
    ));

    expect(response.status).toBe(200);
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "Novo", phone: "5517991089190" }),
    }));
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: "Serializable",
    }));
  });

  it("confirm revalida o arquivo e ignora linha que virou duplicada depois do preview", async () => {
    emptyTenantSources();
    const file = "Nome,Telefone\nNovo,17991089190";
    const preview = await previewImport(uploadRequest("/api/admin/clients/import/preview", file));
    expect((await preview.json()).valid).toBe(1);

    prismaMock.customerBarbershopLink.findMany.mockResolvedValueOnce([{ customerId: "concurrent-user" }]);
    prismaMock.appointment.findMany.mockResolvedValueOnce([]);
    prismaMock.comanda.findMany.mockResolvedValueOnce([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findMany.mockResolvedValueOnce([{ phone: "5517991089190" }]);
    const confirmed = await confirmImport(uploadRequest("/api/admin/clients/import/confirm", file));
    const data = await confirmed.json();

    expect(data).toMatchObject({ imported: 0, duplicates: 1, failed: 0 });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.customerBarbershopLink.create).not.toHaveBeenCalled();
  });

  it("faz retry limitado em conflito concorrente e nao confirma duas vezes", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("serialization", {
      code: "P2034",
      clientVersion: "7.8.0",
    });
    prismaMock.$transaction
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    emptyTenantSources();
    prismaMock.user.findMany.mockResolvedValueOnce([]);
    prismaMock.user.create.mockResolvedValueOnce({ id: "new", name: "Novo", email: null, phone: "5517991089190" });

    const response = await confirmImport(uploadRequest(
      "/api/admin/clients/import/confirm",
      "Nome,Telefone\nNovo,17991089190"
    ));
    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(prismaMock.customerBarbershopLink.create).toHaveBeenCalledTimes(1);
  });

  it("duas confirmacoes simultaneas persistem um unico User e um unico vinculo", async () => {
    let user: { id: string; name: string; email: null; phone: string } | null = null;
    let linked = false;
    let transactionTail = Promise.resolve();

    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => {
      const current = transactionTail.then(() => callback(prismaMock));
      transactionTail = current.then(() => undefined, () => undefined);
      return current;
    });
    prismaMock.customerBarbershopLink.findMany.mockImplementation(async () =>
      linked ? [{ customerId: "new-user" }] : []
    );
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.comanda.findMany.mockResolvedValue([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockImplementation(async (args: { where?: { id?: unknown } }) => {
      if (!user) return [];
      return args.where?.id ? [{ phone: user.phone }] : [user];
    });
    prismaMock.user.create.mockImplementation(async () => {
      user = { id: "new-user", name: "Novo", email: null, phone: "5517991089190" };
      return user;
    });
    prismaMock.customerBarbershopLink.create.mockImplementation(async () => {
      linked = true;
      return { id: "link-new" };
    });

    const file = "Nome,Telefone\nNovo,17991089190";
    const [first, second] = await Promise.all([
      confirmImport(uploadRequest("/api/admin/clients/import/confirm", file)),
      confirmImport(uploadRequest("/api/admin/clients/import/confirm", file)),
    ]);
    const results = await Promise.all([first.json(), second.json()]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(results.map((result) => result.imported).sort()).toEqual([0, 1]);
    expect(results.map((result) => result.duplicates).sort()).toEqual([0, 1]);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.customerBarbershopLink.create).toHaveBeenCalledTimes(1);
  });

  it("falha interna retorna 500 e fica contida pela unica transacao autoritativa", async () => {
    const persistedUsers: string[] = [];
    const persistedLinks: string[] = [];
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => {
      const userSnapshot = persistedUsers.length;
      const linkSnapshot = persistedLinks.length;
      try {
        return await callback(prismaMock);
      } catch (error) {
        persistedUsers.length = userSnapshot;
        persistedLinks.length = linkSnapshot;
        throw error;
      }
    });
    emptyTenantSources();
    prismaMock.user.findMany.mockResolvedValueOnce([]);
    prismaMock.user.create.mockImplementationOnce(async () => {
      persistedUsers.push("new");
      return { id: "new", name: "Novo", email: null, phone: "5517991089190" };
    });
    prismaMock.customerBarbershopLink.create.mockImplementationOnce(async () => {
      persistedLinks.push("link-new");
      throw new Error("db failed");
    });
    const response = await confirmImport(uploadRequest(
      "/api/admin/clients/import/confirm",
      "Nome,Telefone\nNovo,17991089190"
    ));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "IMPORT_CONFIRM_FAILED" });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(persistedUsers).toEqual([]);
    expect(persistedLinks).toEqual([]);
  });
});

describe("admin customer export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-a", memberId: "member-a", role: "OWNER", barbershopId: "shop-a" },
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ slug: "Barbearia São João" });
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.comanda.findMany.mockResolvedValue([]);
    prismaMock.customerClubSubscription.findMany.mockResolvedValue([]);
  });

  function exportTenantData() {
    prismaMock.customerBarbershopLink.findMany
      .mockResolvedValueOnce([{ customerId: "shared-user" }, { customerId: "legacy-a" }])
      .mockResolvedValueOnce([{
        customerId: "shared-user",
        birthDate: new Date("1990-05-10T00:00:00.000Z"),
        notes: "=Notas A",
      }]);
    prismaMock.user.findMany.mockResolvedValueOnce([{
      id: "shared-user",
      name: "@Cliente A",
      phone: "5517991089190",
      email: null,
    }, {
      id: "legacy-a",
      name: "Legado A",
      phone: "5517991089191",
      email: "legado@test.com",
    }]);
  }

  it("exporta CSV do tenant atual, legado null, injection segura e filename sanitizado", async () => {
    exportTenantData();
    const response = await exportClients(new NextRequest("http://localhost/api/admin/clients/export?format=csv"));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("clientes-barbearia-sao-joao-");
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="clientes-barbearia-sao-joao-\d{4}-\d{2}-\d{2}\.csv"/
    );
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv).toContain("'@Cliente A");
    expect(csv).toContain("1990-05-10,'=Notas A");
    expect(csv).toContain("Legado A,5517991089191,legado@test.com,,");
    expect(csv).not.toContain("Notas B");
    expect(prismaMock.customerBarbershopLink.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barbershopId: "shop-a" }) })
    );
  });

  it("exporta XLSX sem formula executavel e sem dados tenant-scoped de B", async () => {
    exportTenantData();
    const response = await exportClients(new NextRequest("http://localhost/api/admin/clients/export?format=xlsx"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const sheet = workbook.worksheets[0];
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="clientes-barbearia-sao-joao-\d{4}-\d{2}-\d{2}\.xlsx"/
    );
    expect(sheet.getCell("A2").value).toBe("'@Cliente A");
    expect(sheet.getCell("A2").formula).toBeUndefined();
    expect(sheet.getCell("D2").value).toBe("1990-05-10");
    expect(sheet.getCell("E2").value).toBe("'=Notas A");
    expect(JSON.stringify(sheet.getSheetValues())).not.toContain("Notas B");
  });

  it("exporta B com o mesmo User global sem expor os dados tenant-scoped de A", async () => {
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-b", memberId: "member-b", role: "OWNER", barbershopId: "shop-b" },
    });
    prismaMock.barbershop.findUnique.mockResolvedValue({ slug: "Barbearia B" });
    prismaMock.customerBarbershopLink.findMany
      .mockResolvedValueOnce([{ customerId: "shared-user" }])
      .mockResolvedValueOnce([{
        customerId: "shared-user",
        birthDate: new Date("1991-06-11T00:00:00.000Z"),
        notes: "Notas B",
      }]);
    prismaMock.user.findMany.mockResolvedValueOnce([{
      id: "shared-user",
      name: "Cliente compartilhado",
      phone: "5517991089190",
      email: null,
    }]);

    const response = await exportClients(
      new NextRequest("http://localhost/api/admin/clients/export?format=csv")
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(csv).toContain("1991-06-11,Notas B");
    expect(csv).not.toContain("Notas A");
    expect(prismaMock.customerBarbershopLink.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barbershopId: "shop-b" }) })
    );
  });

  it("fornece XLSX modelo sem dados reais", async () => {
    const response = await exportClients(new NextRequest("http://localhost/api/admin/clients/export?format=template"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(response.headers.get("content-disposition")).toContain("modelo-importacao-clientes.xlsx");
    expect(workbook.worksheets[0].getRow(1).values).toEqual([
      undefined,
      "Nome",
      "Telefone",
      "E-mail",
      "Data de nascimento",
      "Observações",
    ]);
    expect(workbook.worksheets[0].getCell("A2").value).toBe("João Silva");
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
});
