import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { makeEntryId } from "../../src/lib/entryId";
import { createResourcePackZip } from "../../src/lib/exportPack";
import {
  buildCatalog,
  createEmptyProjectPatch,
  createPatchValue,
  normalizeProjectPatch,
  resolveBaseValue,
  resolveEntry,
  resolveLlmReferenceValues,
  resolveReferenceValuesForKey,
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
    const fallbackChains = {
      zh_tw: ["zh_hk", "en_us"],
    };
    expect(resolveBaseValue(mods, [highPack, lowPack], "create", "zh_tw", "block.create.shaft")).toMatchObject({
      source: "resourcePack",
      value: "High Pack Shaft",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_tw", "block.create.shaft")).toMatchObject({
      source: "jar",
      value: "Jar Shaft",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_tw", "block.create.cog", fallbackChains)).toMatchObject({
      source: "converted",
      value: "港式齒輪",
      sourceLabel: "Converted from zh_hk jar",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_tw", "block.create.cog")).toMatchObject({
      source: "fallback",
      value: "Cogwheel",
      sourceLabel: "en_us jar fallback",
    });
  });

  it("builds bundled minecraft rows as vanilla with implicit en_us target", () => {
    const rows = buildCatalog({ create: { en_us: { "block.create.shaft": "Shaft" } } }, [], createEmptyProjectPatch());
    const oakSlab = rows.find((row) => row.namespace === "minecraft" && row.key === "block.minecraft.oak_slab");

    expect(rows[0].namespace).toBe("minecraft");
    expect(oakSlab).toBeTruthy();
    expect(oakSlab?.sourceLocale).toBe("en_us");
    expect(oakSlab?.sourceValue).toBe("Oak Slab");
    expect(oakSlab?.entries.en_us).toMatchObject({
      locale: "en_us",
      hasSource: true,
      base: {
        source: "vanilla",
        value: "Oak Slab",
        sourceLabel: "Vanilla locale",
      },
      final: {
        source: "vanilla",
        value: "Oak Slab",
      },
    });
  });

  it("lets resource packs and loaded jars override bundled vanilla minecraft values", () => {
    const minecraftMods: TranslationMap = {
      minecraft: {
        en_us: {
          "block.minecraft.oak_slab": "Jar Oak Slab",
        },
      },
    };
    const pack = sourcePack("minecraft-overrides.zip", {
      minecraft: {
        en_us: {
          "block.minecraft.oak_slab": "Pack Oak Slab",
        },
      },
    });

    expect(resolveBaseValue(minecraftMods, [pack], "minecraft", "en_us", "block.minecraft.oak_slab")).toMatchObject({
      source: "resourcePack",
      value: "Pack Oak Slab",
    });
    expect(resolveBaseValue(minecraftMods, [], "minecraft", "en_us", "block.minecraft.oak_slab")).toMatchObject({
      source: "jar",
      value: "Jar Oak Slab",
    });
    expect(resolveBaseValue({}, [], "minecraft", "en_us", "block.minecraft.oak_slab")).toMatchObject({
      source: "vanilla",
      value: "Oak Slab",
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
    const onlyLlm = { manual: false, llm: true, resourcePack: false, jar: false, vanilla: false };
    const jarOnly = { manual: false, llm: false, resourcePack: false, jar: true, vanilla: false };

    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, onlyLlm)).toMatchObject({
      source: "converted",
      value: "LLM 齿轮",
      sourceLabel: "Converted from zh_tw LLM",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, jarOnly)).toMatchObject({
      source: "fallback",
      value: "Cogwheel",
      sourceLabel: "en_us jar fallback",
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
    const onlyManual = { manual: true, llm: false, resourcePack: false, jar: false, vanilla: false };
    const jarOnly = { manual: false, llm: false, resourcePack: false, jar: true, vanilla: false };

    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, onlyManual)).toMatchObject({
      source: "converted",
      value: "Manual 齿轮",
      sourceLabel: "Converted from zh_tw manual",
    });
    expect(resolveBaseValue(mods, [], "create", "zh_cn", "block.create.cog", fallbackChain, [], project, jarOnly)).toMatchObject({
      source: "fallback",
      value: "Cogwheel",
      sourceLabel: "en_us jar fallback",
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
      sourceLabel: "en_us jar fallback",
    });
  });

  it("uses the key as missing-source display text when no fallback source exists", () => {
    const missingSourceMods: TranslationMap = {
      create: {
        zh_tw: {
          "item.create.other": "其他",
        },
      },
    };
    const enUsOnlyFallbacks = {
      zh_cn: ["en_us"],
      zh_tw: ["en_us"],
      zh_hk: ["en_us"],
    };

    expect(resolveBaseValue(missingSourceMods, [], "create", "zh_hk", "item.create.only_target", enUsOnlyFallbacks)).toMatchObject({
      source: "missing",
      value: "item.create.only_target",
      sourceLabel: "missing source",
    });
    expect(resolveEntry(missingSourceMods, [], createEmptyProjectPatch(), "create", "zh_hk", "item.create.only_target", enUsOnlyFallbacks)).toMatchObject({
      sourceValue: "item.create.only_target",
      hasSource: false,
    });
  });

  it("marks existing non-fallback locales as missing when en_us is missing", () => {
    const translatedOnlyMods: TranslationMap = {
      create: {
        fr_fr: {
          "item.create.only_fr": "Arbre",
        },
      },
    };

    expect(resolveEntry(translatedOnlyMods, [], createEmptyProjectPatch(), "create", "ja_jp", "item.create.only_fr", {})).toMatchObject({
      sourceLocale: "",
      sourceValue: "item.create.only_fr",
      hasSource: false,
      base: {
        source: "missing",
        value: "item.create.only_fr",
        sourceLabel: "missing source",
      },
    });
  });

  it("uses explicitly configured fallback locales as translation source", () => {
    const translatedOnlyMods: TranslationMap = {
      create: {
        fr_fr: {
          "item.create.only_fr": "Arbre",
        },
      },
    };

    expect(resolveEntry(translatedOnlyMods, [], createEmptyProjectPatch(), "create", "ja_jp", "item.create.only_fr", { ja_jp: ["fr_fr"] })).toMatchObject({
      sourceLocale: "fr_fr",
      sourceValue: "Arbre",
      hasSource: true,
      base: {
        source: "fallback",
        value: "Arbre",
        sourceLabel: "fr_fr jar fallback",
      },
    });
  });

  it("selects LLM references by en_us, fallback, or all valid values", () => {
    const referenceMods: TranslationMap = {
      create: {
        es_ar: {
          "item.create.example": "Ejemplo",
        },
        fr_fr: {
          "item.create.example": "Exemple",
        },
      },
    };
    const fallbackChains = { zh_tw: ["fr_fr"] };

    expect(resolveLlmReferenceValues(referenceMods, [], undefined, "create", "zh_tw", "item.create.example", fallbackChains, undefined, "en_us")).toEqual([
      {
        locale: "fr_fr",
        source: "jar",
        sourceLabel: "fr_fr jar",
        value: "Exemple",
      },
    ]);
    expect(resolveLlmReferenceValues(referenceMods, [], undefined, "create", "zh_tw", "item.create.example", fallbackChains, undefined, "fallback")).toEqual([
      {
        locale: "fr_fr",
        source: "jar",
        sourceLabel: "fr_fr jar",
        value: "Exemple",
      },
    ]);
    expect(resolveLlmReferenceValues(referenceMods, [], undefined, "create", "zh_tw", "item.create.example", fallbackChains, undefined, "all")).toEqual([
      {
        locale: "fr_fr",
        source: "jar",
        sourceLabel: "fr_fr jar",
        value: "Exemple",
      },
      {
        locale: "es_ar",
        source: "jar",
        sourceLabel: "es_ar jar",
        value: "Ejemplo",
      },
    ]);
  });

  it("collects all concrete per-key reference values without treating them as fallback sources", async () => {
    const referenceMods: TranslationMap = {
      create: {
        es_ar: {
          "item.create.example": "Ejemplo",
        },
        en_us: {
          "item.create.other": "Other",
        },
      },
    };
    const pack = sourcePack("references.zip", {
      create: {
        fr_fr: {
          "item.create.example": "Exemple",
        },
      },
    });
    const patch = await createPatchValue("繁體範例", { source: "missing", value: "item.create.example", sourceLabel: "missing source" });
    const project = {
      ...createEmptyProjectPatch(),
      patches: {
        [makeEntryId("create", "zh_tw", "item.create.example")]: patch,
      },
    };

    expect(resolveReferenceValuesForKey(referenceMods, [pack], project, "create", "item.create.example").map(({ locale, source, value }) => ({ locale, source, value }))).toEqual([
      { locale: "es_ar", source: "jar", value: "Ejemplo" },
      { locale: "fr_fr", source: "resourcePack", value: "Exemple" },
      { locale: "zh_tw", source: "manual", value: "繁體範例" },
    ]);
    expect(resolveEntry(referenceMods, [], createEmptyProjectPatch(), "create", "zh_hk", "item.create.example", { zh_hk: ["zh_tw", "en_us"] })).toMatchObject({
      hasSource: false,
      base: {
        source: "missing",
      },
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

  it("loads old project patches without Glossary overrides", () => {
    const normalized = normalizeProjectPatch({
      schemaVersion: 1,
      locales: ["zh_cn", "zh_tw", "zh_hk"],
      modFingerprints: [],
      sourcePackOrder: [],
      llmCandidates: {},
      patches: {},
    });

    expect(normalized.glossary).toEqual({});
    expect(normalized.schemaVersion).toBe(3);
    expect(normalized.locales).toEqual(["zh_cn", "zh_tw", "zh_hk"]);
    expect(normalized.sourceLocalePriority).toEqual([]);
  });

  it("uses default Chinese fallback chains when project patches omit them", () => {
    const normalized = normalizeProjectPatch({
      schemaVersion: 2,
      locales: ["zh_tw", "zh_cn", "zh_hk"],
    });

    expect(normalized.fallbackChains).toEqual({
      zh_tw: ["zh_hk", "zh_cn", "en_us"],
      zh_cn: ["zh_hk", "zh_tw", "en_us"],
      zh_hk: ["zh_tw", "zh_cn", "en_us"],
    });
  });

  it("normalizes Glossary overrides in project patches", () => {
    const normalized = normalizeProjectPatch({
      schemaVersion: 1,
      locales: ["zh_cn", "zh_tw", "zh_hk"],
      glossary: {
        "curated.block.slab": {
          enabled: false,
          en_us: ["slab", "slab"],
          zh_tw: ["薄板"],
        },
      },
    });

    expect(normalized.glossary["curated.block.slab"]).toMatchObject({
      enabled: false,
      terms: {
        en_us: ["slab"],
        zh_tw: ["薄板"],
      },
    });
  });

  it("exports resolved rows as Minecraft resource pack zip", async () => {
    const project = createEmptyProjectPatch();
    const rows = [
      {
        namespace: "create",
        key: "block.create.shaft",
        sourceLocale: "en_us",
        sourceValue: "Shaft",
        hasSource: true,
        entries: {
          zh_cn: resolveEntry(mods, [highPack], project, "create", "zh_cn", "block.create.shaft"),
          zh_tw: resolveEntry(mods, [highPack], project, "create", "zh_tw", "block.create.shaft"),
          zh_hk: resolveEntry(mods, [highPack], project, "create", "zh_hk", "block.create.shaft"),
        },
      },
    ];

    const zip = await JSZip.loadAsync(await (await createResourcePackZip(rows, ["zh_tw"])).arrayBuffer());
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
