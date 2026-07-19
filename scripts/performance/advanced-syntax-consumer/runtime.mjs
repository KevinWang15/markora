import { createEditor } from "markora";
import { defineMarkdownEditorExtension, Plugin } from "markora/extension-api";
import { createAlertsExtension } from "markora-extension-alerts";
import {
  createDiagramsExtension,
  DIAGRAM_MAX_CONCURRENT_RENDERS,
  DIAGRAM_MAX_RENDERED_OUTPUT_BYTES,
  diagramKinds,
} from "markora-extension-diagrams";
import { createFootnotesExtension } from "markora-extension-footnotes";
import { createFrontmatterExtension } from "markora-extension-frontmatter";
import { createHtmlExtension } from "markora-extension-html";
import { createMathExtension } from "markora-extension-math";
import { createTocExtension } from "markora-extension-toc";
import "markora/styles.css";
import "markora-extension-alerts/styles.css";
import "markora-extension-diagrams/styles.css";
import "markora-extension-footnotes/styles.css";
import "markora-extension-frontmatter/styles.css";
import "markora-extension-html/styles.css";
import "markora-extension-math/styles.css";
import "markora-extension-toc/styles.css";

const expectedExtensionNames = Object.freeze([
  "markora-extension-frontmatter",
  "markora-extension-footnotes",
  "markora-extension-math",
  "markora-extension-alerts",
  "markora-extension-toc",
  "markora-extension-html",
  "markora-extension-diagrams",
]);
const fixtures = new Map();
const encoder = new TextEncoder();
const host = requireElement("editor-host");
const rendererArtifacts = new Map();
const activeRendererSignals = new Map();
const pendingRendererPromises = new Set();
const pressureResolvers = new Set();
const rendererCalls = [];
const errors = [];
let activeMount = null;
let activeRendererJobs = 0;
let changeCallbackCount = 0;
let disconnectedIntersectionObservers = 0;
let liveIntersectionObservers = 0;
let maxConcurrentRendererJobs = 0;
let observedRendererTargets = 0;
let pressureOversizedPending = false;
let pressureReleased = false;
let rendererCallCount = 0;
let rendererMode = "normal";
let totalIntersectionObservers = 0;

installIntersectionObserverLedger();

