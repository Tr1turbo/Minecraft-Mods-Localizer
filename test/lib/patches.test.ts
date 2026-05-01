import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { makeEntryId } from "../../src/lib/entryId";
import { createResourcePackZip } from "../../src/lib/exportPack";
import {
  createEmptyProjectPatch,
  createPatchValue,
  normalizeProjectPatch,
  resolveBaseValue,
  resolveEntry,
  revertManualKey,
  revertManualNamespace,
} from "../../src/lib/patches";
import type { SourcePackScanResult, TranslationMap } from "../../src/lib/types";

describe("patch resolution", () => {
  const mods: TranslationMap = {
    create: {
      en_us: {
        "block.create.shaft": "Shaft",
        "block.create.cog": "Cogwheel",
      },
      zh_tw: {
        "block.create.shaft": "Jar Shaft",
      },
      zh_hk: {
        "block.create.cog": "港式齒輪",
      },
    },
  };

  const lowPack = sourcePack("low.zip", {
    create: {
      zh_tw: {
        "block.create.shaft": "Low Pack Shaft",
      },
    },
  });
  const highPack = sourcePack("high.zip", {
    create: {
      zh_tw: {
        "block.create.shaft": "High Pack Shaft",
      },
    },
  });

  it("uses resource pack, jar locale, converted locale fallback, then English fallback precedence", () => {
    expect(resolveBaseValue(mods, [highPack, lowPack], "create", "zh_tw", "block.create.shaft")).toMatchObject({
      source: "resourcePack",
      value: "High Pack Shaft",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_tw", "block.create.shaft")).toMatchObject({
      source: "jar",
      value: "Jar Shaft",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_tw", "block.create.cog")).toMatchObject({
      source: "converted",
      value: "港式齒輪",
      sourceLabel: "Converted from zh_hk jar",
    });
  });

  it("auto-converts from the first translated locale in the fallback chain", () => {
    const customFallbacks = {
      zh_cn: ["zh_tw", "zh_hk", "en_us"],
      zh_tw: ["zh_hk", "zh_cn", "en_us"],
      zh_hk: ["zh_tw", "zh_cn", "en_us"],
    };

    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", customFallbacks)).toMatchObject({
      source: "converted",
      value: "港式齿轮",
      sourceLabel: "Converted from zh_hk jar",
    });
  });

  it("can convert from LLM patches when that conversion source is enabled", async () => {
    const id = makeEntryId("create", "zh_tw", "block.create.cog");
    const llmPatch = await createPatchValue("LLM 齒輪", { source: "fallback", value: "Cogwheel", sourceLabel: "en_us fallback" }, {
      generatedBy: "llm",
      model: "mock-model",
    });
    const project = {
      ...createEmptyProjectPatch(),
      patches: { [id]: llmPatch },
    };
    const fallbackChain = {
      zh_cn: ["zh_tw", "en_us"],
      zh_tw: ["en_us"],
      zh_hk: ["zh_tw", "en_us"],
    };
    const onlyLlm = { manual: false, llm: true, resourcePack: false, jar: false };
    const noConvertedSources = { manual: false, llm: false, resourcePack: false, jar: false };

    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, onlyLlm)).toMatchObject({
      source: "converted",
      value: "LLM 齿轮",
      sourceLabel: "Converted from zh_tw LLM",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, noConvertedSources)).toMatchObject({
      source: "fallback",
      value: "Cogwheel",
      sourceLabel: "en_us fallback",
    });
  });

  it("can convert from manual patches when that conversion source is enabled", async () => {
    const id = makeEntryId("create", "zh_tw", "block.create.cog");
    const manualPatch = await createPatchValue("Manual 齒輪", { source: "fallback", value: "Cogwheel", sourceLabel: "en_us fallback" }, {
      generatedBy: "manual",
    });
    const project = {
      ...createEmptyProjectPatch(),
      patches: { [id]: manualPatch },
    };
    const fallbackChain = {
      zh_cn: ["zh_tw", "en_us"],
      zh_tw: ["en_us"],
      zh_hk: ["zh_tw", "en_us"],
    };
    const onlyManual = { manual: true, llm: false, resourcePack: false, jar: false };
    const noConvertedSources = { manual: false, llm: false, resourcePack: false, jar: false };

    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, onlyManual)).toMatchObject({
      source: "converted",
      value: "Manual 齿轮",
      sourceLabel: "Converted from zh_tw manual",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, noConvertedSources)).toMatchObject({
      source: "fallback",
      value: "Cogwheel",
      sourceLabel: "en_us fallback",
    });
  });

  it("uses adjustable fallback order per target locale", () => {
    const customFallbacks = {
      zh_cn: ["en_us"],
      zh_tw: ["en_us"],
      zh_hk: ["en_us"],
    };

    expect(resolveBaseValue(mods, [], "create", "zh_tw", "block.create.cog", customFallbacks)).toMatchObject({
      source: "fallback",
      value: "Cogwheel",
      sourceLabel: "en_us fallback",
    });
  });

  it("uses the key as missing-source display text when no fallback source exists", () => {
    const missingEnglishMods: TranslationMap = {
      create: {
        zh_tw: {
          "item.create.only_target": "只有目標語系",
        },
      },
    };
    const enUsOnlyFallbacks = {
      zh_cn: ["en_us"],
      zh_tw: ["en_us"],
      zh_hk: ["en_us"],
    };

    expect(resolveBaseValue(missingEnglishMods, [], "create", "zh_hk", "item.create.only_target", enUsOnlyFallbacks)).toMatchObject({
      source: "missing",
      value: "item.create.only_target",
      sourceLabel: "missing source",
    });
    expect(resolveEntry(missingEnglishMods, [], createEmptyProjectPatch(), "create", "zh_hk", "item.create.only_target", enUsOnlyFallbacks)).toMatchObject({
      english: "item.create.only_target",
      hasEnglish: false,
    });
  });

  it("uses one patch field with LLM/manual metadata and clears it on revert", async () => {
    const id = makeEntryId("create", "zh_tw", "block.create.shaft");
    const base = resolveBaseValue(mods, [highPack], "create", "zh_tw", "block.create.shaft");
    const llmPatch = await createPatchValue("LLM Shaft", base, { generatedBy: "llm", model: "mock-model" });
    const manualPatch = await createPatchValue("Manual Shaft", base, { generatedBy: "manual" });
    const project = {
      ...createEmptyProjectPatch(),
      patches: { [id]: llmPatch },
    };

    expect(resolveEntry(mods, [highPack], project, "create", "zh_tw", "block.create.shaft").final).toMatchObject({
      source: "llm",
      value: "LLM Shaft",
    });

    const editedProject = {
      ...project,
      patches: { [id]: manualPatch },
    };

    expect(resolveEntry(mods, [highPack], editedProject, "create", "zh_tw", "block.create.shaft").final).toMatchObject({
      source: "manual",
      value: "Manual Shaft",
    });

    const reverted = revertManualKey(editedProject, id);
    expect(resolveEntry(mods, [highPack], reverted, "create", "zh_tw", "block.create.shaft").final).toMatchObject({
      source: "resourcePack",
      value: "High Pack Shaft",
    });
  });

  it("labels converted patches as converted", async () => {
    const id = makeEntryId("create", "zh_cn", "block.create.cog");
    const base = resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog");
    const convertedPatch = await createPatchValue("转换齿轮", base, {
      generatedBy: "converted",
      convertedFromLocale: "zh_hk",
    });
    const project = {
      ...createEmptyProjectPatch(),
      patches: { [id]: convertedPatch },
    };

    expect(resolveEntry(mods, [], project, "create", "zh_cn", "block.create.cog").final).toMatchObject({
      source: "converted",
      sourceLabel: "Converted from zh_hk",
      value: "转换齿轮",
    });
  });

  it("reverts all patches in a namespace", async () => {
    const first = makeEntryId("create", "zh_tw", "block.create.shaft");
    const second = makeEntryId("create", "zh_cn", "block.create.cog");
    const third = makeEntryId("other", "zh_tw", "item.other");
    const patch = await createPatchValue("Manual", { source: "fallback", value: "Base", sourceLabel: "Base" });
    const project = {
      ...createEmptyProjectPatch(),
      patches: { [first]: patch, [second]: patch, [third]: patch },
    };

    const reverted = revertManualNamespace(project, "create");

    expect(reverted.patches[first]).toBeUndefined();
    expect(reverted.patches[second]).toBeUndefined();
    expect(reverted.patches[third]).toBe(patch);
  });

  it("loads old project patches without Phrase Mapping overrides", () => {
    const normalized = normalizeProjectPatch({
      schemaVersion: 1,
      locales: ["zh_cn", "zh_tw", "zh_hk"],
      modFingerprints: [],
      sourcePackOrder: [],
      llmCandidates: {},
      patches: {},
    });

    expect(normalized.phraseMappings).toEqual({});
  });

  it("normalizes Phrase Mapping overrides in project patches", () => {
    const normalized = normalizeProjectPatch({
      schemaVersion: 1,
      locales: ["zh_cn", "zh_tw", "zh_hk"],
      phraseMappings: {
        "curated.block.slab": {
          enabled: false,
          en_us: ["slab", "slab"],
          zh_tw: ["薄板"],
        },
      },
    });

    expect(normalized.phraseMappings["curated.block.slab"]).toMatchObject({
      enabled: false,
      en_us: ["slab"],
      zh_tw: ["薄板"],
    });
  });

  it("exports resolved rows as Minecraft resource pack zip", async () => {
    const project = createEmptyProjectPatch();
    const rows = [
      {
        namespace: "create",
        key: "block.create.shaft",
        english: "Shaft",
        hasEnglish: true,
        entries: {
          zh_cn: resolveEntry(mods, [highPack], project, "create", "zh_cn", "block.create.shaft"),
          zh_tw: resolveEntry(mods, [highPack], project, "create", "zh_tw", "block.create.shaft"),
          zh_hk: resolveEntry(mods, [highPack], project, "create", "zh_hk", "block.create.shaft"),
        },
      },
    ];

    const zip = await JSZip.loadAsync(await (await createResourcePackZip(rows)).arrayBuffer());
    const zhTw = JSON.parse((await zip.file("assets/create/lang/zh_tw.json")!.async("string")) ?? "{}");

    expect(zhTw["block.create.shaft"]).toBe("High Pack Shaft");
    expect(zip.file("pack.mcmeta")).toBeTruthy();
  });
});

function sourcePack(name: string, translations: TranslationMap): SourcePackScanResult {
  return {
    fingerprint: { name, size: 10, sha256: name },
    translations,
    warnings: [],
  };
}
