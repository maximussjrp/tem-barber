import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getReactivationCandidates } from "../src/lib/clients/reactivation";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

const pool = new Pool({ connectionString: testDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function diagnose() {
  console.log("=== R3 FULL DIAGNOSTIC TIMING ===");

  const shopRow = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM barbershops WHERE slug = 'r3-perf-10k-barbershop' LIMIT 1;
  `;
  const barbershopId = shopRow[0]?.id;

  const t0 = Date.now();
  const res = await getReactivationCandidates(prisma, { barbershopId, limit: 50 });
  const totalTime = Date.now() - t0;

  console.log(`Candidates generated: ${res.items.length}`);
  console.log(`Total Latency: ${totalTime} ms`);
  console.log(`DB Query Count: ${res.meta?.queryCount}`);
}

diagnose()
  .catch((e) => console.error("Diagnostic error:", e))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