function requireElement(id) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}.`);
  return element;
}

function installIntersectionObserverLedger() {
  const NativeIntersectionObserver = window.IntersectionObserver;
  if (typeof NativeIntersectionObserver !== "function") return;

  class TrackedIntersectionObserver {
    constructor(callback, options) {
      this.active = true;
      this.targets = new Set();
      this.inner = new NativeIntersectionObserver(callback, options);
      liveIntersectionObservers += 1;
      totalIntersectionObservers += 1;
    }

    get root() { return this.inner.root; }
    get rootMargin() { return this.inner.rootMargin; }
    get thresholds() { return this.inner.thresholds; }
    disconnect() {
      this.inner.disconnect();
      if (!this.active) return;
      this.active = false;
      observedRendererTargets -= this.targets.size;
      this.targets.clear();
      liveIntersectionObservers -= 1;
      disconnectedIntersectionObservers += 1;
    }
    observe(target) {
      this.inner.observe(target);
      if (!this.targets.has(target)) {
        this.targets.add(target);
        observedRendererTargets += 1;
      }
    }
    takeRecords() { return this.inner.takeRecords(); }
    unobserve(target) {
      this.inner.unobserve(target);
      if (this.targets.delete(target)) observedRendererTargets -= 1;
    }
  }

  window.IntersectionObserver = TrackedIntersectionObserver;
}

function assertRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function installFixture(input) {
  assertRecord(input, "Fixture");
  if (typeof input.id !== "string" || !/^[a-z0-9_-]+$/u.test(input.id)) {
    throw new TypeError("Fixture id is invalid.");
  }
  if (typeof input.markdown !== "string") throw new TypeError("Fixture Markdown must be a string.");
  const stats = structuredClone(assertRecord(input.stats, "Fixture stats"));
  const bytes = encoder.encode(input.markdown).byteLength;
  if (stats.bytes !== bytes || stats.targetBytes !== bytes) {
    throw new RangeError("Fixture byte metadata does not match its Markdown.");
  }
  const fixture = Object.freeze({
    id: input.id,
    markdown: input.markdown,
    stats: Object.freeze(stats),
  });
  fixtures.set(fixture.id, fixture);
  return { id: fixture.id, stats: fixture.stats };
}

function requireFixture(id) {
  const fixture = fixtures.get(id);
  if (!fixture) throw new Error(`Unknown fixture ${String(id)}.`);
  return fixture;
}

function clearTelemetry({ resetCounters = false } = {}) {
  rendererCalls.length = 0;
  errors.length = 0;
  if (resetCounters) {
    rendererCallCount = 0;
    maxConcurrentRendererJobs = activeRendererJobs;
  }
}

function createRendererOutput(request, oversized) {
  const output = request.ownerDocument.createElement("div");
  const label = request.ownerDocument.createElement("span");
  label.textContent = oversized
    ? "x".repeat(DIAGRAM_MAX_RENDERED_OUTPUT_BYTES + 1)
    : `${request.kind}:${request.info}:${request.source.slice(0, 48)}`;
  output.append(label);
  rendererArtifacts.set(output, request.info);
  return output;
}

function diagramRenderer(request) {
  const oversized = rendererMode === "pressure" && pressureOversizedPending;
  if (oversized) pressureOversizedPending = false;
  rendererCallCount += 1;
  rendererCalls.push(Object.freeze({
    info: request.info,
    kind: request.kind,
    oversized,
    sourceBytes: encoder.encode(request.source).byteLength,
  }));
  activeRendererSignals.set(request.signal, request.info);
  activeRendererJobs += 1;
  maxConcurrentRendererJobs = Math.max(maxConcurrentRendererJobs, activeRendererJobs);
  const output = createRendererOutput(request, oversized);
  let cleaned = false;
  const cleanupGeneration = () => {
    if (cleaned) return;
    cleaned = true;
    activeRendererSignals.delete(request.signal);
    rendererArtifacts.delete(output);
  };
  request.signal.addEventListener("abort", cleanupGeneration, { once: true });

  let promise;
  promise = new Promise((resolve) => {
    let settled = false;
    const resolveOutput = () => {
      if (settled) return;
      settled = true;
      pressureResolvers.delete(resolveOutput);
      resolve(output);
    };
    request.signal.addEventListener("abort", resolveOutput, { once: true });
    if (rendererMode === "pressure") {
      pressureResolvers.add(resolveOutput);
      if (pressureReleased) queueMicrotask(resolveOutput);
    } else {
      queueMicrotask(resolveOutput);
    }
  }).finally(() => {
    activeRendererJobs = Math.max(0, activeRendererJobs - 1);
    pendingRendererPromises.delete(promise);
  });
  pendingRendererPromises.add(promise);
  return promise;
}

function createDefinitions() {
  const diagramRenderers = Object.freeze(Object.fromEntries(
    diagramKinds.map((kind) => [kind, diagramRenderer]),
  ));
  return Object.freeze([
    createFrontmatterExtension(),
    createFootnotesExtension(),
    createMathExtension(),
    createAlertsExtension(),
    createTocExtension(),
    createHtmlExtension(),
    createDiagramsExtension({ renderers: diagramRenderers }),
  ]);
}

function handlesFor(editor, definitions) {
  return Object.fromEntries(definitions.map((definition) => [
    definition.name,
    editor.extensions.get(definition),
  ]));
}

function featureSnapshot(mount) {
  const { handles } = mount;
  const frontmatter = handles["markora-extension-frontmatter"].state.getSnapshot();
  const footnotes = handles["markora-extension-footnotes"].state.getSnapshot();
  const math = handles["markora-extension-math"].state.getSnapshot();
  const alerts = handles["markora-extension-alerts"].state.getAlerts();
  const toc = handles["markora-extension-toc"].state.getSnapshot();
  const html = handles["markora-extension-html"].state.getSnapshot();
  const diagrams = handles["markora-extension-diagrams"].state.getSnapshot();
  return {
    alerts: alerts.length,
    diagrams: diagrams.nodes.length,
    diagramStatuses: diagrams.nodes.reduce((counts, node) => {
      counts[node.render.status] = (counts[node.render.status] ?? 0) + 1;
      return counts;
    }, {}),
    footnoteDefinitions: footnotes.definitions.length,
    footnoteReferences: footnotes.references.length,
    frontmatter: frontmatter ? 1 : 0,
    html: html.nodes.length,
    math: math.nodes.length,
    tocHeadings: toc.headings.length,
    tocs: toc.tocs.length,
  };
}

function ledgerSnapshot() {
  return {
    activeRendererJobs,
    activeRendererSignals: activeRendererSignals.size,
    disconnectedIntersectionObservers,
    hostChildren: host.childNodes.length,
    liveIntersectionObservers,
    maxConcurrentRendererJobs,
    observedRendererTargets,
    pendingRendererPromises: pendingRendererPromises.size,
    pressureResolvers: pressureResolvers.size,
    rendererArtifacts: rendererArtifacts.size,
    totalIntersectionObservers,
  };
}

function optionalManifest(editor) {
  return editor.extensions.manifest.extensions
    .map(({ name }) => name)
    .filter((name) => expectedExtensionNames.includes(name));
}

function createMount(markdown, fixture = null) {
  if (activeMount) throw new Error("An advanced syntax editor is already mounted.");
  host.replaceChildren();
  clearTelemetry({ resetCounters: true });
  changeCallbackCount = 0;
  const definitions = createDefinitions();
  const startedAt = performance.now();
  const editor = createEditor({
    ariaLabel: "All-seven advanced syntax performance editor",
    attributes: { spellcheck: "false" },
    element: host,
    extensions: definitions,
    initialSelection: "start",
    markdown,
    onChange() { changeCallbackCount += 1; },
  });
  const durationMs = performance.now() - startedAt;
  const mount = {
    definitions,
    editor,
    fixture,
    handles: handlesFor(editor, definitions),
  };
  activeMount = mount;
  mount.unsubscribeError = editor.subscribe("error", (event) => {
    errors.push({
      code: event.error && typeof event.error === "object" && "code" in event.error
        ? event.error.code
        : event.context.code,
      extension: event.context.extension,
      message: event.error instanceof Error ? event.error.message : String(event.error),
    });
  });
  return {
    durationMs,
    immediateChangeCallbacks: changeCallbackCount,
    immediateRendererCalls: rendererCallCount,
    manifest: optionalManifest(editor),
  };
}

function mountFixture(id) {
  const fixture = requireFixture(id);
  rendererMode = "normal";
  pressureOversizedPending = false;
  pressureReleased = false;
  return createMount(fixture.markdown, fixture);
}

function createPressureMarkdown(seed = "initial") {
  return Array.from({ length: 8 }, (_, index) => [
    `\`\`\`mermaid pressure=${seed}-${String(index + 1).padStart(2, "0")}`,
    `graph TD\nA${index} --> B${index}`,
    "```",
  ].join("\n")).join("\n\n");
}

