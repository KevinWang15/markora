import AxeBuilder from "@axe-core/playwright";
import type { Request } from "@playwright/test";
import {
  convertPendingDiagramEdit,
  copyEditorSelection,
  destroyEditorOnly,
  editorLocator,
  expect,
  focusEditor,
  getDiagramRendererCalls,
  getDiagramSnapshot,
  getEditorEvents,
  getExtensionSnapshot,
  getMarkdown,
  getPendingDiagramEdit,
  mountEditor,
  reconcileEditor,
  removePendingDiagramEdit,
  resetEditor,
  restorePendingDiagramEdit,
  runDiagramCommand,
  runEditorCommand,
  selectDiagram,
  settleDiagramRenderer,
  settleEditor,
  snapshotEditor,
  test,
  updateEditorOptions,
  updatePendingDiagramEdit,
  type LabDiagramKind,
  type LabDiagramNodeTarget,
} from "./fixtures";

const DIAGRAM_KINDS = ["mermaid", "geojson", "topojson", "stl"] as const;

const FIDELITY_SOURCE = [
  "~~~mermaid theme=neutral",
  "graph TD",
  "A-->B",
  "````",
  "C-->D",
  "~~~",
  "",
  "```geojson map=world",
  '{"type":"Point","coordinates":[1,2]}',
  "```",
  "",
  "```topojson",
  "```",
  "",
  "```stl binary=false",
  "solid cube",
  "endsolid cube",
  "```",
  "",
  "```Mermaid",
  "case-sensitive negative",
  "```",
  "",
  "```plantuml",
  "unknown negative",
  "```",
].join("\n");

const FIDELITY_CANONICAL = [
  "`````mermaid theme=neutral",
  "graph TD",
  "A-->B",
  "````",
  "C-->D",
  "`````",
  "",
  "```geojson map=world",
  '{"type":"Point","coordinates":[1,2]}',
  "```",
  "",
  "```topojson",
  "",
  "```",
  "",
  "```stl binary=false",
  "solid cube",
  "endsolid cube",
  "```",
  "",
  "```Mermaid",
  "case-sensitive negative",
  "```",
  "",
  "```plantuml",
  "unknown negative",
  "```",
].join("\n");

function diagramShell(
  page: Parameters<typeof editorLocator>[0],
  id: string,
  occurrence = 0,
) {
  return editorLocator(page, id).locator("[data-mdw-diagram]").nth(occurrence);
}

function genericCodeBlocks(
  page: Parameters<typeof editorLocator>[0],
  id: string,
  entry: "minimal" | "root",
) {
  const editor = editorLocator(page, id);
  return entry === "minimal"
    ? editor.locator("pre:not(.mdw-diagram__source-shell)")
    : editor.locator(".mdw-code-block");
}

async function waitForDiagramCalls(
  page: Parameters<typeof getDiagramRendererCalls>[0],
  id: string,
  count: number,
) {
  await expect.poll(async () => (await getDiagramRendererCalls(page, id)).length)
    .toBe(count);
}

async function waitForDiagramStatus(
  page: Parameters<typeof getDiagramSnapshot>[0],
  id: string,
  status: string,
  occurrence = 0,
) {
  await expect.poll(async () => (
    await getDiagramSnapshot(page, id)
  ).nodes[occurrence]?.render.status).toBe(status);
}

test("@required diagrams claim four GitHub fence kinds in root and minimal document and Shadow embeds", async ({ labPage }) => {
  const canonical: string[] = [];

  for (const [id, entry, root] of [
    ["diagrams-root-document", "root", "document"],
    ["diagrams-minimal-shadow", "minimal", "shadow"],
  ] as const) {
    await mountEditor(labPage, {
      diagramRendererModes: {},
      entry,
      extensionMode: "diagrams",
      id,
      markdown: FIDELITY_SOURCE,
      root,
    });

    const editor = editorLocator(labPage, id);
    await expect(editor.locator("[data-mdw-diagram]")).toHaveCount(4);
    await expect(genericCodeBlocks(labPage, id, entry)).toHaveCount(2);

    const snapshot = await getDiagramSnapshot(labPage, id);
    expect(snapshot.nodes.map(({ info, kind, source }) => ({ info, kind, source })))
      .toEqual([
        {
          info: "mermaid theme=neutral",
          kind: "mermaid",
          source: "graph TD\nA-->B\n````\nC-->D",
        },
        {
          info: "geojson map=world",
          kind: "geojson",
          source: '{"type":"Point","coordinates":[1,2]}',
        },
        { info: "topojson", kind: "topojson", source: "" },
        {
          info: "stl binary=false",
          kind: "stl",
          source: "solid cube\nendsolid cube",
        },
      ]);
    expect(snapshot.nodes.map(({ render }) => render)).toEqual(
      DIAGRAM_KINDS.map(() => ({ enabled: false, errorCode: null, status: "source" })),
    );
    expect(snapshot.diagnostics).toEqual([]);
    expect(await getDiagramRendererCalls(labPage, id)).toEqual([]);
    expect((await getExtensionSnapshot(labPage, id)).manifest).toContainEqual({
      name: "markora-extension-diagrams",
      version: "0.0.1",
    });

    canonical.push(await getMarkdown(labPage, id));
    expect(canonical[canonical.length - 1]).toBe(FIDELITY_CANONICAL);
    expect(await resetEditor(labPage, id, FIDELITY_CANONICAL))
      .toBe(FIDELITY_CANONICAL);
    expect((await getDiagramSnapshot(labPage, id)).nodes.map(({ info, kind, source }) => ({
      info,
      kind,
      source,
    }))).toEqual(snapshot.nodes.map(({ info, kind, source }) => ({ info, kind, source })));
  }

  expect(canonical[1]).toBe(canonical[0]);

  for (const [id, entry] of [
    ["diagrams-absent-root", "root"],
    ["diagrams-absent-minimal", "minimal"],
  ] as const) {
    await mountEditor(labPage, {
      entry,
      id,
      markdown: "```mermaid\ngraph TD; A-->B\n```",
    });
    await expect(editorLocator(labPage, id).locator("[data-mdw-diagram]"))
      .toHaveCount(0);
    await expect(genericCodeBlocks(labPage, id, entry))
      .toHaveCount(1);
    expect((await getExtensionSnapshot(labPage, id)).manifest.map(({ name }) => name))
      .not.toContain("markora-extension-diagrams");
    expect(await getMarkdown(labPage, id)).toBe("```mermaid\ngraph TD; A-->B\n```");
  }
});

