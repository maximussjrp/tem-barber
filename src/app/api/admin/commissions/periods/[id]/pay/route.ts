import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";

export async function POST(_request: Request) {
  const { error } = await getAdminSession();
  if (error) return error;

  return NextResponse.json(
    {
      error:
        "O pagamento legado de CommissionPeriod foi descontinuado. Utilize a liquidação canônica por ciclo (/api/admin/commissions/payouts).",
      code: "LEGACY_ENDPOINT_DEPRECATED",
    },
    { status: 410 }
  );
}
