import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import {
  collectBarbershopCustomerIds,
  formatCustomerBirthDate,
  normalizePhone,
  phoneLookupVariants,
  validateCustomerBarbershopProfile,
} from "@/lib/customers";
import { validateBrazilianMobilePhone } from "@/lib/phone/br-phone";

export const CUSTOMER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_ROWS = 1000;
export const CUSTOMER_IMPORT_BATCH_SIZE = 100;

export type CustomerImportStatus =
  | "VALID"
  | "DUPLICATE"
  | "DUPLICATE_IN_FILE"
  | "INVALID";

export type CustomerImportRow = {
  rowNumber: number;
  name: string;
  phoneOriginal: string;
  phoneNormalized: string;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
  status: CustomerImportStatus;
  reason: string | null;
};

export type CustomerImportPreview = {
  totalRows: number;
  valid: number;
  duplicates: number;
  invalid: number;
  rows: CustomerImportRow[];
};

export type CustomerImportResult = {
  totalRows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  failed: number;
  rows: CustomerImportRow[];
};

export type CustomerExportRow = {
  name: string;
  phone: string;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
};

type CustomerDataClient = Pick<
  Prisma.TransactionClient,
  | "appointment"
  | "comanda"
  | "customerBarbershopLink"
  | "customerClubSubscription"
  | "user"
>;

type UploadedFile = {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type RawCell = { value: unknown; unsafeReason?: string };
type RawImportRow = {
  rowNumber: number;
  name: RawCell;
  phone: RawCell;
  email: RawCell;
  birthDate: RawCell;
  notes: RawCell;
};

const HEADER_ALIASES = new Map<string, keyof Omit<RawImportRow, "rowNumber">>([
  ["nome", "name"],
  ["name", "name"],
  ["telefone", "phone"],
  ["phone", "phone"],
  ["celular", "phone"],
  ["whatsapp", "phone"],
  ["email", "email"],
  ["e mail", "email"],
  ["data de nascimento", "birthDate"],
  ["nascimento", "birthDate"],
  ["birthdate", "birthDate"],
  ["birth date", "birthDate"],
  ["observacoes", "notes"],
  ["notes", "notes"],
]);

const EMPTY_CELL: RawCell = { value: "" };

export class CustomerImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "CustomerImportError";
  }
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  return String(value).trim();
}

function currentCivilDateInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeBirthDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const text = String(value).trim();
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "__INVALID__";
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    return "__INVALID__";
  }
  return iso;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateRawRow(row: RawImportRow): CustomerImportRow {
  const unsafeReason = [row.name, row.phone, row.email, row.birthDate, row.notes]
    .map((cell) => cell.unsafeReason)
    .find(Boolean);
  const name = String(stringValue(row.name.value));
  const phoneOriginal = String(stringValue(row.phone.value));
  const phoneNormalized = normalizePhone(phoneOriginal);
  const emailText = String(stringValue(row.email.value));
  const email = emailText || null;
  const notesText = String(stringValue(row.notes.value));
  const notes = notesText || null;
  const birthDate = normalizeBirthDate(row.birthDate.value);

  let reason = unsafeReason ?? null;
  if (!reason && !name) reason = "Nome obrigatorio.";
  if (!reason && name.length > 120) reason = "Nome deve ter no maximo 120 caracteres.";
  if (!reason && !phoneOriginal) reason = "Telefone obrigatorio.";
  if (!reason && phoneOriginal.length > 32) reason = "Telefone deve ter no maximo 32 caracteres.";
  if (!reason && !validateBrazilianMobilePhone(phoneNormalized)) reason = "Telefone brasileiro invalido.";
  if (!reason && email && email.length > 254) reason = "E-mail deve ter no maximo 254 caracteres.";
  if (!reason && email && !isValidEmail(email)) reason = "E-mail invalido.";
  if (!reason && birthDate === "__INVALID__") reason = "Data de nascimento invalida.";
  if (!reason && birthDate && birthDate !== "__INVALID__") {
    const profile = validateCustomerBarbershopProfile({ birthDate }, new Date());
    if ("error" in profile) reason = profile.message;
  }
  if (!reason && notes && notes.length > 1000) {
    reason = "Observacoes devem ter no maximo 1000 caracteres.";
  }

  return {
    rowNumber: row.rowNumber,
    name,
    phoneOriginal,
    phoneNormalized,
    email,
    birthDate: birthDate === "__INVALID__" ? null : birthDate,
    notes,
    status: reason ? "INVALID" : "VALID",
    reason,
  };
}

