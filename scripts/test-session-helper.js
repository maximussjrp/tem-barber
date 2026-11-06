const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { encode } = require("next-auth/jwt");

const ALLOWED_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const ALLOWED_PORTS = new Set(["5439", "55439"]);
const ALLOWED_DATABASES = new Set(["match_barber_test"]);

function loadEnvIfMissing() {
  if (process.env.NEXTAUTH_SECRET && process.env.DATABASE_URL) return;
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_0-9]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

function validateTestEnvironment(customEnv = process.env) {
  // A. Bloqueio estrito de ambiente de produção
  if (customEnv.NODE_ENV === "production") {
    throw new Error("test-session-helper bloqueado: execução terminantemente proibida em ambiente de produção (NODE_ENV=production).");
  }

  // C. Segurança de autenticação: Sem fallback hardcoded
  const secret = customEnv.NEXTAUTH_SECRET;
  if (!secret || typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("test-session-helper bloqueado: NEXTAUTH_SECRET obrigatória no ambiente de testes local, sem chave fallback.");
  }

  // B. Validação segura do banco de dados via parser URL
  const databaseUrl = customEnv.DATABASE_URL;
  if (!databaseUrl || typeof databaseUrl !== "string") {
    throw new Error("test-session-helper bloqueado: DATABASE_URL não configurada.");
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (err) {
    throw new Error(`test-session-helper bloqueado: URL PostgreSQL inválida (${err && err.message ? err.message : String(err)}).`);
  }

  // Validação de protocolo
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`test-session-helper bloqueado: protocolo '${parsed.protocol}' inválido. Permitido apenas postgresql: ou postgres:.`);
  }

  // Validação estrita de hostname (sem verificação por substring)
  const rawHostname = parsed.hostname.toLowerCase();
  const normalizedHostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;

  if (!ALLOWED_HOSTNAMES.has(rawHostname) && !ALLOWED_HOSTNAMES.has(normalizedHostname)) {
    throw new Error(`test-session-helper bloqueado: hostname '${parsed.hostname}' não é host local de testes autorizado (localhost, 127.0.0.1 ou ::1).`);
  }

  // Validação de porta
  const port = parsed.port;
  if (!ALLOWED_PORTS.has(port)) {
    throw new Error(`test-session-helper bloqueado: porta '${port}' não é uma porta de testes local autorizada (${Array.from(ALLOWED_PORTS).join(", ")}).`);
  }

  // Validação estrita do nome do banco de dados de testes
  const dbName = parsed.pathname.replace(/^\//, "").split("?")[0].trim();
  if (!ALLOWED_DATABASES.has(dbName)) {
    throw new Error(`test-session-helper bloqueado: banco '${dbName}' não autorizado para testes locais (${Array.from(ALLOWED_DATABASES).join(", ")}).`);
  }

  return {
    secret: secret.trim(),
    databaseUrl,
    dbName,
    port,
    hostname: parsed.hostname,
  };
}

async function getTestSessionToken(email = "admin@tembarber.com.br") {
  loadEnvIfMissing();

  const validated = validateTestEnvironment(process.env);

  const pool = new Pool({ connectionString: validated.databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const admin = await prisma.user.findFirst({
      where: { email },
    });

    if (!admin) {
      throw new Error(`Usuário de teste '${email}' não encontrado no banco local.`);
    }

    const token = await encode({
      token: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: "OWNER",
        authLevel: "admin",
        sub: admin.id,
      },
      secret: validated.secret,
    });

    return token;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

module.exports = {
  validateTestEnvironment,
  getTestSessionToken,
};
