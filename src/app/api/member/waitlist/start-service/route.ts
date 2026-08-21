import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/member-api-auth";
import { CallNextWaitlistError, startCalledWaitlistEntry } from "@/lib/waitlist/call-next";

export async function POST(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;
  if (!data?.barbershopId || !data.memberId) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string") return NextResponse.json({ error: "entryId é obrigatório." }, { status: 400 });
  try {
    return NextResponse.json(await startCalledWaitlistEntry({ barbershopId: data.barbershopId, memberId: data.memberId, entryId: body.entryId, startedByUserId: data.userId }));
  } catch (err) {
    if (err instanceof CallNextWaitlistError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.statusCode });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}