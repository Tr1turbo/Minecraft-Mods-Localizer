import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { parseMinecraftFormatting, type MinecraftFormattedSegment } from "../../lib/minecraftFormatting";

const OBFUSCATED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?#$%&";

export function MinecraftFormattedText({ value, fallback = "None" }: { value: string; fallback?: string }) {
  const segments = useMemo(() => parseMinecraftFormatting(value), [value]);
  const hasObfuscatedText = segments.some((segment) => segment.obfuscated);
  const [obfuscationTick, setObfuscationTick] = useState(0);

  useEffect(() => {
    if (!hasObfuscatedText) {
      return undefined;
    }
    const interval = window.setInterval(() => setObfuscationTick((tick) => tick + 1), 120);
    return () => window.clearInterval(interval);
  }, [hasObfuscatedText]);

  if (!segments.length) {
    return <>{fallback}</>;
  }

  return (
    <>
      {segments.map((segment, index) => (
        <span className={segment.obfuscated ? "minecraftFormattedSegment obfuscated" : "minecraftFormattedSegment"} key={index} style={styleForSegment(segment)}>
          {segment.obfuscated ? obfuscateText(segment.text, obfuscationTick + index) : segment.text}
        </span>
      ))}
    </>
  );
}

function styleForSegment(segment: MinecraftFormattedSegment): CSSProperties {
  const textDecorationLine = [
    segment.underlined ? "underline" : "",
    segment.strikethrough ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    color: segment.color,
    fontStyle: segment.italic ? "italic" : undefined,
    fontWeight: segment.bold ? 700 : undefined,
    textDecorationLine: textDecorationLine || undefined,
  };
}

function obfuscateText(text: string, tick: number): string {
  return Array.from(text)
    .map((char, index) => {
      if (/\s/.test(char)) {
        return char;
      }
      return OBFUSCATED_CHARS[(char.charCodeAt(0) + tick + index * 7) % OBFUSCATED_CHARS.length];
    })
    .join("");
}
