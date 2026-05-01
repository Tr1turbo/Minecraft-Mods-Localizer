const PLACEHOLDER_RE = /%(\d+\$)?[0-9.+\-# ]*[bcdeEfgGosxXaA%]|\\[nrt]|§.|<[^>\s]+>|<\/[^>\s]+>|\{\}|\{[^{}\s]+\}/g;

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
