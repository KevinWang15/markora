import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtInThemes } from "../src/themes";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(testDirectory, "..");
const workspaceRoot = join(coreRoot, "..", "..");
const coreStyles = readFileSync(join(coreRoot, "src", "styles.css"), "utf8");
const uiStyles = readFileSync(join(workspaceRoot, "packages", "ui", "src", "styles.css"), "utf8");
const themes = readFileSync(join(coreRoot, "src", "themes.css"), "utf8");
const themeContract = readFileSync(join(workspaceRoot, "docs", "theme-contract.md"), "utf8");
const copyScript = readFileSync(join(coreRoot, "scripts", "copyStyles.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  sideEffects: string[];
};

const productionStyles = [
  ["markora/styles.css", coreStyles],
  ["markora-ui/styles.css", uiStyles],
  ["markora/themes.css", themes],
] as const;

function matchingLines(source: string, predicate: (line: string) => boolean) {
  return source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => predicate(line));
}

describe("public theme styles", () => {
  it("routes authored colors and visual dimensions through documented Markora tokens", () => {
    const rawColor = /#[\da-f]{3,8}\b|rgba?\(/iu;
    const rawDimension = /-?(?:\d*\.)?\d+(?:px|rem|em|ms|s)\b/u;

    for (const [name, source] of productionStyles) {
      const untokenizedColors = matchingLines(source, (line) => (
        rawColor.test(line)
        && !line.startsWith("--mdw-")
        && !line.includes("var(--mdw-")
      ));
      const untokenizedDimensions = matchingLines(source, (line) => (
        rawDimension.test(line)
        && !line.startsWith("--mdw-")
        && !line.includes("var(--mdw-")
        && !line.startsWith("transform:")
      ));

      expect(untokenizedColors, `${name} contains raw component colors`).toEqual([]);
      expect(untokenizedDimensions, `${name} contains raw component dimensions`).toEqual([]);
    }

    const tokens = new Set(
      productionStyles.flatMap(([, source]) => source.match(/--mdw-[\w-]+/gu) ?? []),
    );
    const undocumented = [...tokens].filter((token) => !themeContract.includes(token)).sort();
    expect(undocumented).toEqual([]);
  });

  it("keeps a component default on every token use", () => {
    for (const [name, source] of productionStyles) {
      const missingFallbacks = matchingLines(source, (line) => (
        /var\(--mdw-[\w-]+\)/u.test(line)
      ));

      expect(
        missingFallbacks,
        `${name} contains a Markora token without a fallback`,
      ).toEqual([]);
    }
  });

  it("keeps inline-direction presentation logical while leaving coordinate math to runtime", () => {
    const physicalBoxProperty = /^(?:top|bottom|left|right|margin-(?:top|bottom|left|right)|padding-(?:top|bottom|left|right)|border-(?:top|bottom|left|right))(?:-[\w-]+)?:/u;

    for (const [name, source] of productionStyles) {
      expect(
        matchingLines(source, (line) => physicalBoxProperty.test(line)),
        `${name} contains physical box-direction CSS`,
      ).toEqual([]);
    }

    expect(coreStyles).toContain("padding-inline-start:");
    expect(coreStyles).toContain("border-inline-end:");
    expect(coreStyles).toContain("inset-inline-start:");
    expect(uiStyles).toContain("border-inline-start:");
  });

  it("ships opt-in reference schemes and automatic accessibility media behavior", () => {
    for (const theme of builtInThemes) {
      expect(themes).toContain(`[data-mdw-theme="${theme.id}"]`);
      expect(themes).toContain(`.mdw-theme-${theme.id}`);
    }
    expect(themes).toContain('[data-mdw-theme="light"]');
    expect(themes).toContain('[data-mdw-theme="dark"]');
    expect(themes).toContain('[data-mdw-theme="auto"]');
    expect(themes).toContain('[data-mdw-theme="contrast"]');
    expect(themes).toContain("@media (prefers-color-scheme: dark)");
    expect(themes).toContain("@media (prefers-contrast: more)");
    expect(coreStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(coreStyles).toContain("@media (forced-colors: active)");
    expect(uiStyles).toContain("@media (forced-colors: active)");
    expect(coreStyles).toContain(".mdw-image-spinner");
    expect(coreStyles).toContain(".cm-cursorLayer");
  });

  it("publishes and copies the reference theme asset", () => {
    expect(packageJson.exports["./themes"]).toEqual({ types: "./dist/themes.d.ts", import: "./dist/themes.js" });
    expect(packageJson.exports["./themes.css"]).toBe("./dist/themes.css");
    expect(packageJson.sideEffects).toContain("./dist/themes.css");
    expect(copyScript).toContain('resolve(packageRoot, "src/themes.css")');
    expect(copyScript).toContain('resolve(packageRoot, "dist/themes.css")');
    expect(copyScript).toContain("writeFile(themesOutputPath, themes)");
  });
});
