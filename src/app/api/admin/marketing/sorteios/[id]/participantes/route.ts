import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não identificada." }, { status: 403 });
  }
  const { id } = await context.params;

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "30", 10)));
  const search = sp.get("search")?.trim() || "";

  const whereClause: any = {
    sweepstakeId: id,
    barbershopId,
  };

  if (search) {
    whereClause.customer = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    };
  }

  const [total, participants] = await Promise.all([
    prisma.customerSweepstakeParticipant.count({ where: whereClause }),
    prisma.customerSweepstakeParticipant.findMany({
      where: whereClause,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        tickets: { orderBy: { ticketNumber: "asc" } },
        chanceOrigins: { orderBy: { performedAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    participants,
  });
}
