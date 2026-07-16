import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MarkdownEditorExtensionError,
  createEditor as createCompatibilityEditor,
  defineMarkdownEditorExtension,
  type MarkdownEditor,
  type MarkdownEditorErrorEvent,
  type MarkdownEditorTokenizerRule,
} from "../src";
import { createEditor as createMinimalEditor } from "../src/minimal";

type BlockRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "block" }
>["createRule"]>;

const extensionName = "@acme/codec-errors";
const nodeName = "acme_codec_error";
const markName = "acme_codec_error_mark";

const editors: MarkdownEditor[] = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({
    cancel() {},
    finished: Promise.resolve(),
  })) as typeof Element.prototype.animate;
}

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function lineText(state: Parameters<BlockRule>[0], line: number) {
  const start = state.bMarks[line] + state.tShift[line];
  return state.src.slice(start, state.eMarks[line]);
}

function createFailingCodecExtension() {
  const causes = {
    getAttrs: new Error("parser getAttrs failed"),
    markSerializer: new Error("mark serializer failed"),
    nodeSerializer: new Error("node serializer failed"),
    tokenizer: new Error("tokenizer failed"),
  };
  const failures = {
    getAttrs: false,
    markSerializer: false,
    nodeSerializer: false,
    tokenizer: false,
  };
  const extension = defineMarkdownEditorExtension({
    name: extensionName,
    version: "1.0.0",
    compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
    schema: {
      nodes: [{
        name: nodeName,
        before: "blockquote",
        spec: {
          atom: true,
          group: "block",
          parseDOM: [{ tag: "div[data-acme-codec-error]" }],
          toDOM() {
            return ["div", { "data-acme-codec-error": "true" }];
          },
        },
      }],
      marks: [{
        name: markName,
        before: "em",
        spec: {
          parseDOM: [{ tag: "span[data-acme-codec-error-mark]" }],
          toDOM() {
            return ["span", { "data-acme-codec-error-mark": "true" }, 0];
          },
        },
      }],
    },
    markdown: {
      tokenizerRules: [{
        id: "node",
        phase: "block",
        before: ["@markora/foundation/block/paragraph"],
        createRule: ({ token }) => (state, startLine, _endLine, silent) => {
          if (lineText(state, startLine) !== ":::codec-error") {
            return false;
          }

          if (failures.tokenizer) {
            throw causes.tokenizer;
          }

          if (silent) {
            return true;
          }

          const parsed = state.push(token("node"), "div", 0);
          parsed.map = [startLine, startLine + 1];
          state.line = startLine + 1;
          return true;
        },
      }],
      parserTokens: {
        node: {
          block: nodeName,
          getAttrs() {
            if (failures.getAttrs) {
              throw causes.getAttrs;
            }

            return null;
          },
          noCloseToken: true,
        },
      },
      serializer: {
        nodes: {
          [nodeName](state) {
            if (failures.nodeSerializer) {
              throw causes.nodeSerializer;
            }

            state.write(":::codec-error");
          },
        },
        marks: {
          [markName]: {
            open() {
              if (failures.markSerializer) {
                throw causes.markSerializer;
              }

              return "!!";
            },
            close: "!!",
          },
        },
      },
    },
  });

  return { causes, extension, failures };
}

function createReadonlyStateExtension() {
  let runNestedQuery: () => unknown = () => {
    throw new Error("Nested state query was not connected.");
  };
  const extension = defineMarkdownEditorExtension({
    name: "@acme/readonly-state",
    version: "1.0.0",
    compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
    createRuntime: (context) => ({
      commands: {
        appendQuestion: () => context.dispatch(
          context.getState().tr.insertText("?"),
        ),
      },
      state: {
        directDispatch: () => context.dispatch(
          context.getState().tr.insertText("!"),
        ),
        nestedDispatch: () => runNestedQuery(),
        runCommand: () => context.runCommand((state, dispatch) => {
          dispatch?.(state.tr.insertText("!"));
          return true;
        }),
      },
    }),
  });

  return {
    extension,
    connectNestedQuery(query: () => unknown) {
      runNestedQuery = query;
    },
  };
}

