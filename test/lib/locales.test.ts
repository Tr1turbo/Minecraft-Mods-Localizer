import { describe, expect, it } from "vitest";

import { preferredAppLocale, preferredMinecraftLocale } from "../../src/lib/locales";

describe("locale preferences", () => {
  it("maps browser language tags to bundled Minecraft locales", () => {
    expect(preferredMinecraftLocale(["ja-JP"])).toBe("ja_jp");
    expect(preferredMinecraftLocale(["pt-PT", "en-US"])).toBe("pt_br");
    expect(preferredMinecraftLocale(["zh-Hant-HK"])).toBe("zh_tw");
    expect(preferredMinecraftLocale(["unknown"])).toBe("zh_tw");
  });

  it("uses Traditional Chinese for Chinese app language preferences", () => {
    expect(preferredAppLocale(["zh-TW"])).toBe("zh_tw");
    expect(preferredAppLocale(["en-US"])).toBe("en_us");
  });
});