function preparePressure({ oversized }) {
  rendererMode = "pressure";
  pressureOversizedPending = oversized;
  pressureReleased = false;
  clearTelemetry({ resetCounters: true });
}

function mountPressure() {
  preparePressure({ oversized: true });
  const result = createMount(createPressureMarkdown(), null);
  host.scrollIntoView({ block: "start" });
  return result;
}

function requireMount() {
  if (!activeMount) throw new Error("No advanced syntax editor is mounted.");
  return activeMount;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function mappedFootnotes(snapshot, mapping) {
  return {
    definitions: snapshot.definitions.map((definition) => ({
      ...definition,
      position: mapping.map(definition.position, 1),
      referencePositions: definition.referencePositions.map((position) => mapping.map(position, 1)),
    })),
    diagnostics: snapshot.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      position: mapping.map(diagnostic.position, 1),
    })),
    references: snapshot.references.map((reference) => ({
      ...reference,
      definitionPosition: reference.definitionPosition === null
        ? null
        : mapping.map(reference.definitionPosition, 1),
      position: mapping.map(reference.position, 1),
    })),
  };
}

function mappedToc(snapshot, mapping) {
  return {
    headings: snapshot.headings.map((heading) => ({
      ...heading,
      position: mapping.map(heading.position, 1),
    })),
    tocs: snapshot.tocs.map((toc) => ({ position: mapping.map(toc.position, 1) })),
  };
}

