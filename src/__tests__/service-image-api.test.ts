import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    service: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    appointmentService: {
      count: vi.fn(),
    },
    category: {
      findUnique: vi.fn(),
    },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(
      (
        from: Parameters<typeof actual.rename>[0],
        to: Parameters<typeof actual.rename>[1]
      ) => actual.rename(from, to)
    ),
  };
});

import { POST as postServiceImage, DELETE as deleteServiceImage } from "@/app/api/admin/services/[id]/image/route";
import { PUT as putService, DELETE as deleteService } from "@/app/api/admin/services/[id]/route";

describe("Service Image API & Filesystem Safety Suite", () => {
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

  // Valid JPEG header
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
  ]);

  // Valid WebP header: RIFF....WEBP
  const validWebpBuffer = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
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

  function createUploadRequest(buffer: Buffer, filename: string, mimeType: string) {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append("file", blob, filename);

    return new NextRequest("http://localhost/api/admin/services/svc-1/image", {
      method: "POST",
      body: formData,
    });
  }

  it("A. admin correto pode enviar JPEG válido", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/uploads/mock.jpg",
    });

    const req = createUploadRequest(validJpegBuffer, "foto.jpg", "image/jpeg");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toMatch(/^\/uploads\/[0-9a-f-]+\.jpg$/);

    const savedFile = path.resolve(process.cwd(), "public", data.url.replace(/^\//, ""));
    createdFiles.push(savedFile);
  });

  it("B. admin correto pode enviar PNG válido", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/uploads/mock.png",
    });

    const req = createUploadRequest(validPngBuffer, "foto.png", "image/png");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);

    const savedFile = path.resolve(process.cwd(), "public", data.url.replace(/^\//, ""));
    createdFiles.push(savedFile);
  });

  it("C. admin correto pode enviar WebP válido", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/uploads/mock.webp",
    });

    const req = createUploadRequest(validWebpBuffer, "foto.webp", "image/webp");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toMatch(/^\/uploads\/[0-9a-f-]+\.webp$/);

    const savedFile = path.resolve(process.cwd(), "public", data.url.replace(/^\//, ""));
    createdFiles.push(savedFile);
  });

  it("D. tipo proibido (ex: PDF ou GIF) retorna 400", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });

    const fakePdf = Buffer.from("%PDF-1.4 file content here");
    const req = createUploadRequest(fakePdf, "arquivo.pdf", "application/pdf");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Tipo inválido");
  });

  it("E. magic bytes inválidos com extensão mentirosa retorna 400", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });

    const corruptBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
    const req = createUploadRequest(corruptBuffer, "corrupto.jpg", "image/jpeg");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Conteúdo do arquivo não corresponde a uma imagem válida");
  });

  it("F. arquivo maior que 5MB retorna 400", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });

    const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 10);
    // write valid PNG header at start
    validPngBuffer.copy(bigBuffer, 0, 0, validPngBuffer.length);

    const req = createUploadRequest(bigBuffer, "pesado.png", "image/png");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Imagem muito grande");
  });

  it("G. serviço de outro tenant retorna 404 (cross-tenant)", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-from-other-barbershop",
      barbershopId: "shop-beta", // Loja diferente da sessão (shop-alpha)
      imageUrl: null,
    });

    const req = createUploadRequest(validPngBuffer, "foto.png", "image/png");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-from-other-barbershop" }) });
    expect(res.status).toBe(404);
  });

  it("H & I. banco recebe imageUrl com formato /uploads/<uuid>.<ext>", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });
    prismaMock.service.update.mockResolvedValue({
      id: "svc-1",
      imageUrl: "/uploads/some-uuid.png",
    });

    const req = createUploadRequest(validPngBuffer, "foto.png", "image/png");
    await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });

    expect(prismaMock.service.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "svc-1" },
        data: {
          imageUrl: expect.stringMatching(/^\/uploads\/[0-9a-f-]+\.png$/),
        },
      })
    );
  });

  it("J. substituir imagem limpa arquivo anterior se não referenciado", async () => {
    const oldUuid = "11111111-2222-3333-4444-555555555555";
    const oldFilename = `${oldUuid}.png`;
    const oldFilePath = path.resolve(uploadsDir, oldFilename);
    await writeFile(oldFilePath, validPngBuffer);
    createdFiles.push(oldFilePath);

    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: `/uploads/${oldFilename}`,
    });
    prismaMock.service.count.mockResolvedValue(0); // Nenhum outro serviço usa
    prismaMock.service.update.mockResolvedValue({ id: "svc-1" });

    const req = createUploadRequest(validPngBuffer, "nova.png", "image/png");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    createdFiles.push(path.resolve(process.cwd(), "public", data.url.replace(/^\//, "")));

    // Verify old file was deleted
    const fs = await import("fs");
    expect(fs.existsSync(oldFilePath)).toBe(false);
  });

  it("K. DELETE /api/admin/services/[id]/image define imageUrl=null e limpa filesystem", async () => {
    const oldUuid = "22222222-3333-4444-5555-666666666666";
    const oldFilename = `${oldUuid}.jpg`;
    const oldFilePath = path.resolve(uploadsDir, oldFilename);
    await writeFile(oldFilePath, validJpegBuffer);
    createdFiles.push(oldFilePath);

    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: `/uploads/${oldFilename}`,
    });
    prismaMock.service.count.mockResolvedValue(0);
    prismaMock.service.update.mockResolvedValue({ id: "svc-1", imageUrl: null });

    const req = new NextRequest("http://localhost/api/admin/services/svc-1/image", { method: "DELETE" });
    const res = await deleteServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.url).toBeNull();

    expect(prismaMock.service.update).toHaveBeenCalledWith({
      where: { id: "svc-1" },
      data: { imageUrl: null },
    });

    const fs = await import("fs");
    expect(fs.existsSync(oldFilePath)).toBe(false);
  });

  it("L. DELETE imagem em serviço de outro tenant é proibido (404)", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-cross",
      barbershopId: "shop-beta",
      imageUrl: "/uploads/image.png",
    });

    const req = new NextRequest("http://localhost/api/admin/services/svc-cross/image", { method: "DELETE" });
    const res = await deleteServiceImage(req, { params: Promise.resolve({ id: "svc-cross" }) });
    expect(res.status).toBe(404);
  });

  it("M. PUT /api/admin/services/[id] não altera imageUrl arbitrariamente", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: "/uploads/original.png",
    });
    prismaMock.category.findUnique.mockResolvedValue({
      id: "cat-1",
      barbershopId: "shop-alpha",
    });
    prismaMock.service.update.mockImplementation(async ({ data }) => ({
      id: "svc-1",
      ...data,
    }));

    const req = new NextRequest("http://localhost/api/admin/services/svc-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Corte Atualizado",
        categoryId: "cat-1",
        price: 50,
        durationMin: 30,
        imageUrl: "/uploads/malicious-injected.png",
      }),
    });

    const res = await putService(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(200);

    // Verify update was called without imageUrl in data
    expect(prismaMock.service.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "svc-1" },
        data: expect.not.objectContaining({
          imageUrl: expect.anything(),
        }),
      })
    );
  });

  it("N. Falha na persistência DB limpa o novo arquivo salvo em best-effort (Addendum 2)", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });
    prismaMock.service.update.mockRejectedValue(new Error("Database connection error"));

    const fs = await import("fs");
    const filesBefore = fs.readdirSync(uploadsDir);

    const req = createUploadRequest(validPngBuffer, "teste.png", "image/png");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(500);

    // Verify that no orphaned file remains
    const filesAfter = fs.readdirSync(uploadsDir);
    expect(filesAfter.length).toBe(filesBefore.length);
  });

  it("O. Hard delete de serviço remove foto local unreferenced; Soft delete mantém foto (Addendum 3)", async () => {
    const serviceUuid = "33333333-4444-5555-6666-777777777777";
    const serviceImageFilename = `${serviceUuid}.png`;
    const serviceImageFilePath = path.resolve(uploadsDir, serviceImageFilename);
    await writeFile(serviceImageFilePath, validPngBuffer);
    createdFiles.push(serviceImageFilePath);

    // 1. Soft delete test (service has appointments linked)
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-with-appointments",
      barbershopId: "shop-alpha",
      imageUrl: `/uploads/${serviceImageFilename}`,
    });
    prismaMock.appointmentService.count.mockResolvedValue(3); // Has appointments
    prismaMock.service.update.mockResolvedValue({ id: "svc-with-appointments", isActive: false });

    const softReq = new NextRequest("http://localhost/api/admin/services/svc-with-appointments", { method: "DELETE" });
    const softRes = await deleteService(softReq, { params: Promise.resolve({ id: "svc-with-appointments" }) });
    expect(softRes.status).toBe(200);
    const softData = await softRes.json();
    expect(softData.softDeleted).toBe(true);

    // File must still exist!
    const fs = await import("fs");
    expect(fs.existsSync(serviceImageFilePath)).toBe(true);

    // 2. Hard delete test (service has NO appointments linked)
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-no-appointments",
      barbershopId: "shop-alpha",
      imageUrl: `/uploads/${serviceImageFilename}`,
    });
    prismaMock.appointmentService.count.mockResolvedValue(0); // No appointments
    prismaMock.service.count.mockResolvedValue(0); // No other service references it
    prismaMock.service.delete.mockResolvedValue({ id: "svc-no-appointments" });

    const hardReq = new NextRequest("http://localhost/api/admin/services/svc-no-appointments", { method: "DELETE" });
    const hardRes = await deleteService(hardReq, { params: Promise.resolve({ id: "svc-no-appointments" }) });
    expect(hardRes.status).toBe(200);

    // File must have been deleted!
    expect(fs.existsSync(serviceImageFilePath)).toBe(false);
  });

  it("P. Se rename falhar, tempFilePath é removido em best-effort", async () => {
    prismaMock.service.findUnique.mockResolvedValue({
      id: "svc-1",
      barbershopId: "shop-alpha",
      imageUrl: null,
    });

    const { rename } = await import("fs/promises");
    vi.mocked(rename).mockRejectedValueOnce(new Error("Simulated disk rename error"));

    const fs = await import("fs");
    const filesBefore = fs.readdirSync(uploadsDir);

    const req = createUploadRequest(validPngBuffer, "rename-fail.png", "image/png");
    const res = await postServiceImage(req, { params: Promise.resolve({ id: "svc-1" }) });
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toBe("Erro ao processar o upload.");

    // Verify that no orphaned .tmp file remains in uploads
    const filesAfter = fs.readdirSync(uploadsDir);
    expect(filesAfter).toEqual(filesBefore);
  });
});
