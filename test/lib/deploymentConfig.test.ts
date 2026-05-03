import { describe, expect, it } from "vitest";

import {
  OFFICIAL_OPENAI_API_BASE_URL,
  createDefaultDeploymentDefaults,
  loadDeploymentConfig,
  mergeAppSettings,
  mergeLlmSettings,
  normalizeDeploymentConfig,
} from "../../src/lib/deploymentConfig";

describe("deployment config", () => {
  it("uses official OpenAI API defaults when config is missing", async () => {
    const defaults = await loadDeploymentConfig(
      async () => new Response("Not found", { status: 404 }),
      "https://example.test/app-config.json",
    );

    expect(defaults.llmSettings.baseUrl).toBe(OFFICIAL_OPENAI_API_BASE_URL);
    expect(defaults.llmSettings.model).toBe("gpt-5.4-mini");
    expect(defaults.settings.targetLocales).toEqual([]);
    expect(defaults.settings.llmReferenceMode).toBe("en_us");
    expect(defaults.settings.warnFormattingCodeMismatch).toBe(false);
  });

  it("normalizes partial openai_api, app, and source label config", () => {
    const normalized = normalizeDeploymentConfig({
      schemaVersion: 1,
      openai_api: {
        base_url: `${OFFICIAL_OPENAI_API_BASE_URL}/`,
        model: "gpt-5.4-mini-latest",
        system_prompt: "Translate Minecraft strings.",
        user_prompt: "Use Traditional Chinese terminology.",
      },
      app: {
        packFormat: 48,
        description: "Custom deployment",
        llmBatchSize: 24,
        llmConcurrency: 4,
        llmReferenceMode: "fallback",
        warnFormattingCodeMismatch: true,
      },
      sourceLabels: {
        jar: {
          label: "Mod JAR",
          background: "#111111",
        },
      },
    });

    expect(normalized.llmSettings).toMatchObject({
      baseUrl: `${OFFICIAL_OPENAI_API_BASE_URL}/`,
      model: "gpt-5.4-mini-latest",
      systemPrompt: "Translate Minecraft strings.",
      userPrompt: "Use Traditional Chinese terminology.",
    });
    expect(normalized.settings).toMatchObject({
      packFormat: 48,
      description: "Custom deployment",
      llmBatchSize: 24,
      llmConcurrency: 4,
      llmReferenceMode: "fallback",
      warnFormattingCodeMismatch: true,
    });
    expect(normalized.sourceLabels.jar).toMatchObject({
      label: "Mod JAR",
      background: "#111111",
      text: "#315b8c",
      stripe: "#6c8fba",
    });
    expect(normalized.sourceLabels.vanilla).toMatchObject({
      label: "Vanilla",
    });
  });

  it("uses default Chinese fallback chains when app config omits them", () => {
    const normalized = normalizeDeploymentConfig({
      app: {
        targetLocales: ["zh_tw", "zh_cn", "zh_hk"],
      },
    });

    expect(normalized.settings.fallbackChains).toEqual({
      zh_tw: ["zh_hk", "zh_cn", "en_us"],
      zh_cn: ["zh_hk", "zh_tw", "en_us"],
      zh_hk: ["zh_tw", "zh_cn", "en_us"],
    });
  });

  it("ignores invalid fields, unknown source keys, and public API key fields", () => {
    const defaults = createDefaultDeploymentDefaults();
    const normalized = normalizeDeploymentConfig({
      openai_api: {
        base_url: "",
        model: "",
        api_key: "ignored",
        debug_delay_ms: 6000,
      },
      app: {
        packFormat: -4,
        llmBatchSize: 999,
        llmConcurrency: -2,
        targetLocales: ["zh_tw"],
        fallbackChains: {
          zh_tw: ["zh_cn", "zh_cn", "bad_locale", "zh_tw"],
        },
        llmReferenceMode: "bad",
      },
      sourceLabels: {
        jar: {
          label: "",
          background: "red",
          text: "#12xyz6",
          stripe: "#abc",
        },
        unknown: {
          label: "Unknown",
          background: "#000000",
          text: "#ffffff",
          stripe: "#000000",
        },
      },
    });

    expect(normalized.llmSettings.baseUrl).toBe(defaults.llmSettings.baseUrl);
    expect(normalized.llmSettings.model).toBe(defaults.llmSettings.model);
    expect(normalized.llmSettings.apiKey).toBe("");
    expect(normalized.llmSettings.debugDelayMs).toBe(5000);
    expect(normalized.settings.packFormat).toBe(1);
    expect(normalized.settings.llmBatchSize).toBe(200);
    expect(normalized.settings.llmConcurrency).toBe(1);
    expect(normalized.settings.llmReferenceMode).toBe(defaults.settings.llmReferenceMode);
    expect(normalized.settings.targetLocales).toEqual(["zh_tw"]);
    expect(normalized.settings.fallbackChains.zh_tw).toEqual(["zh_cn", "en_us"]);
    expect(normalized.sourceLabels.jar).toMatchObject({
      label: defaults.sourceLabels.jar.label,
      background: defaults.sourceLabels.jar.background,
      text: defaults.sourceLabels.jar.text,
      stripe: "#abc",
    });
    expect(normalized.sourceLabels.vanilla).toMatchObject(defaults.sourceLabels.vanilla);
    expect((normalized.sourceLabels as Record<string, unknown>).unknown).toBeUndefined();
  });

  it("lets saved browser settings override deployment defaults", () => {
    const deploymentDefaults = normalizeDeploymentConfig({
      openai_api: {
        model: "deployed-model",
      },
      app: {
        packFormat: 45,
        llmBatchSize: 60,
      },
    });

    const savedSettings = mergeAppSettings(
      {
        ...deploymentDefaults.settings,
        packFormat: 12,
        llmBatchSize: 8,
      },
      deploymentDefaults.settings,
    );
    const savedLlmSettings = mergeLlmSettings(deploymentDefaults.llmSettings, {
      ...deploymentDefaults.llmSettings,
      model: "saved-model",
    });

    expect(savedSettings.packFormat).toBe(12);
    expect(savedSettings.llmBatchSize).toBe(8);
    expect(savedLlmSettings.model).toBe("saved-model");
    expect(savedLlmSettings.baseUrl).toBe(OFFICIAL_OPENAI_API_BASE_URL);
    expect(savedLlmSettings.apiKey).toBe("");
  });
});
