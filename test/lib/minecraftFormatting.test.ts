import { describe, expect, it } from "vitest";

import { parseMinecraftFormatting } from "../../src/lib/minecraftFormatting";

describe("minecraft formatting", () => {
  it("parses section sign color and style codes into render segments", () => {
    expect(parseMinecraftFormatting("§6Gold §lBold§r Plain")).toEqual([
      { color: "#ffaa00", text: "Gold " },
      { color: "#ffaa00", bold: true, text: "Bold" },
      { text: " Plain" },
    ]);
  });

  it("resets active styles when a color code is applied", () => {
    expect(parseMinecraftFormatting("§lBold §cRed")).toEqual([
      { bold: true, text: "Bold " },
      { color: "#ff5555", text: "Red" },
    ]);
  });

  it("supports underline, strikethrough, italic, obfuscated, uppercase, and reset codes", () => {
    expect(parseMinecraftFormatting("§NUnder §mStrike §OItalic §KMagic§R Reset")).toEqual([
      { underlined: true, text: "Under " },
      { underlined: true, strikethrough: true, text: "Strike " },
      { underlined: true, strikethrough: true, italic: true, text: "Italic " },
      { underlined: true, strikethrough: true, italic: true, obfuscated: true, text: "Magic" },
      { text: " Reset" },
    ]);
  });

  it("renders unknown section sign sequences literally", () => {
    expect(parseMinecraftFormatting("Use §z literally")).toEqual([{ text: "Use §z literally" }]);
  });
});
