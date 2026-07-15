import { afterEach, describe, expect, it } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  composePrototypeExtensions,
  defineMarkdownEditorExtension,
  type PrototypeMarkdownEditorExtension,
} from "./support/contract";
import {
  calloutActivityKey,
  calloutExtension,
  highlightActivityKey,
  highlightExtension,
  opaqueDirectiveFallbackExtension,
  prototypeExtensions,
} from "./support/extensions";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) {
    views.pop()?.destroy();
  }
});

function createView(state: EditorState) {
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, { state });
  views.push(view);
  return view;
}

function minimalExtension(
  name: string,
  contributions: Partial<PrototypeMarkdownEditorExtension> = {},
) {
  return defineMarkdownEditorExtension({
    name,
    version: "1.0.0",
    compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
    createRuntime: () => ({ commands: {}, state: {} }),
    ...contributions,
  });
}

describe("EE-009 executable extension contract", () => {
  it("composes additive block and inline schema contributions", () => {
    const composition = composePrototypeExtensions(prototypeExtensions);

    expect(Object.isFrozen(calloutExtension)).toBe(true);
    expect(Object.isFrozen(calloutExtension.schema?.nodes)).toBe(true);
    expect(composition.schema.nodes.callout).toBeDefined();
    expect(composition.schema.marks.highlight).toBeDefined();
    expect(composition.storage["@example/highlight"]).toBeUndefined();

    const baseline = composition.parse("# Heading\n\n* one\n* two");
    expect(baseline.firstChild?.type.name).toBe("heading");
    expect(baseline.lastChild?.type.name).toBe("bullet_list");
  });

  it("round-trips a rich callout containing nested inline highlighting", () => {
    const composition = composePrototypeExtensions(prototypeExtensions);
    const source = [
      ":::warning Deploy",
      "Read ==the **runbook**== first.",
      ":::",
      "",
      "After.",
    ].join("\n");
    const doc = composition.parse(source);
    const callout = doc.firstChild;

    expect(callout?.type.name).toBe("callout");
    expect(callout?.attrs).toMatchObject({
      kind: "warning",
      title: "Deploy",
    });

    let runbookMarks: string[] = [];
    doc.descendants((node) => {
      if (node.isText && node.text === "runbook") {
        runbookMarks = node.marks.map((mark) => mark.type.name).sort();
      }
    });

    expect(runbookMarks).toEqual(["highlight", "strong"]);

    const normalized = composition.serialize(doc);
    expect(normalized).toBe([
      ":::warning Deploy",
      "Read ==the **runbook**== first.",
      "",
      ":::",
      "",
      "After.",
    ].join("\n"));
    expect(composition.parse(normalized).eq(doc)).toBe(true);
  });

  it("orders a specific callout tokenizer before a generic directive fallback", () => {
    const knownSource = ":::note Heads up\nKnown syntax.\n:::";
    const unknownSource = ":::custom value\nUnknown syntax.\n:::";
    const extensionOrders = [
      [opaqueDirectiveFallbackExtension, calloutExtension, highlightExtension],
      [highlightExtension, calloutExtension, opaqueDirectiveFallbackExtension],
    ] as const;

    for (const extensionOrder of extensionOrders) {
      const composition = composePrototypeExtensions(extensionOrder);
      expect(composition.parse(knownSource).firstChild?.type.name).toBe("callout");
      expect(composition.parse(unknownSource).firstChild?.type.name).toBe("code_block");

      const knownTokenTypes = composition.tokenizer
        .parse(knownSource, {})
        .map((token) => token.type);
      const unknownTokenTypes = composition.tokenizer
        .parse(unknownSource, {})
        .map((token) => token.type);

      expect(knownTokenTypes).toContain("@example/callout/container_open");
      expect(knownTokenTypes).not.toContain("code_block");
      expect(unknownTokenTypes).toContain("code_block");
    }

    const withoutFallback = composePrototypeExtensions([
      calloutExtension,
      highlightExtension,
    ]);
    expect(withoutFallback.parse(knownSource).firstChild?.type.name).toBe("callout");
  });

  it("runs host commands through an attached ProseMirror state", () => {
    const composition = composePrototypeExtensions(prototypeExtensions);
    const doc = composition.parse("Alpha\n\nBeta");
    const state = EditorState.create({
      doc,
      plugins: [...composition.plugins],
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    const wrapWarningCallout = composition
      .commands["@example/callout"]
      .wrapWarningCallout;

    expect(() => wrapWarningCallout()).toThrowError(
      "Prototype editor state is unavailable until attachState(state) is called.",
    );
    composition.attachState(state);
    expect(wrapWarningCallout()).toBe(true);
    const nextState = composition.currentState!;

    expect(nextState.doc.firstChild?.type.name).toBe("callout");
    expect(nextState.doc.firstChild?.attrs).toMatchObject({
      kind: "warning",
      title: "Deploy",
    });
    expect(calloutActivityKey.getState(nextState)).toBe(1);
    expect(highlightActivityKey.getState(nextState)).toBe(1);
    expect(composition.state["@example/callout"].commandRuns()).toBe(1);

    const secondComposition = composePrototypeExtensions(prototypeExtensions);
    const secondDoc = secondComposition.parse("Gamma\n\nDelta");
    secondComposition.attachState(EditorState.create({
      doc: secondDoc,
      plugins: [...secondComposition.plugins],
      selection: TextSelection.create(secondDoc, 1, secondDoc.content.size - 1),
    }));
    expect(
      secondComposition.commands["@example/callout"].wrapWarningCallout(),
    ).toBe(true);
    expect(secondComposition.state["@example/callout"].commandRuns()).toBe(1);
    expect(composition.state["@example/callout"].commandRuns()).toBe(1);
  });

  it("composes explicit plugins, input rules, and keymaps in stable order", () => {
    const composition = composePrototypeExtensions(prototypeExtensions);

    expect(composition.pluginOrder).toEqual([
      "@example/highlight/input-rule/highlight-delimiters",
      "@example/callout/plugin/activity",
      "@example/highlight/plugin/activity",
      "@example/callout/keymap/wrap-warning-callout",
      "@example/highlight/keymap/toggle-highlight",
    ]);

    const inputDoc = composition.parse("Make ==urgent=");
    const inputView = createView(EditorState.create({
      doc: inputDoc,
      plugins: [...composition.plugins],
      selection: TextSelection.atEnd(inputDoc),
    }));
    const inputPosition = inputView.state.selection.from;
    const inputHandled = inputView.someProp("handleTextInput", (handler) => handler(
      inputView,
      inputPosition,
      inputPosition,
      "=",
      () => inputView.state.tr.insertText("=", inputPosition, inputPosition),
    ));

    expect(inputHandled).toBe(true);
    expect(composition.serialize(inputView.state.doc)).toBe("Make ==urgent==");
    expect(highlightActivityKey.getState(inputView.state)).toBe(1);

    const keymapDoc = composition.parse("urgent");
    const keymapView = createView(EditorState.create({
      doc: keymapDoc,
      plugins: [...composition.plugins],
      selection: TextSelection.create(keymapDoc, 1, 7),
    }));
    const keyHandled = keymapView.someProp("handleKeyDown", (handler) => handler(
      keymapView,
      new KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "h",
        shiftKey: true,
      }),
    ));

    expect(keyHandled).toBe(true);
    expect(composition.serialize(keymapView.state.doc)).toBe("==urgent==");
    expect(highlightActivityKey.getState(keymapView.state)).toBe(1);
  });

  it("rejects duplicate extension definitions with both declaration sites", () => {
    const duplicate = minimalExtension("@example/duplicate");

    expect(() => composePrototypeExtensions([duplicate, duplicate])).toThrowError(
      'Extension "@example/duplicate" is declared by both definition #1 and definition #2.',
    );
  });

  it("rejects schema ownership conflicts with both extension names", () => {
    const first = minimalExtension("@example/first-schema", {
      schema: {
        nodes: [
          {
            name: "shared_block",
            spec: { atom: true, group: "block" },
          },
        ],
      },
    });
    const second = minimalExtension("@example/second-schema", {
      schema: {
        nodes: [
          {
            name: "shared_block",
            spec: { atom: true, group: "block" },
          },
        ],
      },
    });

    expect(() => composePrototypeExtensions([first, second])).toThrowError(
      'Schema node "shared_block" is owned by both "@example/first-schema" and "@example/second-schema".',
    );
  });

  it("rejects non-local Markdown parser token IDs", () => {
    const invalid = minimalExtension("@example/invalid-parser", {
      markdown: {
        parserTokens: {
          "@reserved/token": { ignore: true },
        },
      },
    });

    expect(() => composePrototypeExtensions([invalid])).toThrowError(
      'Markdown parser token local ID "@reserved/token" from "@example/invalid-parser" must use lowercase local characters and cannot reserve _open/_close suffixes.',
    );
  });

  it("namespaces the same local command name under separate owner handles", () => {
    const first = minimalExtension("@example/first-command", {
      createRuntime: () => ({
        commands: { sharedCommand: () => true },
        state: {},
      }),
    });
    const second = minimalExtension("@example/second-command", {
      createRuntime: () => ({
        commands: { sharedCommand: () => false },
        state: {},
      }),
    });
    const composition = composePrototypeExtensions([first, second]);

    expect(composition.commands["@example/first-command"].sharedCommand).not.toBe(
      composition.commands["@example/second-command"].sharedCommand,
    );
  });

  it("chains duplicate key bindings in resolved extension order", () => {
    const calls: string[] = [];
    const first = minimalExtension("@example/first-keymap", {
      createRuntime: () => {
        const firstCommand: Command = () => {
          calls.push("first");
          return false;
        };

        return {
          commands: {},
          state: {},
          keymaps: [
            {
              id: "shared-key",
              key: "Ctrl-k",
              create: () => firstCommand,
            },
          ],
        };
      },
    });
    const second = minimalExtension("@example/second-keymap", {
      createRuntime: () => {
        const secondCommand: Command = () => {
          calls.push("second");
          return true;
        };

        return {
          commands: {},
          state: {},
          keymaps: [
            {
              id: "shared-key",
              key: "Ctrl-k",
              create: () => secondCommand,
            },
          ],
        };
      },
    });
    const composition = composePrototypeExtensions([first, second]);
    const doc = composition.parse("Key chain");
    const view = createView(EditorState.create({
      doc,
      plugins: [...composition.plugins],
    }));
    const handled = view.someProp("handleKeyDown", (handler) => handler(
      view,
      new KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "k",
      }),
    ));

    expect(handled).toBe(true);
    expect(calls).toEqual(["first", "second"]);
    expect(composition.pluginOrder).toEqual([
      "@example/first-keymap/keymap/shared-key",
      "@example/second-keymap/keymap/shared-key",
    ]);
  });
});
