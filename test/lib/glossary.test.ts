import { describe, expect, it } from "vitest";

import curatedGlossary from "../../data/curatedGlossary.json";
import {
  BUILTIN_GLOSSARY,
  INTERNAL_VANILLA_GLOSSARY,
  compactVanillaGlossaryEntriesForDisplay,
  effectiveGlossaryEntries,
  glossaryDictionaryForConversion,
  normalizeGlossaryOverrides,
  glossaryWithInternalVanilla,
  selectGlossaryEntries,
  selectGlossaryEntriesForReference,
} from "../../src/lib/glossary";

describe("glossary", () => {
  it("keeps vanilla locale entries internal and ships category-based curated entries", () => {
    const ids = BUILTIN_GLOSSARY.map((entry) => entry.id);
    const internalIds = INTERNAL_VANILLA_GLOSSARY.map((entry) => entry.id);
    const oakSlab = INTERNAL_VANILLA_GLOSSARY.find((entry) => entry.id === "block.minecraft.oak_slab");

    expect(ids).toEqual([...ids].sort((first, second) => first.localeCompare(second)));
    expect(curatedGlossary.every((entry) => entry.source === "curated")).toBe(true);
    expect(ids.some((id) => id.startsWith("vanilla.full."))).toBe(false);
    expect(internalIds).toContain("block.minecraft.oak_slab");
    expect(internalIds).toContain("block.minecraft.potatoes");
    expect(internalIds).toContain("biome.minecraft.badlands");
    expect(oakSlab?.terms.en_us).toEqual(["Oak Slab"]);
    expect(oakSlab?.terms.fr_fr?.[0]).toEqual(expect.any(String));
    expect(oakSlab?.terms.ja_jp?.[0]).toEqual(expect.any(String));
    expect(oakSlab?.terms.ko_kr?.[0]).toEqual(expect.any(String));
    expect(oakSlab?.terms.ru_ru?.[0]).toEqual(expect.any(String));
    expect(internalIds.some((id) => id.startsWith("vanilla.full."))).toBe(false);
    expect(internalIds.some((id) => id.includes("advancements."))).toBe(false);
    expect(ids.some((id) => id.startsWith("curated.standard."))).toBe(false);
    expect(BUILTIN_GLOSSARY.find((entry) => entry.id === "curated.item.potato")).toMatchObject({
      terms: {
        en_us: ["potato", "potatoes"],
        zh_cn: ["马铃薯", "土豆"],
        zh_tw: ["馬鈴薯"],
        zh_hk: ["薯仔"],
      },
    });
    expect(BUILTIN_GLOSSARY.find((entry) => entry.id === "curated.entity.ender_pearl")).toBeUndefined();
    expect(BUILTIN_GLOSSARY.find((entry) => entry.id === "curated.item.ender_pearl")).toBeUndefined();
    expect(internalIds).toContain("item.minecraft.ender_pearl");
    expect(
      normalizeGlossaryOverrides({
        "vanilla.full.block.minecraft.oak_slab": { enabled: false },
        "block.minecraft.oak_slab": { enabled: false },
        "curated.block.slab": { enabled: false },
      }),
    ).toEqual({
      "curated.block.slab": { enabled: false },
    });
    expect(effectiveGlossaryEntries({ "curated.block.slab": { source: "vanilla" } }).find((entry) => entry.id === "curated.block.slab")).toMatchObject({
      source: "curated",
    });
  });

  it("selects only hint entries matching the source value", () => {
    const entries = effectiveGlossaryEntries({
      "custom.engine": {
        enabled: true,
        source: "custom",
        en_us: ["engine"],
        zh_cn: ["引擎"],
        zh_tw: ["引擎"],
        zh_hk: ["引擎"],
      },
    });
    const runtimeGlossary = glossaryWithInternalVanilla(entries);

    const oakSlab = selectGlossaryEntries([{ key: "block.test.oak_slab", locale: "en_us", value: "Oak Slab" }], runtimeGlossary);
    expect(oakSlab.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["curated.block.slab", "block.minecraft.oak_slab"]),
    );

    const engine = selectGlossaryEntries([{ key: "block.test.engine", locale: "en_us", value: "Copper Engine" }], runtimeGlossary);
    expect(engine.map((entry) => entry.id)).toEqual(expect.arrayContaining(["custom.engine", "curated.item.copper"]));
    expect(engine.map((entry) => entry.id)).not.toContain("curated.item.potion");

    const redstone = selectGlossaryEntries([{ key: "block.test.redstone_machine", locale: "en_us", value: "Redstone Machine" }], runtimeGlossary);
    expect(redstone.map((entry) => entry.id)).not.toContain("block.minecraft.stone");
    expect(redstone.map((entry) => entry.id)).not.toContain("item.minecraft.redstone");

    const keyOnlyGlossary = selectGlossaryEntries([{ key: "block.test.engine", locale: "en_us", value: "Copper Machine" }], runtimeGlossary);
    expect(keyOnlyGlossary.map((entry) => entry.id)).not.toContain("custom.engine");

    const referenceMatches = selectGlossaryEntriesForReference(
      { key: "block.test.oak_slab", locale: "zh_tw", value: "橡木半磚" },
      runtimeGlossary,
    );
    expect(referenceMatches.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["curated.block.slab", "block.minecraft.oak_slab"]),
    );

    const keyOnlyReferenceMatches = selectGlossaryEntriesForReference(
      { key: "tag.item.c.dyes.black", locale: "en_us", value: "Black Dyes" },
      runtimeGlossary,
    );
    expect(keyOnlyReferenceMatches.map((entry) => entry.id)).not.toContain("entity.minecraft.item");

    const emptyAndesiteMatches = selectGlossaryEntriesForReference(
      { key: "block.create_power_loader.empty_andesite_chunk_loader", locale: "en_us", value: "Empty Andesite Chunk Loader" },
      runtimeGlossary,
    );
    expect(emptyAndesiteMatches.map((entry) => entry.id)).toContain("block.minecraft.andesite");
    expect(emptyAndesiteMatches.map((entry) => entry.id)).not.toContain("item.minecraft.potion.effect.empty");
    expect(emptyAndesiteMatches.map((entry) => entry.id)).not.toContain("item.minecraft.lingering_potion.effect.empty");

    const japaneseDebugHintMatches = selectGlossaryEntriesForReference(
      { key: "debugify.option.food_stats", locale: "ja_jp", value: "有効な場合、デバッグ画面で空腹度・満腹度・疲労度を表示します" },
      runtimeGlossary,
    );
    expect(japaneseDebugHintMatches.map((entry) => entry.id)).toContain("effect.minecraft.hunger");
    expect(japaneseDebugHintMatches.map((entry) => entry.id)).not.toContain("effect.minecraft.mining_fatigue");
    expect(japaneseDebugHintMatches.map((entry) => entry.id)).not.toContain("entity.minecraft.painting");
    expect(japaneseDebugHintMatches.map((entry) => entry.id)).not.toContain("item.minecraft.painting");
  });

  it("caches conversion dictionaries per glossary array and direction", () => {
    const runtimeGlossary = glossaryWithInternalVanilla(effectiveGlossaryEntries());
    const first = glossaryDictionaryForConversion(runtimeGlossary, "zh_cn", "zh_tw");

    expect(glossaryDictionaryForConversion(runtimeGlossary, "zh_cn", "zh_tw")).toBe(first);
    expect(glossaryDictionaryForConversion(runtimeGlossary, "zh_tw", "zh_cn")).not.toBe(first);
  });

  it("matches longer vanilla phrases first while keeping curated and custom word matches", () => {
    const runtimeGlossary = glossaryWithInternalVanilla(
      effectiveGlossaryEntries({
        "custom.lantern": {
          enabled: true,
          source: "custom",
          en_us: ["lantern"],
          zh_tw: ["燈籠"],
        },
      }),
    );
    const matches = selectGlossaryEntriesForReference(
      { key: "block.test.waxed_exposed_copper_lantern", locale: "en_us", value: "Waxed Exposed Copper Lantern" },
      runtimeGlossary,
      80,
    );
    const ids = matches.map((entry) => entry.id);

    expect(ids).toContain("block.minecraft.waxed_exposed_copper_lantern");
    expect(ids).toContain("custom.lantern");
    expect(ids).toContain("curated.item.copper");
    expect(ids).not.toContain("block.minecraft.exposed_copper_lantern");
    expect(ids).not.toContain("block.minecraft.copper_lantern");
    expect(ids).not.toContain("block.minecraft.lantern");
  });

  it("compacts same-object vanilla Glossary hints across tags", () => {
    const runtimeGlossary = glossaryWithInternalVanilla(effectiveGlossaryEntries());
    const matches = selectGlossaryEntriesForReference(
      { key: "test.lingering_potion", locale: "en_us", value: "Lingering Potion" },
      runtimeGlossary,
      40,
    );

    const compact = compactVanillaGlossaryEntriesForDisplay(matches, ["en_us", "zh_tw"]);
    const potion = compact.find((entry) => entry.displayId === "minecraft.lingering_potion");

    expect(potion).toMatchObject({
      source: "vanilla",
      tags: ["entity", "item"],
      hiddenIds: [],
      allIds: ["entity.minecraft.lingering_potion", "item.minecraft.lingering_potion"],
    });
  });

  it("compacts same-value vanilla Glossary hints with a hidden id count", () => {
    const runtimeGlossary = glossaryWithInternalVanilla(effectiveGlossaryEntries());
    const matches = selectGlossaryEntriesForReference(
      { key: "test.music_disc", locale: "en_us", value: "Music Disc" },
      runtimeGlossary,
      80,
    );

    const compact = compactVanillaGlossaryEntriesForDisplay(matches, ["en_us", "zh_tw"]);
    const musicDisc = compact.find((entry) => entry.displayId === "minecraft.music_disc_5");

    expect(musicDisc).toMatchObject({
      source: "vanilla",
      tags: ["item"],
    });
    expect(musicDisc?.hiddenIds).toHaveLength(20);
    expect(musicDisc?.allIds).toContain("item.minecraft.music_disc_11");
    expect(compact.filter((entry) => entry.terms.en_us?.[0] === "Music Disc")).toHaveLength(1);
  });

  it("does not compact curated entries or vanilla entries with different displayed terms", () => {
    const compactCurated = compactVanillaGlossaryEntriesForDisplay(
      [
        {
          id: "curated.first",
          enabled: true,
          source: "curated",
          terms: { en_us: ["Music Disc"], zh_tw: ["唱片"] },
        },
        {
          id: "curated.second",
          enabled: true,
          source: "curated",
          terms: { en_us: ["Music Disc"], zh_tw: ["唱片"] },
        },
      ],
      ["en_us", "zh_tw"],
    );
    const compactDifferentTerms = compactVanillaGlossaryEntriesForDisplay(
      [
        {
          id: "entity.minecraft.test_object",
          enabled: true,
          source: "vanilla",
          terms: { en_us: ["Test Object"], zh_tw: ["測試實體"] },
        },
        {
          id: "item.minecraft.test_object",
          enabled: true,
          source: "vanilla",
          terms: { en_us: ["Test Object"], zh_tw: ["測試物品"] },
        },
      ],
      ["en_us", "zh_tw"],
    );

    expect(compactCurated.map((entry) => entry.id)).toEqual(["curated.first", "curated.second"]);
    expect(compactDifferentTerms.map((entry) => entry.id)).toEqual(["entity.minecraft.test_object", "item.minecraft.test_object"]);
  });
});