test("@required per-kind diagram renderers receive complete source metadata and preview stays derived", async ({ labPage }) => {
  const id = "diagrams-per-kind-preview";
  const markdown = [
    "```mermaid theme=dark",
    "graph LR; A-->B",
    "```",
    "",
    "```geojson map=earth",
    '{"type":"Point","coordinates":[3,4]}',
    "```",
    "",
    "```topojson object=counties",
    '{"type":"Topology","objects":{}}',
    "```",
    "",
    "```stl units=mm",
    "solid sample",
    "endsolid sample",
    "```",
  ].join("\n");
  await mountEditor(labPage, {
    diagramRendererModes: {
      geojson: "sync",
      mermaid: "sync",
      stl: "sync",
      topojson: "sync",
    },
    extensionMode: "diagrams",
    id,
    markdown,
    root: "shadow",
  });

  for (let occurrence = 0; occurrence < DIAGRAM_KINDS.length; occurrence += 1) {
    await diagramShell(labPage, id, occurrence).scrollIntoViewIfNeeded();
    await waitForDiagramStatus(labPage, id, "rendered", occurrence);
  }

  const snapshot = await getDiagramSnapshot(labPage, id);
  const expectedCalls = snapshot.nodes.map(({ info, kind, source }) => ({ info, kind, source }));
  const calls = await getDiagramRendererCalls(labPage, id);
  expect(calls.map(({ info, kind, source }) => ({ info, kind, source })))
    .toEqual(expect.arrayContaining(expectedCalls));
  expect(calls).toHaveLength(4);
  expect(calls.every(({ aborted, settled }) => !aborted && settled === "resolved"))
    .toBe(true);

  const editor = editorLocator(labPage, id);
  await expect(editor.locator("[data-mdw-diagram-preview] svg")).toHaveCount(4);
  await expect(editor.locator("[data-mdw-diagram-preview]").first())
    .toHaveAttribute("aria-hidden", "true");
  expect(await getMarkdown(labPage, id)).toBe(markdown);

  const target = snapshot.nodes[0]!;
  expect(await selectDiagram(labPage, id, target)).toBe(true);
  const copied = await copyEditorSelection(labPage, id);
  const expectedSource = "```mermaid theme=dark\ngraph LR; A-->B\n```";
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe(expectedSource);
  expect(copied.plain).toBe(expectedSource);
  expect(copied.html).toContain('data-mdw-diagram-kind="mermaid"');
  expect(copied.html).toContain("graph LR; A--&gt;B");
  expect(copied.html).not.toContain("Rendered mermaid diagram");
  expect(copied.html).not.toContain("data-mdw-diagram-preview");
  expect(copied.html).not.toContain("<svg");
  expect(copied.html).not.toContain("<button");
});

test("@required diagram renderer failures retain source without execution, requests, or navigation", async ({ labPage }) => {
  const observedRequests: string[] = [];
  const recordRequest = (request: Request) => {
    if (request.url().includes("markora-diagrams.invalid")) {
      observedRequests.push(request.url());
    }
  };
  const initialUrl = labPage.url();
  labPage.on("request", recordRequest);
  await labPage.evaluate(() => {
    document.documentElement.style.setProperty(
      "--markora-diagram-network-probe",
      "url(https://markora-diagrams.invalid/css-variable.svg#probe)",
    );
  });

  try {
    for (const [mode, kind, errorCode, extensionCode] of [
      ["unsafe", "mermaid", "unsafe-output", "EXTENSION_DIAGRAM_UNSAFE_RENDERER_OUTPUT"],
      ["unsafe-css-var", "mermaid", "unsafe-output", "EXTENSION_DIAGRAM_UNSAFE_RENDERER_OUTPUT"],
      ["wrong-document", "geojson", "wrong-document", "EXTENSION_DIAGRAM_INVALID_RENDERER_OUTPUT"],
      ["connected", "topojson", "connected-output", "EXTENSION_DIAGRAM_INVALID_RENDERER_OUTPUT"],
      ["throw", "stl", "renderer-failed", "EXTENSION_DIAGRAM_RENDERER_FAILED"],
      ["reject", "geojson", "renderer-failed", "EXTENSION_DIAGRAM_RENDERER_FAILED"],
      ["string", "topojson", "invalid-output", "EXTENSION_DIAGRAM_INVALID_RENDERER_OUTPUT"],
      ["missing", "stl", "renderer-missing", "EXTENSION_DIAGRAM_RENDERER_MISSING"],
    ] as const) {
      const id = `diagram-clamp-${mode}`;
      const source = `${kind} ${mode} renderer source`;
      await mountEditor(labPage, {
        diagramRendererModes: { [kind]: mode },
        extensionMode: "diagrams",
        id,
        markdown: `\`\`\`${kind}\n${source}\n\`\`\``,
      });
      await diagramShell(labPage, id).scrollIntoViewIfNeeded();
      if (mode === "missing") {
        const target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
        expect(target.render).toEqual({ enabled: false, errorCode: null, status: "source" });
        expect(await runDiagramCommand(labPage, id, {
          target,
          type: "togglePreview",
        })).toBe(true);
      }
      await waitForDiagramStatus(labPage, id, "error");

      expect((await getDiagramSnapshot(labPage, id)).nodes[0]?.render).toEqual({
        enabled: true,
        errorCode,
        status: "error",
      });
      const editor = editorLocator(labPage, id);
      await expect(editor.locator("[data-mdw-diagram-source]"))
        .toContainText(source);
      await expect(editor.locator("[data-mdw-diagram-preview]"))
        .toBeEmpty();
      await expect(editor.locator(
        "script, img, iframe, object, embed, form, input, foreignObject, animate, use, markora-diagram-probe, [onclick], [onload], [onbegin], [href], [src], [action]",
      )).toHaveCount(0);
      expect(await getMarkdown(labPage, id))
        .toBe(`\`\`\`${kind}\n${source}\n\`\`\``);
      expect((await getEditorEvents(labPage, id)).log).toContainEqual(
        expect.objectContaining({
          code: extensionCode,
          extension: "markora-extension-diagrams",
          type: "error",
        }),
      );
    }
  } finally {
    labPage.off("request", recordRequest);
    await labPage.evaluate(() => {
      document.documentElement.style.removeProperty("--markora-diagram-network-probe");
    });
  }

  expect(observedRequests).toEqual([]);
  expect(labPage.url()).toBe(initialUrl);
  expect(await labPage.evaluate(() => (
    window as typeof window & { __markoraUnsafeDiagramRenderer?: boolean }
  ).__markoraUnsafeDiagramRenderer)).toBeUndefined();
  await expect(labPage.locator("[data-e2e-diagram-renderer-artifact]"))
    .toHaveCount(0);
});

