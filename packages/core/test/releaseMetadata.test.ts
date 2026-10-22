import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { MARKORA_VERSION } from "../src/extensionVersion";
import { createDefaultMarkdownEditorPreset } from "../src/defaultExtensionPreset";
import { createMinimalMarkdownEditorPreset } from "../src/minimalExtensionPreset";

describe("release metadata", () => {
  it("keeps the runtime version aligned with the npm package", () => {
    expect(MARKORA_VERSION).toBe(packageJson.version);
    expect(createDefaultMarkdownEditorPreset().version).toBe(packageJson.version);
    expect(createMinimalMarkdownEditorPreset().version).toBe(packageJson.version);
  });

  it("targets the public markora package on the npm registry", () => {
    expect(packageJson.name).toBe("markora");
    expect(packageJson.publishConfig).toMatchObject({ access: "public", registry: "https://registry.npmjs.org/" });
  });
});
