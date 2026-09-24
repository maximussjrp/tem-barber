import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";

export async function GET() {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const member = await prisma.barbershopMember.findUnique({
    where: { id: data!.memberId },
    include: {
      services: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              durationMin: true,
              price: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Membro não encontrado." }, { status: 404 });
  }

  const services = member.services
    .map((s) => s.service)
    .filter((s) => s && s.isActive)
    .map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      price: s.price.toString(),
    }));

  return NextResponse.json({ services });
}
