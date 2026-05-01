import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { createPatchedJarDownload, createPatchedJarExports } from "../../src/lib/exportJars";
import type { CatalogRow, SourceKind, TargetLocale } from "../../src/lib/types";

describe("patched jar export", () => {
  it("writes final locale JSON directly into matching mod jars", async () => {
    const jar = await jarFile("create.jar", {
      "assets/create/models/shaft.json": "{}",
      "assets/create/lang/en_us.json": JSON.stringify({ "block.create.shaft": "Shaft" }),
      "META-INF/mods.toml": "modLoader=\"javafml\"",
    });

    const exports = await createPatchedJarExports([jar], [row("create", "block.create.shaft", "傳動桿", "传动杆", "傳動桿")]);

    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({
      filename: "create-langpatched.jar",
      namespaces: ["create"],
      langFilesWritten: 3,
      entriesWritten: 3,
    });

    const patched = await JSZip.loadAsync(await exports[0].blob.arrayBuffer());
    expect(await patched.file("META-INF/mods.toml")?.async("text")).toBe("modLoader=\"javafml\"");
    expect(JSON.parse((await patched.file("assets/create/lang/zh_tw.json")?.async("text")) ?? "{}")).toEqual({
      "block.create.shaft": "傳動桿",
    });
    expect(JSON.parse((await patched.file("assets/create/lang/zh_cn.json")?.async("text")) ?? "{}")).toEqual({
      "block.create.shaft": "传动杆",
    });
  });

  it("bundles multiple patched jars and skips jars without matching namespaces", async () => {
    const createJar = await jarFile("create.jar", {
      "assets/create/models/shaft.json": "{}",
    });
    const libraryJar = await jarFile("library.jar", {
      "META-INF/mods.toml": "modLoader=\"javafml\"",
    });

    const download = await createPatchedJarDownload(
      [createJar, libraryJar],
      [row("create", "block.create.shaft", "傳動桿", "传动杆", "傳動桿")],
    );

    expect(download.filename).toBe("create-langpatched.jar");
    expect(download.jars).toHaveLength(1);
    const patched = await JSZip.loadAsync(await download.blob.arrayBuffer());
    expect(patched.file("assets/create/lang/zh_hk.json")).toBeTruthy();
  });

  it("skips unreadable jar files instead of failing the whole export", async () => {
    const createJar = await jarFile("create.jar", {
      "assets/create/models/shaft.json": "{}",
    });
    const brokenJar = new File(["not a zip"], "broken.jar");

    const download = await createPatchedJarDownload(
      [brokenJar, createJar],
      [row("create", "block.create.shaft", "傳動桿", "传动杆", "傳動桿")],
    );

    expect(download.filename).toBe("create-langpatched.jar");
    expect(download.jars).toHaveLength(1);
    expect(download.skipped).toHaveLength(1);
    expect(download.skipped[0].filename).toBe("broken.jar");
    expect(download.skipped[0].reason).toContain("central directory");
  });

  it("skips source-filtered entries from patched jar lang files", async () => {
    const createJar = await jarFile("create.jar", {
      "assets/create/models/shaft.json": "{}",
    });

    const download = await createPatchedJarDownload(
      [createJar],
      [
        row("create", "manual.key", "手動", "手动", "手動", "manual"),
        row("create", "jar.key", "Jar value", "Jar value", "Jar value", "jar"),
        row("create", "fallback.key", "Fallback value", "Fallback value", "Fallback value", "fallback"),
      ],
      undefined,
      {
        skipSources: {
          jar: true,
          fallback: true,
        },
      },
    );

    const patched = await JSZip.loadAsync(await download.blob.arrayBuffer());
    const zhTw = JSON.parse((await patched.file("assets/create/lang/zh_tw.json")?.async("text")) ?? "{}");
    expect(zhTw).toEqual({
      "manual.key": "手動",
    });
  });

  it("creates a zip when more than one jar is patched", async () => {
    const createJar = await jarFile("create.jar", {
      "assets/create/models/shaft.json": "{}",
    });
    const railwaysJar = await jarFile("railways.jar", {
      "assets/railways/models/track.json": "{}",
    });

    const download = await createPatchedJarDownload(
      [createJar, railwaysJar],
      [
        row("create", "block.create.shaft", "傳動桿", "传动杆", "傳動桿"),
        row("railways", "block.railways.track", "軌道", "轨道", "軌道"),
      ],
    );

    expect(download.filename).toBe("Minecraft-Mods-Localizer-Patched-Jars.zip");
    expect(download.jars.map((jar) => jar.filename)).toEqual(["create-langpatched.jar", "railways-langpatched.jar"]);
    const bundle = await JSZip.loadAsync(await download.blob.arrayBuffer());
    expect(bundle.file("create-langpatched.jar")).toBeTruthy();
    expect(bundle.file("railways-langpatched.jar")).toBeTruthy();
  });
});

async function jarFile(name: string, entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  return new File([await zip.generateAsync({ type: "arraybuffer" })], name);
}

function row(namespace: string, key: string, zhTw: string, zhCn: string, zhHk: string, source: SourceKind = "manual"): CatalogRow {
  return {
    namespace,
    key,
    english: key,
    hasEnglish: true,
    entries: {
      zh_cn: entry(namespace, "zh_cn", key, zhCn, source),
      zh_tw: entry(namespace, "zh_tw", key, zhTw, source),
      zh_hk: entry(namespace, "zh_hk", key, zhHk, source),
    },
  };
}

function entry(namespace: string, locale: TargetLocale, key: string, value: string, source: SourceKind): CatalogRow["entries"][TargetLocale] {
  return {
    id: `${namespace}/${locale}/${key}`,
    namespace,
    locale,
    key,
    english: key,
    hasEnglish: true,
    base: { source, value, sourceLabel: "test" },
    final: { source, value, sourceLabel: "test" },
  };
}