test("@required diagram block renderers activate near the viewport and abort when leaving it", async ({ labPage }) => {
  const id = "diagram-viewport";
  const filler = Array.from(
    { length: 90 },
    (_, index) => `Viewport filler paragraph ${index}.`,
  ).join("\n\n");
  await mountEditor(labPage, {
    diagramRendererModes: { mermaid: "deferred" },
    extensionMode: "diagrams",
    id,
    markdown: `${filler}\n\n\`\`\`mermaid\ngraph TD; offscreen-->visible\n\`\`\``,
  });

  await waitForDiagramStatus(labPage, id, "offscreen");
  expect(await getDiagramRendererCalls(labPage, id)).toEqual([]);

  const shell = diagramShell(labPage, id);
  await shell.scrollIntoViewIfNeeded();
  await waitForDiagramCalls(labPage, id, 1);
  await waitForDiagramStatus(labPage, id, "rendering");

  await labPage.locator("[data-e2e-browser-lab] > h1").scrollIntoViewIfNeeded();
  await waitForDiagramStatus(labPage, id, "offscreen");
  expect((await getDiagramRendererCalls(labPage, id))[0]?.aborted).toBe(true);
  expect(await settleDiagramRenderer(labPage, id, { callId: 1 })).toBe(true);
  await settleEditor(labPage, id);
  await expect(shell.locator("[data-mdw-diagram-preview] svg")).toHaveCount(0);

  await shell.scrollIntoViewIfNeeded();
  await waitForDiagramCalls(labPage, id, 2);
  expect(await settleDiagramRenderer(labPage, id, { callId: 2 })).toBe(true);
  await waitForDiagramStatus(labPage, id, "rendered");
  await expect(shell.locator("[data-mdw-diagram-preview] svg")).toHaveCount(1);
});

test("@required diagram render concurrency stays bounded and one failed kind does not block siblings", async ({ labPage }) => {
  const id = "diagram-render-pressure";
  const markdown = [
    "```mermaid",
    "graph TD; A-->B",
    "```",
    "",
    "```geojson",
    '{"type":"Point","coordinates":[1,2]}',
    "```",
    "",
    "```topojson",
    '{"type":"Topology","objects":{}}',
    "```",
    "",
    "```stl",
    "solid one",
    "endsolid one",
    "```",
    "",
    "```mermaid",
    "graph LR; C-->D",
    "```",
  ].join("\n");
  await mountEditor(labPage, {
    diagramRendererModes: {
      geojson: "deferred",
      mermaid: "deferred",
      stl: "deferred",
      topojson: "deferred",
    },
    extensionMode: "diagrams",
    id,
    markdown,
  });
  await diagramShell(labPage, id, 2).scrollIntoViewIfNeeded();
  await waitForDiagramCalls(labPage, id, 4);
  await expect.poll(async () => {
    const statuses = (await getDiagramSnapshot(labPage, id)).nodes
      .map(({ render }) => render.status);
    return {
      queued: statuses.filter((status) => status === "queued").length,
      rendering: statuses.filter((status) => status === "rendering").length,
    };
  }).toEqual({ queued: 1, rendering: 4 });

  expect(await settleDiagramRenderer(labPage, id, {
    callId: 1,
    outcome: "reject",
  })).toBe(true);
  await waitForDiagramCalls(labPage, id, 5);
  for (const callId of [2, 3, 4, 5]) {
    expect(await settleDiagramRenderer(labPage, id, { callId })).toBe(true);
  }
  await expect.poll(async () => {
    const statuses = (await getDiagramSnapshot(labPage, id)).nodes
      .map(({ render }) => render.status);
    return {
      errors: statuses.filter((status) => status === "error").length,
      rendered: statuses.filter((status) => status === "rendered").length,
    };
  }).toEqual({ errors: 1, rendered: 4 });
  expect((await getDiagramSnapshot(labPage, id)).nodes
    .filter(({ render }) => render.status === "error")[0]?.render.errorCode)
    .toBe("renderer-failed");
});

