import { URL } from "url";
import crypto from "crypto";

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:5439/match_barber_test?schema=public";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

async function seedUiData() {
  const { default: prisma } = await import("../src/lib/prisma");
  const { createTrialSubscription } = await import("../src/lib/subscription-utils");
  const {
    freezeCustomerSweepstake,
    executeSweepstakeDraw,
  } = await import("../src/lib/marketing/sweepstake-engine");
  const { localDateToUTCBoundary, shiftDateISO } = await import("../src/lib/time-utils");

  console.log("=== PREPARANDO DADOS DE DEMONSTRAÇÃO E TESTE E2E (TEM BARBER) ===");

  // 1. Barbearia Principal: Dom Brio Barbearia
  let shop = await prisma.barbershop.findFirst({
    where: { slug: "dom-brio" },
  });

  if (!shop) {
    shop = await prisma.barbershop.create({
      data: {
        name: "Dom Brio Barbearia",
        slug: "dom-brio",
        phone: "11999990000",
        zipCode: "01310-100",
        street: "Avenida Paulista",
        number: "1000",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "SP",
      },
    });
    console.log(`Barbearia criada: ${shop.name} (${shop.id})`);
  } else {
    console.log(`Barbearia encontrada: ${shop.name} (${shop.id})`);
  }

  // 2. Assinatura Ativa
  const existingSub = await prisma.tenantSubscription.findFirst({
    where: { barbershopId: shop.id },
  });
  if (!existingSub) {
    await createTrialSubscription(shop.id, "admin@tembarber.com.br");
    console.log("Assinatura Trial ativada para Dom Brio.");
  }

  // 3. Usuário Administrador
  let admin = await prisma.user.findFirst({
    where: { email: "admin@tembarber.com.br" },
  });

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: "Carlos Eduardo (Proprietário)",
        email: "admin@tembarber.com.br",
        phone: "11999999999",
        role: "SUPER_ADMIN",
      },
    });
    console.log(`Usuário admin criado: ${admin.email}`);
  }

  // 4. Membro da Barbearia (OWNER)
  let member = await prisma.barbershopMember.findFirst({
    where: { barbershopId: shop.id, userId: admin.id },
  });

  if (!member) {
    member = await prisma.barbershopMember.create({
      data: {
        barbershopId: shop.id,
        userId: admin.id,
        role: "OWNER",
        isActive: true,
      },
    });
    console.log(`Vínculo de membro OWNER criado.`);
  }

  // 5. Categorias e Serviços
  let category = await prisma.category.findFirst({
    where: { barbershopId: shop.id },
  });
  if (!category) {
    category = await prisma.category.create({
      data: {
        barbershopId: shop.id,
        name: "Serviços Gerais",
        slug: "servicos-gerais",
      },
    });
  }

  let serviceCorte = await prisma.service.findFirst({
    where: { barbershopId: shop.id, name: "Corte Tradicional" },
  });
  if (!serviceCorte) {
    serviceCorte = await prisma.service.create({
      data: {
        barbershopId: shop.id,
        categoryId: category.id,
        name: "Corte Tradicional",
        price: 60.0,
        durationMin: 35,
      },
    });
  }

  let serviceBarba = await prisma.service.findFirst({
    where: { barbershopId: shop.id, name: "Barba Terapia" },
  });
  if (!serviceBarba) {
    serviceBarba = await prisma.service.create({
      data: {
        barbershopId: shop.id,
        categoryId: category.id,
        name: "Barba Terapia",
        price: 50.0,
        durationMin: 30,
      },
    });
  }

  // 6. Criar Clientes e Comandas para Gerar Histórico Elegível
  const customerNames = [
    "Rodrigo Silveira", "Marcos Vinicius", "Lucas Andrade", "Felipe Bastos",
    "Gabriel Martins", "Thiago Nogueira", "Bruno Carvalho", "André Luiz",
    "Rafael Lima", "Matheus Ribeiro", "Gustavo Costa", "Diego Pereira"
  ];

  for (let i = 0; i < customerNames.length; i++) {
    const name = customerNames[i];
    const phone = `1198100${(1000 + i).toString().slice(-4)}`;

    let cust = await prisma.user.findFirst({
      where: { phone },
    });

    if (!cust) {
      cust = await prisma.user.create({
        data: {
          name,
          phone,
          role: "USER",
        },
      });

      // Cria comanda com itens concluídos em outubro
      const comanda = await prisma.comanda.create({
        data: {
          barbershopId: shop.id,
          customerId: cust.id,
          customerName: cust.name || name,
          customerPhone: phone,
          status: i % 2 === 0 ? "CLOSED" : "OPEN", // Testa comanda aberta e fechada
          closedAt: new Date("2026-10-25T16:00:00Z"),
        },
      });

      await prisma.comandaItem.create({
        data: {
          comandaId: comanda.id,
          barbershopId: shop.id,
          type: "SERVICE",
          serviceId: serviceCorte.id,
          description: serviceCorte.name,
          unitPrice: 60.0,
          total: 60.0,
          status: "DONE",
          completedAt: new Date(`2026-10-${(10 + (i % 15)).toString().padStart(2, "0")}T14:00:00Z`),
        },
      });

      if (i % 3 === 0) {
        await prisma.comandaItem.create({
          data: {
            comandaId: comanda.id,
            barbershopId: shop.id,
            type: "SERVICE",
            serviceId: serviceBarba.id,
            description: serviceBarba.name,
            unitPrice: 50.0,
            total: 50.0,
            status: "DONE",
            completedAt: new Date(`2026-10-${(12 + (i % 15)).toString().padStart(2, "0")}T15:30:00Z`),
          },
        });
      }
    }
  }

  // 7. Criar as Campanhas de Demonstração
  const startDateCivil = "2026-10-01";
  const endDateCivil = "2026-11-05";
  const startInclusiveUtc = localDateToUTCBoundary(startDateCivil);
  const endExclusiveUtc = localDateToUTCBoundary(shiftDateISO(endDateCivil, 1));

  // 7.1 Campanha Apurada (DRAWN)
  let campApurada = await prisma.customerSweepstake.findFirst({
    where: { barbershopId: shop.id, title: "Sorteio Especial de Primavera" },
  });

  if (!campApurada) {
    campApurada = await prisma.customerSweepstake.create({
      data: {
        barbershopId: shop.id,
        title: "Sorteio Especial de Primavera",
        description: "Campanha especial com 2 prêmios exclusivos para clientes atendidos.",
        participationMode: "ONE_PER_SERVICE",
        targetSegment: "ALL_CUSTOMERS",
        startDateCivil,
        endDateCivil,
        startInclusiveUtc,
        endExclusiveUtc,
        drawDateScheduled: endExclusiveUtc,
        status: "DRAFT",
        createdById: admin.id,
        prizes: {
          create: [
            { position: 1, title: "Kit Premium Barba & Cabelo", description: "Shampoo, balm e pomada modeladora matte" },
            { position: 2, title: "Corte Grátis + Cerveja Artesanal", description: "Válido para o próximo atendimento" },
          ],
        },
      },
    });

    // Congelar
    await prisma.$transaction(async (tx) => {
      return freezeCustomerSweepstake(tx, campApurada!.id, shop.id, admin.id);
    });

    // Apurar com Simulação Técnica
    await prisma.$transaction(async (tx) => {
      return executeSweepstakeDraw(tx, {
        sweepstakeId: campApurada!.id,
        barbershopId: shop.id,
        drawnByUserId: admin.id,
        isTechnicalSimulation: true,
      });
    });

    console.log(`Campanha Apurada criada: ${campApurada!.title} (${campApurada!.id})`);
  }

  // 7.2 Campanha Congelada (FROZEN)
  let campCongelada = await prisma.customerSweepstake.findFirst({
    where: { barbershopId: shop.id, title: "Sorteio VIP dos Assinantes" },
  });

  if (!campCongelada) {
    campCongelada = await prisma.customerSweepstake.create({
      data: {
        barbershopId: shop.id,
        title: "Sorteio VIP dos Assinantes",
        description: "Sorteio congelado pronto para apuração oficial.",
        participationMode: "ONE_PER_CUSTOMER",
        targetSegment: "ALL_CUSTOMERS",
        startDateCivil,
        endDateCivil,
        startInclusiveUtc,
        endExclusiveUtc,
        drawDateScheduled: endExclusiveUtc,
        status: "DRAFT",
        createdById: admin.id,
        prizes: {
          create: [
            { position: 1, title: "Máquina de Acabamento Profissional", description: "Edição especial com lâmina em T" },
          ],
        },
      },
    });

    await prisma.$transaction(async (tx) => {
      return freezeCustomerSweepstake(tx, campCongelada!.id, shop.id, admin.id);
    });

    console.log(`Campanha Congelada criada: ${campCongelada!.title} (${campCongelada!.id})`);
  }

  // 7.3 Campanha Rascunho (DRAFT)
  let campDraft = await prisma.customerSweepstake.findFirst({
    where: { barbershopId: shop.id, title: "Sorteio Natalino 2026" },
  });

  if (!campDraft) {
    campDraft = await prisma.customerSweepstake.create({
      data: {
        barbershopId: shop.id,
        title: "Sorteio Natalino 2026",
        description: "Campanha em planejamento com múltiplos prêmios.",
        participationMode: "ONE_PER_APPOINTMENT",
        targetSegment: "ALL_CUSTOMERS",
        startDateCivil: "2026-11-01",
        endDateCivil: "2026-12-24",
        startInclusiveUtc: localDateToUTCBoundary("2026-11-01"),
        endExclusiveUtc: localDateToUTCBoundary("2026-12-25"),
        drawDateScheduled: localDateToUTCBoundary("2026-12-25"),
        status: "DRAFT",
        createdById: admin.id,
        prizes: {
          create: [
            { position: 1, title: "Smartphone Xiaomi Redmi Note", description: "Prêmio principal de Natal" },
            { position: 2, title: "Dia de Noivo / Tratamento VIP", description: "Completo com hidratação e toalha quente" },
            { position: 3, title: "Camiseta Oficial Tem Barber", description: "Tamanho à escolha" },
          ],
        },
      },
    });
    console.log(`Campanha Rascunho criada: ${campDraft.title} (${campDraft.id})`);
  }

  console.log("\n===============================================================================");
  console.log("=== AMBIENTE E2E PREPARADO COM SUCESSO! ===");
  console.log(`Barbearia ID: ${shop.id}`);
  console.log(`Campanha Apurada ID: ${campApurada.id}`);
  console.log(`Campanha Congelada ID: ${campCongelada.id}`);
  console.log(`Campanha Rascunho ID: ${campDraft.id}`);
  console.log("===============================================================================\n");
}

seedUiData()
  .catch((e) => {
    console.error("Erro no seed:", e);
    process.exit(1);
  });
