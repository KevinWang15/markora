import { describe, expect, it } from "vitest";
import {
  MarkdownEditorExtensionError,
  defineMarkoraMarkdownEditorExtension,
  defineMarkdownEditorExtension,
  defineMarkdownEditorPreset,
  readMarkdownEditorExtensionDefinition,
  type MarkdownEditorExtensionStaticDefinition,
} from "../src/extensionApi";
import { resolveMarkdownEditorExtensions } from "../src/extensionResolver";
import {
  isValidMarkdownEditorSemVerRange,
  markdownEditorSemVerSatisfies,
} from "../src/extensionSemver";

const compatibility = {
  extensionApi: "^1.0.0",
  markora: "^0.0.1",
} as const;

function extension(
  name: string,
  contributions: Omit<
    Partial<MarkdownEditorExtensionStaticDefinition>,
    "compatibility" | "name" | "version"
  > = {},
) {
  return defineMarkdownEditorExtension({
    name,
    version: "1.0.0",
    compatibility,
    ...contributions,
  });
}

function expectExtensionError(
  operation: () => unknown,
  code: string,
  phase: string = "resolve",
) {
  try {
    operation();
    throw new Error("Expected an extension error.");
  } catch (error) {
    expect(error).toBeInstanceOf(MarkdownEditorExtensionError);
    expect(error).toMatchObject({ code, phase });
    return error as MarkdownEditorExtensionError;
  }
}

