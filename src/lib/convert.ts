import * as OpenCC from "opencc-js";

import { DEFAULT_RUNTIME_GLOSSARY, glossaryDictionaryForConversion } from "./glossary";
import type { ChineseLocale, GlossaryEntry } from "./types";

type OpenCcLocale = "cn" | "twp" | "hk";

const OPENCC_LOCALES: Record<ChineseLocale, OpenCcLocale> = {
  zh_cn: "cn",
  zh_tw: "twp",
  zh_hk: "hk",
};

const converters = new WeakMap<readonly GlossaryEntry[], Map<string, (input: string) => string>>();

export function convertChineseLocale(
  value: string,
  from: ChineseLocale,
  to: ChineseLocale,
  glossary: readonly GlossaryEntry[] = DEFAULT_RUNTIME_GLOSSARY,
): string {
  if (from === to || !value) {
    return value;
  }
  return converterFor(from, to, glossary)(value);
}

function converterFor(from: ChineseLocale, to: ChineseLocale, glossary: readonly GlossaryEntry[]): (input: string) => string {
  const key = `${from}->${to}`;
  const cached = converters.get(glossary)?.get(key);
  if (cached) {
    return cached;
  }

  const customDictionary = glossaryDictionaryForConversion(glossary, from, to);
  const converter =
    customDictionary.length > 0
      ? OpenCC.ConverterFactory([customDictionary], OpenCC.Locale.from[OPENCC_LOCALES[from]], OpenCC.Locale.to[OPENCC_LOCALES[to]])
      : OpenCC.Converter({
          from: OPENCC_LOCALES[from],
          to: OPENCC_LOCALES[to],
        });
  let glossaryConverters = converters.get(glossary);
  if (!glossaryConverters) {
    glossaryConverters = new Map<string, (input: string) => string>();
    converters.set(glossary, glossaryConverters);
  }
  glossaryConverters.set(key, converter);
  return converter;
}
