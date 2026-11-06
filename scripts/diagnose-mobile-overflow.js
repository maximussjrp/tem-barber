/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync, spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { getTestSessionToken } = require("./test-session-helper");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE_DIR = path.resolve(__dirname, "../previews/diag-chrome-profile");
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

const APURADA_ID = "e1ece5d5-b1ee-4b5e-b1ab-c3628cba6b10";
const CONGELADA_ID = "a8fc6a51-2248-48ac-864a-4cac8dee5ab8";

const routes = [
  { name: "hub", path: "/admin/marketing" },
  { name: "lista", path: "/admin/marketing/sorteios" },
  { name: "novo", path: "/admin/marketing/sorteios/novo" },
  { name: "detalhe-apurada", path: `/admin/marketing/sorteios/${APURADA_ID}` },
  { name: "detalhe-congelada", path: `/admin/marketing/sorteios/${CONGELADA_ID}` },
];

const viewports = [320, 375, 390, 430, 768, 1280];

async function main() {
  console.log("=== DIAGNÓSTICO DE OVERFLOW MOBILE VIA CHROME CDP ===");

  // 1. Iniciar Chrome com remote debugging
  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${PROFILE_DIR}`,
    "about:blank"
  ]);

  // Aguardar Chrome inicializar
  await new Promise(r => setTimeout(r, 2000));

  try {
    const listRes = await fetch("http://localhost:9222/json/list").then(r => r.json());
    const pageTarget = listRes.find(x => x.type === "page");
    if (!pageTarget) throw new Error("Nenhuma página encontrada no Chrome.");
    const wsUrl = pageTarget.webSocketDebuggerUrl;
    console.log("Conectado ao Chrome Page CDP:", wsUrl);

    const ws = new globalThis.WebSocket(wsUrl);
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

    // Configurar cookie de sessão administrativa de teste
    console.log("Configurando cookie de sessão administrativa de teste...");
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

    console.log("\n| Rota | Viewport | clientWidth | docScrollWidth | bodyScrollWidth | Status Overflow | Itens Barra Inferior | Elementos Extrapolando |");
    console.log("|---|---|---|---|---|---|---|---|");

    for (const route of routes) {
      for (const vp of viewports) {
        await send("Emulation.setDeviceMetricsOverride", {
          width: vp,
          height: 800,
          deviceScaleFactor: 1,
          mobile: vp < 1024,
        });

        await send("Page.navigate", { url: `http://localhost:3000${route.path}` });
        await new Promise(r => setTimeout(r, 2000));

        const evalResult = await send("Runtime.evaluate", {
          expression: `(() => {
            const innerWidth = window.innerWidth;
            const clientWidth = document.documentElement.clientWidth;
            const docScrollWidth = document.documentElement.scrollWidth;
            const bodyScrollWidth = document.body.scrollWidth;

            const overflowing = [];
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const rect = el.getBoundingClientRect();
              if (rect.right > clientWidth + 0.5) {
                // Distinguir contêineres legitimamente roláveis (ex: tabelas com overflow-x-auto)
                const style = window.getComputedStyle(el);
                let isScrollable = style.overflowX === 'auto' || style.overflowX === 'scroll';

                let parent = el.parentElement;
                while (parent && parent !== document.body && !isScrollable) {
                  const pStyle = window.getComputedStyle(parent);
                  if (pStyle.overflowX === 'auto' || pStyle.overflowX === 'scroll') {
                    isScrollable = true;
                    break;
                  }
                  parent = parent.parentElement;
                }

                overflowing.push({
                  tag: el.tagName.toLowerCase(),
                  id: el.id || '',
                  className: (el.className && typeof el.className === 'string') ? el.className.split(' ').slice(0, 3).join(' ') : '',
                  right: Math.round(rect.right),
                  exceeds: Math.round(rect.right - clientWidth),
                  isScrollable,
                });
              }
            }

            const navBottom = document.querySelector('nav[aria-label="Navegação móvel principal"]');
            let bottomBarStatus = 'OCULTO_DESKTOP';
            if (innerWidth < 1024) {
              if (navBottom) {
                const linksAndButtons = navBottom.querySelectorAll('a, button');
                bottomBarStatus = linksAndButtons.length + ' ITENS';
              } else {
                bottomBarStatus = 'NAO_ENCONTRADO';
              }
            }

            return {
              innerWidth,
              clientWidth,
              docScrollWidth,
              bodyScrollWidth,
              hasGlobalOverflow: docScrollWidth > clientWidth || bodyScrollWidth > clientWidth,
              overflowCount: overflowing.filter(x => !x.isScrollable).length,
              topExceeds: overflowing.filter(x => !x.isScrollable).slice(0, 3),
              bottomBarStatus,
            };
          })()`,
          returnByValue: true,
        });

        const res = evalResult?.result?.value || evalResult?.value || {};
        if (!res.clientWidth) {
          console.error("Erro no retorno de evaluate:", JSON.stringify(evalResult));
          continue;
        }
        const statusText = res.hasGlobalOverflow ? `⚠️ OVERFLOW (+${res.docScrollWidth - res.clientWidth}px)` : "✅ OK (0px)";
        const exceedsSummary = res.topExceeds.length > 0
          ? res.topExceeds.map(e => `<${e.tag} class="${e.className}"> +${e.exceeds}px`).join("; ")
          : "Nenhum";

        console.log(`| ${route.name} | ${vp}px | ${res.clientWidth}px | ${res.docScrollWidth}px | ${res.bodyScrollWidth}px | ${statusText} | ${res.bottomBarStatus} | ${exceedsSummary} |`);
      }
    }

    ws.close();
  } catch (err) {
    console.error("Erro no diagnóstico:", err);
  } finally {
    chromeProc.kill();
  }
}

main();
