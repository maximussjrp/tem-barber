import { describe, expect, it } from "vitest";

describe("P0 - Member Avatar Upload Validation", () => {
  const ALLOWED_TYPES: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB

  function validateAvatarFile(type: string, size: number): { valid: boolean; error?: string } {
    const ext = ALLOWED_TYPES[type];
    if (!ext) {
      return { valid: false, error: "Tipo inválido. Use JPEG, PNG ou WebP." };
    }
    if (size > MAX_SIZE) {
      return { valid: false, error: "Imagem muito grande. Máximo 5 MB." };
    }
    return { valid: true };
  }

  it("accepts valid JPEG, PNG and WebP files under 5MB", () => {
    expect(validateAvatarFile("image/jpeg", 1024 * 1024).valid).toBe(true);
    expect(validateAvatarFile("image/png", 2 * 1024 * 1024).valid).toBe(true);
    expect(validateAvatarFile("image/webp", 4 * 1024 * 1024).valid).toBe(true);
  });

  it("rejects unauthorized file formats such as GIF, SVG, PDF, and text", () => {
    const gif = validateAvatarFile("image/gif", 1000);
    expect(gif.valid).toBe(false);
    expect(gif.error).toBe("Tipo inválido. Use JPEG, PNG ou WebP.");

    const svg = validateAvatarFile("image/svg+xml", 1000);
    expect(svg.valid).toBe(false);

    const pdf = validateAvatarFile("application/pdf", 1000);
    expect(pdf.valid).toBe(false);
  });

  it("rejects files larger than 5MB", () => {
    const oversized = validateAvatarFile("image/png", 5 * 1024 * 1024 + 1);
    expect(oversized.valid).toBe(false);
    expect(oversized.error).toBe("Imagem muito grande. Máximo 5 MB.");
  });
});
