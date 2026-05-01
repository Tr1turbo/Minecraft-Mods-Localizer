import JSZip from "jszip";

import type { CatalogRow, SourceKind, TargetLocale } from "./types";
import { TARGET_LOCALES } from "./types";

const ASSET_NAMESPACE_RE = /^assets\/([^/]+)\//i;

export interface PatchedJarExport {
  filename: string;
  blob: Blob;
  namespaces: string[];
  langFilesWritten: number;
  entriesWritten: number;
}

export interface SkippedJarExport {
  filename: string;
  reason: string;
}

export interface PatchedJarExportResult {
  jars: PatchedJarExport[];
  skipped: SkippedJarExport[];
}

export interface PatchedJarExportOptions {
  skipSources?: Partial<Record<SourceKind, boolean>>;
}

export async function createPatchedJarExports(
  files: readonly File[],
  rows: readonly CatalogRow[],
  locales: readonly TargetLocale[] = TARGET_LOCALES,
  options: PatchedJarExportOptions = {},
): Promise<PatchedJarExport[]> {
  return (await createPatchedJarExportResult(files, rows, locales, options)).jars;
}

export async function createPatchedJarExportResult(
  files: readonly File[],
  rows: readonly CatalogRow[],
  locales: readonly TargetLocale[] = TARGET_LOCALES,
  options: PatchedJarExportOptions = {},
): Promise<PatchedJarExportResult> {
  const rowsByNamespace = groupRowsByNamespace(rows);
  const jars: PatchedJarExport[] = [];
  const skipped: SkippedJarExport[] = [];

  for (const file of files) {
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const namespaces = namespacesForJar(zip).filter((namespace) => rowsByNamespace.has(namespace));
      if (namespaces.length === 0) {
        continue;
      }

      let langFilesWritten = 0;
      let entriesWritten = 0;
      for (const namespace of namespaces) {
        const namespaceRows = rowsByNamespace.get(namespace) ?? [];
        for (const locale of locales) {
          const data = Object.fromEntries(
            namespaceRows
              .filter((row) => !options.skipSources?.[row.entries[locale].final.source])
              .map((row) => [row.key, row.entries[locale].final.value] as const)
              .sort(([left], [right]) => left.localeCompare(right)),
          );
          if (Object.keys(data).length === 0) {
            continue;
          }
          zip.file(`assets/${namespace}/lang/${locale}.json`, JSON.stringify(data, null, 2) + "\n");
          langFilesWritten += 1;
          entriesWritten += Object.keys(data).length;
        }
      }

      if (langFilesWritten === 0) {
        continue;
      }

      jars.push({
        filename: patchedJarFilename(file.name),
        blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
        namespaces,
        langFilesWritten,
        entriesWritten,
      });
    } catch (error) {
      skipped.push({ filename: file.name, reason: errorMessage(error) });
    }
  }

  return { jars, skipped };
}

export async function createPatchedJarDownload(
  files: readonly File[],
  rows: readonly CatalogRow[],
  locales: readonly TargetLocale[] = TARGET_LOCALES,
  options: PatchedJarExportOptions = {},
): Promise<{ blob: Blob; filename: string; jars: PatchedJarExport[]; skipped: SkippedJarExport[] }> {
  const { jars, skipped } = await createPatchedJarExportResult(files, rows, locales, options);
  if (jars.length === 1) {
    return {
      blob: jars[0].blob,
      filename: jars[0].filename,
      jars,
      skipped,
    };
  }

  const zip = new JSZip();
  for (const jar of jars) {
    zip.file(jar.filename, await jar.blob.arrayBuffer());
  }
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    filename: "Minecraft-Mods-Localizer-Patched-Jars.zip",
    jars,
    skipped,
  };
}

function groupRowsByNamespace(rows: readonly CatalogRow[]): Map<string, CatalogRow[]> {
  const byNamespace = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    byNamespace.set(row.namespace, [...(byNamespace.get(row.namespace) ?? []), row]);
  }
  return byNamespace;
}

function namespacesForJar(zip: JSZip): string[] {
  const namespaces = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      continue;
    }
    const match = ASSET_NAMESPACE_RE.exec(entry.name);
    if (match) {
      namespaces.add(match[1]);
    }
  }
  return [...namespaces].sort((left, right) => left.localeCompare(right));
}

function patchedJarFilename(filename: string): string {
  return filename.replace(/\.jar$/i, "") + "-langpatched.jar";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
