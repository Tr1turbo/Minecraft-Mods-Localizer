declare module "opencc-js" {
  export type OpenCcLocale = "cn" | "tw" | "twp" | "hk" | "jp" | "t";
  export type OpenCcDictionary = string | string[][];
  export type OpenCcDictionaryGroup = OpenCcDictionary[];

  export function Converter(options: { from: OpenCcLocale; to: OpenCcLocale }): (input: string) => string;
  export function ConverterFactory(...dictGroups: OpenCcDictionaryGroup[]): (input: string) => string;

  export const Locale: {
    from: Record<Exclude<OpenCcLocale, "t">, OpenCcDictionaryGroup>;
    to: Record<Exclude<OpenCcLocale, "t">, OpenCcDictionaryGroup>;
  };
}
