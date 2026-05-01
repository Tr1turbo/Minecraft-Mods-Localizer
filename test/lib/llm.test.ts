import { afterEach, describe, expect, it, vi } from "vitest";

import { makeEntryId } from "../../src/lib/entryId";
import { DEFAULT_LLM_SYSTEM_PROMPT, listLlmModels, mergeLlmPatches, parseTranslationObject, translateJobsWithLlm, type LlmJob } from "../../src/lib/llm";
import { createEmptyProjectPatch, createPatchValue } from "../../src/lib/patches";
import { effectivePhraseMappings, phraseMappingsWithInternalVanilla } from "../../src/lib/phraseMappings";
import type { TranslationMap } from "../../src/lib/types";

describe("llm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses plain and fenced JSON responses", () => {
    expect(parseTranslationObject('{"a":"b"}')).toEqual({ a: "b" });
    expect(parseTranslationObject('```json\n{"a":"b"}\n```')).toEqual({ a: "b" });
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
                  [id]: "數量",
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
    expect(result.warnings[0]).toContain("placeholders changed");
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
                  [id]: "數量: %s",
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
                  [validId]: "數量",
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
    expect(payload.items).toEqual([
      expect.objectContaining({
        id: validId,
        targetLocale: "zh_tw",
        sourceLocale: "en_us",
        key: "screen.create.count",
        sourceText: "Count",
        sourceValues: [{ locale: "en_us", source: "fallback", sourceLabel: "en_us source", text: "Count" }],
      }),
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
                  [id]: "數量: %s",
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
      promptVersion: "minecraft-mods-localizer-v1-custom",
      instructions: "Prefer Minecraft Taiwan terminology.",
      items: [
        {
          id,
          targetLocale: "zh_tw",
          sourceLocale: "en_us",
          key: "screen.create.count",
          sourceText: "Count: %s",
          sourceValues: [{ locale: "en_us", source: "fallback", sourceLabel: "en_us source", text: "Count: %s" }],
        },
      ],
    });
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
                  [id]: "數量: %s",
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
      sourceReferenceMode: "all",
      sourceValues: [
        { locale: "en_us", source: "jar", sourceLabel: "en_us jar", text: "Count: %s" },
        { locale: "es_ar", source: "jar", sourceLabel: "es_ar jar", text: "Cuenta: %s" },
      ],
    });
  });

  it("includes matching Phrase Mapping glossary entries in the request payload", async () => {
    const id = makeEntryId("create", "zh_tw", "block.create.oak_slab");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  [id]: "橡木半磚",
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
      phraseMappingsWithInternalVanilla(effectivePhraseMappings()),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.phraseGlossary.map((mapping: { id: string }) => mapping.id)).toEqual(
      expect.arrayContaining(["curated.block.slab", "block.minecraft.oak_slab"]),
    );
  });

  it("excludes unrelated Phrase Mapping entries and includes matching custom mappings", async () => {
    const id = makeEntryId("create", "zh_cn", "block.create.engine");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  [id]: "铜引擎",
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
      phraseMappingsWithInternalVanilla(
        effectivePhraseMappings({
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
    expect(payload.phraseGlossary.map((mapping: { id: string }) => mapping.id)).toEqual(
      expect.arrayContaining(["custom.engine", "curated.item.copper"]),
    );
    expect(payload.phraseGlossary.map((mapping: { id: string }) => mapping.id)).not.toContain("curated.item.potion");
  });

  it("does not add LLM Phrase Mapping glossary entries from key-only matches", async () => {
    const id = makeEntryId("create", "zh_cn", "block.create.engine");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  [id]: "铜机器",
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
      phraseMappingsWithInternalVanilla(
        effectivePhraseMappings({
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
    expect(payload.phraseGlossary.map((mapping: { id: string }) => mapping.id)).not.toContain("custom.engine");
  });

  it("does not send Chinese Phrase Mapping glossary entries for non-Chinese targets", async () => {
    const id = makeEntryId("create", "fr_fr", "block.create.oak_slab");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  [id]: "Dalle de chêne",
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
      phraseMappingsWithInternalVanilla(effectivePhraseMappings()),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.phraseGlossary).toEqual([]);
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
