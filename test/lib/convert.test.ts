import { describe, expect, it } from "vitest";

import { convertChineseLocale } from "../../src/lib/convert";
import { effectivePhraseMappings } from "../../src/lib/phraseMappings";

describe("Chinese locale conversion", () => {
  it("converts between Simplified, Taiwan Traditional, and Hong Kong Traditional", () => {
    expect(convertChineseLocale("汉语", "zh_cn", "zh_tw")).toBe("漢語");
    expect(convertChineseLocale("漢語", "zh_tw", "zh_cn")).toBe("汉语");
    expect(convertChineseLocale("汉语", "zh_cn", "zh_hk")).toBe("漢語");
  });

  it("uses Taiwan phrase conversion in both directions", () => {
    expect(convertChineseLocale("自行车", "zh_cn", "zh_tw")).toBe("腳踏車");
    expect(convertChineseLocale("腳踏車", "zh_tw", "zh_cn")).toBe("自行车");
  });

  it("applies Phrase Mapping through OpenCC conversion", () => {
    expect(convertChineseLocale("台阶", "zh_cn", "zh_tw")).toBe("半磚");
    expect(convertChineseLocale("楼梯", "zh_cn", "zh_tw")).toBe("階梯");
    expect(convertChineseLocale("用固定式土豆加农炮击杀一只幻翼", "zh_cn", "zh_tw")).toBe(
      "用固定式馬鈴薯加農炮擊殺一隻夜魅",
    );
    expect(convertChineseLocale("馬鈴薯加農炮", "zh_tw", "zh_cn")).toBe("马铃薯加农炮");
    expect(convertChineseLocale("土豆加农炮", "zh_cn", "zh_hk")).toBe("薯仔加農炮");
    expect(convertChineseLocale("馬鈴薯加農炮", "zh_hk", "zh_tw")).toBe("馬鈴薯加農炮");
    expect(convertChineseLocale("末影珍珠", "zh_cn", "zh_tw")).toBe("終界珍珠");
  });

  it("excludes disabled mappings and lets project overrides win", () => {
    const disabledPotato = effectivePhraseMappings({
      "curated.item.potato": { enabled: false },
    });
    const overriddenSlab = effectivePhraseMappings({
      "curated.block.slab": { zh_tw: ["薄板"] },
    });

    expect(convertChineseLocale("土豆加农炮", "zh_cn", "zh_tw", disabledPotato)).toBe("土豆加農炮");
    expect(convertChineseLocale("台阶", "zh_cn", "zh_tw", overriddenSlab)).toBe("薄板");
  });
});
