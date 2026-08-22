import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  confirmCustomerImport,
  CustomerImportError,
} from "@/lib/customer-import-export";

export const runtime = "nodejs";

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
      typeof value !== "string" &&
      typeof value.name === "string" &&
      typeof value.size === "number" &&
      typeof value.arrayBuffer === "function"
  );
}

export async function POST(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  if (!data?.barbershopId) {
    return NextResponse.json({ error: "Barbearia nao vinculada." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!isUploadedFile(file)) {
      return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
    }
    const result = await confirmCustomerImport(prisma, data.barbershopId, file);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CustomerImportError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      return NextResponse.json(
        { error: "CONCURRENT_IMPORT", message: "Outro processo alterou estes clientes. Tente novamente." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "IMPORT_CONFIRM_FAILED", message: "A importacao foi desfeita por uma falha interna." },
      { status: 500 }
    );
  }
}
