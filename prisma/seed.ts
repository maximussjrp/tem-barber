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

  const plans = [
    {
      code: "pro_monthly",
      name: "Plano Tem Barber",
      description: "Plano completo de gestao para sua barbearia.",
      price: 49.90,
      period: "MONTHLY" as const,
      maxMembers: 3,
      isActive: true,
    },
  ];

  for (const planData of plans) {
    const existingPlan = await prisma.plan.findFirst({
      where: { code: planData.code },
    });

    if (!existingPlan) {
      const plan = await prisma.plan.create({
        data: planData,
      });
      console.log(`Plano cadastrado com sucesso por código: ${plan.code} (${plan.name} R$ ${plan.price})`);
    } else {
      console.log(`Plano ja existente preservado por código: ${planData.code} (${existingPlan.name})`);
    }
  }

  console.log("Semeadura concluida com sucesso!");
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