test("@required diagram retry, toggle, update, reset, reconcile, remove, and teardown isolate render generations", async ({ labPage }) => {
  const id = "diagram-render-boundaries";
  const firstMarkdown = "```mermaid theme=one\ngraph TD; A-->B\n```";
  await mountEditor(labPage, {
    diagramRendererModes: { mermaid: "deferred" },
    extensionMode: "diagrams",
    id,
    markdown: firstMarkdown,
  });
  await diagramShell(labPage, id).scrollIntoViewIfNeeded();
  await waitForDiagramCalls(labPage, id, 1);

  expect(await settleDiagramRenderer(labPage, id, { callId: 1, outcome: "reject" }))
    .toBe(true);
  await waitForDiagramStatus(labPage, id, "error");
  let target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await runDiagramCommand(labPage, id, { target, type: "retryPreview" }))
    .toBe(true);
  await waitForDiagramCalls(labPage, id, 2);
  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await runDiagramCommand(labPage, id, { target, type: "togglePreview" }))
    .toBe(true);
  expect((await getDiagramRendererCalls(labPage, id))[1]?.aborted).toBe(true);
  expect(await settleDiagramRenderer(labPage, id, { callId: 2 })).toBe(true);
  await settleEditor(labPage, id);
  await expect(diagramShell(labPage, id).locator("[data-mdw-diagram-preview] svg"))
    .toHaveCount(0);

  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await runDiagramCommand(labPage, id, { target, type: "togglePreview" }))
    .toBe(true);
  await waitForDiagramCalls(labPage, id, 3);
  expect(await settleDiagramRenderer(labPage, id, { callId: 3 })).toBe(true);
  await waitForDiagramStatus(labPage, id, "rendered");

  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await runDiagramCommand(labPage, id, {
    patch: { info: "mermaid theme=two", source: "graph TD; B-->C" },
    target,
    type: "update",
  })).toBe(true);
  await waitForDiagramCalls(labPage, id, 4);
  expect((await getDiagramRendererCalls(labPage, id))[2]?.aborted).toBe(true);
  const beforeReset = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  const secondMarkdown = "```mermaid theme=two\ngraph TD; B-->C\n```";

  expect(await resetEditor(labPage, id, secondMarkdown)).toBe(secondMarkdown);
  await waitForDiagramCalls(labPage, id, 5);
  const afterReset = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(afterReset.identity).not.toBe(beforeReset.identity);
  expect((await getDiagramRendererCalls(labPage, id))[3]?.aborted).toBe(true);
  expect(await runDiagramCommand(labPage, id, {
    patch: { source: "stale reset" },
    target: beforeReset,
    type: "update",
  })).toBe(false);

  expect(await reconcileEditor(
    labPage,
    id,
    "```mermaid theme=three\ngraph TD; C-->D\n```",
  )).toMatchObject({ changed: true });
  await waitForDiagramCalls(labPage, id, 6);
  expect((await getDiagramRendererCalls(labPage, id))[4]?.aborted).toBe(true);
  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await runDiagramCommand(labPage, id, { target, type: "remove" }))
    .toBe(true);
  expect((await getDiagramRendererCalls(labPage, id))[5]?.aborted).toBe(true);

  for (const callId of [4, 5, 6]) {
    expect(await settleDiagramRenderer(labPage, id, { callId })).toBe(true);
  }
  await settleEditor(labPage, id);
  expect((await getDiagramSnapshot(labPage, id)).nodes).toEqual([]);
  await expect(editorLocator(labPage, id).locator("[data-mdw-diagram-preview] svg"))
    .toHaveCount(0);

  const destroyId = "diagram-render-destroy";
  await mountEditor(labPage, {
    diagramRendererModes: { stl: "deferred" },
    extensionMode: "diagrams",
    id: destroyId,
    markdown: "```stl\nsolid pending\nendsolid pending\n```",
  });
  await diagramShell(labPage, destroyId).scrollIntoViewIfNeeded();
  await waitForDiagramCalls(labPage, destroyId, 1);
  expect(await destroyEditorOnly(labPage, destroyId)).toBe(true);
  expect((await getDiagramRendererCalls(labPage, destroyId))[0]?.aborted).toBe(true);
  expect(await settleDiagramRenderer(labPage, destroyId, { callId: 1 })).toBe(true);
  await labPage.evaluate(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(editorLocator(labPage, destroyId).locator("[data-mdw-diagram-preview] svg"))
    .toHaveCount(0);

  const compositionId = "diagram-render-composition";
  await mountEditor(labPage, {
    diagramRendererModes: { mermaid: "deferred" },
    extensionMode: "diagrams",
    id: compositionId,
    markdown: "```mermaid\ngraph TD; composition-->safe\n```",
  });
  await diagramShell(labPage, compositionId).scrollIntoViewIfNeeded();
  await waitForDiagramCalls(labPage, compositionId, 1);
  await editorLocator(labPage, compositionId).evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "編",
    }));
  });
  expect(await settleDiagramRenderer(labPage, compositionId, { callId: 1 }))
    .toBe(true);
  await waitForDiagramStatus(labPage, compositionId, "queued");
  expect((await getDiagramRendererCalls(labPage, compositionId))[0]?.aborted)
    .toBe(true);
  await expect(diagramShell(labPage, compositionId).locator("[data-mdw-diagram-preview] svg"))
    .toHaveCount(0);
  await editorLocator(labPage, compositionId).evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "編",
    }));
  });
  await waitForDiagramCalls(labPage, compositionId, 2);
  expect(await settleDiagramRenderer(labPage, compositionId, { callId: 2 }))
    .toBe(true);
  await waitForDiagramStatus(labPage, compositionId, "rendered");
});

