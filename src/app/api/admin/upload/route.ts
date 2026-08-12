import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request: Request) {
  const { error } = await getAdminSession();
  if (error) return error;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const kind = formData.get("kind") as string | null;

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

    // Set max size limit based on kind
    let maxAllowedSize = MAX_SIZE; // default 5MB
    if (kind === "logo") {
      maxAllowedSize = 2 * 1024 * 1024; // 2MB
    } else if (kind === "cover") {
      maxAllowedSize = 5 * 1024 * 1024; // 5MB
    }

    if (file.size > maxAllowedSize) {
      const errorMsg = kind === "logo"
        ? "Logo muito grande. Máximo 2 MB."
        : "Foto de capa muito grande. Máximo 5 MB.";
      return NextResponse.json(
        { error: errorMsg },
        { status: 400 }
      );
    }

    const filename = `${randomUUID()}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, filename), buffer);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch {
    return NextResponse.json({ error: "Erro ao processar o upload." }, { status: 500 });
  }
}
