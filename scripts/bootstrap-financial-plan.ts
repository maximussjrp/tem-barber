import prisma from "../src/lib/prisma";
import { analyzeFinancialPlan, bootstrapFinancialPlan } from "../src/lib/financial/default-plan";

async function main() {
  const args = process.argv.slice(2);
  let tenantId: string | null = null;
  let isExecute = false;

  for (const arg of args) {
    if (arg.startsWith("--tenantId=")) {
      tenantId = arg.split("=")[1]?.trim() || null;
    } else if (arg === "--execute") {
      isExecute = true;
    }
  }

  if (!tenantId) {
    console.error("ERRO: --tenantId=<barbershopId> é obrigatório.");
    console.log("Uso:");
    console.log("  npx tsx scripts/bootstrap-financial-plan.ts --tenantId=UUID [--execute]");
    process.exit(1);
  }

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: tenantId },
  });

  if (!barbershop) {
    console.error(`ERRO: Barbearia com ID ${tenantId} não encontrada.`);
    process.exit(1);
  }

  console.log(`=== Bootstrap Plano Financeiro Padrão V1 ===`);
  console.log(`Barbearia: ${barbershop.name} (${barbershop.id})`);

  const analysis = await analyzeFinancialPlan(prisma, tenantId);

  console.log("\n--- Análise Read-Only do Tenant ---");
  console.log(`Categorias a serem criadas (${analysis.missingCategories.length}):`, analysis.missingCategories.map((c) => c.code));
  console.log(`Mapeamentos a serem criados (${analysis.missingMappings.length}):`, analysis.missingMappings.map((m) => m.systemKey));
  console.log(`Categorias existentes preservadas (${analysis.preservedCategories.length}):`, analysis.preservedCategories);
  console.log(`Nomes customizados preservados (${analysis.preservedCustomNames.length}):`, analysis.preservedCustomNames);
  console.log(`Mapeamentos existentes preservados (${analysis.preservedMappings.length}):`, analysis.preservedMappings);

  if (analysis.structuralConflicts.length > 0) {
    console.error(`\n⚠️ CONFLITOS ESTRUTURAIS ENCONTRADOS (${analysis.structuralConflicts.length}):`);
    for (const conflict of analysis.structuralConflicts) {
      console.error(`  - ${conflict}`);
    }
  }

  if (!isExecute) {
    console.log("\n[DRY-RUN] Nenhuma alteração foi gravada no banco de dados.");
    console.log("Para executar a aplicação real das categorias faltantes, adicione a flag --execute.");
    process.exit(analysis.structuralConflicts.length > 0 ? 1 : 0);
  }

  if (analysis.structuralConflicts.length > 0) {
    console.error("\n❌ Impossível executar o bootstrap devido aos conflitos estruturais acima.");
    process.exit(1);
  }

  console.log("\n[EXECUÇÃO REAL] Executando bootstrap dentro de transação...");
  const result = await prisma.$transaction(async (tx) => {
    return bootstrapFinancialPlan(tx, tenantId!);
  });

  console.log("✓ Bootstrap executado com sucesso!");
  console.log(`Categorias criadas: ${result.categoriesCreated}`);
  console.log(`Mapeamentos criados: ${result.mappingsCreated}`);
}

main()
  .catch((err) => {
    console.error("ERRO durante o bootstrap:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
