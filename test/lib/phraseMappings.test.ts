import { describe, expect, it } from "vitest";

import curatedPhraseMappings from "../../data/curatedPhraseMappings.json";
import {
  BUILTIN_PHRASE_MAPPINGS,
  INTERNAL_VANILLA_PHRASE_MAPPINGS,
  effectivePhraseMappings,
  phraseDictionaryForConversion,
  normalizePhraseMappingOverrides,
  phraseMappingsWithInternalVanilla,
  selectPhraseGlossary,
  selectPhraseMappingsForReference,
} from "../../src/lib/phraseMappings";

describe("phrase mappings", () => {
  it("keeps vanilla locale mappings internal and ships category-based curated mappings", () => {
    const ids = BUILTIN_PHRASE_MAPPINGS.map((mapping) => mapping.id);
    const internalIds = INTERNAL_VANILLA_PHRASE_MAPPINGS.map((mapping) => mapping.id);

    expect(ids).toEqual([...ids].sort((first, second) => first.localeCompare(second)));
    expect(curatedPhraseMappings.every((mapping) => mapping.source === "curated")).toBe(true);
    expect(ids.some((id) => id.startsWith("vanilla.full."))).toBe(false);
    expect(internalIds).toContain("block.minecraft.oak_slab");
    expect(internalIds).toContain("block.minecraft.potatoes");
    expect(internalIds).toContain("biome.minecraft.badlands");
    expect(internalIds.some((id) => id.startsWith("vanilla.full."))).toBe(false);
    expect(internalIds.some((id) => id.includes("advancements."))).toBe(false);
    expect(ids.some((id) => id.startsWith("curated.standard."))).toBe(false);
    expect(BUILTIN_PHRASE_MAPPINGS.find((mapping) => mapping.id === "curated.item.potato")).toMatchObject({
      en_us: ["potato", "potatoes"],
      zh_cn: ["马铃薯", "土豆"],
      zh_tw: ["馬鈴薯"],
      zh_hk: ["薯仔"],
    });
    expect(BUILTIN_PHRASE_MAPPINGS.find((mapping) => mapping.id === "curated.entity.ender_pearl")).toBeUndefined();
    expect(BUILTIN_PHRASE_MAPPINGS.find((mapping) => mapping.id === "curated.item.ender_pearl")).toBeUndefined();
    expect(internalIds).toContain("item.minecraft.ender_pearl");
    expect(
      normalizePhraseMappingOverrides({
        "vanilla.full.block.minecraft.oak_slab": { enabled: false },
        "block.minecraft.oak_slab": { enabled: false },
        "curated.block.slab": { enabled: false },
      }),
    ).toEqual({
      "curated.block.slab": { enabled: false },
    });
    expect(effectivePhraseMappings({ "curated.block.slab": { source: "vanilla" } }).find((mapping) => mapping.id === "curated.block.slab")).toMatchObject({
      source: "curated",
    });
  });

  it("selects only hint entries matching the source value", () => {
    const mappings = effectivePhraseMappings({
      "custom.engine": {
        enabled: true,
        source: "custom",
        en_us: ["engine"],
        zh_cn: ["引擎"],
        zh_tw: ["引擎"],
        zh_hk: ["引擎"],
      },
    });
    const runtimeMappings = phraseMappingsWithInternalVanilla(mappings);

    const oakSlab = selectPhraseGlossary([{ key: "block.test.oak_slab", english: "Oak Slab" }], runtimeMappings);
    expect(oakSlab.map((mapping) => mapping.id)).toEqual(
      expect.arrayContaining(["curated.block.slab", "block.minecraft.oak_slab"]),
    );

    const engine = selectPhraseGlossary([{ key: "block.test.engine", english: "Copper Engine" }], runtimeMappings);
    expect(engine.map((mapping) => mapping.id)).toEqual(expect.arrayContaining(["custom.engine", "curated.item.copper"]));
    expect(engine.map((mapping) => mapping.id)).not.toContain("curated.item.potion");

    const redstone = selectPhraseGlossary([{ key: "block.test.redstone_machine", english: "Redstone Machine" }], runtimeMappings);
    expect(redstone.map((mapping) => mapping.id)).not.toContain("block.minecraft.stone");
    expect(redstone.map((mapping) => mapping.id)).not.toContain("item.minecraft.redstone");

    const keyOnlyGlossary = selectPhraseGlossary([{ key: "block.test.engine", english: "Copper Machine" }], runtimeMappings);
    expect(keyOnlyGlossary.map((mapping) => mapping.id)).not.toContain("custom.engine");

    const referenceMatches = selectPhraseMappingsForReference(
      { key: "block.test.oak_slab", value: "橡木半磚" },
      runtimeMappings,
    );
    expect(referenceMatches.map((mapping) => mapping.id)).toEqual(
      expect.arrayContaining(["curated.block.slab", "block.minecraft.oak_slab"]),
    );

    const keyOnlyReferenceMatches = selectPhraseMappingsForReference(
      { key: "tag.item.c.dyes.black", value: "Black Dyes" },
      runtimeMappings,
    );
    expect(keyOnlyReferenceMatches.map((mapping) => mapping.id)).not.toContain("entity.minecraft.item");

    const emptyAndesiteMatches = selectPhraseMappingsForReference(
      { key: "block.create_power_loader.empty_andesite_chunk_loader", value: "Empty Andesite Chunk Loader" },
      runtimeMappings,
    );
    expect(emptyAndesiteMatches.map((mapping) => mapping.id)).toContain("block.minecraft.andesite");
    expect(emptyAndesiteMatches.map((mapping) => mapping.id)).not.toContain("item.minecraft.potion.effect.empty");
    expect(emptyAndesiteMatches.map((mapping) => mapping.id)).not.toContain("item.minecraft.lingering_potion.effect.empty");
  });

  it("caches conversion dictionaries per mapping array and direction", () => {
    const runtimeMappings = phraseMappingsWithInternalVanilla(effectivePhraseMappings());
    const first = phraseDictionaryForConversion(runtimeMappings, "zh_cn", "zh_tw");

    expect(phraseDictionaryForConversion(runtimeMappings, "zh_cn", "zh_tw")).toBe(first);
    expect(phraseDictionaryForConversion(runtimeMappings, "zh_tw", "zh_cn")).not.toBe(first);
  });
});
