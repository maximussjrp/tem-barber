import { NextResponse } from "next/server";
import { getMemberSession } from "@/lib/member-api-auth";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function isValidImageSignature(buffer: Buffer, type: string): boolean {
  if (buffer.length < 12) return false;

  if (type === "image/jpeg") {
    // JPEG starts with FF D8 FF
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (type === "image/png") {
    // PNG starts with 89 50 4E 47 0D 0A 1A 0A
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
    // WebP starts with "RIFF" (bytes 0-3) and "WEBP" (bytes 8-11)
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

export async function POST(request: Request) {
  const { error, data } = await getMemberSession();
  if (error) return error;

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

    // Nome de arquivo gerado estritamente no backend via randomUUID
    const filename = `${randomUUID()}.${ext}`;
    const uploadDir = path.resolve(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });

    await writeFile(path.join(uploadDir, filename), buffer);

    const avatarUrl = `/uploads/${filename}`;

    // Atualiza imediatamente o avatar do usuário
    await prisma.user.update({
      where: { id: data!.userId },
      data: { avatarUrl },
    });

    return NextResponse.json({ url: avatarUrl });
  } catch (err) {
    console.error("Erro no upload de avatar do colaborador:", err);
    return NextResponse.json({ error: "Erro ao processar o upload." }, { status: 500 });
  }
}

export async function DELETE() {
  const { error, data } = await getMemberSession();
  if (error) return error;

  try {
    const user = await prisma.user.findUnique({
      where: { id: data!.userId },
      select: { id: true, avatarUrl: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const currentAvatarUrl = user.avatarUrl;

    // Atualiza o avatar do próprio usuário autenticado para null
    await prisma.user.update({
      where: { id: data!.userId },
      data: { avatarUrl: null },
    });

    // Se o avatar era local e no formato esperado /uploads/<uuid>.<ext>, remove o arquivo
    if (currentAvatarUrl && currentAvatarUrl.startsWith("/uploads/")) {
      const filename = path.basename(currentAvatarUrl);
      const UUID_REGEX =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

      if (UUID_REGEX.test(filename)) {
        // Garantir que nenhum outro usuário referencia este mesmo arquivo
        const usageCount = await prisma.user.count({
          where: {
            avatarUrl: currentAvatarUrl,
            id: { not: data!.userId },
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
    }

    return NextResponse.json({ success: true, url: null });
  } catch (err) {
    console.error("Erro ao remover avatar do colaborador:", err);
    return NextResponse.json({ error: "Erro ao processar a remoção do avatar." }, { status: 500 });
  }
}
