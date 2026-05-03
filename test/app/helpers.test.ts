import { describe, expect, it } from "vitest";

import {
  animatedDraftTextAtElapsed,
  draftAnimationDurationMs,
  draftTargetDeltaCharCount,
} from "../../src/app/helpers";

describe("app helpers", () => {
  describe("draftAnimationDurationMs", () => {
    it("uses a base time plus time per chunk character", () => {
      expect(draftAnimationDurationMs(0)).toBe(10);
      expect(draftAnimationDurationMs(8)).toBe(14);
      expect(draftAnimationDurationMs(20)).toBe(20);
    });

    it("clamps negative character counts to the base time", () => {
      expect(draftAnimationDurationMs(-4)).toBe(10);
    });

    it("uses the base time for completed text", () => {
      expect(draftAnimationDurationMs(40, { complete: true })).toBe(10);
    });
  });

  describe("draftTargetDeltaCharCount", () => {
    it("counts only new target characters for prefix updates", () => {
      expect(draftTargetDeltaCharCount("Craft", "Crafting")).toBe(3);
    });

    it("keeps Unicode code points intact", () => {
      expect(draftTargetDeltaCharCount("礦石", "礦石😀")).toBe(1);
    });

    it("uses the unmatched target tail for non-prefix recovery", () => {
      expect(draftTargetDeltaCharCount("abc", "axyz")).toBe(3);
      expect(draftTargetDeltaCharCount("stale", "新值")).toBe(2);
    });
  });

  describe("animatedDraftTextAtElapsed", () => {
    it("reveals text according to elapsed frame time", () => {
      const duration = draftAnimationDurationMs(10);

      expect(animatedDraftTextAtElapsed("", "abcdefghij", 0, duration)).toBe("");
      expect(animatedDraftTextAtElapsed("", "abcdefghij", duration / 2, duration)).toBe("abcde");
      expect(animatedDraftTextAtElapsed("", "abcdefghij", duration, duration)).toBe("abcdefghij");
    });

    it("can reveal multiple characters in one frame", () => {
      const duration = draftAnimationDurationMs(10);

      expect(animatedDraftTextAtElapsed("", "abcdefghij", 12, duration)).toBe("abcdefgh");
    });

    it("keeps Unicode code points intact", () => {
      const target = "礦石😀abc";
      const duration = draftAnimationDurationMs(Array.from(target).length);

      expect(animatedDraftTextAtElapsed("", target, duration / 2, duration)).toBe("礦石😀");
    });

    it("handles empty and equal targets", () => {
      expect(animatedDraftTextAtElapsed("Draft", "", 5, 10)).toBe("");
      expect(animatedDraftTextAtElapsed("完成", "完成", 5, 10)).toBe("完成");
    });

    it("recovers from non-prefix text over the animation duration", () => {
      expect(animatedDraftTextAtElapsed("abc", "axyz", 5, 10)).toBe("axy");
      expect(animatedDraftTextAtElapsed("stale", "新值", 5, 10)).toBe("新");
    });
  });
});
