import { describe, expect, it } from "vitest";

import { nextAnimatedDraftText } from "../../src/app/helpers";

describe("app helpers", () => {
  describe("nextAnimatedDraftText", () => {
    it("advances toward a target one character at a time", () => {
      expect(nextAnimatedDraftText("", "Craft")).toBe("C");
      expect(nextAnimatedDraftText("C", "Craft")).toBe("Cr");
      expect(nextAnimatedDraftText("Craf", "Craft")).toBe("Craft");
    });

    it("keeps Unicode code points intact", () => {
      expect(nextAnimatedDraftText("", "礦石😀")).toBe("礦");
      expect(nextAnimatedDraftText("礦石", "礦石😀")).toBe("礦石😀");
    });

    it("returns an empty string for empty targets", () => {
      expect(nextAnimatedDraftText("Draft", "")).toBe("");
    });

    it("leaves equal visible and target text unchanged", () => {
      expect(nextAnimatedDraftText("完成", "完成")).toBe("完成");
    });

    it("recovers from non-prefix text by returning the next target prefix", () => {
      expect(nextAnimatedDraftText("abc", "axyz")).toBe("ax");
      expect(nextAnimatedDraftText("stale", "新值")).toBe("新");
    });
  });
});