function createDestroyReentryExtension() {
  const extensionName = "@acme/destroy-reentry";
  const nodeName = "acme_destroy_reentry";
  let assemblySignal: AbortSignal | undefined;
  let setupSignal: AbortSignal | undefined;
  let editor: MarkdownEditor | undefined;
  let serializerCalls = 0;
  const serializerObservations: Array<{
    assemblyAborted: boolean;
    setupAborted: boolean;
  }> = [];
  const cleanups: string[] = [];
  const extension = defineMarkdownEditorExtension({
    name: extensionName,
    version: "1.0.0",
    compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
    schema: {
      nodes: [{
        name: nodeName,
        before: "blockquote",
        spec: {
          atom: true,
          group: "block",
          parseDOM: [{ tag: "div[data-acme-destroy-reentry]" }],
          toDOM() {
            return ["div", { "data-acme-destroy-reentry": "true" }];
          },
        },
      }],
    },
    markdown: {
      serializer: {
        nodes: {
          [nodeName](state, node) {
            serializerCalls += 1;
            serializerObservations.push({
              assemblyAborted: assemblySignal?.aborted ?? false,
              setupAborted: setupSignal?.aborted ?? false,
            });

            if (serializerCalls === 1) {
              editor?.destroy();
            }

            state.write(":::destroy-reentry");
            state.closeBlock(node);
          },
        },
      },
    },
    createStorage({ lifecycle }) {
      assemblySignal = lifecycle.signal;
      lifecycle.addCleanup(() => cleanups.push("assembly"));
      return {};
    },
    createRuntime: () => ({
      setup(context) {
        editor = context.editor;
        setupSignal = context.lifecycle.signal;
        context.lifecycle.addCleanup(() => cleanups.push("setup"));
      },
    }),
  });

  return {
    cleanups,
    extension,
    nodeName,
    serializerObservations,
    get serializerCalls() {
      return serializerCalls;
    },
  };
}

function expectAttributedFailure(
  operation: () => unknown,
  expected: {
    cause: Error;
    contribution: string;
    phase: "initial-parse" | "parse" | "serialize";
  },
) {
  let thrown: unknown;

  try {
    operation();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(MarkdownEditorExtensionError);
  expect(thrown).toMatchObject({
    cause: expected.cause,
    code: "EXTENSION_RUNTIME_FAILED",
    contribution: expected.contribution,
    extension: extensionName,
    phase: expected.phase,
  });
  return thrown as MarkdownEditorExtensionError;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }

  vi.restoreAllMocks();
  delete (window as Window & { reportError?: (error: unknown) => void }).reportError;
  document.body.innerHTML = "";
});

const entries = [
  ["compatibility", createCompatibilityEditor],
  ["minimal", createMinimalEditor],
] as const;

