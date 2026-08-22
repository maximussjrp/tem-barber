import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/member-api-auth";
import { sanitizeWaitlistEntryResponse } from "@/lib/waitlist/serializers";
import { markWaitlistEntryNoShow, WaitlistNoShowError } from "@/lib/waitlist/no-show";

export async function POST(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;
  if (!data?.barbershopId || !data.memberId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string" || !body.entryId.trim()) {
    return NextResponse.json({ error: "entryId é obrigatório." }, { status: 400 });
  }

  try {
    const result = await markWaitlistEntryNoShow({
      barbershopId: data.barbershopId,
      entryId: body.entryId.trim(),
      expectedMemberId: data.memberId,
    });
    return NextResponse.json({ entry: sanitizeWaitlistEntryResponse(result.entry) });
  } catch (err) {
    if (err instanceof WaitlistNoShowError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