test("@required diagram commands and host edits are stale-safe, undoable, read-only and composition guarded", async ({ labPage }) => {
  const id = "diagram-commands-edits";
  await mountEditor(labPage, {
    diagramRendererModes: {},
    extensionMode: "diagrams",
    id,
    initialSelection: "end",
    markdown: "",
  });

  expect(await runDiagramCommand(labPage, id, {
    options: { info: "mermaid theme=dark", source: "graph TD; A-->B" },
    type: "insert",
  })).toBe(true);
  let target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await runDiagramCommand(labPage, id, {
    patch: { info: target.info, source: target.source },
    target,
    type: "update",
  })).toBe(false);
  expect(await runDiagramCommand(labPage, id, {
    kind: "geojson",
    target,
    type: "convert",
  })).toBe(true);
  expect(await runDiagramCommand(labPage, id, {
    patch: { source: "stale" },
    target,
    type: "update",
  })).toBe(false);
  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(target).toMatchObject({
    info: "geojson theme=dark",
    kind: "geojson",
    source: "graph TD; A-->B",
  });
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect((await getDiagramSnapshot(labPage, id)).nodes[0]?.kind).toBe("mermaid");
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);

  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await selectDiagram(labPage, id, target)).toBe(true);
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit diagram source",
  }).click();
  expect(await getPendingDiagramEdit(labPage, id)).toEqual({
    ...target,
    render: { enabled: false, errorCode: null, status: "source" },
  });
  expect(await updatePendingDiagramEdit(labPage, id, {
    info: "geojson map=updated",
    source: '{"type":"Point","coordinates":[5,6]}',
  })).toBe(true);

  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await selectDiagram(labPage, id, target)).toBe(true);
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit diagram source",
  }).click();
  expect(await reconcileEditor(
    labPage,
    id,
    "```geojson map=external\n{\"type\":\"Point\",\"coordinates\":[7,8]}\n```",
  )).toMatchObject({ changed: true });
  expect(await convertPendingDiagramEdit(labPage, id, "topojson")).toBe(false);

  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await selectDiagram(labPage, id, target)).toBe(true);
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit diagram source",
  }).click();
  await updateEditorOptions(labPage, id, { editable: false });
  await expect(editorLocator(labPage, id).getByRole("button", {
    name: "Edit diagram source",
  })).toBeDisabled();
  expect(await removePendingDiagramEdit(labPage, id)).toBe(false);
  for (const request of [
    { patch: { source: "blocked" }, target, type: "update" as const },
    { kind: "stl" as const, target, type: "convert" as const },
    { target, type: "remove" as const },
    { target, type: "restoreCodeBlock" as const },
    { target, type: "togglePreview" as const },
    { target, type: "retryPreview" as const },
  ]) {
    expect(await runDiagramCommand(labPage, id, request)).toBe(false);
  }
  await updateEditorOptions(labPage, id, { editable: true });

  await focusEditor(labPage, id, "end");
  await editorLocator(labPage, id).evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "編",
    }));
  });
  expect(await selectDiagram(labPage, id, target)).toBe(false);
  expect(await updatePendingDiagramEdit(labPage, id, { source: "composing" }))
    .toBe(false);
  expect(await runDiagramCommand(labPage, id, {
    patch: { source: "composing" },
    target,
    type: "update",
  })).toBe(false);
  expect(await runDiagramCommand(labPage, id, {
    options: { info: "mermaid", source: "graph TD" },
    type: "insert",
  })).toBe(false);
  for (const request of [
    { kind: "stl" as const, target, type: "convert" as const },
    { target, type: "remove" as const },
    { target, type: "restoreCodeBlock" as const },
    { target, type: "togglePreview" as const },
    { target, type: "retryPreview" as const },
  ]) {
    expect(await runDiagramCommand(labPage, id, request)).toBe(false);
  }
  await editorLocator(labPage, id).evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "編",
    }));
  });

  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await selectDiagram(labPage, id, target)).toBe(true);
  await editorLocator(labPage, id).getByRole("button", {
    name: "Edit diagram source",
  }).click();
  expect(await restorePendingDiagramEdit(labPage, id)).toBe(true);
  expect((await getDiagramSnapshot(labPage, id)).nodes).toEqual([]);
  await expect(editorLocator(labPage, id).locator(".mdw-code-block"))
    .toHaveCount(1);
});

test("@required generic code conversion and Markdown paste preserve source and code selection", async ({ labPage }) => {
  const id = "diagram-code-conversion";
  const generic = "```javascript extra\nalpha beta gamma\n```";
  await mountEditor(labPage, {
    diagramRendererModes: {},
    extensionMode: "diagrams",
    id,
    markdown: generic,
  });
  expect(await labPage.evaluate((editorId) => (
    window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "beta", "all")
  ), id)).toBe(true);
  const before = await snapshotEditor(labPage, id);
  expect(await runDiagramCommand(labPage, id, {
    kind: "mermaid",
    type: "convertCodeBlock",
  })).toBe(true);
  let after = await snapshotEditor(labPage, id);
  expect(after.selection).toEqual(before.selection);
  let target: LabDiagramNodeTarget = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(target).toMatchObject({
    info: "mermaid extra",
    kind: "mermaid",
    source: "alpha beta gamma",
  });

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect((await snapshotEditor(labPage, id)).selection).toEqual(before.selection);
  expect((await getDiagramSnapshot(labPage, id)).nodes).toEqual([]);
  expect(await getMarkdown(labPage, id)).toBe(generic);
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  expect((await snapshotEditor(labPage, id)).selection).toEqual(before.selection);

  target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await runDiagramCommand(labPage, id, {
    target,
    type: "restoreCodeBlock",
  })).toBe(true);
  after = await snapshotEditor(labPage, id);
  expect(after.selection).toEqual(before.selection);
  expect(await getMarkdown(labPage, id))
    .toBe("```mermaid extra\nalpha beta gamma\n```");

  const pasteId = "diagram-markdown-paste";
  await mountEditor(labPage, {
    diagramRendererModes: {},
    extensionMode: "diagrams",
    id: pasteId,
    initialSelection: "end",
    markdown: "Paste target.",
  });
  expect(await runEditorCommand(labPage, pasteId, {
    text: "```topojson object=pasted\n{\"type\":\"Topology\",\"objects\":{}}\n```",
    type: "pasteMarkdown",
  })).toBe(true);
  expect((await getDiagramSnapshot(labPage, pasteId)).nodes[0]).toMatchObject({
    info: "topojson object=pasted",
    kind: "topojson",
    source: '{"type":"Topology","objects":{}}',
  });
});