function applyInFileDuplicates(rows: CustomerImportRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status !== "VALID") continue;
    if (seen.has(row.phoneNormalized)) {
      row.status = "DUPLICATE_IN_FILE";
      row.reason = "Telefone repetido no arquivo.";
    } else {
      seen.add(row.phoneNormalized);
    }
  }
  return rows;
}

function parseCsvRecords(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  if (normalized.includes("\0")) {
    throw new CustomerImportError("MALFORMED_FILE", "CSV malformado.");
  }
  const firstLine = normalized.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = countDelimiter(firstLine, ";") > countDelimiter(firstLine, ",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quoted) {
      if (char === '"' && normalized[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      if (value.length > 0) throw new CustomerImportError("MALFORMED_FILE", "CSV malformado.");
      quoted = true;
    } else if (char === delimiter) {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new CustomerImportError("MALFORMED_FILE", "CSV malformado.");
  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function resolveHeaders(headers: unknown[]) {
  const columns = new Map<keyof Omit<RawImportRow, "rowNumber">, number>();
  headers.forEach((header, index) => {
    const key = HEADER_ALIASES.get(normalizeHeader(header));
    if (key && !columns.has(key)) columns.set(key, index);
  });
  if (!columns.has("name") || !columns.has("phone")) {
    throw new CustomerImportError(
      "MISSING_REQUIRED_COLUMNS",
      "A planilha deve conter as colunas Nome e Telefone."
    );
  }
  return columns;
}

function rawRowsFromCsv(records: string[][]): RawImportRow[] {
  if (records.length === 0) throw new CustomerImportError("EMPTY_FILE", "Arquivo vazio.");
  const columns = resolveHeaders(records[0]);
  return records.slice(1).flatMap((values, index) => {
    const cell = (key: keyof Omit<RawImportRow, "rowNumber">): RawCell => {
      const column = columns.get(key);
      return column === undefined ? EMPTY_CELL : { value: values[column] ?? "" };
    };
    const row = {
      rowNumber: index + 2,
      name: cell("name"),
      phone: cell("phone"),
      email: cell("email"),
      birthDate: cell("birthDate"),
      notes: cell("notes"),
    };
    return [row.name, row.phone, row.email, row.birthDate, row.notes].some(
      (entry) => String(entry.value ?? "").trim() !== ""
    )
      ? [row]
      : [];
  });
}

function excelCell(cell: ExcelJS.Cell): RawCell {
  const value = cell.value;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const object = value as unknown as Record<string, unknown>;
    if ("formula" in object || "sharedFormula" in object) {
      return { value: "", unsafeReason: "Formulas nao sao permitidas." };
    }
    if ("hyperlink" in object) {
      return { value: "", unsafeReason: "Hyperlinks nao sao permitidos." };
    }
    if (Array.isArray(object.richText)) {
      return {
        value: object.richText
          .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
          .join(""),
      };
    }
  }
  return { value };
}

async function rawRowsFromXlsx(buffer: Buffer): Promise<RawImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
  } catch {
    throw new CustomerImportError("MALFORMED_FILE", "Arquivo XLSX malformado.");
  }
  if (workbook.worksheets.length !== 1) {
    throw new CustomerImportError("WORKSHEET_COUNT", "Envie um XLSX com somente uma planilha.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.actualRowCount === 0) throw new CustomerImportError("EMPTY_FILE", "Arquivo vazio.");
  const headerRow = sheet.getRow(1);
  const headerValues: unknown[] = [];
  for (let column = 1; column <= headerRow.cellCount; column += 1) {
    const parsed = excelCell(headerRow.getCell(column));
    if (parsed.unsafeReason) throw new CustomerImportError("UNSAFE_CELL", parsed.unsafeReason);
    headerValues.push(parsed.value);
  }
  const columns = resolveHeaders(headerValues);
  const rows: RawImportRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (key: keyof Omit<RawImportRow, "rowNumber">) => {
      const column = columns.get(key);
      return column === undefined ? EMPTY_CELL : excelCell(excelRow.getCell(column + 1));
    };
    const row = {
      rowNumber,
      name: cell("name"),
      phone: cell("phone"),
      email: cell("email"),
      birthDate: cell("birthDate"),
      notes: cell("notes"),
    };
    if (
      [row.name, row.phone, row.email, row.birthDate, row.notes].some(
        (entry) => entry.unsafeReason || String(entry.value ?? "").trim() !== ""
      )
    ) {
      rows.push(row);
    }
  });
  return rows;
}

export async function parseCustomerImportFile(file: UploadedFile): Promise<CustomerImportRow[]> {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (extension !== ".csv" && extension !== ".xlsx") {
    throw new CustomerImportError("UNSUPPORTED_FORMAT", "Formato invalido. Use CSV ou XLSX.");
  }
  if (file.size <= 0) throw new CustomerImportError("EMPTY_FILE", "Arquivo vazio.");
  if (file.size > CUSTOMER_IMPORT_MAX_BYTES) {
    throw new CustomerImportError("FILE_TOO_LARGE", "O arquivo deve ter no maximo 5 MB.", 413);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const rawRows =
    extension === ".csv"
      ? rawRowsFromCsv(parseCsvRecords(buffer.toString("utf8")))
      : await rawRowsFromXlsx(buffer);
  if (rawRows.length > CUSTOMER_IMPORT_MAX_ROWS) {
    throw new CustomerImportError("TOO_MANY_ROWS", "A planilha deve ter no maximo 1000 linhas.", 413);
  }
  if (rawRows.length === 0) throw new CustomerImportError("EMPTY_FILE", "Nenhuma linha util encontrada.");
  return applyInFileDuplicates(rawRows.map(validateRawRow));
}

async function tenantPhoneSet(client: CustomerDataClient, barbershopId: string) {
  const { ids } = await collectBarbershopCustomerIds(client as Prisma.TransactionClient, barbershopId);
  if (ids.length === 0) return new Set<string>();
  const users = await client.user.findMany({
    where: { id: { in: ids } },
    select: { phone: true },
  });
  return new Set(users.map((user) => normalizePhone(user.phone)).filter(Boolean));
}

export async function classifyCustomerImportRows(
  client: CustomerDataClient,
  barbershopId: string,
  sourceRows: CustomerImportRow[]
): Promise<CustomerImportPreview> {
  const rows = sourceRows.map((row) => ({ ...row }));
  const existingPhones = await tenantPhoneSet(client, barbershopId);
  const candidates = rows.filter((row) => row.status === "VALID");
  const phoneVariants = [...new Set(candidates.flatMap((row) => phoneLookupVariants(row.phoneNormalized)))];
  const emails = [...new Set(candidates.map((row) => row.email).filter((email): email is string => Boolean(email)))];
  const globalUsers = candidates.length
    ? await client.user.findMany({
        where: {
          OR: [
            ...(phoneVariants.length ? [{ phone: { in: phoneVariants } }] : []),
            ...(emails.length ? [{ email: { in: emails } }] : []),
          ],
        },
        select: { phone: true, email: true },
      })
    : [];
  const globalPhones = new Set(globalUsers.map((user) => normalizePhone(user.phone)).filter(Boolean));
  const emailOwners = new Map(
    globalUsers.filter((user) => user.email).map((user) => [user.email!.toLowerCase(), normalizePhone(user.phone)])
  );
  for (const row of rows) {
    if (row.status === "VALID" && existingPhones.has(row.phoneNormalized)) {
      row.status = "DUPLICATE";
      row.reason = "Cliente ja pertence a esta barbearia.";
    } else if (
      row.status === "VALID" &&
      row.email &&
      !globalPhones.has(row.phoneNormalized) &&
      emailOwners.has(row.email.toLowerCase())
    ) {
      row.status = "INVALID";
      row.reason = "E-mail ja utilizado por outro usuario.";
    }
  }
  return summarizePreview(rows);
}

function summarizePreview(rows: CustomerImportRow[]): CustomerImportPreview {
  return {
    totalRows: rows.length,
    valid: rows.filter((row) => row.status === "VALID").length,
    duplicates: rows.filter(
      (row) => row.status === "DUPLICATE" || row.status === "DUPLICATE_IN_FILE"
    ).length,
    invalid: rows.filter((row) => row.status === "INVALID").length,
    rows,
  };
}

export async function previewCustomerImport(
  client: CustomerDataClient,
  barbershopId: string,
  file: UploadedFile
) {
  return classifyCustomerImportRows(client, barbershopId, await parseCustomerImportFile(file));
}

function isRetryablePrismaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

export async function confirmCustomerImport(
  client: typeof import("@/lib/prisma").default,
  barbershopId: string,
  file: UploadedFile
): Promise<CustomerImportResult> {
  const parsedRows = await parseCustomerImportFile(file);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx) => {
          const preview = await classifyCustomerImportRows(tx, barbershopId, parsedRows);
          const validRows = preview.rows.filter((row) => row.status === "VALID");
          const variants = [...new Set(validRows.flatMap((row) => phoneLookupVariants(row.phoneNormalized)))];
          const existingUsers = variants.length
            ? await tx.user.findMany({
                where: { phone: { in: variants } },
                select: { id: true, name: true, email: true, phone: true },
              })
            : [];
          const usersByPhone = new Map(
            existingUsers.map((user) => [normalizePhone(user.phone), user])
          );

          let imported = 0;
          for (let offset = 0; offset < validRows.length; offset += CUSTOMER_IMPORT_BATCH_SIZE) {
            const batch = validRows.slice(offset, offset + CUSTOMER_IMPORT_BATCH_SIZE);
            for (const row of batch) {
              let user = usersByPhone.get(row.phoneNormalized);
              if (!user) {
                user = await tx.user.create({
                  data: {
                    name: row.name,
                    phone: row.phoneNormalized,
                    email: row.email,
                    role: "USER",
                  },
                  select: { id: true, name: true, email: true, phone: true },
                });
                usersByPhone.set(row.phoneNormalized, user);
              }
              await tx.customerBarbershopLink.create({
                data: {
                  barbershopId,
                  customerId: user.id,
                  birthDate: row.birthDate ? new Date(`${row.birthDate}T00:00:00.000Z`) : null,
                  notes: row.notes,
                },
                select: { id: true },
              });
              imported += 1;
            }
          }

          return {
            totalRows: preview.totalRows,
            imported,
            duplicates: preview.duplicates,
            invalid: preview.invalid,
            failed: 0,
            rows: preview.rows,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 }
      );
    } catch (error) {
      lastError = error;
      if (!isRetryablePrismaError(error) || attempt === 3) throw error;
    }
  }
  throw lastError;
}

