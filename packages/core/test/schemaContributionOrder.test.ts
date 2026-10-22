import { describe, expect, it } from "vitest";
import type { MarkSpec } from "prosemirror-model";
import {
  defineMarkdownEditorExtension,
  type MarkdownEditorSchemaEntry,
} from "../src/extensionApi";
import { MARKORA_VERSION } from "../src/extensionPresets";
import { resolveMarkdownEditorExtensions } from "../src/extensionResolver";
import { createMarkdownCodec } from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

const compatibility = {
  extensionApi: "^1.0.0",
  markora: "^0.1.0",
} as const;

function markExtension(
  name: string,
  entries: readonly MarkdownEditorSchemaEntry<MarkSpec>[],
) {
  return defineMarkdownEditorExtension({
    name,
    version: "1.0.0",
    compatibility,
    schema: { marks: entries },
    markdown: {
      serializer: {
        marks: Object.fromEntries(entries.map(({ name: entryName }) => [
          entryName,
          { open: "", close: "" },
        ])),
      },
    },
  });
}

function resolvedExtensions(
  extensions: readonly ReturnType<typeof markExtension>[],
) {
  return resolveMarkdownEditorExtensions({
    markoraVersion: MARKORA_VERSION,
    extensions,
  }).extensions;
}

function orderedMarkNames(codec: ReturnType<typeof createMinimalMarkdownCodec>) {
  const names: string[] = [];
  codec.schema.spec.marks.forEach((name) => names.push(name));
  return names;
}

for (const [mode, createCodec] of [
  ["compatibility", createMarkdownCodec],
  ["minimal", createMinimalMarkdownCodec],
] as const) {
  describe(`${mode} schema contribution ordering`, () => {
    it("retains resolved extension and declaration order for a shared after target", () => {
      const first = markExtension("acme-schema-first", [
        { name: "acme_first", spec: {}, after: "em" },
        { name: "acme_second", spec: {}, after: "em" },
      ]);
      const second = markExtension("acme-schema-second", [
        { name: "acme_third", spec: {}, after: "em" },
      ]);
      const names = orderedMarkNames(createCodec(resolvedExtensions([first, second])));
      const emIndex = names.indexOf("em");

      expect(names.slice(emIndex + 1, emIndex + 4)).toEqual([
        "acme_first",
        "acme_second",
        "acme_third",
      ]);
    });

    it("resolves forward before/after chains around their final foundation gap", () => {
      const extension = markExtension("acme-schema-chain", [
        { name: "acme_after", spec: {}, after: "acme_anchor" },
        { name: "acme_before", spec: {}, before: "acme_anchor" },
        { name: "acme_anchor", spec: {}, after: "em" },
      ]);
      const names = orderedMarkNames(createCodec(resolvedExtensions([extension])));
      const emIndex = names.indexOf("em");

      expect(names.slice(emIndex + 1, emIndex + 4)).toEqual([
        "acme_before",
        "acme_anchor",
        "acme_after",
      ]);
    });

    it("keeps missing optional targets unconstrained in declaration order", () => {
      const extension = markExtension("acme-schema-optional", [
        {
          name: "acme_optional",
          spec: {},
          after: { name: "acme_missing", optional: true },
        },
        { name: "acme_unconstrained", spec: {} },
      ]);
      const names = orderedMarkNames(createCodec(resolvedExtensions([extension])));

      expect(names.slice(-2)).toEqual([
        "acme_optional",
        "acme_unconstrained",
      ]);
    });

    it("rejects missing required targets consistently", () => {
      const extension = markExtension("acme-schema-missing", [
        { name: "acme_missing_required", spec: {}, after: "acme_absent" },
      ]);

      expect(() => createCodec(resolvedExtensions([extension]))).toThrow(
        expect.objectContaining({
          code: "EXTENSION_MISSING_DEPENDENCY",
          phase: "schema",
          extension: "acme-schema-missing",
          contribution: "acme_missing_required",
        }),
      );
    });

    it("rejects real cycles but accepts reciprocal declarations of one edge", () => {
      const reciprocal = markExtension("acme-schema-reciprocal", [
        { name: "acme_left", spec: {}, before: "acme_right" },
        { name: "acme_right", spec: {}, after: "acme_left" },
      ]);
      const reciprocalNames = orderedMarkNames(
        createCodec(resolvedExtensions([reciprocal])),
      );

      expect(reciprocalNames.slice(-2)).toEqual(["acme_left", "acme_right"]);

      const cyclic = markExtension("acme-schema-cycle", [
        { name: "acme_cycle_a", spec: {}, after: "acme_cycle_b" },
        { name: "acme_cycle_b", spec: {}, after: "acme_cycle_a" },
      ]);

      expect(() => createCodec(resolvedExtensions([cyclic]))).toThrow(
        expect.objectContaining({
          code: "EXTENSION_ORDER_CYCLE",
          phase: "schema",
          participants: ["acme_cycle_a", "acme_cycle_b"],
        }),
      );
    });

    it("attributes invalid compiled schema specs before the host is touched", () => {
      const invalid = markExtension("acme-schema-invalid-spec", [{
        name: "acme_invalid_spec",
        spec: { excludes: "acme_missing_mark" },
      }]);

      expect(() => createCodec(resolvedExtensions([invalid]))).toThrow(
        expect.objectContaining({
          code: "EXTENSION_INVALID_DEFINITION",
          phase: "schema",
          extension: "acme-schema-invalid-spec",
          cause: expect.any(Error),
        }),
      );
    });
  });
}
