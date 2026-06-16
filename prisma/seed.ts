import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Iniciando semeadura do banco de dados...");

  // 1. Criar Planos de Assinatura do SaaS (Match Barber)
  const plans = [
    {
      name: "Plano Bronze",
      description: "Ideal para barbearias pequenas e profissionais individuais.",
      price: 49.90,
      period: "MONTHLY" as const,
      maxMembers: 3,
      isActive: true,
    },
    {
      name: "Plano Prata",
      description: "Para barbearias em crescimento com equipes médias.",
      price: 89.90,
      period: "MONTHLY" as const,
      maxMembers: 7,
      isActive: true,
    },
    {
      name: "Plano Ouro",
      description: "Plano completo para grandes barbearias com múltiplos profissionais.",
      price: 149.90,
      period: "MONTHLY" as const,
      maxMembers: 20,
      isActive: true,
    },
  ];

  for (const planData of plans) {
    const existingPlan = await prisma.plan.findFirst({
      where: { name: planData.name },
    });

    if (!existingPlan) {
      const plan = await prisma.plan.create({
        data: planData,
      });
      console.log(`Plano cadastrado com sucesso: ${plan.name} (R$ ${plan.price})`);
    } else {
      console.log(`Plano já existente: ${planData.name}`);
    }
  }

  console.log("Semeadura concluída com sucesso!");
}

main()
  .catch((e) => {
    console.error("Erro durante a semeadura:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
