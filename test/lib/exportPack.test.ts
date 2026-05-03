import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { createResourcePackZip } from "../../src/lib/exportPack";
import { DEFAULT_EXPORT_SKIP_SOURCES } from "../../src/lib/types";
import type { CatalogRow, LocaleCode, SourceKind } from "../../src/lib/types";

describe("resource pack export", () => {
  it("skips entries whose final source is disabled for export", async () => {
    const rows = [
      row("create", "manual.key", "手動", "manual"),
      row("create", "jar.key", "Jar value", "jar"),
      row("create", "fallback.key", "Fallback value", "fallback"),
    ];

    const blob = await createResourcePackZip(rows, ["zh_tw"], {
      skipSources: {
        jar: true,
        fallback: true,
      },
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const zhTw = JSON.parse((await zip.file("assets/create/lang/zh_tw.json")?.async("text")) ?? "{}");

    expect(zhTw).toEqual({
      "manual.key": "手動",
    });
  });

  it("skips untouched vanilla entries by default", async () => {
    const blob = await createResourcePackZip(
      [rowForLocale("minecraft", "block.minecraft.oak_slab", "Oak Slab", "vanilla", "en_us")],
      ["en_us"],
      { skipSources: DEFAULT_EXPORT_SKIP_SOURCES },
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(zip.file("assets/minecraft/lang/en_us.json")).toBeNull();
    expect(zip.file("pack.mcmeta")).toBeTruthy();
  });

  it("exports manual minecraft edits to the minecraft namespace lang file", async () => {
    const blob = await createResourcePackZip(
      [rowForLocale("minecraft", "block.minecraft.oak_slab", "Custom Oak Slab", "manual", "en_us")],
      ["en_us"],
      { skipSources: DEFAULT_EXPORT_SKIP_SOURCES },
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const enUs = JSON.parse((await zip.file("assets/minecraft/lang/en_us.json")?.async("text")) ?? "{}");

    expect(enUs).toEqual({
      "block.minecraft.oak_slab": "Custom Oak Slab",
    });
  });
});

function row(namespace: string, key: string, value: string, source: SourceKind): CatalogRow {
  return {
    namespace,
    key,
    sourceLocale: "en_us",
    sourceValue: key,
    hasSource: true,
    entries: {
      zh_cn: entry(namespace, "zh_cn", key, value, source),
      zh_tw: entry(namespace, "zh_tw", key, value, source),
      zh_hk: entry(namespace, "zh_hk", key, value, source),
    },
  };
}

function entry(namespace: string, locale: LocaleCode, key: string, value: string, source: SourceKind): CatalogRow["entries"][LocaleCode] {
  return {
    id: `${namespace}/${locale}/${key}`,
    namespace,
    locale,
    key,
    sourceLocale: "en_us",
    sourceValue: key,
    hasSource: true,
    base: { source, value, sourceLabel: "test" },
    final: { source, value, sourceLabel: "test" },
  };
}

function rowForLocale(namespace: string, key: string, value: string, source: SourceKind, locale: LocaleCode): CatalogRow {
  return {
    namespace,
    key,
    sourceLocale: "en_us",
    sourceValue: key,
    hasSource: true,
    entries: {
      [locale]: entry(namespace, locale, key, value, source),
    },
  };
}
