import vanillaDeDe from "../../minecraft/lang/de_de.json";
import vanillaEnUs from "../../minecraft/lang/en_us.json";
import vanillaEsEs from "../../minecraft/lang/es_es.json";
import vanillaFrFr from "../../minecraft/lang/fr_fr.json";
import vanillaItIt from "../../minecraft/lang/it_it.json";
import vanillaJaJp from "../../minecraft/lang/ja_jp.json";
import vanillaKoKr from "../../minecraft/lang/ko_kr.json";
import vanillaLzh from "../../minecraft/lang/lzh.json";
import vanillaNlNl from "../../minecraft/lang/nl_nl.json";
import vanillaPtBr from "../../minecraft/lang/pt_br.json";
import vanillaRuRu from "../../minecraft/lang/ru_ru.json";
import vanillaThTh from "../../minecraft/lang/th_th.json";
import vanillaUkUa from "../../minecraft/lang/uk_ua.json";
import vanillaViVn from "../../minecraft/lang/vi_vn.json";
import vanillaZhCn from "../../minecraft/lang/zh_cn.json";
import vanillaZhHk from "../../minecraft/lang/zh_hk.json";
import vanillaZhTw from "../../minecraft/lang/zh_tw.json";
import type { TranslationMap } from "./types";

export const VANILLA_NAMESPACE = "minecraft";

export const VANILLA_LOCALES: Record<string, Record<string, string>> = {
  de_de: vanillaDeDe,
  en_us: vanillaEnUs,
  es_es: vanillaEsEs,
  fr_fr: vanillaFrFr,
  it_it: vanillaItIt,
  ja_jp: vanillaJaJp,
  ko_kr: vanillaKoKr,
  lzh: vanillaLzh,
  nl_nl: vanillaNlNl,
  pt_br: vanillaPtBr,
  ru_ru: vanillaRuRu,
  th_th: vanillaThTh,
  uk_ua: vanillaUkUa,
  vi_vn: vanillaViVn,
  zh_cn: vanillaZhCn,
  zh_hk: vanillaZhHk,
  zh_tw: vanillaZhTw,
};

export const VANILLA_TRANSLATIONS: TranslationMap = {
  [VANILLA_NAMESPACE]: VANILLA_LOCALES,
};

export function compareNamespaceNames(left: string, right: string): number {
  if (left === VANILLA_NAMESPACE && right !== VANILLA_NAMESPACE) {
    return -1;
  }
  if (right === VANILLA_NAMESPACE && left !== VANILLA_NAMESPACE) {
    return 1;
  }
  return left.localeCompare(right);
}
