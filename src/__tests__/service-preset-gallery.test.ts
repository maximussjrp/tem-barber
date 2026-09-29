import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import fs from "fs";

import {
  SERVICE_IMAGE_PRESETS,
  PRESET_CATEGORIES,
  getPresetById,
  getPresetsByCategory,
} from "@/lib/service-image-presets";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    service: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { PATCH as patchServiceImage, POST as postServiceImage, DELETE as deleteServiceImage } from "@/app/api/admin/services/[id]/image/route";

describe("Tem Barber Service Image Preset Gallery & Backend Safety Suite", () => {
  const uploadsDir = path.resolve(process.cwd(), "public", "uploads");

  // Valid 1x1 PNG bytes
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const createdFiles: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    await mkdir(uploadsDir, { recursive: true });
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: "admin-1", barbershopId: "shop-alpha", role: "OWNER" },
    });
  });

  afterEach(async () => {
    for (const file of createdFiles) {
      await unlink(file).catch(() => {});
    }
    createdFiles.length = 0;
  });

  // ============================================================
  // 1. MANIFEST & ASSET INTEGRITY
  // ============================================================

  it("1. Manifesto: IDs únicos, categorias válidas e paths iniciam com /service-presets/", () => {
    const ids = new Set<string>();
    const urls = new Set<string>();

    for (const preset of SERVICE_IMAGE_PRESETS) {
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);

      expect(urls.has(preset.imageUrl)).toBe(false);
      urls.add(preset.imageUrl);

      expect(preset.imageUrl.startsWith("/service-presets/")).toBe(true);

      const categoryExists = PRESET_CATEGORIES.some((c) => c.id === preset.category);
      expect(categoryExists).toBe(true);
    }
  });

  it("2. Manifesto: Todos os arquivos estáticos apontados existem no disco (PRESET_BROKEN_PATH_COUNT=0)", () => {
    let brokenPathCount = 0;

    for (const preset of SERVICE_IMAGE_PRESETS) {
      const diskPath = path.resolve(process.cwd(), "public", preset.imageUrl.replace(/^\//, ""));
      if (!fs.existsSync(diskPath)) {
        brokenPathCount++;
      }
    }

    expect(brokenPathCount).toBe(0);
  });

  it("3. Manifesto: Utilitários getPresetById e getPresetsByCategory funcionam corretamente", () => {
    const fadePreset = getPresetById("fade-baixo");
    expect(fadePreset).toBeDefined();
    expect(fadePreset?.category).toBe("fade");

    const invalidPreset = getPresetById("inexistente-999");
    expect(invalidPreset).toBeUndefined();

    const fadeList = getPresetsByCategory("fade");
    expect(fadeList.length).toBeGreaterThan(0);
    expect(fadeList.every((p) => p.category === "fade")).toBe(true);

    const allList = getPresetsByCategory("todos");
    expect(allList.length).toBe(SERVICE_IMAGE_PRESETS.length);
  });

  // ============================================================
  // 2. BACKEND API PATCH & SAFETY
  // ============================================================

  it("4. PATCH /api/admin/services/[id]/image com presetId válido atualiza imageUrl", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/service-presets/fade/fade-baixo.webp",
    });

    const req = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "fade-baixo" }),
    });

    const res = await patchServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.url).toBe("/service-presets/fade/fade-baixo.webp");
    expect(prismaMock.service.update).toHaveBeenCalledWith({
      where: { id: "svc-1" },
      data: { imageUrl: "/service-presets/fade/fade-baixo.webp" },
    });
  });

  it("5. ADENDO 1: Body com imageUrl/url/path arbitrário é rejeitado com 400 (ARBITRARY_IMAGE_URL_REJECTED=PASS)", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });

    // Attempt 1: body with presetId + injected imageUrl
    const req1 = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "fade-baixo", imageUrl: "/hacked/foto.jpg" }),
    });

    const res1 = await patchServiceImage(req1, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res1.status).toBe(400);

    // Attempt 2: body with custom url property
    const req2 = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://evil.com/pic.png" }),
    });

    const res2 = await patchServiceImage(req2, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res2.status).toBe(400);
  });

  it("6. PATCH com presetId inválido/inexistente retorna 400", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });

    const req = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "preset-fake-123" }),
    });

    const res = await patchServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Preset de imagem não encontrado");
  });

  it("7. Tenant Isolation: PATCH em serviço de outra barbearia retorna 404", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-other-shop",
      barbershopId: "shop-beta", // Different tenant
      imageUrl: null,
    });

    const req = new NextRequest("http://localhost/api/admin/services/svc-other-shop/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "fade-baixo" }),
    });

    const res = await patchServiceImage(req, { params: Promise.resolve({ id: "svc-other-shop" }) });
    expect(res.status).toBe(404);
  });

  // ============================================================
  // 3. TROCAS DE ORIGEM & CLEANUP SAFETY (ADENDOS 5 & 6)
  // ============================================================

  it("8. UPLOAD -> PRESET: Persiste preset no banco e remove upload local unreferenced após persistência", async () => {
    const oldUuid = "aaaa1111-bb22-cc33-dd44-eeee55555555";
    const oldFilename = `${oldUuid}.png`;
    const oldFilePath = path.resolve(uploadsDir, oldFilename);
    await writeFile(oldFilePath, validPngBuffer);
    createdFiles.push(oldFilePath);

    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: `/uploads/${oldFilename}`,
    });
    prismaMock.service.count.mockResolvedValue(0); // Unreferenced
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/service-presets/corte/corte-classico.webp",
    });

    const req = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "corte-classico" }),
    });

    const res = await patchServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);

    // Verify old upload file was removed
    expect(fs.existsSync(oldFilePath)).toBe(false);
  });

  it("9. PRESET -> PRESET: Atualiza DB sem chamar unlink em arquivos estáticos", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: "/service-presets/fade/fade-baixo.webp",
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/service-presets/barba/barba-navalhada.webp",
    });

    const req = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "barba-navalhada" }),
    });

    const res = await patchServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);

    // Verify static preset file still exists on disk
    const presetPath = path.resolve(process.cwd(), "public", "service-presets", "fade", "fade-baixo.webp");
    expect(fs.existsSync(presetPath)).toBe(true);
  });

  it("10. PRESET -> UPLOAD: Salva upload e NÃO apaga arquivo preset estático", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: "/service-presets/fade/fade-baixo.webp",
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/uploads/mock-upload.png",
    });

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(validPngBuffer)], { type: "image/png" });
    formData.append("file", blob, "foto.png");

    const req = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "POST",
      body: formData,
    });

    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    createdFiles.push(path.resolve(process.cwd(), "public", data.url.replace(/^\//, "")));

    // Verify preset file remains untouched
    const presetPath = path.resolve(process.cwd(), "public", "service-presets", "fade", "fade-baixo.webp");
    expect(fs.existsSync(presetPath)).toBe(true);
  });

  it("11. PRESET -> NULL: DELETE define imageUrl=null e NÃO chama unlink no preset", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: "/service-presets/combo/combo-cabelo-e-barba.webp",
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: null,
    });

    const req = new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "DELETE",
    });

    const res = await deleteServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);

    // Verify preset file still exists
    const presetPath = path.resolve(process.cwd(), "public", "service-presets", "combo", "combo-cabelo-e-barba.webp");
    expect(fs.existsSync(presetPath)).toBe(true);
  });
});