describe.each(entries)("%s editor extension codec errors", (_entryName, createEditor) => {
  it("runs a returned setup cleanup when setup reentrantly destroys creation", () => {
    let cleanupCalls = 0;
    const extension = defineMarkdownEditorExtension({
      name: "@acme/setup-destroy-reentry",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        setup({ editor }) {
          editor.destroy();
          return () => {
            cleanupCalls += 1;
          };
        },
      }),
    });
    const element = createHost();

    expect(() => createEditor({ element, extensions: [extension] })).toThrow(
      expect.objectContaining({
        code: "EXTENSION_RUNTIME_FAILED",
        phase: "setup",
        extension: "@acme/setup-destroy-reentry",
        contribution: "setup",
      }),
    );
    expect(cleanupCalls).toBe(1);
    expect(element.classList.contains("mdw-host")).toBe(false);
    expect(element.childNodes).toHaveLength(0);

    const recovered = track(createEditor({ element, markdown: "recovered" }));
    expect(recovered.getMarkdown()).toBe("recovered");
  });

  it("defers construction-time reports so the host can subscribe", async () => {
    const reported = new Error("reported while assembling");
    const reporting = defineMarkdownEditorExtension({
      name: "@acme/construction-report",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        setup({ reportError }) {
          reportError(reported, "setup");
        },
      }),
    });
    const fallback = vi.fn();
    (window as Window & { reportError?: (error: unknown) => void }).reportError = fallback;
    const editor = track(createEditor({
      element: createHost(),
      extensions: [reporting],
    }));
    const events: MarkdownEditorErrorEvent[] = [];
    editor.subscribe("error", (event) => events.push(event));

    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: "EXTENSION_RUNTIME_FAILED",
      context: {
        contribution: "setup",
        extension: "@acme/construction-report",
        phase: "assemble",
      },
      error: { cause: reported },
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("keeps state queries read-only across nested dispatch and runCommand calls", async () => {
    const probe = createReadonlyStateExtension();
    const editor = track(createEditor({
      element: createHost(),
      extensions: [probe.extension],
      markdown: "readonly",
    }));
    const handle = editor.extensions.get(probe.extension);
    probe.connectNestedQuery(() => handle.state.directDispatch());
    const fallback = vi.fn();
    (window as Window & { reportError?: (error: unknown) => void }).reportError = fallback;
    const events: MarkdownEditorErrorEvent[] = [];
    editor.subscribe("error", (event) => events.push(event));
    const originalDoc = editor.view.state.doc;

    let nestedError: unknown;
    try {
      handle.state.nestedDispatch();
    } catch (error) {
      nestedError = error;
    }

    expect(nestedError).toBeInstanceOf(MarkdownEditorExtensionError);
    expect(nestedError).toMatchObject({
      code: "EXTENSION_RUNTIME_FAILED",
      contribution: "directDispatch",
      extension: "@acme/readonly-state",
      phase: "state",
    });
    expect(editor.view.state.doc).toBe(originalDoc);

    let commandError: unknown;
    try {
      handle.state.runCommand();
    } catch (error) {
      commandError = error;
    }

    expect(commandError).toBeInstanceOf(MarkdownEditorExtensionError);
    expect(commandError).toMatchObject({
      code: "EXTENSION_RUNTIME_FAILED",
      contribution: "runCommand",
      extension: "@acme/readonly-state",
      phase: "state",
    });
    expect(editor.view.state.doc).toBe(originalDoc);
    expect(events.map((event) => event.error)).toEqual([nestedError, commandError]);
    await Promise.resolve();
    expect(fallback).not.toHaveBeenCalled();

    expect(handle.commands.appendQuestion()).toBe(true);
    expect(editor.view.state.doc).not.toBe(originalDoc);
  });

  it("aborts extension scopes before a final serializer can reenter destroy", () => {
    const probe = createDestroyReentryExtension();
    const host = createHost();
    const editor = track(createEditor({
      element: host,
      extensions: [probe.extension],
      markdown: "safe",
    }));
    const node = editor.view.state.schema.nodes[probe.nodeName].create();
    editor.view.dispatch(editor.view.state.tr.replaceWith(
      0,
      editor.view.state.doc.content.size,
      node,
    ));

    expect(() => editor.destroy()).not.toThrow();
    expect(probe.serializerCalls).toBe(1);
    expect(probe.serializerObservations).toEqual([{
      assemblyAborted: true,
      setupAborted: true,
    }]);
    expect(probe.cleanups).toEqual(["setup", "assembly"]);
    expect(editor.getMarkdown()).toBe(":::destroy-reentry");

    const recovered = track(createEditor({ element: host, markdown: "recovered" }));
    expect(recovered.getMarkdown()).toBe("recovered");
  });

  it("attributes an initial tokenizer execution failure before claiming the host", () => {
    const host = createHost();
    const { causes, extension, failures } = createFailingCodecExtension();
    failures.tokenizer = true;

    expectAttributedFailure(() => createEditor({
      element: host,
      extensions: [extension],
      markdown: ":::codec-error",
    }), {
      cause: causes.tokenizer,
      contribution: `${extensionName}/node`,
      phase: "initial-parse",
    });

    const recovered = track(createEditor({ element: host, markdown: "recovered" }));
    expect(recovered.getMarkdown()).toBe("recovered");
  });

  it("attributes an initial parser getAttrs failure before claiming the host", () => {
    const host = createHost();
    const { causes, extension, failures } = createFailingCodecExtension();
    failures.getAttrs = true;

    expectAttributedFailure(() => createEditor({
      element: host,
      extensions: [extension],
      markdown: ":::codec-error",
    }), {
      cause: causes.getAttrs,
      contribution: `${extensionName}/node`,
      phase: "initial-parse",
    });

    const recovered = track(createEditor({ element: host, markdown: "recovered" }));
    expect(recovered.getMarkdown()).toBe("recovered");
  });

  it("attributes an initial serializer failure before claiming the host", () => {
    const host = createHost();
    const { causes, extension, failures } = createFailingCodecExtension();
    failures.nodeSerializer = true;

    expectAttributedFailure(() => createEditor({
      element: host,
      extensions: [extension],
      markdown: ":::codec-error",
    }), {
      cause: causes.nodeSerializer,
      contribution: `${extensionName}/${nodeName}`,
      phase: "serialize",
    });

    const recovered = track(createEditor({ element: host, markdown: "recovered" }));
    expect(recovered.getMarkdown()).toBe("recovered");
  });

  it("reports later reconcile and reset parse failures, rethrows, and suppresses fallback", async () => {
    const { causes, extension, failures } = createFailingCodecExtension();
    const editor = track(createEditor({
      element: createHost(),
      extensions: [extension],
      markdown: "safe",
    }));
    const fallback = vi.fn();
    (window as Window & { reportError?: (error: unknown) => void }).reportError = fallback;
    const events: MarkdownEditorErrorEvent[] = [];
    editor.subscribe("error", (event) => events.push(event));
    failures.tokenizer = true;

    const reconcileError = expectAttributedFailure(
      () => editor.commands.reconcileMarkdown(":::codec-error"),
      {
        cause: causes.tokenizer,
        contribution: `${extensionName}/node`,
        phase: "parse",
      },
    );
    const resetError = expectAttributedFailure(
      () => editor.commands.resetMarkdown(":::codec-error"),
      {
        cause: causes.tokenizer,
        contribution: `${extensionName}/node`,
        phase: "parse",
      },
    );

    expect(events.map((event) => event.error)).toEqual([reconcileError, resetError]);
    expect(events.map((event) => event.context)).toEqual([
      expect.objectContaining({
        contribution: `${extensionName}/node`,
        extension: extensionName,
        phase: "parse",
      }),
      expect.objectContaining({
        contribution: `${extensionName}/node`,
        extension: extensionName,
        phase: "parse",
      }),
    ]);
    await Promise.resolve();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("reports node serializer failures from reset and getMarkdown without fallback", async () => {
    const { causes, extension, failures } = createFailingCodecExtension();
    const editor = track(createEditor({
      element: createHost(),
      extensions: [extension],
      markdown: "safe",
    }));
    const fallback = vi.fn();
    (window as Window & { reportError?: (error: unknown) => void }).reportError = fallback;
    const events: MarkdownEditorErrorEvent[] = [];
    editor.subscribe("error", (event) => events.push(event));
    failures.nodeSerializer = true;

    const resetError = expectAttributedFailure(
      () => editor.commands.resetMarkdown(":::codec-error"),
      {
        cause: causes.nodeSerializer,
        contribution: `${extensionName}/${nodeName}`,
        phase: "serialize",
      },
    );
    const getMarkdownError = expectAttributedFailure(() => editor.getMarkdown(), {
      cause: causes.nodeSerializer,
      contribution: `${extensionName}/${nodeName}`,
      phase: "serialize",
    });

    expect(events.map((event) => event.error)).toEqual([resetError, getMarkdownError]);
    await Promise.resolve();
    expect(fallback).not.toHaveBeenCalled();
    failures.nodeSerializer = false;
  });

  it("reports functional mark delimiter failures from flushChange without fallback", async () => {
    const { causes, extension, failures } = createFailingCodecExtension();
    const onChange = vi.fn();
    const editor = track(createEditor({
      element: createHost(),
      extensions: [extension],
      markdown: "marked",
      onChange,
      onChangeMode: "animationFrame",
    }));
    const fallback = vi.fn();
    (window as Window & { reportError?: (error: unknown) => void }).reportError = fallback;
    const events: MarkdownEditorErrorEvent[] = [];
    editor.subscribe("error", (event) => events.push(event));
    const mark = editor.view.state.schema.marks[markName].create();
    failures.markSerializer = true;
    editor.view.dispatch(editor.view.state.tr.addMark(1, 7, mark));

    const flushError = expectAttributedFailure(() => editor.flushChange(), {
      cause: causes.markSerializer,
      contribution: `${extensionName}/${markName}`,
      phase: "serialize",
    });

    expect(events.map((event) => event.error)).toEqual([flushError]);
    expect(onChange).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fallback).not.toHaveBeenCalled();
    failures.markSerializer = false;
  });
});
