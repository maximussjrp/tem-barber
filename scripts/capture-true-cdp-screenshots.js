/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { getTestSessionToken } = require("./test-session-helper");
const WebSocket = require(path.resolve(__dirname, "../../Projeto vigilante/node_modules/ws"));

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUTPUT_DIR = path.resolve(__dirname, "../previews/real");
const PROFILE_DIR = path.resolve(__dirname, "../previews/cdp-chrome-profile");
const DRIVE_DEST_DIR = "G:\\Meu Drive\\TEM BARBER - Entregas e Auditorias do Antigravity\\evidencias_sorteios_v1";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

const APURADA_ID = "e1ece5d5-b1ee-4b5e-b1ab-c3628cba6b10";
const CONGELADA_ID = "a8fc6a51-2248-48ac-864a-4cac8dee5ab8";

const routes = [
  { name: "marketing-hub", path: "/admin/marketing" },
  { name: "sorteios-lista", path: "/admin/marketing/sorteios" },
  { name: "sorteios-novo", path: "/admin/marketing/sorteios/novo" },
  { name: "sorteios-detalhe-apurada", path: `/admin/marketing/sorteios/${APURADA_ID}` },
  { name: "sorteios-detalhe-congelada", path: `/admin/marketing/sorteios/${CONGELADA_ID}` },
];

const viewports = [
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-320", width: 320, height: 640 },
];

async function main() {
  console.log("=== INICIANDO CAPTURA DE SCREENSHOTS REAIS VIA CHROME CDP (MOBILE EMULATION ATIVA) ===");

  const chromeProc = spawn(CHROME_PATH, [
    "--headless=new",
    "--remote-debugging-port=9225",
    `--user-data-dir=${PROFILE_DIR}`,
    "about:blank"
  ]);

  await new Promise(r => setTimeout(r, 2000));

  try {
    const listRes = await fetch("http://localhost:9225/json/list").then(r => r.json());
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

    // Injetar sessão de teste local via CDP
    console.log("-> Configurando sessão de teste local via cookie...");
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

    for (const route of routes) {
      for (const vp of viewports) {
        const filename = `${route.name}-${vp.name}.png`;
        const outputPath = path.join(OUTPUT_DIR, filename);

        console.log(`-> Capturando via CDP: ${filename} (${vp.width}x${vp.height}) em ${route.path}...`);

        // Configuração estrita de emulação de dispositivo (elimina qualquer borda de janela do SO)
        await send("Emulation.setDeviceMetricsOverride", {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: vp.width < 1024,
          fitWindow: false,
        });

        // Configuração de User Agent Mobile para larguras < 1024
        if (vp.width < 1024) {
          await send("Network.setUserAgentOverride", {
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
          });
        } else {
          await send("Network.setUserAgentOverride", {
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          });
        }

        await send("Page.navigate", { url: `http://localhost:3000${route.path}` });
        await new Promise(r => setTimeout(r, 2000));

        // Capturar screenshot via protocolo DevTools (buffer de renderização real do Chromium)
        const shotResult = await send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });

        const buf = Buffer.from(shotResult.data, "base64");
        fs.writeFileSync(outputPath, buf);
        console.log(`   ✅ Salvo localmente: ${filename} (${buf.length} bytes)`);

        // Copiar para Google Drive se acessível
        if (fs.existsSync(DRIVE_DEST_DIR)) {
          const driveDest = path.join(DRIVE_DEST_DIR, filename);
          fs.writeFileSync(driveDest, buf);
        }
      }
    }

    console.log("\n=== CAPTURA DE TODAS AS 25 TELAS VIA CDP CONCLUÍDA COM SUCESSO! ===");
    ws.close();
  } finally {
    chromeProc.kill();
  }
}

main().catch(err => {
  console.error("Erro fatal na captura CDP:", err);
  process.exit(1);
});
