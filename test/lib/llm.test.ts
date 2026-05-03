import { afterEach, describe, expect, it, vi } from "vitest";

import { makeEntryId } from "../../src/lib/entryId";
import {
  DEFAULT_LLM_SYSTEM_PROMPT,
  listLlmModels,
  mergeLlmPatches,
  parseTranslationObject,
  scanPartialTranslationObject,
  translateJobsWithLlm,
  type LlmJob,
} from "../../src/lib/llm";
import { createEmptyProjectPatch, createPatchValue } from "../../src/lib/patches";
import { effectiveGlossaryEntries, glossaryWithInternalVanilla } from "../../src/lib/glossary";
import type { TranslationMap } from "../../src/lib/types";

describe("llm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses plain and fenced JSON responses", () => {
    expect(parseTranslationObject('{"a":"b"}')).toEqual({ a: "b" });
    expect(parseTranslationObject('```json\n{"a":"b"}\n```')).toEqual({ a: "b" });
  });

  it("scans partial JSON object translations", () => {
    expect(scanPartialTranslationObject('{"block.create.oak_slab":"橡木')).toEqual({
      completed: {},
      drafts: { "block.create.oak_slab": "橡木" },
      complete: false,
    });
    expect(scanPartialTranslationObject('{"a":"Quote: \\"ok","b":"\\u6578\\u91cf')).toEqual({
      completed: { a: 'Quote: "ok' },
      drafts: { a: 'Quote: "ok', b: "數量" },
      complete: false,
    });
    expect(scanPartialTranslationObject('```json\n{"a":"b"}\n```')).toEqual({
      completed: { a: "b" },
      drafts: { a: "b" },
      complete: true,
    });
  });

  it("lists OpenAI-compatible models", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "z-model" }, { id: "a-model" }, { missing: "id" }],
        }),
        { status: 200 },
      ),
    );

    const models = await listLlmModels({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" });

    expect(models).toEqual(["a-model", "z-model"]);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer test-key" },
    });
  });

  it("rejects translations that change placeholders", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "screen.create.count": "數量",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const mods: TranslationMap = {
      create: {
        en_us: {
          "screen.create.count": "Count: %s",
        },
      },
    };

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" })],
      mods,
      [],
    );

    expect(result.patches[id]).toBeUndefined();
    expect(result.warnings[0]).toContain("protected tokens changed");
  });

  it("allows LLM translations to change formatting codes by default", async () => {
    const id = makeEntryId("create", "zh_tw", "item.create.gold");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(chatResponse({ "item.create.gold": "黃金" }));
    const mods: TranslationMap = {
      create: {
        en_us: {
          "item.create.gold": "§6Gold",
        },
      },
    };

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "item.create.gold", sourceText: "§6Gold" })],
      mods,
      [],
    );

    expect(result.warnings).toEqual([]);
    expect(result.patches[id].value).toBe("黃金");
  });

  it("warns about formatting code changes when formatting mismatch warnings are enabled", async () => {
    const id = makeEntryId("create", "zh_tw", "item.create.gold");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(chatResponse({ "item.create.gold": "黃金" }));
    const mods: TranslationMap = {
      create: {
        en_us: {
          "item.create.gold": "§6Gold",
        },
      },
    };

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "item.create.gold", sourceText: "§6Gold" })],
      mods,
      [],
      { warnFormattingCodeMismatch: true },
    );

    expect(result.patches[id].value).toBe("黃金");
    expect(result.warnings[0]).toContain("formatting codes");
  });

  it("creates patches for valid translations", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "screen.create.count": "數量: %s",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const mods: TranslationMap = {
      create: {
        en_us: {
          "screen.create.count": "Count: %s",
        },
      },
    };

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" })],
      mods,
      [],
    );

    expect(result.patches[id].value).toBe("數量: %s");
    expect(result.patches[id].meta?.model).toBe("mock-model");
  });

  it("streams draft text before applying a completed translation", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        streamDelta('{"screen.create.count":"數'),
        streamDelta("量"),
        streamDelta(': %s"}'),
        "data: [DONE]\n\n",
      ]),
    );
    const drafts: string[] = [];
    const patches: string[] = [];

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" })],
      { create: { en_us: { "screen.create.count": "Count: %s" } } },
      [],
      {
        onDraft: (draftId, text) => {
          expect(draftId).toBe(id);
          drafts.push(text);
        },
        onPatch: (patchId, patch) => {
          patches.push(`${patchId}:${patch.value}`);
        },
      },
    );

    expect(drafts).toContain("數");
    expect(drafts).toContain("數量");
    expect(patches).toEqual([`${id}:數量: %s`]);
    expect(result.patches[id].value).toBe("數量: %s");
  });

  it("falls back to a non-stream request when streaming is rejected", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("stream unsupported", { status: 400 }))
      .mockResolvedValueOnce(chatResponse({ "screen.create.count": "數量: %s" }));

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" })],
      { create: { en_us: { "screen.create.count": "Count: %s" } } },
      [],
    );

    const firstRequest = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const secondRequest = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string);
    expect(firstRequest.stream).toBe(true);
    expect(secondRequest.stream).toBeUndefined();
    expect(result.patches[id].value).toBe("數量: %s");
  });

  it("keeps completed stream patches and warns for missing keys after a partial stream", async () => {
    const firstId = makeEntryId("create", "zh_tw", "block.create.oak_slab");
    const secondId = makeEntryId("create", "zh_tw", "screen.create.count");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        streamDelta('{"block.create.oak_slab":"橡木半磚","screen.create.count":"數'),
      ]),
    );

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [
        job({ targetLocale: "zh_tw", key: "block.create.oak_slab", sourceText: "Oak Slab" }),
        job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" }),
      ],
      { create: { en_us: { "block.create.oak_slab": "Oak Slab", "screen.create.count": "Count: %s" } } },
      [],
    );

    expect(result.patches[firstId].value).toBe("橡木半磚");
    expect(result.patches[secondId]).toBeUndefined();
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("missing LLM translation")]));
  });

  it("warns for unknown streamed keys without blocking known translations", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        streamDelta('{"unknown.key":"忽略","screen.create.count":"數量: %s"}'),
        "data: [DONE]\n\n",
      ]),
    );

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" })],
      { create: { en_us: { "screen.create.count": "Count: %s" } } },
      [],
    );

    expect(result.patches[id].value).toBe("數量: %s");
    expect(result.warnings).toEqual(expect.arrayContaining(["unknown.key: unknown LLM translation id"]));
  });

  it("does not send empty source jobs to the LLM endpoint", async () => {
    const validId = makeEntryId("create", "zh_tw", "screen.create.count");
    const emptyId = makeEntryId("argentinasdelightreborn", "zh_tw", "gui.argentinasdelightreborn.sawing_machine_gui.button_auto");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "screen.create.count": "數量",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const mods: TranslationMap = {
      create: {
        en_us: {
          "screen.create.count": "Count",
        },
      },
      argentinasdelightreborn: {
        en_us: {
          "gui.argentinasdelightreborn.sawing_machine_gui.button_auto": "",
        },
      },
    };

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [
        job({
          namespace: "argentinasdelightreborn",
          targetLocale: "zh_tw",
          key: "gui.argentinasdelightreborn.sawing_machine_gui.button_auto",
          sourceText: "",
        }),
        job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count" }),
      ],
      mods,
      [],
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(request.stream).toBe(true);
    expect(payload).toMatchObject({
      instructions: expect.any(String),
      to: "zh_tw",
      outputShape: "Return one JSON object only. Keys must be item ids. Values must be translated strings.",
    });
    expect(payload.glossary).toBeUndefined();
    expect(payload.glossaryInstruction).toBeUndefined();
    expect(payload.items).toEqual([
      {
        id: "screen.create.count",
        refs: [{ locale: "en_us", text: "Count" }],
      },
    ]);
    expect(result.patches[validId].value).toBe("數量");
    expect(result.patches[emptyId]).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("does not call the LLM endpoint when every source job is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [
        job({
          namespace: "argentinasdelightreborn",
          targetLocale: "zh_tw",
          key: "gui.argentinasdelightreborn.sawing_machine_gui.button_auto",
          sourceText: "  ",
        }),
      ],
      { argentinasdelightreborn: { en_us: { "gui.argentinasdelightreborn.sawing_machine_gui.button_auto": "  " } } },
      [],
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ patches: {}, warnings: [] });
  });

  it("sends configured prompts with the translation payload", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "screen.create.count": "數量: %s",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const mods: TranslationMap = {
      create: {
        en_us: {
          "screen.create.count": "Count: %s",
        },
      },
    };

    const result = await translateJobsWithLlm(
      {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "mock-model",
        systemPrompt: `${DEFAULT_LLM_SYSTEM_PROMPT} Use concise Traditional Chinese.`,
        userPrompt: "Prefer Minecraft Taiwan terminology.",
      },
      [job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" })],
      mods,
      [],
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(request.messages[0]).toMatchObject({
      role: "system",
      content: `${DEFAULT_LLM_SYSTEM_PROMPT} Use concise Traditional Chinese.`,
    });
    expect(JSON.parse(request.messages[1].content)).toMatchObject({
      instructions: "Prefer Minecraft Taiwan terminology.",
      to: "zh_tw",
      items: [
        {
          id: "screen.create.count",
          refs: [{ locale: "en_us", text: "Count: %s" }],
        },
      ],
    });
    expect(JSON.parse(request.messages[1].content).promptVersion).toBeUndefined();
    expect(result.patches[id].meta?.promptVersion).toBe("minecraft-mods-localizer-v1-custom");
  });

  it("sends every selected source value to the LLM payload", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "screen.create.count": "數量: %s",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [
        job({
          targetLocale: "zh_tw",
          key: "screen.create.count",
          sourceLocale: "en_us",
          sourceText: "Count: %s",
          sourceReferenceMode: "all",
          sourceValues: [
            { locale: "en_us", source: "jar", sourceLabel: "en_us jar", value: "Count: %s" },
            { locale: "es_ar", source: "jar", sourceLabel: "es_ar jar", value: "Cuenta: %s" },
          ],
        }),
      ],
      { create: { en_us: { "screen.create.count": "Count: %s" } } },
      [],
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.items[0]).toMatchObject({
      id: "screen.create.count",
      refs: [
        { locale: "en_us", text: "Count: %s" },
        { locale: "es_ar", text: "Cuenta: %s" },
      ],
    });
  });

  it("qualifies only duplicate prompt keys with namespaces", async () => {
    const firstId = makeEntryId("create", "zh_tw", "block.shared");
    const secondId = makeEntryId("other", "zh_tw", "block.shared");
    const uniqueId = makeEntryId("create", "zh_tw", "block.unique");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      chatResponse({
        "create/block.shared": "共享一",
        "other/block.shared": "共享二",
        "block.unique": "唯一",
      }),
    );

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [
        job({ namespace: "create", targetLocale: "zh_tw", key: "block.shared", sourceText: "Shared One" }),
        job({ namespace: "other", targetLocale: "zh_tw", key: "block.shared", sourceText: "Shared Two" }),
        job({ namespace: "create", targetLocale: "zh_tw", key: "block.unique", sourceText: "Unique" }),
      ],
      {
        create: { en_us: { "block.shared": "Shared One", "block.unique": "Unique" } },
        other: { en_us: { "block.shared": "Shared Two" } },
      },
      [],
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.items.map((item: { id: string }) => item.id)).toEqual(["create/block.shared", "other/block.shared", "block.unique"]);
    expect(result.patches[firstId].value).toBe("共享一");
    expect(result.patches[secondId].value).toBe("共享二");
    expect(result.patches[uniqueId].value).toBe("唯一");
  });

  it("splits mixed target locales into separate requests", async () => {
    const zhTwId = makeEntryId("create", "zh_tw", "block.create.oak_slab");
    const zhCnId = makeEntryId("create", "zh_cn", "block.create.oak_slab");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse({ "block.create.oak_slab": "橡木半磚" }))
      .mockResolvedValueOnce(chatResponse({ "block.create.oak_slab": "橡木台阶" }));

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "mock-model" },
      [
        job({ targetLocale: "zh_tw", key: "block.create.oak_slab", sourceText: "Oak Slab" }),
        job({ targetLocale: "zh_cn", key: "block.create.oak_slab", sourceText: "Oak Slab" }),
      ],
      { create: { en_us: { "block.create.oak_slab": "Oak Slab" } } },
      [],
    );

    const firstPayload = JSON.parse(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string).messages[1].content);
    const secondPayload = JSON.parse(JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string).messages[1].content);
    expect(firstPayload.to).toBe("zh_tw");
    expect(secondPayload.to).toBe("zh_cn");
    expect(result.patches[zhTwId].value).toBe("橡木半磚");
    expect(result.patches[zhCnId].value).toBe("橡木台阶");
  });

  it("includes matching Glossary entries in the request payload", async () => {
    const id = makeEntryId("create", "zh_tw", "block.create.oak_slab");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "block.create.oak_slab": "橡木半磚",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const mods: TranslationMap = {
      create: {
        en_us: {
          "block.create.oak_slab": "Oak Slab",
        },
      },
    };

    await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "block.create.oak_slab", sourceText: "Oak Slab" })],
      mods,
      [],
      glossaryWithInternalVanilla(effectiveGlossaryEntries()),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.glossaryInstruction).toContain("glossary");
    expect(payload.glossary.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining(["curated.block.slab", "block.minecraft.oak_slab"]),
    );
    expect(payload.glossary[0]).toHaveProperty("en_us");
    expect(payload.glossary[0]).toHaveProperty("zh_tw");
    expect(payload.glossary[0]).not.toHaveProperty("zh_cn");
  });

  it("matches Glossary entries from all LLM reference locales and sends those locales with the target", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "block.create.oak_slab": "橡木台阶",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "mock-model" },
      [
        job({
          targetLocale: "zh_cn",
          key: "block.create.oak_slab",
          sourceLocale: "en_us",
          sourceText: "Oak Slab",
          sourceReferenceMode: "all",
          sourceValues: [
            { locale: "en_us", source: "jar", sourceLabel: "en_us jar", value: "Oak Slab" },
            { locale: "ja_jp", source: "jar", sourceLabel: "ja_jp jar", value: "オークのハーフブロック" },
          ],
        }),
      ],
      { create: { en_us: { "block.create.oak_slab": "Oak Slab" } } },
      [],
      glossaryWithInternalVanilla(effectiveGlossaryEntries()),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    const oakSlab = payload.glossary.find((entry: { id: string }) => entry.id === "block.minecraft.oak_slab");
    expect(oakSlab).toMatchObject({
      en_us: ["Oak Slab"],
      ja_jp: ["オークのハーフブロック"],
      zh_cn: ["橡木台阶"],
    });
  });

  it("excludes unrelated Glossary entries and includes matching custom entries", async () => {
    const id = makeEntryId("create", "zh_cn", "block.create.engine");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "block.create.engine": "铜引擎",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const mods: TranslationMap = {
      create: {
        en_us: {
          "block.create.engine": "Copper Engine",
        },
      },
    };

    await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "mock-model" },
      [job({ targetLocale: "zh_cn", key: "block.create.engine", sourceText: "Copper Engine" })],
      mods,
      [],
      glossaryWithInternalVanilla(
        effectiveGlossaryEntries({
          "custom.engine": {
            enabled: true,
            source: "custom",
            en_us: ["engine"],
            zh_cn: ["引擎"],
            zh_tw: ["引擎"],
            zh_hk: ["引擎"],
          },
        }),
      ),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.glossary.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining(["custom.engine", "curated.item.copper"]),
    );
    expect(payload.glossary.map((entry: { id: string }) => entry.id)).not.toContain("curated.item.potion");
    expect(payload.glossary[0]).toHaveProperty("zh_cn");
    expect(payload.glossary[0]).not.toHaveProperty("zh_tw");
  });

  it("does not add LLM Glossary entries from key-only matches", async () => {
    const id = makeEntryId("create", "zh_cn", "block.create.engine");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "block.create.engine": "铜机器",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const mods: TranslationMap = {
      create: {
        en_us: {
          "block.create.engine": "Copper Machine",
        },
      },
    };

    await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "mock-model" },
      [job({ targetLocale: "zh_cn", key: "block.create.engine", sourceText: "Copper Machine" })],
      mods,
      [],
      glossaryWithInternalVanilla(
        effectiveGlossaryEntries({
          "custom.engine": {
            enabled: true,
            source: "custom",
            en_us: ["engine"],
            zh_cn: ["引擎"],
            zh_tw: ["引擎"],
            zh_hk: ["引擎"],
          },
        }),
      ),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.glossary.map((entry: { id: string }) => entry.id)).not.toContain("custom.engine");
  });

  it("sends vanilla Glossary entries for bundled non-Chinese targets", async () => {
    const id = makeEntryId("create", "fr_fr", "block.create.oak_slab");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  "block.create.oak_slab": "Dalle de chêne",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "mock-model" },
      [job({ targetLocale: "fr_fr", key: "block.create.oak_slab", sourceText: "Oak Slab" })],
      { create: { en_us: { "block.create.oak_slab": "Oak Slab" } } },
      [],
      glossaryWithInternalVanilla(effectiveGlossaryEntries()),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.glossaryInstruction).toContain("glossary");
    expect(payload.glossary.map((entry: { id: string }) => entry.id)).toContain("block.minecraft.oak_slab");
    expect(payload.glossary.find((entry: { id: string }) => entry.id === "block.minecraft.oak_slab")).toHaveProperty("fr_fr");
    expect(payload.glossary.map((entry: { id: string }) => entry.id)).not.toContain("curated.block.slab");
  });

  it("compacts duplicate vanilla Glossary entries in the LLM payload only", async () => {
    const id = makeEntryId("create", "zh_tw", "item.test.music_disc");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(chatResponse({ "item.test.music_disc": "唱片" }));

    const result = await translateJobsWithLlm(
      { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "mock-model" },
      [job({ targetLocale: "zh_tw", key: "item.test.music_disc", sourceText: "Music Disc" })],
      { create: { en_us: { "item.test.music_disc": "Music Disc" } } },
      [],
      glossaryWithInternalVanilla(effectiveGlossaryEntries()),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    const musicDiscEntries = payload.glossary.filter((entry: { id: string; en_us?: string[] }) => entry.en_us?.[0] === "Music Disc");
    expect(payload.items).toEqual([
      {
        id: "item.test.music_disc",
        refs: [{ locale: "en_us", text: "Music Disc" }],
      },
    ]);
    expect(musicDiscEntries).toHaveLength(1);
    expect(musicDiscEntries[0]).toMatchObject({
      id: expect.stringContaining("item.minecraft.music_disc_5, music_disc_11, music_disc_13"),
      en_us: ["Music Disc"],
      zh_tw: ["唱片"],
    });
    expect(result.patches[id].value).toBe("唱片");
  });

  it("simulates translations in debug mode without calling an endpoint", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const mods: TranslationMap = {
      create: {
        en_us: {
          "screen.create.count": "Count: %s",
        },
      },
    };

    const result = await translateJobsWithLlm(
      { baseUrl: "", apiKey: "", model: "", debugMode: true },
      [job({ targetLocale: "zh_tw", key: "screen.create.count", sourceText: "Count: %s" })],
      mods,
      [],
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.warnings).toEqual([]);
    expect(result.patches[id].value).toBe("[debug zh_tw] Count: %s");
    expect(result.patches[id].meta?.generatedBy).toBe("llm");
    expect(result.patches[id].meta?.model).toBe("debug-simulated-llm");
  });

  it("keeps every LLM generation as selectable history and activates the latest", async () => {
    const id = makeEntryId("create", "zh_tw", "screen.create.count");
    const parent = { source: "fallback" as const, value: "Count: %s", sourceLabel: "en_us fallback" };
    const first = await createPatchValue("數量: %s", parent, {
      generatedBy: "llm",
      llmCandidateId: "first",
      model: "mock-model",
    });
    const second = await createPatchValue("計數: %s", parent, {
      generatedBy: "llm",
      llmCandidateId: "second",
      model: "mock-model",
    });

    const project = mergeLlmPatches(mergeLlmPatches(createEmptyProjectPatch(), { [id]: first }), { [id]: second });

    expect(project.llmCandidates[id]).toEqual([first, second]);
    expect(project.patches[id]).toBe(second);
  });
});

function job({
  namespace = "create",
  targetLocale,
  key,
  sourceText,
  sourceLocale = "en_us",
  sourceValues,
  sourceReferenceMode,
}: {
  namespace?: string;
  targetLocale: string;
  key: string;
  sourceText: string;
  sourceLocale?: string;
  sourceValues?: LlmJob["sourceValues"];
  sourceReferenceMode?: LlmJob["sourceReferenceMode"];
}): LlmJob {
  return {
    namespace,
    targetLocale,
    key,
    sourceLocale,
    sourceText,
    sourceValues,
    sourceReferenceMode,
  };
}

function chatResponse(content: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(content),
          },
        },
      ],
    }),
    { status: 200 },
  );
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function streamDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}
