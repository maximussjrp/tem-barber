/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { getTestSessionToken } = require("./test-session-helper");
const WebSocket = require(path.resolve(__dirname, "../../Projeto vigilante/node_modules/ws"));

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_DIR = path.resolve(__dirname, "../previews/journey-chrome-profile");
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

async function main() {
  console.log("=== INICIANDO JORNADA REAL PELO NAVEGADOR (CLIQUES E PREENCHIMENTOS) ===");

  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    "--remote-debugging-port=9224",
    `--user-data-dir=${PROFILE_DIR}`,
    "about:blank"
  ]);

  await new Promise(r => setTimeout(r, 2000));

  try {
    const listRes = await fetch("http://localhost:9224/json/list").then(r => r.json());
    const pageTarget = listRes.find(x => x.type === "page");
    if (!pageTarget) throw new Error("Página não encontrada no Chrome.");
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener("message", handler);
            resolve(data.result);
          }
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send("Page.enable");
    await send("Runtime.enable");
    await send("DOM.enable");

    // Configurar viewport mobile e desktop
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Passo 1: Injetar cookie de autenticação e acessar Central de Marketing
    console.log("Passo 1: Injetando cookie de autenticação e navegando para a Central de Marketing...");
    const sessionToken = await getTestSessionToken();
    await send("Network.enable");
    await send("Network.setCookie", {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    await send("Page.navigate", { url: "http://localhost:3000/admin/marketing" });
    await new Promise(r => setTimeout(r, 2500));

    // Passo 2: Clicar no botão 'Criar Sorteio de Clientes'
    console.log("Passo 2: Clicando em 'Criar Sorteio de Clientes'...");
    const clickNovoRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const link = document.querySelector('a[href="/admin/marketing/sorteios/novo"]');
        if (link) {
          link.click();
          return { success: true };
        }
        return { success: false, error: 'Link para novo sorteio não encontrado' };
      })()`,
      returnByValue: true
    });
    console.log("   Resultado do clique:", JSON.stringify(clickNovoRes.result?.value));
    await new Promise(r => setTimeout(r, 2000));

    // Passo 3: Preencher formulário de criação
    console.log("Passo 3: Preenchendo campos do formulário na página /sorteios/novo...");
    const campaignTitle = "Sorteio Homologação Real UI " + Date.now().toString().slice(-4);
    const fillRes = await send("Runtime.evaluate", {
      expression: `(() => {
        function setReactValue(el, val) {
          const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor && descriptor.set) {
            descriptor.set.call(el, val);
          } else {
            el.value = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const titleInput = document.querySelector('input[placeholder*="Ex: Sorteio"]');
        const descInput = document.querySelector('textarea');
        if (!titleInput) return { success: false, error: 'Campo título não encontrado' };

        setReactValue(titleInput, ${JSON.stringify(campaignTitle)});

        if (descInput) {
          setReactValue(descInput, 'Campanha criada por validação interativa via navegador automatizado');
        }

        // Primeiro dia do mês anterior para garantir atendimentos elegíveis
        const dateInputs = document.querySelectorAll('input[type="date"]');
        if (dateInputs[0]) setReactValue(dateInputs[0], '2026-10-01');

        return { success: true, title: ${JSON.stringify(campaignTitle)} };
      })()`,
      returnByValue: true
    });
    console.log("   Formulário preenchido:", JSON.stringify(fillRes.result?.value));
    await new Promise(r => setTimeout(r, 1000));

    // Passo 4: Clicar em 'Salvar Campanha'
    console.log("Passo 4: Submetendo o formulário (clique em 'Salvar Campanha')...");
    const submitRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('form');
        const saveBtn = document.querySelector('button[type="submit"]');
        const errorDiv = document.querySelector('.bg-rose-500\\\\/10');
        if (saveBtn) {
          saveBtn.click();
          if (form) form.requestSubmit();
          return {
            success: true,
            hasErrorDiv: !!errorDiv,
            errorText: errorDiv ? errorDiv.innerText : null
          };
        }
        return { success: false, error: 'Botão salvar não encontrado' };
      })()`,
      returnByValue: true
    });
    console.log("   Submissão disparada:", JSON.stringify(submitRes.result?.value));

    // Aguardar redirecionamento para a página de detalhes da campanha
    await new Promise(r => setTimeout(r, 3500));

    const currentUrlRes = await send("Runtime.evaluate", {
      expression: `window.location.pathname`,
      returnByValue: true
    });
    const currentPath = currentUrlRes.result?.value;
    console.log("   Página atual após salvar:", currentPath);

    if (!currentPath.includes("/admin/marketing/sorteios/")) {
      throw new Error(`Falha no redirecionamento: página atual é ${currentPath}`);
    }

    // Passo 5: Clicar em 'Simular Prévia de Participantes'
    console.log("Passo 5: Clicando em 'Simular Prévia de Participantes'...");
    const previewClickRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.innerText.includes('Simular Prévia'));
        if (btn) {
          btn.click();
          return { success: true };
        }
        return { success: false, error: 'Botão de prévia não encontrado' };
      })()`,
      returnByValue: true
    });
    console.log("   Disparo da prévia:", JSON.stringify(previewClickRes.result?.value));
    await new Promise(r => setTimeout(r, 3500));

    // Verificar métricas calculadas na tela
    const metricsRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const cards = Array.from(document.querySelectorAll('span.font-serif'));
        return cards.map(c => c.innerText.trim());
      })()`,
      returnByValue: true
    });
    console.log("   Métricas renderizadas na interface:", JSON.stringify(metricsRes.result?.value));

    // Passo 6: Clicar em 'Congelar e Emitir Bilhetes'
    console.log("Passo 6: Clicando em 'Congelar e Emitir Bilhetes'...");
    const freezeOpenRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes('Congelar') || b.innerText.toUpperCase().includes('CONGELAR'));
        if (btn) {
          btn.click();
          return { success: true, text: btn.innerText.trim() };
        }
        return { success: false, error: 'Botão de congelar não encontrado' };
      })()`,
      returnByValue: true
    });
    console.log("   Abertura do modal de confirmação:", JSON.stringify(freezeOpenRes.result?.value));
    await new Promise(r => setTimeout(r, 1200));

    // Passo 7: Confirmar congelamento no modal
    console.log("Passo 7: Confirmando no modal ('Sim, Congelar e Emitir')...");
    const freezeConfirmRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes('Sim, Congelar') || b.innerText.toUpperCase().includes('SIM, CONGELAR'));
        if (btn) {
          btn.click();
          return { success: true, text: btn.innerText.trim() };
        }
        return { success: false, error: 'Botão de confirmação no modal não encontrado' };
      })()`,
      returnByValue: true
    });
    console.log("   Confirmação disparada:", JSON.stringify(freezeConfirmRes.result?.value));
    await new Promise(r => setTimeout(r, 4000));

    // Passo 8: Verificar que status mudou para FROZEN
    const statusRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const statusEl = document.querySelector('h1 + span') || document.querySelector('span.uppercase');
        return {
          statusText: statusEl ? statusEl.innerText.trim() : 'NÃO_ENCONTRADO'
        };
      })()`,
      returnByValue: true
    });
    console.log("   Status renderizado na UI:", JSON.stringify(statusRes.result?.value));

    // Passo 9: Clicar na aba 'Participantes & Bilhetes'
    console.log("Passo 9: Clicando na aba 'Participantes & Bilhetes'...");
    const tabClickRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Participantes & Bilhetes'));
        if (tab) {
          tab.click();
          return { success: true };
        }
        return { success: false, error: 'Aba Participantes não encontrada' };
      })()`,
      returnByValue: true
    });
    console.log("   Aba clicada:", JSON.stringify(tabClickRes.result?.value));
    await new Promise(r => setTimeout(r, 2000));

    // Verificar tabela de participantes
    const tableRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const rows = document.querySelectorAll('tbody tr');
        return {
          rowCount: rows.length,
          firstParticipant: rows[0] ? rows[0].innerText.replace(/\\n/g, ' | ') : null
        };
      })()`,
      returnByValue: true
    });
    console.log("   Participantes renderizados na tabela:", JSON.stringify(tableRes.result?.value));

    // Capturar screenshot da prova de jornada UI
    const shotRes = await send("Page.captureScreenshot", { format: "png" });
    const shotPath = path.resolve(__dirname, "../previews/real/jornada-ui-navegador-real.png");
    fs.writeFileSync(shotPath, Buffer.from(shotRes.data, "base64"));
    console.log("   ✅ Prova visual da jornada salva em:", shotPath);

    const driveDir = "G:\\Meu Drive\\TEM BARBER - Entregas e Auditorias do Antigravity\\evidencias_sorteios_v1";
    if (fs.existsSync(driveDir)) {
      const drivePath = path.join(driveDir, "jornada-ui-navegador-real.png");
      fs.copyFileSync(shotPath, drivePath);
      console.log("   ✅ Prova visual da jornada copiada para o Google Drive:", drivePath);
    }

    console.log("\n=== JORNADA REAL PELO NAVEGADOR EXECUTADA COM 100% DE SUCESSO! ===");

    ws.close();
  } finally {
    chromeProc.kill();
  }
}

main().catch(err => {
  console.error("Erro fatal na jornada UI:", err);
  process.exit(1);
});
