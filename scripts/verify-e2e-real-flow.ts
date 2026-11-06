import { URL } from "url";

async function runE2EFlow() {
  console.log("===============================================================================");
  console.log("=== VERIFICAÇÃO E2E DO FLUXO COMPLETO VIA HTTP NEXT.JS EM TEMPO REAL ===");
  console.log("===============================================================================\n");

  const baseUrl = "http://localhost:3000";

  // 1. Obter Cookie de Sessão Administrativa Autenticada via Helper Seguro de Testes Local
  console.log("-> 1. Gerando token de sessão administrativa para teste local...");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getTestSessionToken } = require("./test-session-helper");
  const token = await getTestSessionToken("admin@tembarber.com.br");
  const sessionCookie = `next-auth.session-token=${token}`;
  console.log("   ✅ Sessão de teste local gerada com sucesso.");

  const headers = {
    "Cookie": sessionCookie,
    "Content-Type": "application/json",
  };

  // 2. Criar Nova Campanha via POST /api/admin/marketing/sorteios
  const runId = Date.now().toString().slice(-5);
  const title = `Sorteio E2E Fluxo Real ${runId}`;
  console.log(`\n-> 2. Criando nova campanha via API: "${title}"...`);

  const createPayload = {
    title,
    description: "Campanha criada via fluxo E2E de validação de homologação.",
    startDateCivil: "2026-10-01",
    endDateCivil: "2026-11-05",
    drawDateScheduled: "2026-11-06",
    participationMode: "ONE_PER_SERVICE",
    targetSegment: "ALL_CUSTOMERS",
    drawMethod: "ELECTRONIC_DETERMINISTIC",
    isRegulatedPromotion: false,
    prizes: [
      { title: "1º Prêmio: Pomada Modeladora Matte", description: "Entrega presencial" },
      { title: "2º Prêmio: Óleo para Barba", description: "Entrega presencial" },
    ],
  };

  const createRes = await fetch(`${baseUrl}/api/admin/marketing/sorteios`, {
    method: "POST",
    headers,
    body: JSON.stringify(createPayload),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Erro ao criar campanha (HTTP ${createRes.status}): ${err}`);
  }

  const createData = await createRes.json();
  const sweepstakeId = createData.sweepstake.id;
  console.log(`   ✅ Campanha criada com sucesso! ID: ${sweepstakeId} (Status: ${createData.sweepstake.status})`);

  // 3. Executar Prévia do Snapshot via POST /api/admin/marketing/sorteios/:id/previa
  console.log(`\n-> 3. Solicitando cálculo de prévia para campanha ${sweepstakeId}...`);
  const previaRes = await fetch(`${baseUrl}/api/admin/marketing/sorteios/${sweepstakeId}/previa`, {
    method: "POST",
    headers,
  });

  if (!previaRes.ok) {
    const err = await previaRes.text();
    throw new Error(`Erro ao calcular prévia (HTTP ${previaRes.status}): ${err}`);
  }

  const previaData = await previaRes.json();
  console.log(`   ✅ Prévia calculada:`);
  console.log(`      - Clientes Elegíveis: ${previaData.preview.totalEligibleCustomers}`);
  console.log(`      - Visitas Elegíveis: ${previaData.preview.totalEligibleVisits}`);
  console.log(`      - Serviços Concluídos: ${previaData.preview.totalEligibleServices}`);
  console.log(`      - Total de Chances: ${previaData.preview.totalChances}`);

  if (previaData.preview.totalEligibleCustomers <= 0 || previaData.preview.totalChances <= 0) {
    throw new Error("Prévia retornou 0 participantes ou 0 chances para dados operacionais existentes.");
  }

  // 4. Congelar Campanha via POST /api/admin/marketing/sorteios/:id/congelar
  console.log(`\n-> 4. Congelando campanha e gerando snapshot SHA-256 e bilhetes...`);
  const congelarRes = await fetch(`${baseUrl}/api/admin/marketing/sorteios/${sweepstakeId}/congelar`, {
    method: "POST",
    headers,
  });

  if (!congelarRes.ok) {
    const err = await congelarRes.text();
    throw new Error(`Erro ao congelar campanha (HTTP ${congelarRes.status}): ${err}`);
  }

  const congelarData = await congelarRes.json();
  console.log(`   ✅ Campanha congelada com sucesso:`);
  console.log(`      - Status: ${congelarData.sweepstake.status}`);
  console.log(`      - Hash SHA-256 do Snapshot: ${congelarData.sweepstake.ticketsSha256Digest}`);
  console.log(`      - Semente Pré-Comprometida: ${congelarData.sweepstake.precommittedSeed}`);
  console.log(`      - Total de Bilhetes Emitidos: ${congelarData.sweepstake.totalChancesAssigned}`);

  if (congelarData.sweepstake.status !== "FROZEN" || !congelarData.sweepstake.ticketsSha256Digest) {
    throw new Error("Campanha não transicionou para FROZEN ou hash está nulo.");
  }

  // 5. Consultar Participantes via GET /api/admin/marketing/sorteios/:id/participantes
  console.log(`\n-> 5. Consultando lista de participantes e bilhetes congelados...`);
  const partRes = await fetch(`${baseUrl}/api/admin/marketing/sorteios/${sweepstakeId}/participantes?page=1&limit=20`, {
    method: "GET",
    headers,
  });

  if (!partRes.ok) {
    const err = await partRes.text();
    throw new Error(`Erro ao consultar participantes (HTTP ${partRes.status}): ${err}`);
  }

  const partData = await partRes.json();
  console.log(`   ✅ Participantes consultados: ${partData.total} registrados no snapshot.`);
  console.log(`   Exemplos de bilhetes emitidos:`);
  for (const p of partData.participants.slice(0, 3)) {
    const tickets = p.tickets.map((t: any) => `#${t.ticketNumber}`).join(", ");
    console.log(`      - ${p.customer.name} (${p.customer.phone}): ${p.chancesCount} chance(s) [${tickets}]`);
  }

  console.log("\n===============================================================================");
  console.log("=== FLUXO E2E REAL (CRIAR -> PRÉVIA -> CONGELAR -> PARTICIPANTES) CONCLUÍDO! 🚀 ===");
  console.log("===============================================================================\n");
}

runE2EFlow()
  .catch((e) => {
    console.error("❌ ERRO NO FLUXO E2E:", e);
    process.exit(1);
  });