describe("extension definition contract", () => {
  it("snapshots and deeply freezes definition-owned data without freezing inputs or functions", () => {
    const serializer = () => {};
    const nodeEntry = {
      name: "acme_panel",
      spec: {
        attrs: { tone: { default: "note" } },
        group: "block",
      },
    };
    const configuration = {
      dialect: { tones: ["note", "warning"] },
    };
    const definition = defineMarkdownEditorExtension({
      name: "@acme/panel",
      version: "1.2.3",
      compatibility,
      configuration,
      schema: { nodes: [nodeEntry] },
      markdown: {
        serializer: { nodes: { acme_panel: serializer } },
      },
    });
    const snapshot = readMarkdownEditorExtensionDefinition(definition);

    configuration.dialect.tones.push("danger");
    nodeEntry.spec.attrs.tone.default = "changed";

    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(snapshot.configuration)).toBe(true);
    expect(Object.isFrozen(snapshot.schema?.nodes)).toBe(true);
    expect(snapshot.configuration).toEqual({
      dialect: { tones: ["note", "warning"] },
    });
    expect(snapshot.schema?.nodes?.[0].spec).toMatchObject({
      attrs: { tone: { default: "note" } },
    });
    expect(snapshot.markdown?.serializer?.nodes?.acme_panel).toBe(serializer);
    expect(Object.isFrozen(configuration)).toBe(false);
    expect(Object.isFrozen(nodeEntry)).toBe(false);
    expect(Object.isFrozen(serializer)).toBe(false);
  });

  it("snapshots accessor values once before validating the immutable carrier", () => {
    let nameReads = 0;
    const definition = defineMarkdownEditorExtension({
      get name() {
        nameReads += 1;
        return nameReads === 1 ? "acme-accessor" : "Bad Name";
      },
      version: "1.0.0",
      compatibility,
    });

    expect(nameReads).toBe(1);
    expect(definition.name).toBe("acme-accessor");
  });

  it("snapshots preset metadata once while retaining exact definition identity", () => {
    const member = extension("acme-preset-member");
    let nameReads = 0;
    const preset = defineMarkdownEditorPreset({
      get name() {
        nameReads += 1;
        return nameReads === 1 ? "acme-accessor-preset" : "Bad Name";
      },
      version: "1.0.0",
      extensions: [member],
    });

    expect(nameReads).toBe(1);
    expect(preset.name).toBe("acme-accessor-preset");
    expect(preset.extensions[0]).toBe(member);
  });

  it("reserves project namespaces for the internal definition helper", () => {
    expectExtensionError(() => defineMarkdownEditorExtension({
      name: "@markora/table",
      version: "1.0.0",
      compatibility,
    }), "EXTENSION_INVALID_DEFINITION");
    expectExtensionError(() => defineMarkdownEditorExtension({
      name: "markora/table",
      version: "1.0.0",
      compatibility,
    }), "EXTENSION_INVALID_DEFINITION");

    const projectDefinition = defineMarkoraMarkdownEditorExtension({
      name: "@markora/table",
      version: "1.0.0",
      compatibility,
    });

    expect(readMarkdownEditorExtensionDefinition(projectDefinition).name).toBe(
      "@markora/table",
    );
  });

  it("allows a static-only definition and a storage-free runtime definition", () => {
    const staticOnly = extension("acme-static");
    const runtime = defineMarkdownEditorExtension({
      name: "acme-runtime",
      version: "1.0.0",
      compatibility,
      createRuntime: ({ storage }) => {
        expect(storage).toBeUndefined();
        return {
          commands: { ping: () => true },
          state: { ready: () => true },
        };
      },
    });

    expect(readMarkdownEditorExtensionDefinition(staticOnly).createRuntime).toBeUndefined();
    expect(readMarkdownEditorExtensionDefinition(runtime).createStorage).toBeUndefined();
    expect(readMarkdownEditorExtensionDefinition(runtime).createRuntime).toBeTypeOf("function");
  });

  it("rejects invalid metadata, local IDs, parser roots, and configuration", () => {
    expectExtensionError(() => extension("Bad Name"), "EXTENSION_INVALID_DEFINITION");
    expectExtensionError(() => defineMarkdownEditorExtension({
      name: "acme-version",
      version: "01.0.0",
      compatibility,
    }), "EXTENSION_INVALID_DEFINITION");
    expectExtensionError(() => defineMarkdownEditorExtension({
      name: "acme-range",
      version: "1.0.0",
      compatibility: { extensionApi: "latest", markora: "^0.0.1" },
    }), "EXTENSION_INVALID_DEFINITION");

    const tokenizerError = expectExtensionError(() => extension("acme-tokenizer", {
      markdown: {
        tokenizerRules: [{
          id: "Bad Rule",
          phase: "block",
          createRule: () => () => false,
        }],
      },
    }), "EXTENSION_INVALID_DEFINITION", "tokenizer");
    expect(tokenizerError.extension).toBe("acme-tokenizer");

    expectExtensionError(() => extension("acme-parser", {
      markdown: { parserTokens: { container_open: { ignore: true } } },
    }), "EXTENSION_INVALID_DEFINITION", "codec");

    expectExtensionError(() => extension("acme-parser-shape", {
      markdown: { parserTokens: { container: {} as never } },
    }), "EXTENSION_INVALID_DEFINITION", "codec");

    expectExtensionError(() => extension("acme-parser-targets", {
      markdown: {
        parserTokens: {
          container: { block: "acme_block", mark: "acme_mark" } as never,
        },
      },
    }), "EXTENSION_INVALID_DEFINITION", "codec");

    expectExtensionError(() => extension("acme-node-serializer", {
      markdown: {
        serializer: { nodes: { acme_node: {} as never } },
      },
    }), "EXTENSION_INVALID_DEFINITION", "codec");

    expectExtensionError(() => extension("acme-mark-serializer", {
      markdown: {
        serializer: { marks: { acme_mark: { open: "==" } as never } },
      },
    }), "EXTENSION_INVALID_DEFINITION", "codec");

    expectExtensionError(() => extension("acme-schema", {
      schema: { nodes: [{ name: "BadNode", spec: { group: "block" } }] },
    }), "EXTENSION_INVALID_DEFINITION", "schema");

    expectExtensionError(() => extension("acme-config", {
      configuration: { invalid: Number.NaN } as never,
    }), "EXTENSION_INVALID_DEFINITION");
  });

  it("rejects structural impostors at runtime", () => {
    const impostor = {
      name: "acme-impostor",
      version: "1.0.0",
      compatibility,
    };

    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [impostor as never],
    }), "EXTENSION_INVALID_DEFINITION");
  });
});

