import { afterEach, describe, expect, it } from "vitest";
import {
  MarkdownEditorExtensionError,
  createEditor,
  defineMarkdownEditorExtension,
  type MarkdownEditor,
  type MarkdownEditorChangeOrigin,
} from "../src";
import {
  calloutActivityKey,
  calloutExtension,
  highlightExtension,
} from "./support/publicExtensions";

const editors: MarkdownEditor[] = [];

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({ cancel() {}, finished: Promise.resolve() })) as typeof Element.prototype.animate;
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

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }

  document.body.innerHTML = "";
});

describe("public editor extensions", () => {
  it("exposes only the immutable public codec facade to extensions", () => {
    let capturedCodec: unknown;
    const probe = defineMarkdownEditorExtension({
      name: "acme-codec-facade",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createStorage: ({ codec }) => {
        capturedCodec = codec;
        return {};
      },
      createRuntime: () => ({}),
    });

    track(createEditor({ element: createHost(), extensions: [probe] }));

    expect(Object.isFrozen(capturedCodec)).toBe(true);
    expect(Object.keys(capturedCodec as object).sort()).toEqual([
      "parse",
      "schema",
      "serialize",
    ]);
    expect(capturedCodec).not.toHaveProperty("managedBlocks");
    expect(capturedCodec).not.toHaveProperty("parser");
    expect(capturedCodec).not.toHaveProperty("serializer");
    expect(capturedCodec).not.toHaveProperty("tokenizer");
  });

  it("installs external block and inline syntax into one coherent codec", () => {
    const markdown = ":::warning Deploy\n\nInside ==hot **and bold**==.\n\n:::";
    const editor = track(createEditor({
      element: createHost(),
      extensions: [highlightExtension, calloutExtension],
      markdown,
    }));
    const callout = editor.view.state.doc.firstChild;
    let highlighted = false;

    callout?.descendants((node) => {
      highlighted ||= node.marks.some(
        (mark) => mark.type === editor.view.state.schema.marks.acme_highlight,
      );
    });

    expect(callout?.type.name).toBe("acme_callout");
    expect(callout?.attrs).toMatchObject({ kind: "warning", title: "Deploy" });
    expect(highlighted).toBe(true);
    expect(editor.getMarkdown()).toBe(
      ":::warning Deploy\nInside ==hot **and bold**==.\n\n:::",
    );
    expect(editor.extensions.manifest.extensions.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["@acme/highlight", "@acme/callout", "@markora/table"]),
    );
  });

  it("exposes exact typed handles with isolated per-editor storage", () => {
    const first = track(createEditor({
      element: createHost(),
      extensions: [calloutExtension],
      markdown: "first",
    }));
    const second = track(createEditor({
      element: createHost(),
      extensions: [calloutExtension],
      markdown: "second",
    }));
    const firstHandle = first.extensions.get(calloutExtension);
    const secondHandle = second.extensions.get(calloutExtension);

    expect(firstHandle).toBe(first.extensions.get("@acme/callout"));
    expect(firstHandle).not.toBe(secondHandle);
    expect(firstHandle.storage).not.toBe(secondHandle.storage);
    expect(firstHandle.storage.commandRuns).toBe(0);
    expect(secondHandle.storage.commandRuns).toBe(0);
    expect(first.extensions.has(calloutExtension)).toBe(true);
    expect(first.extensions.has(highlightExtension)).toBe(false);
    expect(() => first.extensions.get(highlightExtension)).toThrow(
      expect.objectContaining({ code: "EXTENSION_NOT_INSTALLED" }),
    );
  });

  it("runs host-shaped commands through read-only and origin policy", () => {
    const editor = track(createEditor({
      element: createHost(),
      extensions: [calloutExtension],
      markdown: "paragraph",
    }));
    const handle = editor.extensions.get(calloutExtension);
    const origins: MarkdownEditorChangeOrigin[] = [];
    editor.subscribe("update", (event) => origins.push(event.origin));

    expect(handle.commands.wrapWarning()).toBe(true);
    expect(handle.state.commandRuns()).toBe(1);
    expect(handle.storage.commandRuns).toBe(1);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("acme_callout");
    expect(origins).toContain("extension:@acme/callout");
    expect(calloutActivityKey.getState(editor.view.state)).toBeGreaterThan(0);

    editor.updateOptions({ editable: false });
    expect(handle.commands.wrapWarning()).toBe(false);
    expect(handle.storage.commandRuns).toBe(1);
  });

  it("retains one assembly and storage across reconcile and reset", () => {
    const editor = track(createEditor({
      element: createHost(),
      extensions: [calloutExtension],
      markdown: "paragraph",
    }));
    const handle = editor.extensions.get(calloutExtension);
    handle.commands.wrapWarning();

    expect(editor.commands.reconcileMarkdown("reconciled")).toBe(true);
    editor.commands.resetMarkdown("reset");

    expect(editor.extensions.get(calloutExtension)).toBe(handle);
    expect(handle.storage.commandRuns).toBe(1);
    expect(editor.getMarkdown()).toBe("reset");
  });

  it("runs setup cleanup before assembly cleanup in reverse extension order", () => {
    const events: string[] = [];
    const createProbe = (name: string) => defineMarkdownEditorExtension({
      name,
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createStorage: ({ lifecycle }) => {
        lifecycle.addCleanup(() => events.push(`${name}:assembly`));
        return { ready: true };
      },
      createRuntime: () => ({
        setup({ lifecycle }) {
          events.push(`${name}:setup`);
          lifecycle.addCleanup(() => events.push(`${name}:setup-cleanup:first`));
          return () => events.push(`${name}:setup-cleanup:return`);
        },
      }),
    });
    const first = createProbe("acme-probe-first");
    const second = createProbe("acme-probe-second");
    const editor = createEditor({
      element: createHost(),
      extensions: [first, second],
    });

    editor.destroy();

    expect(events).toEqual([
      "acme-probe-first:setup",
      "acme-probe-second:setup",
      "acme-probe-second:setup-cleanup:return",
      "acme-probe-second:setup-cleanup:first",
      "acme-probe-first:setup-cleanup:return",
      "acme-probe-first:setup-cleanup:first",
      "acme-probe-second:assembly",
      "acme-probe-first:assembly",
    ]);
  });

  it("attributes cleanup failures without skipping later extension cleanup", () => {
    const events: string[] = [];
    const failing = defineMarkdownEditorExtension({
      name: "acme-failing-cleanup",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createStorage: ({ lifecycle }) => {
        lifecycle.addCleanup(() => events.push("assembly:last"));
        lifecycle.addCleanup(() => {
          events.push("assembly:failure");
          throw new Error("cleanup exploded");
        });
        return {};
      },
      createRuntime: () => ({
        setup: ({ lifecycle }) => {
          lifecycle.addCleanup(() => events.push("setup"));
        },
      }),
    });
    const editor = createEditor({
      element: createHost(),
      extensions: [failing],
    });

    expect(() => editor.destroy()).toThrow(expect.objectContaining({
      code: "EXTENSION_CLEANUP_FAILED",
      phase: "destroy",
      extension: "acme-failing-cleanup",
      contribution: "assembly",
    }));
    expect(events).toEqual(["setup", "assembly:failure", "assembly:last"]);
    expect(editor.isDestroyed).toBe(true);
  });

  it("rolls back extension resources before claiming the host", () => {
    const events: string[] = [];
    const failing = defineMarkdownEditorExtension({
      name: "acme-failing-runtime",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createStorage: ({ lifecycle }) => {
        lifecycle.addCleanup(() => events.push("cleanup"));
        return {};
      },
      createRuntime() {
        throw new Error("runtime exploded");
      },
    });
    const host = createHost();
    const original = document.createElement("span");
    host.append(original);

    expect(() => createEditor({ element: host, extensions: [failing] })).toThrow(
      expect.objectContaining({
        code: "EXTENSION_FACTORY_FAILED",
        phase: "assemble",
      }),
    );
    expect(events).toEqual(["cleanup"]);
    expect(host.classList.contains("mdw-host")).toBe(false);
    expect([...host.childNodes]).toEqual([original]);
  });

  it("rolls back the current extension when its runtime shape is invalid", () => {
    const events: string[] = [];
    const malformed = defineMarkdownEditorExtension({
      name: "acme-malformed-runtime",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime({ lifecycle }) {
        lifecycle.addCleanup(() => events.push("cleanup"));
        return {
          commands: { invalid: 42 },
        } as never;
      },
    });
    const host = createHost();

    expect(() => createEditor({ element: host, extensions: [malformed] })).toThrow(
      expect.objectContaining({
        code: "EXTENSION_INVALID_DEFINITION",
        phase: "assemble",
        extension: "acme-malformed-runtime",
      }),
    );
    expect(events).toEqual(["cleanup"]);
    expect(host.classList.contains("mdw-host")).toBe(false);
  });

  it("rejects bridge access while createRuntime is still assembling", () => {
    const eager = defineMarkdownEditorExtension({
      name: "acme-eager-runtime",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime({ getState }) {
        getState();
        return {};
      },
    });

    expect(() => createEditor({ element: createHost(), extensions: [eager] })).toThrow(
      expect.objectContaining({
        code: "EXTENSION_RUNTIME_NOT_READY",
      }),
    );
  });

  it("surfaces extension errors as structured failures", () => {
    const conflicting = defineMarkdownEditorExtension({
      name: "acme-conflicting-node",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      schema: {
        nodes: [{ name: "paragraph", spec: { content: "inline*", group: "block" } }],
      },
    });

    expect(() => createEditor({
      element: createHost(),
      extensions: [conflicting],
    })).toThrow(MarkdownEditorExtensionError);
  });

  it("delivers reported runtime failures to typed error subscribers", () => {
    const reporting = defineMarkdownEditorExtension({
      name: "acme-reporting-runtime",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: ({ reportError }) => ({
        commands: {
          report: () => {
            reportError(new Error("reported"), "report-command");
            return true;
          },
        },
      }),
    });
    const editor = track(createEditor({
      element: createHost(),
      extensions: [reporting],
    }));
    const events: Array<{ code: string; extension?: string; contribution?: string }> = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") {
        events.push({
          code: event.code,
          extension: event.context.extension,
          contribution: event.context.contribution,
        });
      }
    });

    expect(editor.extensions.get(reporting).commands.report()).toBe(true);
    expect(events).toEqual([{
      code: "EXTENSION_RUNTIME_FAILED",
      extension: "acme-reporting-runtime",
      contribution: "report-command",
    }]);
  });

  it("notifies subscribers before rethrowing host-invoked command and state failures", () => {
    const failing = defineMarkdownEditorExtension({
      name: "acme-failing-host-calls",
      version: "1.0.0",
      compatibility: { markora: "^0.0.1", extensionApi: "^1.0.0" },
      createRuntime: () => ({
        commands: {
          fail: () => {
            throw new Error("command failed");
          },
        },
        state: {
          fail: () => {
            throw new Error("state failed");
          },
        },
      }),
    });
    const editor = track(createEditor({
      element: createHost(),
      extensions: [failing],
    }));
    const events: Array<{ phase?: string; contribution?: string }> = [];
    editor.subscribe("error", (event) => {
      if (event.code !== "code-block-language-load-failed") {
        events.push({
          phase: event.context.phase,
          contribution: event.context.contribution,
        });
      }
    });
    const handle = editor.extensions.get(failing);

    expect(() => handle.commands.fail()).toThrow(expect.objectContaining({
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "command",
    }));
    expect(() => handle.state.fail()).toThrow(expect.objectContaining({
      code: "EXTENSION_RUNTIME_FAILED",
      phase: "state",
    }));
    expect(events).toEqual([
      { phase: "command", contribution: "fail" },
      { phase: "state", contribution: "fail" },
    ]);
  });
});
