import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { writeFile, mkdir, unlink, rename } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { getPresetById } from "@/lib/service-image-presets";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

function isValidImageSignature(buffer: Buffer, type: string): boolean {
  if (buffer.length < 12) return false;

  if (type === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (type === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (type === "image/webp") {
    const isRiff =
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46;
    const isWebp =
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50;
    return isRiff && isWebp;
  }

  return false;
}

async function removeFileIfUnreferenced(imageUrl: string | null | undefined, excludeServiceId?: string) {
  if (!imageUrl || !imageUrl.startsWith("/uploads/")) return;
  const filename = path.basename(imageUrl);
  if (!UUID_REGEX.test(filename)) return;

  const usageCount = await prisma.service.count({
    where: {
      imageUrl,
      ...(excludeServiceId ? { id: { not: excludeServiceId } } : {}),
    },
  });

  if (usageCount === 0) {
    const uploadDir = path.resolve(process.cwd(), "public", "uploads");
    const targetPath = path.resolve(uploadDir, filename);
    if (targetPath.startsWith(uploadDir + path.sep)) {
      await unlink(targetPath).catch(() => {});
    }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    select: { id: true, barbershopId: true, imageUrl: true },
  });

  if (!service || service.barbershopId !== data!.barbershopId) {
    return NextResponse.json({ error: "Serviço não encontrado." }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Tipo inválido. Use JPEG, PNG ou WebP." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Imagem muito grande. Máximo 5 MB." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!isValidImageSignature(buffer, file.type)) {
      return NextResponse.json(
        { error: "Conteúdo do arquivo não corresponde a uma imagem válida (JPEG, PNG ou WebP)." },
        { status: 400 }
      );
    }

    // Atomic write strategy: write to temp file, then rename
    let tempFilePath: string | null = null;
    let finalFilePath: string | null = null;

    try {
      const filename = `${randomUUID()}.${ext}`;
      const uploadDir = path.resolve(process.cwd(), "public", "uploads");
      await mkdir(uploadDir, { recursive: true });

      tempFilePath = path.join(uploadDir, `${filename}.tmp`);
      finalFilePath = path.join(uploadDir, filename);

      await writeFile(tempFilePath, buffer);
      await rename(tempFilePath, finalFilePath);
      tempFilePath = null; // Successfully moved to finalFilePath

      const newImageUrl = `/uploads/${filename}`;
      const previousImageUrl = service.imageUrl;

      try {
        await prisma.service.update({
          where: { id },
          data: { imageUrl: newImageUrl },
        });
      } catch (dbErr) {
        // Best-effort cleanup of newly written file if database update fails
        if (finalFilePath) {
          await unlink(finalFilePath).catch(() => {});
        }
        console.error("Erro ao atualizar imageUrl do serviço no banco:", dbErr);
        return NextResponse.json({ error: "Erro ao atualizar registro do serviço." }, { status: 500 });
      }

      // Only after successful database persistence, consider removing previous image
      if (previousImageUrl && previousImageUrl !== newImageUrl) {
        await removeFileIfUnreferenced(previousImageUrl, id);
      }

      return NextResponse.json({ url: newImageUrl });
    } catch (err) {
      if (tempFilePath) {
        await unlink(tempFilePath).catch(() => {});
      }
      console.error("Erro no upload de foto do serviço:", err);
      return NextResponse.json({ error: "Erro ao processar o upload." }, { status: 500 });
    }
  } catch (err) {
    console.error("Erro no upload de foto do serviço:", err);
    return NextResponse.json({ error: "Erro ao processar o upload." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    select: { id: true, barbershopId: true, imageUrl: true },
  });

  if (!service || service.barbershopId !== data!.barbershopId) {
    return NextResponse.json({ error: "Serviço não encontrado." }, { status: 404 });
  }

  try {
    const currentImageUrl = service.imageUrl;

    await prisma.service.update({
      where: { id },
      data: { imageUrl: null },
    });

    if (currentImageUrl) {
      await removeFileIfUnreferenced(currentImageUrl, id);
    }

    return NextResponse.json({ success: true, url: null });
  } catch (err) {
    console.error("Erro ao remover foto do serviço:", err);
    return NextResponse.json({ error: "Erro ao processar a remoção da foto." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    select: { id: true, barbershopId: true, imageUrl: true },
  });

  if (!service || service.barbershopId !== data!.barbershopId) {
    return NextResponse.json({ error: "Serviço não encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    if ("imageUrl" in body || "url" in body || "path" in body || "file" in body) {
      return NextResponse.json(
        { error: "Payload contém propriedades não permitidas. Envie apenas presetId." },
        { status: 400 }
      );
    }

    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "presetId") {
      return NextResponse.json(
        { error: "Payload deve conter exclusivamente a propriedade presetId." },
        { status: 400 }
      );
    }

    if (typeof body.presetId !== "string" || !body.presetId.trim()) {
      return NextResponse.json(
        { error: "presetId é obrigatório." },
        { status: 400 }
      );
    }

    const preset = getPresetById(body.presetId);
    if (!preset) {
      return NextResponse.json({ error: "Preset de imagem não encontrado." }, { status: 400 });
    }

    const previousImageUrl = service.imageUrl;

    await prisma.service.update({
      where: { id },
      data: { imageUrl: preset.imageUrl },
    });

    if (previousImageUrl && previousImageUrl !== preset.imageUrl) {
      await removeFileIfUnreferenced(previousImageUrl, id);
    }

    return NextResponse.json({ url: preset.imageUrl });
  } catch (err) {
    console.error("Erro ao aplicar preset da imagem:", err);
    return NextResponse.json({ error: "Erro ao processar o preset da foto." }, { status: 500 });
  }
}
