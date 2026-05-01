import type { FileFingerprint } from "./types";

export async function sha256ArrayBuffer(buffer: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Text(value: string): Promise<string> {
  return sha256ArrayBuffer(new TextEncoder().encode(value));
}

export async function fingerprintFile(file: File, buffer?: ArrayBuffer): Promise<FileFingerprint> {
  const bytes = buffer ?? (await file.arrayBuffer());
  return {
    name: file.name,
    size: file.size,
    sha256: await sha256ArrayBuffer(bytes),
  };
}
