export interface MinecraftFormattingState {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  obfuscated?: boolean;
  strikethrough?: boolean;
  underlined?: boolean;
}

export interface MinecraftFormattedSegment extends MinecraftFormattingState {
  text: string;
}

export const MINECRAFT_FORMATTING_COLORS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000aa",
  "2": "#00aa00",
  "3": "#00aaaa",
  "4": "#aa0000",
  "5": "#aa00aa",
  "6": "#ffaa00",
  "7": "#aaaaaa",
  "8": "#555555",
  "9": "#5555ff",
  a: "#55ff55",
  b: "#55ffff",
  c: "#ff5555",
  d: "#ff55ff",
  e: "#ffff55",
  f: "#ffffff",
};

export function parseMinecraftFormatting(value: string): MinecraftFormattedSegment[] {
  const segments: MinecraftFormattedSegment[] = [];
  let state: MinecraftFormattingState = {};
  let text = "";

  function flush() {
    if (!text) {
      return;
    }
    segments.push({ ...state, text });
    text = "";
  }

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "§" || index + 1 >= value.length) {
      text += char;
      continue;
    }

    const code = value[index + 1].toLowerCase();
    const color = MINECRAFT_FORMATTING_COLORS[code];
    if (color) {
      flush();
      state = { color };
      index += 1;
      continue;
    }

    switch (code) {
      case "k":
        flush();
        state = { ...state, obfuscated: true };
        index += 1;
        break;
      case "l":
        flush();
        state = { ...state, bold: true };
        index += 1;
        break;
      case "m":
        flush();
        state = { ...state, strikethrough: true };
        index += 1;
        break;
      case "n":
        flush();
        state = { ...state, underlined: true };
        index += 1;
        break;
      case "o":
        flush();
        state = { ...state, italic: true };
        index += 1;
        break;
      case "r":
        flush();
        state = {};
        index += 1;
        break;
      default:
        text += char;
        break;
    }
  }

  flush();
  return segments;
}
