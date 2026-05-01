import type { EntryId, LocaleCode } from "./types";

export function makeEntryId(namespace: string, locale: LocaleCode, key: string): EntryId {
  return `${namespace}/${locale}/${key}`;
}

export function parseEntryId(id: EntryId): { namespace: string; locale: LocaleCode; key: string } {
  const firstSlash = id.indexOf("/");
  const secondSlash = id.indexOf("/", firstSlash + 1);
  if (firstSlash < 1 || secondSlash < firstSlash + 2) {
    throw new Error(`Invalid entry id: ${id}`);
  }
  return {
    namespace: id.slice(0, firstSlash),
    locale: id.slice(firstSlash + 1, secondSlash),
    key: id.slice(secondSlash + 1),
  };
}
