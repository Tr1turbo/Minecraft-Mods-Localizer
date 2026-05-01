import type { LangpackProjectPatch } from "./types";
import { normalizeProjectPatch } from "./patches";

export async function readProjectPatchFile(file: File): Promise<LangpackProjectPatch> {
  const raw = JSON.parse(await file.text());
  return normalizeProjectPatch(raw);
}

export function projectPatchBlob(project: LangpackProjectPatch): Blob {
  return new Blob([JSON.stringify(project, null, 2) + "\n"], {
    type: "application/json;charset=utf-8",
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
