import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { canManageWaitlist } from "@/lib/waitlist/permissions";
import { CallNextWaitlistError, passTurnWaitlistEntry } from "@/lib/waitlist/call-next";

export async function POST(request: NextRequest) {
  const auth = await getAdminSession();
  if (auth.error) return auth.error;
  if (!auth.data?.barbershopId || !canManageWaitlist(auth.data.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string" || typeof body.memberId !== "string") return NextResponse.json({ error: "entryId e memberId são obrigatórios." }, { status: 400 });
  try {
    return NextResponse.json(await passTurnWaitlistEntry({ barbershopId: auth.data.barbershopId, memberId: body.memberId, entryId: body.entryId }));
  } catch (err) {
    if (err instanceof CallNextWaitlistError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.statusCode });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}