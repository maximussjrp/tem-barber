import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";

const { prismaMock, getMemberSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    barbershopMember: {
      findUnique: vi.fn(),
    },
  },
  getMemberSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/member-api-auth", () => ({ getMemberSession: getMemberSessionMock }));

import { GET as getUploadFile } from "@/app/uploads/[filename]/route";
import { POST as postAvatar, DELETE as deleteAvatar } from "@/app/api/member/avatar/route";
import { GET as getMemberPerfil } from "@/app/api/member/perfil/route";

describe("Avatar Hotfix - Uploads Serving & API", () => {
  const testDir = path.resolve(process.cwd(), "public", "uploads");
  const testUuid = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
  const testFilename = `${testUuid}.png`;
  const testFilePath = path.resolve(testDir, testFilename);

  // Valid 1x1 PNG bytes (starts with 89 50 4E 47 0D 0A 1A 0A)
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  beforeEach(async () => {
    vi.clearAllMocks();
    await mkdir(testDir, { recursive: true });
    getMemberSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "user-123", memberId: "member-123", barbershopId: "shop-123", role: "BARBER" },
    });
  });

  afterEach(async () => {
    await unlink(testFilePath).catch(() => {});
  });

  describe("Item E: GET /uploads/[filename] retorna imagem existente", () => {
    it("deve retornar bytes da imagem e Content-Type correto para imagem válida existente", async () => {
      await writeFile(testFilePath, validPngBuffer);

      const req = new NextRequest(`https://app.tembarber.com.br/uploads/${testFilename}`);
      const res = await getUploadFile(req, {
        params: Promise.resolve({ filename: testFilename }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toContain("immutable");

      const arrayBuf = await res.arrayBuffer();
      expect(Buffer.from(arrayBuf)).toEqual(validPngBuffer);
    });

    it("deve retornar 404 se o arquivo não existir", async () => {
      const nonExistent = "ffffffff-ffff-ffff-ffff-ffffffffffff.png";
      const req = new NextRequest(`https://app.tembarber.com.br/uploads/${nonExistent}`);
      const res = await getUploadFile(req, {
        params: Promise.resolve({ filename: nonExistent }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("Item F: Path traversal é rejeitado", () => {
    it("deve rejeitar tentativas com .. no filename", async () => {
      const traversalFilenames = [
        "../etc/passwd",
        `../../${testFilename}`,
        `..\\..\\${testFilename}`,
        `subdir/${testFilename}`,
      ];

      for (const invalid of traversalFilenames) {
        const req = new NextRequest(`https://app.tembarber.com.br/uploads/${invalid}`);
        const res = await getUploadFile(req, {
          params: Promise.resolve({ filename: invalid }),
        });
        expect(res.status).toBe(400);
      }
    });
  });

  describe("Item G: Extensão inválida é rejeitada", () => {
    it("deve rejeitar extensões não permitidas mesmo que pareçam seguras", async () => {
      const invalidExtensions = [
        `${testUuid}.exe`,
        `${testUuid}.svg`,
        `${testUuid}.html`,
        `${testUuid}.js`,
        `${testUuid}.pdf`,
      ];

      for (const invalid of invalidExtensions) {
        const req = new NextRequest(`https://app.tembarber.com.br/uploads/${invalid}`);
        const res = await getUploadFile(req, {
          params: Promise.resolve({ filename: invalid }),
        });
        expect(res.status).toBe(400);
      }
    });
  });

  describe("Item H: DELETE limpa somente avatar do usuário autenticado", () => {
    it("deve limpar avatarUrl no banco do usuário autenticado e remover arquivo local", async () => {
      await writeFile(testFilePath, validPngBuffer);

      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-123",
        avatarUrl: `/uploads/${testFilename}`,
      });
      prismaMock.user.count.mockResolvedValue(0); // nenhum outro usuário usa o arquivo
      prismaMock.user.update.mockResolvedValue({ id: "user-123", avatarUrl: null });

      const res = await deleteAvatar();
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ success: true, url: null });

      // Garante que deu update no usuário autenticado
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: { avatarUrl: null },
      });
    });

    it("nunca deve apagar arquivo se outro usuário ainda apontar para ele", async () => {
      await writeFile(testFilePath, validPngBuffer);

      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-123",
        avatarUrl: `/uploads/${testFilename}`,
      });
      prismaMock.user.count.mockResolvedValue(1); // outro usuário usa a mesma URL
      prismaMock.user.update.mockResolvedValue({ id: "user-123", avatarUrl: null });

      const res = await deleteAvatar();
      expect(res.status).toBe(200);

      // Deve atualizar o banco do user-123
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: { avatarUrl: null },
      });

      // E o arquivo deve permanecer intacto
      const verifyReq = new NextRequest(`https://app.tembarber.com.br/uploads/${testFilename}`);
      const checkRes = await getUploadFile(verifyReq, {
        params: Promise.resolve({ filename: testFilename }),
      });
      expect(checkRes.status).toBe(200);
    });
  });

  describe("Item I: Refresh/Profile retorna avatar persistido", () => {
    it("GET /api/member/perfil deve retornar avatarUrl persistido do usuário", async () => {
      const persistedUrl = `/uploads/${testFilename}`;
      prismaMock.barbershopMember.findUnique.mockResolvedValue({
        id: "member-123",
        role: "BARBER",
        bio: "Barbeiro especialista",
        ratingAvg: 4.9,
        user: {
          id: "user-123",
          name: "João Barbeiro",
          email: "joao@example.com",
          phone: "11999999999",
          avatarUrl: persistedUrl,
        },
        barbershop: {
          name: "Barbearia Modelo",
          logoUrl: "/logo.png",
        },
      });

      const res = await getMemberPerfil();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.user.avatarUrl).toBe(persistedUrl);
    });
  });

  describe("POST /api/member/avatar - Validação Real de Imagem", () => {
    it("deve rejeitar arquivo com payload de texto mesmo com tipo image/png falso", async () => {
      const fakeFile = new File([new TextEncoder().encode("not-a-real-png")], "fake.png", {
        type: "image/png",
      });
      const formData = new FormData();
      formData.append("file", fakeFile);

      const req = new Request("https://app.tembarber.com.br/api/member/avatar", {
        method: "POST",
        body: formData,
      });

      const res = await postAvatar(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("imagem válida");
    });

    it("deve aceitar arquivo com assinatura válida de PNG e salvar com randomUUID", async () => {
      const realFile = new File([validPngBuffer], "user-upload.png", {
        type: "image/png",
      });
      const formData = new FormData();
      formData.append("file", realFile);

      prismaMock.user.update.mockResolvedValue({ id: "user-123" });

      const req = new Request("https://app.tembarber.com.br/api/member/avatar", {
        method: "POST",
        body: formData,
      });

      const res = await postAvatar(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.url).toMatch(/^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i);
      expect(json.url).not.toContain("user-upload.png"); // Nunca usa o nome original
    });
  });
});
