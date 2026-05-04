import { describe, expect, it } from "vitest";

import { translate } from "../../src/app/i18n";
import enUs from "../../src/app/locales/en_us.json";
import zhTw from "../../src/app/locales/zh_tw.json";

describe("i18n", () => {
  it("loads app dictionaries from local JSON assets", () => {
    expect(enUs.Project).toBe("Project");
    expect(zhTw.Project).toBe("專案");
    expect(translate("zh_tw", "Project")).toBe(zhTw.Project);
  });

  it("translates known zh-TW strings and interpolates values", () => {
    expect(translate("zh_tw", "Project")).toBe("專案");
    expect(translate("zh_tw", "{count} selected", { count: 3 })).toBe("已選 3 個");
  });

  it("falls back to the source string for missing keys", () => {
    expect(translate("zh_tw", "Untranslated key")).toBe("Untranslated key");
    expect(translate("en_us", "Project")).toBe("Project");
  });
});