test("@required localized RTL diagram actions expose authored source to AT and pass Axe", async ({ labPage }) => {
  const id = "diagram-rtl-localized";
  const source = "graph TD; بداية-->نهاية";
  await mountEditor(labPage, {
    diagramMessages: {
      editSource: "تحرير مصدر المخطط",
      kindLabel: "مخطط ميرميد",
      previewLabel: "معاينة المخطط",
      retryPreview: "إعادة محاولة المخطط",
      showPreview: "إظهار معاينة المخطط",
      showSource: "إظهار مصدر المخطط",
      sourceLabel: "مصدر المخطط الكامل",
    },
    diagramRendererModes: { mermaid: "sync" },
    direction: "rtl",
    extensionMode: "diagrams",
    id,
    language: "ar",
    markdown: `\`\`\`mermaid direction=rtl\n${source}\n\`\`\``,
    root: "shadow",
  });
  await diagramShell(labPage, id).scrollIntoViewIfNeeded();
  await waitForDiagramStatus(labPage, id, "rendered");
  const target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await selectDiagram(labPage, id, target)).toBe(true);

  const shell = diagramShell(labPage, id);
  await expect(shell).toHaveAttribute("role", "group");
  await expect(shell.locator(".mdw-diagram__kind")).toHaveText("مخطط ميرميد");
  expect(await shell.evaluate((element) => getComputedStyle(element).direction))
    .toBe("rtl");
  const accessible = await shell.ariaSnapshot();
  expect(accessible).toContain("مخطط ميرميد");
  expect(accessible).toContain("مصدر المخطط الكامل");
  expect(accessible).toContain("mermaid direction=rtl");
  expect(accessible).toContain(source);
  await expect(shell.locator("[data-mdw-diagram-preview]"))
    .toHaveAttribute("aria-label", "معاينة المخطط");
  await expect(shell.locator("[data-mdw-diagram-preview]"))
    .toHaveAttribute("aria-hidden", "true");

  const edit = shell.getByRole("button", { name: "تحرير مصدر المخطط" });
  await edit.focus();
  await labPage.keyboard.press("Enter");
  expect((await getPendingDiagramEdit(labPage, id))?.source).toBe(source);

  const toggle = shell.getByRole("button", { name: "إظهار مصدر المخطط" });
  await toggle.focus();
  await labPage.keyboard.press("Space");
  expect((await getDiagramSnapshot(labPage, id)).nodes[0]?.render.status)
    .toBe("source");
  await expect(shell.getByRole("button", { name: "إظهار معاينة المخطط" }))
    .toBeFocused();
  await labPage.keyboard.press("Enter");
  await waitForDiagramStatus(labPage, id, "rendered");

  const reflow = await shell.evaluate((element) => {
    const diagram = element as HTMLElement;
    diagram.style.fontSize = "200%";
    diagram.style.inlineSize = "220px";
    const actions = diagram.querySelector<HTMLElement>(".mdw-diagram__actions")!;
    return {
      actionsClientWidth: actions.clientWidth,
      actionsScrollWidth: actions.scrollWidth,
      diagramClientWidth: diagram.clientWidth,
      diagramScrollWidth: diagram.scrollWidth,
    };
  });
  expect(reflow.actionsScrollWidth).toBeLessThanOrEqual(reflow.actionsClientWidth);
  expect(reflow.diagramScrollWidth).toBeLessThanOrEqual(reflow.diagramClientWidth);

  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);
});

test("@required keyboard navigation into a rendered diagram reveals and edits its source", async ({ labPage }) => {
  const id = "diagram-keyboard-source";
  await mountEditor(labPage, {
    diagramRendererModes: { mermaid: "sync" },
    extensionMode: "diagrams",
    id,
    markdown: "Before\n\n```mermaid\ngraph TD; keyboard-->source\n```\n\nAfter",
  });
  const shell = diagramShell(labPage, id);
  await shell.scrollIntoViewIfNeeded();
  await waitForDiagramStatus(labPage, id, "rendered");
  const target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  const sourceShell = shell.locator(".mdw-diagram__source-shell");
  await expect(sourceShell).toHaveClass(/mdw-diagram__source-shell--visually-hidden/);

  await focusEditor(labPage, id, { anchor: target.position - 1 });
  await labPage.keyboard.press("ArrowRight");
  await settleEditor(labPage, id);
  expect((await snapshotEditor(labPage, id)).selection.from)
    .toBe(target.position + 1);
  await expect(sourceShell).not.toHaveClass(/mdw-diagram__source-shell--visually-hidden/);

  await labPage.keyboard.insertText("!");
  await settleEditor(labPage, id);
  expect((await getDiagramSnapshot(labPage, id)).nodes[0]?.source)
    .toBe("!graph TD; keyboard-->source");
  expect(await getMarkdown(labPage, id))
    .toContain("```mermaid\n!graph TD; keyboard-->source\n```");

  await labPage.keyboard.press("ArrowLeft");
  await settleEditor(labPage, id);
  expect((await snapshotEditor(labPage, id)).selection.from)
    .toBe(target.position + 1);
  await labPage.keyboard.press("ArrowLeft");
  await settleEditor(labPage, id);
  expect((await snapshotEditor(labPage, id)).selection.from)
    .toBe(target.position - 1);
  await expect(sourceShell).toHaveClass(/mdw-diagram__source-shell--visually-hidden/);

  await labPage.keyboard.press("Shift+ArrowRight");
  await settleEditor(labPage, id);
  const range = (await snapshotEditor(labPage, id)).selection;
  expect(range.from).toBe(target.position - 1);
  expect(range.to).toBe(target.position + 2);
  await expect(sourceShell).not.toHaveClass(/mdw-diagram__source-shell--visually-hidden/);
});

