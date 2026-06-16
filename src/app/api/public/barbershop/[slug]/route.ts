import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/public/barbershop/[slug]
// Returns full public profile: barbershop info, services, members, reviews
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const barbershop = await prisma.barbershop.findUnique({
    where: { slug, active: true },
    include: {
      categories: {
        include: {
          services: {
            where: { isActive: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { name: "asc" },
      },
      members: {
        where: { isActive: true },
        include: {
          user: { select: { name: true, avatarUrl: true } },
          services: { include: { service: { select: { id: true, name: true } } } },
          workingHours: { where: { isActive: true } },
        },
        orderBy: { user: { name: "asc" } },
      },
    },
  });

  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  // Latest 10 reviews
  const reviews = await prisma.review.findMany({
    where: { appointment: { barbershopId: barbershop.id } },
    include: {
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Working hours for the barbershop itself (via OWNER member)
  const ownerMember = await prisma.barbershopMember.findFirst({
    where: { barbershopId: barbershop.id, role: "OWNER" },
    include: { workingHours: { where: { isActive: true } } },
  });

  return NextResponse.json({
    barbershop: {
      id: barbershop.id,
      name: barbershop.name,
      slug: barbershop.slug,
      description: barbershop.description,
      phone: barbershop.phone,
      logoUrl: barbershop.logoUrl,
      coverUrl: barbershop.coverUrl,
      street: barbershop.street,
      number: barbershop.number,
      complement: barbershop.complement,
      neighborhood: barbershop.neighborhood,
      city: barbershop.city,
      state: barbershop.state,
    },
    categories: barbershop.categories.map((c) => ({
      id: c.id,
      name: c.name,
      services: c.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price,
        durationMin: s.durationMin,
      })),
    })),
    members: barbershop.members.map((m) => ({
      id: m.id,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      bio: m.bio,
      ratingAvg: m.ratingAvg,
      role: m.role,
      serviceIds: m.services.map((s) => s.service.id),
      workingHours: m.workingHours,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      customerName: r.customer.name,
      createdAt: r.createdAt,
    })),
    workingHours: ownerMember?.workingHours ?? [],
  });
}