export async function getCustomerExportRows(
  client: CustomerDataClient,
  barbershopId: string
): Promise<CustomerExportRow[]> {
  const { ids } = await collectBarbershopCustomerIds(client as Prisma.TransactionClient, barbershopId);
  if (ids.length === 0) return [];
  const [users, profiles] = await Promise.all([
    client.user.findMany({
      where: { id: { in: ids } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, email: true },
    }),
    client.customerBarbershopLink.findMany({
      where: { barbershopId, customerId: { in: ids } },
      select: { customerId: true, birthDate: true, notes: true },
    }),
  ]);
  const profilesByCustomer = new Map(profiles.map((profile) => [profile.customerId, profile]));
  return users.map((user) => {
    const profile = profilesByCustomer.get(user.id);
    return {
      name: user.name,
      phone: user.phone,
      email: user.email,
      birthDate: formatCustomerBirthDate(profile?.birthDate),
      notes: profile?.notes ?? null,
    };
  });
}

export function neutralizeSpreadsheetValue(value: string | null | undefined) {
  const text = value ?? "";
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function exportMatrix(rows: CustomerExportRow[]) {
  return rows.map((row) => [
    neutralizeSpreadsheetValue(row.name),
    neutralizeSpreadsheetValue(row.phone),
    neutralizeSpreadsheetValue(row.email),
    row.birthDate ?? "",
    neutralizeSpreadsheetValue(row.notes),
  ]);
}

export function buildCustomerCsv(rows: CustomerExportRow[]) {
  const values = [
    ["Nome", "Telefone", "E-mail", "Data de nascimento", "Observações"],
    ...exportMatrix(rows),
  ];
  const csv = values
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "");
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(",")
    )
    .join("\r\n");
  return Buffer.from(`\uFEFF${csv}`, "utf8");
}

export async function buildCustomerXlsx(rows: CustomerExportRow[], includeExample = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TEM BARBER";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Clientes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Nome", key: "name", width: 28 },
    { header: "Telefone", key: "phone", width: 20 },
    { header: "E-mail", key: "email", width: 32 },
    { header: "Data de nascimento", key: "birthDate", width: 22 },
    { header: "Observações", key: "notes", width: 48 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF292524" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.autoFilter = "A1:E1";
  const sourceRows = includeExample
    ? [{
        name: "João Silva",
        phone: "17991089190",
        email: "joao@email.com",
        birthDate: "1990-05-10",
        notes: "Cliente prefere atendimento pela manhã",
      }]
    : rows;
  for (const values of exportMatrix(sourceRows)) {
    const row = sheet.addRow(values);
    row.eachCell((cell) => {
      cell.numFmt = "@";
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function sanitizedExportSlug(slug: string) {
  return (
    slug
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "barbearia"
  );
}

export function customerExportDate(now = new Date()) {
  return currentCivilDateInSaoPaulo(now);
}