test("@required diagram plaintext direction owns physical arrows inside its editor scope", async ({ labPage }) => {
  for (const scenario of [
    {
      after: "بعد",
      before: "قبل",
      direction: "rtl" as const,
      enter: "ArrowLeft",
      exit: "ArrowLeft",
      id: "diagram-keyboard-rtl-editor-ltr-source",
      inward: "ArrowRight",
      source: "graph TD; rtl-->source",
    },
    {
      after: "After",
      before: "Before",
      direction: "ltr" as const,
      enter: "ArrowRight",
      exit: "ArrowRight",
      id: "diagram-keyboard-ltr-editor-rtl-source",
      inward: "ArrowLeft",
      source: "مرحبا",
    },
  ]) {
    await mountEditor(labPage, {
      diagramRendererModes: { mermaid: "sync" },
      direction: scenario.direction,
      extensionMode: "diagrams",
      id: scenario.id,
      markdown: `${scenario.before}\n\n\`\`\`mermaid\n${scenario.source}\n\`\`\`\n\n${scenario.after}`,
    });
    const shell = diagramShell(labPage, scenario.id);
    await shell.scrollIntoViewIfNeeded();
    await waitForDiagramStatus(labPage, scenario.id, "rendered");
    const target = (await getDiagramSnapshot(labPage, scenario.id)).nodes[0]!;
    const sourceShell = shell.locator(".mdw-diagram__source-shell");

    await focusEditor(labPage, scenario.id, { anchor: target.position - 1 });
    await labPage.keyboard.press(scenario.enter);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(target.position + 1);
    await expect(sourceShell).not.toHaveClass(/mdw-diagram__source-shell--visually-hidden/);

    await labPage.keyboard.press(scenario.inward);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(target.position + 2);
    await labPage.keyboard.press(scenario.exit);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(target.position + 1);
    await labPage.keyboard.press(scenario.exit);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(target.position - 1);
    await expect(sourceShell).toHaveClass(/mdw-diagram__source-shell--visually-hidden/);

    await labPage.keyboard.press(`Shift+${scenario.enter}`);
    await settleEditor(labPage, scenario.id);
    const range = (await snapshotEditor(labPage, scenario.id)).selection;
    expect(range.from).toBe(target.position - 1);
    expect(range.to).toBe(target.position + 2);
    await expect(sourceShell).not.toHaveClass(/mdw-diagram__source-shell--visually-hidden/);
  }
});

test("@required each diagram source line owns physical arrows at its node boundary", async ({ labPage }) => {
  for (const scenario of [
    {
      after: "After",
      before: "Before",
      direction: "ltr" as const,
      enter: "ArrowLeft",
      exit: "ArrowLeft",
      id: "diagram-keyboard-ltr-first-rtl-last",
      inward: "ArrowRight",
      lastGraphemeLength: 1,
      source: "graph TD\nمرحبا",
    },
    {
      after: "بعد",
      before: "قبل",
      direction: "rtl" as const,
      enter: "ArrowRight",
      exit: "ArrowRight",
      id: "diagram-keyboard-rtl-first-ltr-last",
      inward: "ArrowLeft",
      lastGraphemeLength: 1,
      source: "مرحبا\ngraph TD",
    },
    {
      after: "After",
      before: "Before",
      direction: "ltr" as const,
      enter: "ArrowLeft",
      exit: "ArrowRight",
      id: "diagram-keyboard-neutral-zwj-last",
      inward: "ArrowLeft",
      lastGraphemeLength: "👩‍💻".length,
      source: "graph TD\n👩‍💻",
    },
    {
      after: "بعد",
      before: "قبل",
      direction: "rtl" as const,
      enter: "ArrowRight",
      exit: "ArrowRight",
      id: "diagram-keyboard-rtl-first-neutral-zwj-last",
      inward: "ArrowLeft",
      lastGraphemeLength: "👩‍💻".length,
      source: "مرحبا\n👩‍💻",
    },
  ]) {
    await mountEditor(labPage, {
      diagramRendererModes: { mermaid: "sync" },
      direction: scenario.direction,
      extensionMode: "diagrams",
      id: scenario.id,
      markdown: `${scenario.before}\n\n\`\`\`mermaid\n${scenario.source}\n\`\`\`\n\n${scenario.after}`,
    });
    const shell = diagramShell(labPage, scenario.id);
    await shell.scrollIntoViewIfNeeded();
    await waitForDiagramStatus(labPage, scenario.id, "rendered");
    const target = (await getDiagramSnapshot(labPage, scenario.id)).nodes[0]!;
    const sourceShell = shell.locator(".mdw-diagram__source-shell");
    const contentEnd = target.position + scenario.source.length + 1;
    const afterStart = contentEnd + 2;

    await focusEditor(labPage, scenario.id, { anchor: afterStart });
    await labPage.keyboard.press(scenario.enter);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(contentEnd);
    await expect(sourceShell).not.toHaveClass(/mdw-diagram__source-shell--visually-hidden/);

    await labPage.keyboard.press(scenario.inward);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(contentEnd - scenario.lastGraphemeLength);
    await labPage.keyboard.press(scenario.exit);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(contentEnd);
    await labPage.keyboard.press(scenario.exit);
    await settleEditor(labPage, scenario.id);
    expect((await snapshotEditor(labPage, scenario.id)).selection.from)
      .toBe(afterStart);
    await expect(sourceShell).toHaveClass(/mdw-diagram__source-shell--visually-hidden/);

    await labPage.keyboard.press(`Shift+${scenario.enter}`);
    await settleEditor(labPage, scenario.id);
    const range = (await snapshotEditor(labPage, scenario.id)).selection;
    expect(range.from).toBe(contentEnd - scenario.lastGraphemeLength);
    expect(range.to).toBe(afterStart);
    await expect(sourceShell).not.toHaveClass(/mdw-diagram__source-shell--visually-hidden/);
  }
});

