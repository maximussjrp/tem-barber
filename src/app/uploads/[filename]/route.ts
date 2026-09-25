import { NextRequest, NextResponse } from "next/server";
import { stat, readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const VALID_FILENAME_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ error: "Nome de arquivo inválido." }, { status: 400 });
  }

  // Validação estrita: apenas UUID + .jpg/.jpeg/.png/.webp, sem path traversal
  if (!VALID_FILENAME_REGEX.test(filename) || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return NextResponse.json(
      { error: "Nome de arquivo ou extensão inválida." },
      { status: 400 }
    );
  }

  const uploadDir = path.resolve(process.cwd(), "public", "uploads");
  const targetPath = path.resolve(uploadDir, filename);

  // Bloqueio rigoroso de path traversal
  if (!targetPath.startsWith(uploadDir + path.sep)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 400 });
  }

  try {
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext];
    if (!contentType) {
      return NextResponse.json({ error: "Extensão inválida." }, { status: 400 });
    }

    const fileBuffer = await readFile(targetPath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileStat.size.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  }
}
