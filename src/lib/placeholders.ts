type ProtectedTokenKind = "placeholder" | "escape" | "formatting code" | "tag";

interface ProtectedToken {
  kind: ProtectedTokenKind;
  value: string;
}

interface ProtectedTokenOptions {
  includeFormattingCodes?: boolean;
}

const PLACEHOLDER_RE = /%(\d+\$)?[0-9.+\-# ]*[bcdeEfgGosxXaA%]|\{\}|\{[^{}\s]+\}/g;
const PROTECTED_TOKEN_RE =
  /%(\d+\$)?[0-9.+\-# ]*[bcdeEfgGosxXaA%]|\\[nrt]|§[0-9A-Za-z]|<[^>\s]+>|<\/[^>\s]+>|\{\}|\{[^{}\s]+\}/g;

export function placeholderSignature(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER_RE)].map((match) => match[0]).sort();
}

export function placeholdersMatch(sourceValue: string, translatedValue: string): boolean {
  const source = placeholderSignature(sourceValue);
  const translated = placeholderSignature(translatedValue);
  return source.length === translated.length && source.every((value, index) => value === translated[index]);
}

export function placeholderWarnings(sourceValue: string, translatedValue: string): string[] {
  if (placeholdersMatch(sourceValue, translatedValue)) {
    return [];
  }
  return [
    `Placeholder mismatch. Source: ${placeholderSignature(sourceValue).join(", ") || "none"}; value: ${
      placeholderSignature(translatedValue).join(", ") || "none"
    }`,
  ];
}

export function protectedTokenSignature(value: string, options: ProtectedTokenOptions = {}): string[] {
  return protectedTokens(value, options).map((token) => `${token.kind}:${token.value}`).sort();
}

export function protectedTokensMatch(
  sourceValue: string,
  translatedValue: string,
  options: ProtectedTokenOptions = {},
): boolean {
  const source = protectedTokenSignature(sourceValue, options);
  const translated = protectedTokenSignature(translatedValue, options);
  return source.length === translated.length && source.every((value, index) => value === translated[index]);
}

export function protectedTokenWarnings(
  sourceValue: string,
  translatedValue: string,
  options: ProtectedTokenOptions = {},
): string[] {
  if (protectedTokensMatch(sourceValue, translatedValue, options)) {
    return [];
  }
  return [
    `Protected token mismatch. Source: ${formatProtectedTokens(sourceValue, options)}; value: ${formatProtectedTokens(
      translatedValue,
      options,
    )}`,
  ];
}

function protectedTokens(value: string, options: ProtectedTokenOptions): ProtectedToken[] {
  return [...value.matchAll(PROTECTED_TOKEN_RE)]
    .map((match): ProtectedToken => {
      const token = match[0];
      if (token.startsWith("§")) {
        return { kind: "formatting code", value: token };
      }
      if (token.startsWith("\\")) {
        return { kind: "escape", value: token };
      }
      if (token.startsWith("<")) {
        return { kind: "tag", value: token };
      }
      return { kind: "placeholder", value: token };
    })
    .filter((token) => options.includeFormattingCodes || token.kind !== "formatting code");
}

function formatProtectedTokens(value: string, options: ProtectedTokenOptions): string {
  const formatted = protectedTokens(value, options).map((token) => `${token.kind} ${token.value}`).sort();
  return formatted.join(", ") || "none";
}
