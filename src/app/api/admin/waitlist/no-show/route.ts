import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { canManageWaitlist } from "@/lib/waitlist/permissions";
import { sanitizeWaitlistEntryResponse } from "@/lib/waitlist/serializers";
import { markWaitlistEntryNoShow, WaitlistNoShowError } from "@/lib/waitlist/no-show";

export async function POST(request: NextRequest) {
  const auth = await getAdminSession();
  if (auth.error) return auth.error;
  if (!auth.data?.barbershopId || !canManageWaitlist(auth.data.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string" || !body.entryId.trim()) {
    return NextResponse.json({ error: "entryId é obrigatório." }, { status: 400 });
  }

  try {
    const result = await markWaitlistEntryNoShow({
      barbershopId: auth.data.barbershopId,
      entryId: body.entryId.trim(),
    });
    return NextResponse.json({ entry: sanitizeWaitlistEntryResponse(result.entry) });
  } catch (err) {
    if (err instanceof WaitlistNoShowError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
