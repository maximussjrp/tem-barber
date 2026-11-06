/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { getTestSessionToken } = require("./test-session-helper");
const WebSocket = require(path.resolve(__dirname, "../../Projeto vigilante/node_modules/ws"));

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_DIR = path.resolve(__dirname, "../previews/audit-chrome-profile");
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

const APURADA_ID = "e1ece5d5-b1ee-4b5e-b1ab-c3628cba6b10";
const CONGELADA_ID = "a8fc6a51-2248-48ac-864a-4cac8dee5ab8";

const routes = [
  { name: "Central de Marketing", path: "/admin/marketing" },
  { name: "Listagem de Sorteios", path: "/admin/marketing/sorteios" },
  { name: "Nova Campanha", path: "/admin/marketing/sorteios/novo" },
  { name: "Detalhe (Apurada)", path: `/admin/marketing/sorteios/${APURADA_ID}` },
  { name: "Detalhe (Congelada)", path: `/admin/marketing/sorteios/${CONGELADA_ID}` },
];

async function main() {
  console.log("=== INICIANDO AUDITORIA OBJETIVA DE ELEMENTOS CLIPPED/OVERFLOW EM 320PX ===");

  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    "--remote-debugging-port=9223",
    `--user-data-dir=${PROFILE_DIR}`,
    "about:blank"
  ]);

  await new Promise(r => setTimeout(r, 2000));

  try {
    const listRes = await fetch("http://localhost:9223/json/list").then(r => r.json());
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

    // Injetar sessão dev de teste
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

    // Configurar viewport 320x640 com mobile emulation estrita
    await send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 640,
      deviceScaleFactor: 1,
      mobile: true,
      fitWindow: false,
    });

    for (const route of routes) {
      console.log(`\n======================================================`);
      console.log(`PÁGINA: ${route.name} (${route.path})`);
      console.log(`======================================================`);

      await send("Page.navigate", { url: `http://localhost:3000${route.path}` });
      await new Promise(r => setTimeout(r, 2500));

      const res = await send("Runtime.evaluate", {
        expression: `(() => {
          const viewportWidth = 320;
          const issues = [];
          const checkedCategories = {
            actionButtons: 0,
            headersAndTexts: 0,
            cardsAndMetrics: 0,
            badges: 0,
            formControls: 0,
            bottomNav: 0
          };

          // 1. Cinco botões da navegação inferior
          const navBottom = document.querySelector('nav[aria-label="Navegação móvel principal"]');
          if (navBottom) {
            const items = navBottom.querySelectorAll('a, button');
            checkedCategories.bottomNav = items.length;
            items.forEach((item, idx) => {
              const r = item.getBoundingClientRect();
              if (r.right > viewportWidth + 0.5 || r.left < -0.5) {
                issues.push({
                  category: 'bottomNav',
                  item: 'Item ' + (idx + 1) + ' (' + item.innerText.trim() + ')',
                  left: Math.round(r.left),
                  right: Math.round(r.right),
                  width: Math.round(r.width),
                  issue: 'Extrapola limite da viewport (320px)'
                });
              }
            });
          } else {
            issues.push({ category: 'bottomNav', item: 'navBottom', issue: 'Navegação inferior não encontrada' });
          }

          // 2. Todos os botões e links interativos
          const buttons = document.querySelectorAll('main button, main a, header button');
          checkedCategories.actionButtons = buttons.length;
          buttons.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return; // oculto
            if (r.right > viewportWidth + 0.5) {
              issues.push({
                category: 'actionButtons',
                element: el.tagName.toLowerCase(),
                text: el.innerText ? el.innerText.trim().slice(0, 30) : el.getAttribute('aria-label') || '',
                left: Math.round(r.left),
                right: Math.round(r.right),
                width: Math.round(r.width),
                issue: 'right (' + Math.round(r.right) + 'px) > 320px'
              });
            }
          });

          // 3. Cabeçalhos e textos (h1, h2, h3, h4, p, label)
          const textEls = document.querySelectorAll('main h1, main h2, main h3, main h4, main p, main label');
          checkedCategories.headersAndTexts = textEls.length;
          textEls.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            if (r.right > viewportWidth + 0.5) {
              issues.push({
                category: 'headersAndTexts',
                element: el.tagName.toLowerCase(),
                text: el.innerText ? el.innerText.trim().slice(0, 35) : '',
                left: Math.round(r.left),
                right: Math.round(r.right),
                width: Math.round(r.width),
                issue: 'right (' + Math.round(r.right) + 'px) > 320px'
              });
            }

            // Checar se o conteúdo do texto foi cortado por um ancestral com overflow: hidden / clip
            let parent = el.parentElement;
            while (parent && parent !== document.body) {
              const pStyle = window.getComputedStyle(parent);
              const pRect = parent.getBoundingClientRect();
              if (pStyle.overflowX === 'hidden' || pStyle.overflow === 'hidden' || pStyle.overflowX === 'clip') {
                if (r.right > pRect.right + 0.5 && pRect.width > 0) {
                  issues.push({
                    category: 'headersAndTexts',
                    element: el.tagName.toLowerCase(),
                    text: el.innerText ? el.innerText.trim().slice(0, 30) : '',
                    issue: 'Cortado por ancestral ' + parent.tagName.toLowerCase() + ' (' + Math.round(r.right) + ' > ' + Math.round(pRect.right) + ')'
                  });
                  break;
                }
              }
              parent = parent.parentElement;
            }
          });

          // 4. Cards e métricas (.rounded-2xl, .grid)
          const cards = document.querySelectorAll('main .rounded-2xl, main .rounded-xl');
          checkedCategories.cardsAndMetrics = cards.length;
          cards.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            if (r.right > viewportWidth + 0.5) {
              issues.push({
                category: 'cardsAndMetrics',
                element: el.className.split(' ').slice(0, 3).join(' '),
                left: Math.round(r.left),
                right: Math.round(r.right),
                width: Math.round(r.width),
                issue: 'Card extrapola 320px'
              });
            }
          });

          // 5. Badges
          const badges = document.querySelectorAll('main span.rounded-full, main span[class*="rounded"]');
          checkedCategories.badges = badges.length;
          badges.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            if (r.right > viewportWidth + 0.5) {
              issues.push({
                category: 'badges',
                text: el.innerText ? el.innerText.trim() : '',
                left: Math.round(r.left),
                right: Math.round(r.right),
                issue: 'Badge extrapola 320px'
              });
            }
          });

          // 6. Controles de formulário (input, textarea, select)
          const inputs = document.querySelectorAll('main input, main textarea, main select');
          checkedCategories.formControls = inputs.length;
          inputs.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            if (r.right > viewportWidth + 0.5) {
              issues.push({
                category: 'formControls',
                element: el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : ''),
                left: Math.round(r.left),
                right: Math.round(r.right),
                width: Math.round(r.width),
                issue: 'Controle de formulário extrapola 320px'
              });
            }
          });

          return {
            checkedCategories,
            issuesCount: issues.length,
            issues
          };
        })()`,
        returnByValue: true
      });

      const report = (res && res.result && res.result.value) ? res.result.value : (res?.value || res);
      if (!report || !report.checkedCategories) {
        console.error("Resultado inesperado:", JSON.stringify(res));
        continue;
      }
      console.log("Categorias Verificadas:", JSON.stringify(report.checkedCategories));
      if (report.issuesCount === 0) {
        console.log("✅ NENHUM elemento cortado ou extrapolando 320px!");
      } else {
        console.log(`❌ ENCONTRADOS ${report.issuesCount} ELEMENTOS COM PROBLEMAS:`);
        report.issues.forEach(iss => console.log("   -", JSON.stringify(iss)));
      }
    }

    ws.close();
  } finally {
    chromeProc.kill();
  }
}

main().catch(err => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