describe("extension graph resolution", () => {
  it("applies dependencies and required/optional ordering with a stable host-order fallback", () => {
    const dependent = extension("acme-dependent", {
      dependencies: [{ name: "acme-base", version: "^1.0.0" }],
      after: ["acme-first"],
      before: [{ name: "acme-missing", optional: true }],
    });
    const first = extension("acme-first");
    const optionalDependent = extension("acme-optional-dependent", {
      dependencies: [{
        name: "acme-base",
        version: "^1.0.0",
        optional: true,
      }],
    });
    const base = extension("acme-base");
    const resolution = resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [dependent, first, optionalDependent, base],
    });

    expect(resolution.extensions.map(({ definition }) => definition.name)).toEqual([
      "acme-first",
      "acme-base",
      "acme-dependent",
      "acme-optional-dependent",
    ]);
  });

  it("retains registration order for unconstrained definitions", () => {
    const third = extension("acme-third");
    const first = extension("acme-first");
    const second = extension("acme-second");
    const resolution = resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [third, first, second],
    });

    expect(resolution.extensions.map(({ definition }) => definition.name)).toEqual([
      "acme-third",
      "acme-first",
      "acme-second",
    ]);
  });

  it("rejects duplicate names, including repeated exact definitions", () => {
    const duplicate = extension("acme-duplicate");
    const error = expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [duplicate, duplicate],
    }), "EXTENSION_CONFLICT");

    expect(error.message).toContain("definition #1");
    expect(error.message).toContain("definition #2");

    const clone = extension("acme-duplicate");
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [duplicate, clone],
    }), "EXTENSION_CONFLICT");
  });

  it("rejects missing dependencies and required order targets while ignoring missing optional peers", () => {
    const missingDependency = extension("acme-dependent", {
      dependencies: [{ name: "acme-base", version: "^1.0.0" }],
    });
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [missingDependency],
    }), "EXTENSION_MISSING_DEPENDENCY");

    const missingOrderTarget = extension("acme-ordered", {
      before: ["acme-absent"],
    });
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [missingOrderTarget],
    }), "EXTENSION_MISSING_DEPENDENCY");

    const optionalPeers = extension("acme-optional-peers", {
      dependencies: [{ name: "acme-base", version: "^1.0.0", optional: true }],
      after: [{ name: "acme-after", optional: true }],
      before: [{ name: "acme-before", optional: true }],
    });
    expect(resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [optionalPeers],
    }).extensions).toHaveLength(1);
  });

  it("checks extension API, Markora, required, and installed optional dependency versions", () => {
    const wrongApi = defineMarkdownEditorExtension({
      name: "acme-api-v2",
      version: "1.0.0",
      compatibility: { extensionApi: "^2.0.0", markora: "^0.0.1" },
    });
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [wrongApi],
    }), "EXTENSION_INCOMPATIBLE");

    const wrongMarkora = defineMarkdownEditorExtension({
      name: "acme-markora-v2",
      version: "1.0.0",
      compatibility: { extensionApi: "^1.0.0", markora: ">=2.0.0" },
    });
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [wrongMarkora],
    }), "EXTENSION_INCOMPATIBLE");

    const oldBase = defineMarkdownEditorExtension({
      name: "acme-base",
      version: "1.5.0",
      compatibility,
    });
    const requiredV2 = extension("acme-required-v2", {
      dependencies: [{ name: "acme-base", version: "^2.0.0" }],
    });
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [oldBase, requiredV2],
    }), "EXTENSION_INCOMPATIBLE");

    const optionalV2 = extension("acme-optional-v2", {
      dependencies: [{ name: "acme-base", version: "^2.0.0", optional: true }],
    });
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [oldBase, optionalV2],
    }), "EXTENSION_INCOMPATIBLE");
  });

  it("rejects declared conflicts and reports the participants", () => {
    const first = extension("acme-first", { conflicts: ["acme-second"] });
    const second = extension("acme-second");
    const error = expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [first, second],
    }), "EXTENSION_CONFLICT");

    expect(error.participants).toEqual(["acme-first", "acme-second"]);
    expect(Object.isFrozen(error.participants)).toBe(true);
  });

  it("rejects dependency/order cycles and reports only cycle participants", () => {
    const first = extension("acme-first", { after: ["acme-third"] });
    const second = extension("acme-second", { after: ["acme-first"] });
    const third = extension("acme-third", { after: ["acme-second"] });
    const downstream = extension("acme-downstream", { after: ["acme-third"] });
    const error = expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      extensions: [first, second, third, downstream],
    }), "EXTENSION_ORDER_CYCLE");

    expect(new Set(error.participants)).toEqual(new Set([
      "acme-first",
      "acme-second",
      "acme-third",
    ]));
    expect(error.participants).not.toContain("acme-downstream");
  });

  it("creates a frozen resolved-order persistence manifest from a named preset plus additions", () => {
    const base = extension("acme-base", {
      configuration: { dialect: "base" },
    });
    const feature = extension("acme-feature", {
      dependencies: [{ name: "acme-base", version: "^1.0.0" }],
    });
    const preset = defineMarkdownEditorPreset({
      name: "acme-default-preset",
      version: "3.2.1",
      extensions: [base],
    });
    const resolution = resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      preset,
      extensions: [feature],
    });

    expect(resolution.manifest).toEqual({
      extensionApi: "1.0.0",
      preset: { name: "acme-default-preset", version: "3.2.1" },
      extensions: [
        { name: "acme-base", version: "1.0.0", configuration: { dialect: "base" } },
        { name: "acme-feature", version: "1.0.0" },
      ],
    });
    expect(Object.isFrozen(preset)).toBe(true);
    expect(Object.isFrozen(preset.extensions)).toBe(true);
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(Object.isFrozen(resolution.extensions)).toBe(true);
    expect(Object.isFrozen(resolution.manifest)).toBe(true);
    expect(Object.isFrozen(resolution.manifest.extensions)).toBe(true);
  });

  it("rejects an explicitly invalid preset value instead of treating it as absent", () => {
    expectExtensionError(() => resolveMarkdownEditorExtensions({
      markoraVersion: "0.0.1",
      preset: null as never,
    }), "EXTENSION_INVALID_DEFINITION");
  });
});

describe("extension SemVer subset", () => {
  it("supports the documented production range forms", () => {
    expect(isValidMarkdownEditorSemVerRange("^1.2.3")).toBe(true);
    expect(isValidMarkdownEditorSemVerRange("~1.2.3")).toBe(true);
    expect(isValidMarkdownEditorSemVerRange(">=1.0.0 <2.0.0 || 3.x")).toBe(true);
    expect(isValidMarkdownEditorSemVerRange("1.2.3 - 2.0.0")).toBe(true);
    expect(markdownEditorSemVerSatisfies("1.9.0", "^1.2.3")).toBe(true);
    expect(markdownEditorSemVerSatisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(markdownEditorSemVerSatisfies("0.0.2", "^0.0.1")).toBe(false);
    expect(markdownEditorSemVerSatisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(markdownEditorSemVerSatisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(markdownEditorSemVerSatisfies("9.0.0", "*")).toBe(true);
    expect(markdownEditorSemVerSatisfies("1.2.3-beta.2", ">=1.2.3-beta.1 <1.2.3")).toBe(true);
    expect(markdownEditorSemVerSatisfies("1.2.3-beta.2", ">=1.0.0 <2.0.0")).toBe(false);
  });
});