test("@required Chromium CDP invokes diagram editing and copies source-only Markdown", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(browserName !== "chromium", "Chromium is the only Playwright engine exposing CDP input commands.");

  const id = "diagram-cdp";
  const initialSource = "graph TD; CDP-->initial";
  const editedSource = "graph LR; CDP-->edited";
  const nativeSource = `${editedSource}!`;
  await mountEditor(labPage, {
    diagramRendererModes: { mermaid: "sync" },
    extensionMode: "diagrams",
    id,
    markdown: `\`\`\`mermaid theme=cdp\n${initialSource}\n\`\`\``,
  });
  await diagramShell(labPage, id).scrollIntoViewIfNeeded();
  await waitForDiagramStatus(labPage, id, "rendered");
  let target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
  expect(await selectDiagram(labPage, id, target)).toBe(true);
  const edit = diagramShell(labPage, id).getByRole("button", {
    name: "Edit diagram source",
  });
  const box = await edit.boundingBox();
  expect(box).not.toBeNull();

  const cdp = await context.newCDPSession(labPage);
  try {
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    });
    expect((await getPendingDiagramEdit(labPage, id))?.source).toBe(initialSource);
    expect(await updatePendingDiagramEdit(labPage, id, { source: editedSource }))
      .toBe(true);
    await waitForDiagramStatus(labPage, id, "rendered");

    const showSource = diagramShell(labPage, id).getByRole("button", {
      name: "Show diagram source",
    });
    const showSourceBox = await showSource.boundingBox();
    expect(showSourceBox).not.toBeNull();
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 1,
      clickCount: 1,
      type: "mousePressed",
      x: showSourceBox!.x + showSourceBox!.width / 2,
      y: showSourceBox!.y + showSourceBox!.height / 2,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      buttons: 0,
      clickCount: 1,
      type: "mouseReleased",
      x: showSourceBox!.x + showSourceBox!.width / 2,
      y: showSourceBox!.y + showSourceBox!.height / 2,
    });
    await waitForDiagramStatus(labPage, id, "source");

    const source = diagramShell(labPage, id).locator("[data-mdw-diagram-source]");
    await expect(source).toBeVisible();
    await source.evaluate((element) => {
      const editor = element.closest<HTMLElement>(".ProseMirror")!;
      const selection = element.ownerDocument.getSelection()!;
      const range = element.ownerDocument.createRange();
      editor.focus();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await cdp.send("Input.insertText", { text: "!" });
    await expect.poll(async () => (
      await getDiagramSnapshot(labPage, id)
    ).nodes[0]?.source).toBe(nativeSource);
    expect(await getMarkdown(labPage, id))
      .toBe(`\`\`\`mermaid theme=cdp\n${nativeSource}\n\`\`\``);

    target = (await getDiagramSnapshot(labPage, id)).nodes[0]!;
    expect(await selectDiagram(labPage, id, target)).toBe(true);
    await labPage.evaluate((editorId) => {
      const section = document.querySelector(`[data-e2e-editor="${editorId}"]`)!;
      const targetWindow = window as typeof window & {
        __markoraDiagramCdpCopy?: { html: string; markdown: string; plain: string };
      };
      delete targetWindow.__markoraDiagramCdpCopy;
      section.addEventListener("copy", (rawEvent) => {
        const transfer = (rawEvent as ClipboardEvent).clipboardData;
        targetWindow.__markoraDiagramCdpCopy = {
          html: transfer?.getData("text/html") ?? "",
          markdown: transfer?.getData("text/markdown") ?? "",
          plain: transfer?.getData("text/plain") ?? "",
        };
      }, { once: true });
    }, id);
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      commands: ["Copy"],
      key: "c",
      modifiers: 2,
      type: "keyDown",
      windowsVirtualKeyCode: 67,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      key: "c",
      modifiers: 2,
      type: "keyUp",
      windowsVirtualKeyCode: 67,
    });
  } finally {
    await cdp.detach();
  }

  const copied = await labPage.evaluate(() => (
    window as typeof window & {
      __markoraDiagramCdpCopy?: { html: string; markdown: string; plain: string };
    }
  ).__markoraDiagramCdpCopy);
  const expected = `\`\`\`mermaid theme=cdp\n${nativeSource}\n\`\`\``;
  expect(copied).toMatchObject({ markdown: expected, plain: expected });
  expect(copied?.html).toContain('data-mdw-diagram-kind="mermaid"');
  expect(copied?.html).toContain("graph LR; CDP--&gt;edited!");
  expect(copied?.html).not.toContain("Rendered mermaid diagram");
  expect(copied?.html).not.toContain("data-mdw-diagram-preview");
  expect(copied?.html).not.toContain("<svg");
  expect(copied?.html).not.toContain("<button");
});
