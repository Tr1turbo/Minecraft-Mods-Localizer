import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { scanModJars, scanResourcePack } from "../../src/lib/scanner";

describe("scanner", () => {
  it("reads namespace language JSON from mod jars", async () => {
    const file = await zipFile("create.jar", {
      "assets/create/lang/en_us.json": {
        "block.create.shaft": "Shaft",
      },
      "assets/create/lang/zh_tw.json": {
        "block.create.shaft": "傳動桿",
      },
      "assets/create/models/shaft.json": {},
    });

    const scan = await scanModJars([file]);

    expect(scan.warnings).toEqual([]);
    expect(scan.translations.create.en_us["block.create.shaft"]).toBe("Shaft");
    expect(scan.translations.create.zh_tw["block.create.shaft"]).toBe("傳動桿");
    expect(scan.fingerprints[0].name).toBe("create.jar");
  });

  it("keeps scanning when a locale file contains invalid JSON", async () => {
    const zip = new JSZip();
    zip.file("assets/good/lang/en_us.json", JSON.stringify({ "item.good": "Good" }));
    zip.file("assets/bad/lang/en_us.json", "{broken");
    const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "broken.jar");

    const scan = await scanModJars([file]);

    expect(scan.translations.good.en_us["item.good"]).toBe("Good");
    expect(scan.warnings).toHaveLength(1);
    expect(scan.warnings[0].path).toBe("assets/bad/lang/en_us.json");
  });

  it("reads resource pack values", async () => {
    const file = await zipFile("pack.zip", {
      "assets/create/lang/zh_tw.json": {
        "block.create.shaft": "資源包傳動桿",
      },
    });

    const scan = await scanResourcePack(file);

    expect(scan.translations.create.zh_tw["block.create.shaft"]).toBe("資源包傳動桿");
  });
});

async function zipFile(name: string, entries: Record<string, Record<string, string>>): Promise<File> {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(entries)) {
    zip.file(path, JSON.stringify(data));
  }
  return new File([await zip.generateAsync({ type: "arraybuffer" })], name);
}