function observeNodes(nodes) {
  const observer = new MutationObserver(() => undefined);
  for (const node of nodes) {
    observer.observe(node, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
  return observer;
}

function ordinaryEdit() {
  const mount = requireMount();
  let position = null;
  mount.editor.view.state.doc.descendants((node, pos) => {
    if (
      position === null
      && node.type.name === "paragraph"
      && node.textContent.startsWith("Section ")
    ) {
      position = pos + 1;
      return false;
    }
    return position === null;
  });
  if (position === null) throw new Error("No ordinary paragraph was available for the typing probe.");
  const footnotes = mount.handles["markora-extension-footnotes"];
  const toc = mount.handles["markora-extension-toc"];
  const beforeFootnotes = footnotes.state.getSnapshot();
  const beforeToc = toc.state.getSnapshot();
  const beforeFootnoteDom = [...mount.editor.view.dom.querySelectorAll(
    "[data-mdw-footnote-reference], [data-mdw-footnote-definition]",
  )];
  const beforeTocEntries = [...mount.editor.view.dom.querySelectorAll(
    "button[data-mdw-toc-entry]",
  )];
  const footnoteObserver = observeNodes(beforeFootnoteDom);
  const tocObserver = observeNodes(mount.editor.view.dom.querySelectorAll("[data-mdw-toc]"));
  const transaction = mount.editor.view.state.tr.insertText("x", position);
  const expectedFootnotes = mappedFootnotes(beforeFootnotes, transaction.mapping);
  const expectedToc = mappedToc(beforeToc, transaction.mapping);
  const rendererCallsBefore = rendererCallCount;
  const callbacksBefore = changeCallbackCount;
  const startedAt = performance.now();
  mount.editor.view.dispatch(transaction);
  const durationMs = performance.now() - startedAt;
  const footnoteMutations = footnoteObserver.takeRecords().length;
  const tocMutations = tocObserver.takeRecords().length;
  footnoteObserver.disconnect();
  tocObserver.disconnect();
  const afterFootnoteDom = [...mount.editor.view.dom.querySelectorAll(
    "[data-mdw-footnote-reference], [data-mdw-footnote-definition]",
  )];
  const afterTocEntries = [...mount.editor.view.dom.querySelectorAll(
    "button[data-mdw-toc-entry]",
  )];
  return {
    durationMs,
    footnoteDomRetained: beforeFootnoteDom.length === afterFootnoteDom.length
      && beforeFootnoteDom.every((node, index) => node === afterFootnoteDom[index]),
    footnoteMutations,
    footnotePositionsMapped: stableJson(footnotes.state.getSnapshot()) === stableJson(expectedFootnotes),
    immediateChangeCallbacks: changeCallbackCount - callbacksBefore,
    immediateRendererCalls: rendererCallCount - rendererCallsBefore,
    tocDomRetained: beforeTocEntries.length === afterTocEntries.length
      && beforeTocEntries.every((node, index) => node === afterTocEntries[index]),
    tocMutations,
    tocPositionsMapped: stableJson(toc.state.getSnapshot()) === stableJson(expectedToc),
  };
}

function structuralFootnoteEdit() {
  const mount = requireMount();
  const footnotes = mount.handles["markora-extension-footnotes"];
  const before = footnotes.state.getSnapshot();
  const definition = before.definitions[0];
  if (!definition) throw new Error("The fixture has no structural footnote target.");
  const nextLabel = `${definition.label}-r`;
  const rendererCallsBefore = rendererCallCount;
  const callbacksBefore = changeCallbackCount;
  const startedAt = performance.now();
  const changed = footnotes.commands.renameDefinition(
    { label: definition.label, occurrence: definition.occurrence },
    nextLabel,
    { references: "rename" },
  );
  const durationMs = performance.now() - startedAt;
  const after = footnotes.state.getSnapshot();
  return {
    changed,
    durationMs,
    immediateChangeCallbacks: changeCallbackCount - callbacksBefore,
    immediateRendererCalls: rendererCallCount - rendererCallsBefore,
    rebuilt: after !== before,
    renamedDefinition: after.definitions.some((entry) => entry.label === nextLabel),
    renamedReference: after.references.some((entry) => entry.label === nextLabel),
    stableCounts: after.definitions.length === before.definitions.length
      && after.references.length === before.references.length,
  };
}

function tocHeadingEdit() {
  const mount = requireMount();
  const toc = mount.handles["markora-extension-toc"];
  const before = toc.state.getSnapshot();
  const heading = before.headings.at(-1);
  if (!heading) throw new Error("The fixture has no TOC heading target.");
  const node = mount.editor.view.state.doc.nodeAt(heading.position);
  if (!node || node.type.name !== "heading") throw new Error("The TOC heading target is stale.");
  const rendererCallsBefore = rendererCallCount;
  const callbacksBefore = changeCallbackCount;
  const transaction = mount.editor.view.state.tr.insertText("x", heading.position + 1);
  const startedAt = performance.now();
  mount.editor.view.dispatch(transaction);
  const durationMs = performance.now() - startedAt;
  const after = toc.state.getSnapshot();
  return {
    durationMs,
    headingCountStable: after.headings.length === before.headings.length,
    immediateChangeCallbacks: changeCallbackCount - callbacksBefore,
    immediateRendererCalls: rendererCallCount - rendererCallsBefore,
    rebuiltLabel: after.headings.at(-1)?.label === `x${heading.label}`,
    tocCountStable: after.tocs.length === before.tocs.length,
  };
}

function removeRenderedDiagram() {
  const mount = requireMount();
  const diagrams = mount.handles["markora-extension-diagrams"];
  const target = diagrams.state.getNodes().find((node) => node.render.status === "rendered");
  if (!target) throw new Error("The fixture has no rendered diagram removal target.");
  const rendererCallsBefore = rendererCallCount;
  const callbacksBefore = changeCallbackCount;
  const signalWasTracked = [...activeRendererSignals.values()].includes(target.info);
  const artifactWasTracked = [...rendererArtifacts.values()].includes(target.info);
  const startedAt = performance.now();
  const removed = diagrams.commands.remove(target);
  const durationMs = performance.now() - startedAt;
  return {
    artifactWasTracked,
    durationMs,
    immediateChangeCallbacks: changeCallbackCount - callbacksBefore,
    immediateRendererCalls: rendererCallCount - rendererCallsBefore,
    info: target.info,
    removed,
    signalWasTracked,
  };
}

function activateFirstDiagram() {
  const mount = requireMount();
  const diagrams = mount.handles["markora-extension-diagrams"];
  const target = diagrams.state.getNodes()[0];
  if (!target) throw new Error("The fixture has no first diagram target.");
  const first = mount.editor.view.dom.querySelector("[data-mdw-diagram]");
  if (!(first instanceof HTMLElement)) throw new Error("The fixture has no diagram DOM.");
  const callsBefore = rendererCallCount;
  const statusBefore = target.render.status;
  first.scrollIntoView({ block: "center" });
  return { callsBefore, statusBefore, target };
}

function activateLastDiagram() {
  const mount = requireMount();
  const diagramState = mount.handles["markora-extension-diagrams"].state;
  const target = diagramState.getNodes().at(-1);
  if (!target) throw new Error("The fixture has no last diagram target.");
  const diagrams = [...mount.editor.view.dom.querySelectorAll("[data-mdw-diagram]")];
  const last = diagrams.at(-1);
  if (!(last instanceof HTMLElement)) throw new Error("The fixture has no last diagram DOM.");
  const callsBefore = rendererCallCount;
  const statusBefore = target.render.status;
  last.scrollIntoView({ block: "center" });
  return { callsBefore, statusBefore, target };
}

function diagramTargetSnapshot(target) {
  const mount = requireMount();
  return mount.handles["markora-extension-diagrams"].state.getNode(target)?.render ?? null;
}

function removalSnapshot(info) {
  const mount = requireMount();
  const diagrams = mount.handles["markora-extension-diagrams"];
  return {
    artifactReleased: ![...rendererArtifacts.values()].includes(info),
    nodeRemoved: !diagrams.state.getNodes().some((node) => node.info === info),
    signalReleased: ![...activeRendererSignals.values()].includes(info),
  };
}

function pressureSnapshot() {
  const mount = requireMount();
  const diagrams = mount.handles["markora-extension-diagrams"].state.getNodes();
  return {
    errors: [...errors],
    ledger: ledgerSnapshot(),
    outputByteLimitErrors: diagrams.filter((node) => (
      node.render.status === "error" && node.render.errorCode === "output-byte-limit"
    )).length,
    rendererCalls: rendererCallCount,
    statuses: diagrams.reduce((counts, node) => {
      counts[node.render.status] = (counts[node.render.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function renderWorkSnapshot() {
  const mount = requireMount();
  const diagrams = mount.handles["markora-extension-diagrams"].state.getNodes();
  return {
    ledger: ledgerSnapshot(),
    statuses: diagrams.reduce((counts, node) => {
      counts[node.render.status] = (counts[node.render.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function releasePressure() {
  pressureReleased = true;
  for (const resolve of [...pressureResolvers]) resolve();
  return pressureSnapshot();
}

function restartPressure() {
  const mount = requireMount();
  preparePressure({ oversized: false });
  const startedAt = performance.now();
  mount.editor.commands.resetMarkdown(createPressureMarkdown("reset"));
  return { durationMs: performance.now() - startedAt };
}

function resetPressureToSentinel() {
  const mount = requireMount();
  const callsBefore = rendererCallCount;
  const callbacksBefore = changeCallbackCount;
  rendererMode = "normal";
  const startedAt = performance.now();
  mount.editor.commands.resetMarkdown("Reset cleanup sentinel.");
  return {
    callsBefore,
    callbacksBefore,
    durationMs: performance.now() - startedAt,
  };
}

function createFailingExtension() {
  return defineMarkdownEditorExtension({
    name: "markora-performance-failed-creation",
    version: "0.0.1",
    compatibility: { extensionApi: "^1.3.0", markora: "^0.0.1" },
    createRuntime() {
      return {
        plugins: [{
          id: "fail-after-node-views",
          create: () => new Plugin({
            view() {
              throw new Error("Expected all-seven creation failure probe.");
            },
          }),
        }],
      };
    },
  });
}

function failedCreationProbe() {
  const probeHost = document.createElement("div");
  document.body.append(probeHost);
  const before = ledgerSnapshot();
  let caught = false;
  let message = "";
  try {
    const editor = createEditor({
      element: probeHost,
      extensions: [...createDefinitions(), createFailingExtension()],
      markdown: "```mermaid failed-creation\ngraph TD\nA --> B\n```",
    });
    editor.destroy();
  } catch (error) {
    caught = true;
    message = error instanceof Error ? error.message : String(error);
  }
  const hostChildren = probeHost.childNodes.length;
  probeHost.remove();
  const after = ledgerSnapshot();
  return {
    after,
    before,
    caught,
    disconnectedObservers: after.disconnectedIntersectionObservers
      - before.disconnectedIntersectionObservers,
    hostChildren,
    message,
    observersCreated: after.totalIntersectionObservers - before.totalIntersectionObservers,
  };
}

function snapshot() {
  const mount = requireMount();
  return {
    callbacks: changeCallbackCount,
    canonical: mount.editor.getMarkdown(),
    errors: [...errors],
    features: featureSnapshot(mount),
    ledger: ledgerSnapshot(),
    rendererCalls: rendererCallCount,
  };
}

function destroy() {
  const mount = requireMount();
  const rendererCallsBefore = rendererCallCount;
  const callbacksBefore = changeCallbackCount;
  const recordedErrors = [...errors];
  activeMount = null;
  const startedAt = performance.now();
  mount.unsubscribeError();
  mount.editor.destroy();
  const durationMs = performance.now() - startedAt;
  rendererCalls.length = 0;
  errors.length = 0;
  rendererMode = "normal";
  pressureOversizedPending = false;
  pressureReleased = false;
  return {
    callbacksBefore,
    durationMs,
    ledger: ledgerSnapshot(),
    recordedErrors,
    rendererCallsBefore,
  };
}

function postLifecycleSnapshot() {
  return {
    callbacks: changeCallbackCount,
    errors: errors.length,
    hostChildren: host.childNodes.length,
    ledger: ledgerSnapshot(),
    rendererCalls: rendererCallCount,
  };
}

window.__MARKORA_ADVANCED_PERFORMANCE__ = Object.freeze({
  activateFirstDiagram,
  activateLastDiagram,
  clearTelemetry,
  destroy,
  diagramTargetSnapshot,
  failedCreationProbe,
  installFixture,
  mountFixture,
  mountPressure,
  ordinaryEdit,
  postLifecycleSnapshot,
  pressureSnapshot,
  renderWorkSnapshot,
  releasePressure,
  removalSnapshot,
  removeRenderedDiagram,
  rendererCallCount: () => rendererCallCount,
  resetPressureToSentinel,
  restartPressure,
  snapshot,
  structuralFootnoteEdit,
  tocHeadingEdit,
});
document.body.dataset.advancedSyntaxPerformanceReady = "true";
