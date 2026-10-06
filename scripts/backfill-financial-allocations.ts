import prisma from "../src/lib/prisma";
import { runFinancialBackfill, reconcileTenantFinancialAllocations } from "../src/lib/financial/reconciliation";

async function main() {
  const args = process.argv.slice(2);
  let tenantId: string | undefined = undefined;
  let isExecute = false;

  for (const arg of args) {
    if (arg.startsWith("--tenantId=")) {
      tenantId = arg.split("=")[1]?.trim() || undefined;
    } else if (arg === "--execute") {
      isExecute = true;
    }
  }

  const dryRun = !isExecute;

  console.log("=================================================");
  console.log("TEM BARBER — BACKFILL FINANCEIRO (FASE 6C)");
  console.log("=================================================");
  console.log(`Modo: ${dryRun ? "DRY-RUN (SOMENTE LEITURA / SIMULAÇÃO)" : "EXECUTE (APLICAÇÃO REAL)"}`);
  if (tenantId) {
    console.log(`Tenant específico: ${tenantId}`);
  } else {
    console.log("Todos os tenants cadastrados.");
  }
  console.log("-------------------------------------------------");

  const overall = await runFinancialBackfill({ tenantId, dryRun });

  console.log("\nRESUMO POR TENANT:");
  for (const t of overall.tenants) {
    console.log(`\nTenant: ${t.barbershopId}`);
    console.log(`  Elegíveis: ${t.eligibleEntries}`);
    console.log(`  Já 100% Alocados: ${t.alreadyFullyAllocated}`);
    console.log(`  Necessitam Alocação/Sync: ${t.needsAllocation}`);
    console.log(`  Fora de Escopo por Política: ${t.unallocatableByPolicy}`);
    console.log(`  Mapping Ausente: ${t.missingMapping}`);
    console.log(`  Soma Incorreta: ${t.sumMismatch}`);
    console.log(`  Problemas Cross-Tenant: ${t.crossTenantIssues}`);
    console.log(`  Alocações Criadas: ${t.createdAllocationsCount}`);
    console.log(`  Alocações Atualizadas (Resync): ${t.updatedAllocationsCount}`);
    if (t.errors.length > 0) {
      console.log(`  Erros (${t.errors.length}):`);
      for (const err of t.errors) {
        console.log(`    - ${err}`);
      }
    }
  }

  console.log("\n=================================================");
  console.log("TOTAIS GERAIS:");
  console.log(`  ELIGIBLE_ENTRIES: ${overall.totals.eligibleEntries}`);
  console.log(`  ALREADY_FULLY_ALLOCATED: ${overall.totals.alreadyFullyAllocated}`);
  console.log(`  NEEDS_ALLOCATION: ${overall.totals.needsAllocation}`);
  console.log(`  UNALLOCATABLE_BY_POLICY: ${overall.totals.unallocatableByPolicy}`);
  console.log(`  MISSING_MAPPING: ${overall.totals.missingMapping}`);
  console.log(`  SUM_MISMATCH: ${overall.totals.sumMismatch}`);
  console.log(`  CROSS_TENANT_ISSUES: ${overall.totals.crossTenantIssues}`);
  console.log(`  CREATED_ALLOCATIONS: ${overall.totals.createdAllocationsCount}`);
  console.log(`  UPDATED_ALLOCATIONS: ${overall.totals.updatedAllocationsCount}`);
  console.log("=================================================");

  if (dryRun) {
    console.log("\n[DRY-RUN] Nenhuma gravação foi realizada no banco.");
    console.log("Para aplicar as alocações reais, utilize a flag --execute.");
  } else {
    console.log("\n[EXECUTE] Alocações aplicadas com sucesso.");

    // Se foi executado para um tenant específico, executa a reconciliação e exibe os dados
    if (tenantId) {
      console.log("\n--- Reconciliação Pós-Backfill ---");
      const recon = await reconcileTenantFinancialAllocations(prisma, tenantId);
      console.log(`  Lançamentos Totais: ${recon.totalEntries}`);
      console.log(`  Elegíveis: ${recon.eligibleEntries}`);
      console.log(`  Totalmente Alocados: ${recon.fullyAllocatedEntries}`);
      console.log(`  Inconsistências Encontradas: ${recon.issues.length}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Erro na execução do script:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
