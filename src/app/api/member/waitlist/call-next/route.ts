import { NextRequest, NextResponse } from "next/server";
import { getMemberSession } from "@/lib/member-api-auth";
import { callNextWaitlistEntry, CallNextWaitlistError } from "@/lib/waitlist/call-next";

export async function POST(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;
  if (!data?.barbershopId || !data?.memberId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { confirmPreferredMismatch } = body;

  try {
    // memberId is ALWAYS forced to the authenticated member's ID.
    // External memberId in body is strictly ignored.
    const result = await callNextWaitlistEntry({
      barbershopId: data.barbershopId,
      memberId: data.memberId,
      calledByUserId: data.userId,
      confirmPreferredMismatch: Boolean(confirmPreferredMismatch),
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof CallNextWaitlistError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          preferredMemberMismatch: err.code === "PREFERRED_MEMBER_MISMATCH",
          preferredMember: err.preferredMember ?? null,
        },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Não foi possível chamar o próximo cliente." },
      { status: 500 }
    );
  }
}
