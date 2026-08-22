import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildCustomerCsv,
  buildCustomerXlsx,
  CustomerImportError,
  parseCustomerImportFile,
} from "@/lib/customer-import-export";

function uploaded(name: string, content: string | Buffer, declaredSize?: number) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return {
    name,
    size: declaredSize ?? buffer.length,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    },
  };
}

async function workbookFile(
  configure: (workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet) => void
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clientes");
  configure(workbook, sheet);
  return uploaded("clientes.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()));
}

describe("customer import parsing", () => {
  it("aceita CSV UTF-8 com aliases, acentos e datas BR/ISO", async () => {
    const rows = await parseCustomerImportFile(uploaded(
      "clientes.csv",
      "\uFEFFNome;WhatsApp;E-mail;Data de nascimento;Observações\nJosé Ávila;(17) 99108-9190;jose@email.com;10/05/1990;Cliente manhã\nAna;17991089191;;1991-06-11;"
    ));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "José Ávila",
      phoneNormalized: "5517991089190",
      birthDate: "1990-05-10",
      notes: "Cliente manhã",
      status: "VALID",
    });
    expect(rows[1].birthDate).toBe("1991-06-11");
  });

  it("aceita XLSX de uma planilha e preserva Date real como data civil", async () => {
    const file = await workbookFile((_workbook, sheet) => {
      sheet.addRow(["name", "phone", "email", "birth date", "notes"]);
      sheet.addRow(["Maria", "17991089190", null, new Date("1990-05-10T00:00:00.000Z"), "Nota"]);
    });
    const rows = await parseCustomerImportFile(file);
    expect(rows[0]).toMatchObject({ birthDate: "1990-05-10", status: "VALID" });
  });

  it("marca duplicidade interna depois da primeira linha valida", async () => {
    const rows = await parseCustomerImportFile(uploaded(
      "clientes.csv",
      "Nome,Telefone\nPrimeiro,17991089190\nSegundo,+55 17 99108-9190"
    ));
    expect(rows.map((row) => row.status)).toEqual(["VALID", "DUPLICATE_IN_FILE"]);
  });

  it("normaliza todas as representacoes oficiais do mesmo telefone", async () => {
    const rows = await parseCustomerImportFile(uploaded(
      "clientes.csv",
      [
        "Nome,Telefone",
        "A,17 99108-9190",
        "B,(17) 99108-9190",
        "C,17991089190",
        "D,+55 17 99108-9190",
        "E,5517991089190",
      ].join("\n")
    ));

    expect(rows.map((row) => row.phoneNormalized)).toEqual(
      Array.from({ length: 5 }, () => "5517991089190")
    );
    expect(rows.map((row) => row.status)).toEqual([
      "VALID",
      "DUPLICATE_IN_FILE",
      "DUPLICATE_IN_FILE",
      "DUPLICATE_IN_FILE",
      "DUPLICATE_IN_FILE",
    ]);
  });

  it("rejeita limites, formatos proibidos, XLSX ambiguo e arquivos malformados", async () => {
    const tooMany = [
      "Nome,Telefone",
      ...Array.from({ length: 1001 }, (_, index) => `Cliente ${index},1799${String(index).padStart(7, "0")}`),
    ].join("\n");
    await expect(parseCustomerImportFile(uploaded("clientes.csv", tooMany))).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
    await expect(parseCustomerImportFile(uploaded("clientes.csv", "x", 5 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    for (const name of ["clientes.xls", "clientes.xlsm", "clientes.ods", "clientes.txt"]) {
      await expect(parseCustomerImportFile(uploaded(name, "x"))).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    }
    await expect(parseCustomerImportFile(uploaded("clientes.csv", 'Nome,Telefone\n"sem fim'))).rejects.toBeInstanceOf(CustomerImportError);
    await expect(parseCustomerImportFile(uploaded("clientes.xlsx", "nao e xlsx"))).rejects.toMatchObject({ code: "MALFORMED_FILE" });

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("A").addRow(["Nome", "Telefone"]);
    workbook.addWorksheet("B").addRow(["Nome", "Telefone"]);
    const multi = uploaded("clientes.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()));
    await expect(parseCustomerImportFile(multi)).rejects.toMatchObject({ code: "WORKSHEET_COUNT" });
  });

  it("classifica campos obrigatorios, telefone, email, data e notes invalidos", async () => {
    const csv = [
      "Nome,Telefone,E-mail,Data de nascimento,Observacoes",
      ",17991089190,,,,",
      "Sem telefone,,,,",
      "Telefone ruim,123,,,,",
      `Telefone longo,${"1".repeat(33)},,,,`,
      "Email ruim,17991089191,invalido,,",
      "Data futura,17991089192,,2999-01-01,",
      "Data impossivel,17991089193,,30/02/2024,",
      `Notes longa,17991089194,,,${"x".repeat(1001)}`,
    ].join("\n");
    const rows = await parseCustomerImportFile(uploaded("clientes.csv", csv));
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.status === "INVALID")).toBe(true);
  });

  it("rejeita formulas e hyperlinks em XLSX sem avaliar valor calculado", async () => {
    const file = await workbookFile((_workbook, sheet) => {
      sheet.addRow(["Nome", "Telefone"]);
      sheet.getCell("A2").value = { formula: 'HYPERLINK("https://evil.test","Cliente")', result: "Cliente" };
      sheet.getCell("B2").value = "17991089190";
      sheet.getCell("A3").value = { text: "Outro", hyperlink: "javascript:alert(1)" };
      sheet.getCell("B3").value = "17991089191";
    });
    const rows = await parseCustomerImportFile(file);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "INVALID")).toBe(true);
    expect(rows[0].reason).toContain("Formulas");
    expect(rows[1].reason).toContain("Hyperlinks");
  });
});

describe("customer export file safety", () => {
  const rows = [{
    name: "=CMD()",
    phone: "+5517991089190",
    email: "@evil.test",
    birthDate: "1990-05-10",
    notes: "-formula",
  }, {
    name: "Cliente normal",
    phone: "5517991089191",
    email: null,
    birthDate: null,
    notes: null,
  }];

  it("gera CSV UTF-8 com BOM, null vazio e neutralizacao de formula", () => {
    const csv = buildCustomerCsv(rows).toString("utf8");
    expect(csv.startsWith("\uFEFFNome,Telefone")).toBe(true);
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain("'+5517991089190");
    expect(csv).toContain("'@evil.test");
    expect(csv).toContain("'-formula");
    expect(csv).toContain("Cliente normal,5517991089191,,,");
  });

  it("gera XLSX legivel sem formulas executaveis e com data ISO", async () => {
    const buffer = await buildCustomerXlsx(rows);
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(workbook.worksheets).toHaveLength(1);
    expect(sheet.getCell("A2").value).toBe("'=CMD()");
    expect(sheet.getCell("A2").formula).toBeUndefined();
    expect(sheet.getCell("B2").value).toBe("'+5517991089190");
    expect(sheet.getCell("C2").value).toBe("'@evil.test");
    expect(sheet.getCell("D2").value).toBe("1990-05-10");
    expect(sheet.getCell("C3").value).toBe("");
  });
});
