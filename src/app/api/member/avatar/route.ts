import { NextResponse } from "next/server";
import { getMemberSession } from "@/lib/member-api-auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

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

    const filename = `${randomUUID()}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
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
