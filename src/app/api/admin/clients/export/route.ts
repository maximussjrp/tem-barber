import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  buildCustomerCsv,
  buildCustomerXlsx,
  customerExportDate,
  getCustomerExportRows,
  sanitizedExportSlug,
} from "@/lib/customer-import-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  if (!data?.barbershopId) {
    return NextResponse.json({ error: "Barbearia nao vinculada." }, { status: 403 });
  }

  const format = request.nextUrl.searchParams.get("format")?.toLowerCase();
  if (format !== "csv" && format !== "xlsx" && format !== "template") {
    return NextResponse.json({ error: "Formato de exportacao invalido." }, { status: 400 });
  }

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: data.barbershopId },
    select: { slug: true },
  });
  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 404 });
  }

  const slug = sanitizedExportSlug(barbershop.slug);
  const date = customerExportDate();
  const isTemplate = format === "template";
  const rows = isTemplate ? [] : await getCustomerExportRows(prisma, data.barbershopId);
  const body = format === "csv" ? buildCustomerCsv(rows) : await buildCustomerXlsx(rows, isTemplate);
  const extension = format === "csv" ? "csv" : "xlsx";
  const filename = isTemplate
    ? "modelo-importacao-clientes.xlsx"
    : `clientes-${slug}-${date}.${extension}`;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
