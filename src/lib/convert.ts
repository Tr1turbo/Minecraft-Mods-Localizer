import * as OpenCC from "opencc-js";

import { DEFAULT_RUNTIME_PHRASE_MAPPINGS, phraseDictionaryForConversion } from "./phraseMappings";
import type { PhraseMapping, TargetLocale } from "./types";

type OpenCcLocale = "cn" | "twp" | "hk";

const OPENCC_LOCALES: Record<TargetLocale, OpenCcLocale> = {
  zh_cn: "cn",
  zh_tw: "twp",
  zh_hk: "hk",
};

const converters = new WeakMap<readonly PhraseMapping[], Map<string, (input: string) => string>>();

export function convertChineseLocale(
  value: string,
  from: TargetLocale,
  to: TargetLocale,
  phraseMappings: readonly PhraseMapping[] = DEFAULT_RUNTIME_PHRASE_MAPPINGS,
): string {
  if (from === to || !value) {
    return value;
  }
  return converterFor(from, to, phraseMappings)(value);
}

function converterFor(from: TargetLocale, to: TargetLocale, phraseMappings: readonly PhraseMapping[]): (input: string) => string {
  const key = `${from}->${to}`;
  const cached = converters.get(phraseMappings)?.get(key);
  if (cached) {
    return cached;
  }

  const customDictionary = phraseDictionaryForConversion(phraseMappings, from, to);
  const converter =
    customDictionary.length > 0
      ? OpenCC.ConverterFactory([customDictionary], OpenCC.Locale.from[OPENCC_LOCALES[from]], OpenCC.Locale.to[OPENCC_LOCALES[to]])
      : OpenCC.Converter({
          from: OPENCC_LOCALES[from],
          to: OPENCC_LOCALES[to],
        });
  let mappingConverters = converters.get(phraseMappings);
  if (!mappingConverters) {
    mappingConverters = new Map<string, (input: string) => string>();
    converters.set(phraseMappings, mappingConverters);
  }
  mappingConverters.set(key, converter);
  return converter;
}
