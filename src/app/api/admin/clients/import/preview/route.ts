import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  CustomerImportError,
  previewCustomerImport,
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
    const preview = await previewCustomerImport(prisma, data.barbershopId, file);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof CustomerImportError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: "IMPORT_PREVIEW_FAILED", message: "Nao foi possivel analisar o arquivo." },
      { status: 400 }
    );
  }
}
