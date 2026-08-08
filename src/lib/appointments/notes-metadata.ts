export function extractServiceQuantities(notes: string | null | undefined): Record<string, number> {
  if (!notes) return {};
  const match = notes.match(/\[\[TEMBARBER_SERVICE_QUANTITIES_V1:\s*(\{.*?\})\]\]/);
  if (!match) return {};
  try {
    const raw = JSON.parse(match[1]);
    const validated: Record<string, number> = {};
    for (const [key, val] of Object.entries(raw)) {
      if (!key) continue;
      const qty = Number(val);
      if (Number.isInteger(qty) && qty >= 1) {
        validated[key] = Math.min(5, qty);
      }
    }
    return validated;
  } catch {
    return {};
  }
}

export function stripMetadataFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const stripped = notes
    .replace(/\[\[TEMBARBER_SERVICE_QUANTITIES_V1:.*?\]\]/g, "")
    .replace(/\[services_metadata:.*?\]/g, "") // clean old formatting if present
    .replace(/\[\[.*?\]\]/g, "") // clean arbitrary user manually typed block
    .trim();
  return stripped || null;
}

export function buildNotesWithMetadata(
  originalNotes: string | null | undefined,
  quantities: Record<string, number>
): string | null {
  const baseNotes = stripMetadataFromNotes(originalNotes);
  const activeQuantities: Record<string, number> = {};
  for (const [svcId, qty] of Object.entries(quantities)) {
    if (!svcId) continue;
    const validQty = Math.min(5, Math.max(1, Math.floor(Number(qty) || 1)));
    activeQuantities[svcId] = validQty;
  }

  if (Object.keys(activeQuantities).length === 0) {
    return baseNotes;
  }

  const metadataString = `[[TEMBARBER_SERVICE_QUANTITIES_V1:${JSON.stringify(activeQuantities)}]]`;
  if (baseNotes) {
    return `${baseNotes}\n\n${metadataString}`;
  }
  return metadataString;
}
