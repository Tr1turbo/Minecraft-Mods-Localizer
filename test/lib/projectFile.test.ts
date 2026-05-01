import { describe, expect, it } from "vitest";

import { createEmptyProjectPatch } from "../../src/lib/patches";
import { projectPatchBlob } from "../../src/lib/projectFile";

describe("project file", () => {
  it("does not export runtime LLM API settings", async () => {
    const project = createEmptyProjectPatch();
    const text = await projectPatchBlob(project).text();

    expect(text).not.toContain("apiKey");
    expect(text).not.toContain("OPENAI_API_KEY");
    expect(JSON.parse(text).schemaVersion).toBe(1);
    expect(JSON.parse(text).phraseMappings).toEqual({});
  });
});
