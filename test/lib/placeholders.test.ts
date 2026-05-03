import { describe, expect, it } from "vitest";

import {
  placeholderSignature,
  placeholderWarnings,
  protectedTokenSignature,
  protectedTokenWarnings,
  protectedTokensMatch,
} from "../../src/lib/placeholders";

describe("placeholders", () => {
  it("does not classify Minecraft section sign formatting codes as placeholders", () => {
    expect(placeholderSignature("§6Gold: %s")).toEqual(["%s"]);
    expect(placeholderWarnings("§6Gold", "Gold")).toEqual([]);
  });

  it("ignores Minecraft section sign formatting codes in protected tokens by default", () => {
    expect(protectedTokenSignature("§6Gold: %s\\n")).toEqual(["escape:\\n", "placeholder:%s"]);
    expect(protectedTokensMatch("§6Gold", "Gold")).toBe(true);
    expect(protectedTokenWarnings("§6Gold", "Gold")).toEqual([]);
  });

  it("can opt into formatting code mismatch warnings", () => {
    const options = { includeFormattingCodes: true };

    expect(protectedTokenSignature("§6Gold: %s\\n", options)).toEqual(["escape:\\n", "formatting code:§6", "placeholder:%s"]);
    expect(protectedTokensMatch("§6Gold", "§6黃金")).toBe(true);
    expect(protectedTokensMatch("§6Gold", "Gold", options)).toBe(false);
    expect(protectedTokenWarnings("§6Gold", "Gold", options)).toEqual([
      "Protected token mismatch. Source: formatting code §6; value: none",
    ]);
  });
});
