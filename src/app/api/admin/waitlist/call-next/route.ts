import { NextRequest, NextResponse, after } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { canManageWaitlist } from "@/lib/waitlist/permissions";
import { callNextWaitlistEntry, CallNextWaitlistError } from "@/lib/waitlist/call-next";
import { prepareWaitlistCalledNotifications } from "@/lib/push/events.server";
import { deliverCreatedNotifications } from "@/lib/push/delivery.server";

export async function POST(request: NextRequest) {
  const auth = await getAdminSession();
  if (auth.error) return auth.error;
  if (!auth.data?.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const { barbershopId, role, userId } = auth.data;

  // Strict check: Admin endpoint is OWNER / MANAGER only. BARBER gets 403.
  if (!canManageWaitlist(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { memberId, confirmPreferredMismatch } = body;

  if (!memberId || typeof memberId !== "string" || !memberId.trim()) {
    return NextResponse.json(
      { error: "memberId é obrigatório." },
      { status: 400 }
    );
  }

  try {
    const result = await callNextWaitlistEntry({
      barbershopId,
      memberId: memberId.trim(),
      calledByUserId: userId,
      confirmPreferredMismatch: Boolean(confirmPreferredMismatch),
    });

    if (result?.entry) {
      const prepared = await prepareWaitlistCalledNotifications({
        entry: result.entry,
      });

      if (prepared.created.length > 0) {
        after(async () => {
          try {
            await deliverCreatedNotifications(prepared.created);
          } catch {
            // Contained failure
          }
        });
      }
    }

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
