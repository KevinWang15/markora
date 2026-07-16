import { createEditor } from "markora";
import { defineMarkdownEditorExtension } from "markora/extension-api";
import "markora/styles.css";

const API_VERSION = "1.0.0";
const EVENT_TIMING_DELIVERY_WAIT_MS = 100;
const EVENT_TIMING_THRESHOLD_MS = 16;
const fixtures = new Map();
const textEncoder = new TextEncoder();
const editorHost = requireElement("editor-host");
const codecHost = requireElement("codec-host");
const emptyCodeMirrorExtension = Object.freeze([]);

// Override every built-in alias so a future fixture label cannot accidentally
// add a dynamic language import to a runtime measurement. Plain fences still
// construct their normal CodeMirror NodeViews.
const deterministicCodeBlockLanguages = Object.freeze(Object.fromEntries([
  "javascript",
  "js",
  "typescript",
  "ts",
  "json",
  "css",
  "html",
  "xml",
  "markdown",
  "md",
  "python",
  "py",
  "c",
  "cpp",
  "c++",
  "java",
  "rust",
  "rs",
  "bash",
  "sh",
  "shell",
  "benchmark",
  "bench",
].map((name) => [name, emptyCodeMirrorExtension])));

const deterministicResources = Object.freeze({
  // Exercise the complete image NodeView without network, decode, cache, or
  // remote-server variance. A synchronous null is an intentional host denial.
  loadImage() {
    return null;
  },
});

const codecProbeExtension = defineMarkdownEditorExtension({
  name: "@markora-benchmark/codec-probe",
  version: "1.0.0",
  compatibility: {
    extensionApi: "^1.0.0",
    markora: "^0.0.1",
  },
  createStorage({ codec }) {
    return Object.freeze({ codec });
  },
  createRuntime() {
    return {};
  },
});

let activeMount = null;
let codecRuntime = null;
let lastParsedDocument = null;
let nextKeystrokeId = 1;
let pendingKeystroke = null;
let eventTimingObserver = null;
let eventTimingSupported = false;
const eventTimingEntries = [];

installEventTimingObserver();

function requireElement(id) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing packed performance consumer element #${id}.`);
  }
  return element;
}

function assertPlainRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertIdentifier(value, label = "Fixture id") {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]*$/iu.test(value)) {
    throw new TypeError(`${label} must contain only letters, numbers, underscores, and hyphens.`);
  }
  return value;
}

function assertFiniteDuration(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function cloneJsonRecord(value, label) {
  assertPlainRecord(value, label);
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${label} must be JSON-serializable.`, { cause: error });
  }
  if (encoded === undefined) {
    throw new TypeError(`${label} must be JSON-serializable.`);
  }
  const cloned = JSON.parse(encoded);
  assertPlainRecord(cloned, label);
  return deepFreeze(cloned);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function requireFixture(id) {
  const fixture = fixtures.get(assertIdentifier(id));
  if (!fixture) {
    throw new Error(`Unknown packed performance fixture "${id}".`);
  }
  return fixture;
}

function snapshotFixture(fixture) {
  return {
    characters: fixture.markdown.length,
    id: fixture.id,
    resident: fixtures.get(fixture.id) === fixture,
    stats: fixture.stats,
    utf8Bytes: fixture.utf8Bytes,
  };
}

function installFixture(input) {
  assertPlainRecord(input, "Fixture");
  const id = assertIdentifier(input.id);
  if (typeof input.markdown !== "string") {
    throw new TypeError("Fixture markdown must be a string.");
  }
  const stats = cloneJsonRecord(input.stats, "Fixture stats");
  const utf8Bytes = textEncoder.encode(input.markdown).byteLength;

  if (typeof stats.bytes === "number" && stats.bytes !== utf8Bytes) {
    throw new RangeError(`Fixture stats.bytes (${stats.bytes}) does not match its UTF-8 size (${utf8Bytes}).`);
  }
  if (typeof stats.targetBytes === "number" && stats.targetBytes !== utf8Bytes) {
    throw new RangeError(`Fixture stats.targetBytes (${stats.targetBytes}) does not match its UTF-8 size (${utf8Bytes}).`);
  }

  const existing = fixtures.get(id);
  if (existing) {
    if (existing.markdown !== input.markdown || JSON.stringify(existing.stats) !== JSON.stringify(stats)) {
      throw new Error(`Fixture "${id}" is already resident with different content.`);
    }
    return snapshotFixture(existing);
  }

  const fixture = Object.freeze({ id, markdown: input.markdown, stats, utf8Bytes });
  fixtures.set(id, fixture);
  return snapshotFixture(fixture);
}

function fixtureSnapshot(id) {
  if (id !== undefined) {
    return snapshotFixture(requireFixture(id));
  }
  return {
    count: fixtures.size,
    fixtures: [...fixtures.values()].map(snapshotFixture),
  };
}

function removeFixture(id) {
  const fixture = requireFixture(id);
  if (activeMount?.fixtureId === fixture.id || lastParsedDocument?.fixtureId === fixture.id) {
    throw new Error(`Cannot remove fixture "${fixture.id}" while it is in use.`);
  }
  fixtures.delete(fixture.id);
  return true;
}

function clearFixtures() {
  if (activeMount || lastParsedDocument) {
    throw new Error("Cannot clear resident fixtures while an editor or parsed document is active.");
  }
  const count = fixtures.size;
  fixtures.clear();
  return count;
}

function countDescendantNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let count = 0;
  while (walker.nextNode()) {
    count += 1;
  }
  return count;
}

function readDomCounts(host = editorHost) {
  return {
    animations: document.getAnimations().length,
    blockquotes: host.querySelectorAll("blockquote").length,
    bulletLists: host.querySelectorAll("ul").length,
    codeMirrorEditors: host.querySelectorAll(".cm-editor").length,
    descendantElements: host.querySelectorAll("*").length,
    descendantNodes: countDescendantNodes(host),
    hostChildNodes: host.childNodes.length,
    imageViews: host.querySelectorAll(".mdw-image").length,
    listItems: host.querySelectorAll("li").length,
    orderedLists: host.querySelectorAll("ol").length,
    proseMirrorEditors: host.querySelectorAll(".ProseMirror").length,
    tables: host.querySelectorAll("table").length,
  };
}

function countModelNodes(doc) {
  const counts = Object.create(null);
  counts[doc.type.name] = 1;
  doc.descendants((node) => {
    counts[node.type.name] = (counts[node.type.name] ?? 0) + 1;
  });
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function readModelSnapshot(editor) {
  const { doc, selection } = editor.view.state;
  return {
    childCount: doc.childCount,
    contentSize: doc.content.size,
    nodeCounts: countModelNodes(doc),
    nodeSize: doc.nodeSize,
    selection: {
      anchor: selection.anchor,
      from: selection.from,
      head: selection.head,
      to: selection.to,
    },
  };
}

function assertDomState(expected) {
  if (expected !== "mounted" && expected !== "released") {
    throw new TypeError('DOM state must be "mounted" or "released".');
  }
  const counts = readDomCounts();

  if (expected === "released") {
    const leaked = Object.entries(counts).filter(([name, value]) => name !== "animations" && value !== 0);
    if (leaked.length > 0) {
      throw new Error(`Released editor host retained DOM: ${leaked.map(([name, value]) => `${name}=${value}`).join(", ")}.`);
    }
    return counts;
  }

  if (!activeMount || counts.proseMirrorEditors !== 1 || counts.hostChildNodes === 0) {
    throw new Error("Mounted editor DOM is incomplete.");
  }

  const { stats } = requireFixture(activeMount.fixtureId);
  for (const [statName, countName] of [
    ["codeBlocks", "codeMirrorEditors"],
    ["images", "imageViews"],
    ["tables", "tables"],
  ]) {
    if (typeof stats[statName] === "number" && counts[countName] !== stats[statName]) {
      throw new Error(`Mounted ${countName} count ${counts[countName]} does not match fixture ${statName} ${stats[statName]}.`);
    }
  }
  return counts;
}

function assertRuntimeIsolation(operation) {
  if (activeMount) {
    throw new Error(`Cannot ${operation} while a measured editor is mounted.`);
  }
}

function assertCodecIsolation(operation) {
  if (codecRuntime) {
    throw new Error(`Cannot ${operation} while the codec probe editor is active.`);
  }
}

function prepareCodec() {
  assertRuntimeIsolation("prepare the codec probe");
  if (codecRuntime) {
    return codecSnapshot();
  }
  codecHost.replaceChildren();
  const editor = createEditor({
    ariaLabel: "Markora performance codec probe",
    attributes: { spellcheck: "false" },
    codeBlockLanguages: deterministicCodeBlockLanguages,
    element: codecHost,
    extensions: [codecProbeExtension],
    markdown: "",
    resources: deterministicResources,
  });
  const handle = editor.extensions.get(codecProbeExtension);
  const codec = handle.storage?.codec;
  if (!codec || typeof codec.parse !== "function" || typeof codec.serialize !== "function") {
    editor.destroy();
    codecHost.replaceChildren();
    throw new Error("The public codec probe extension did not expose a codec.");
  }
  codecRuntime = { codec, editor };
  return codecSnapshot();
}

function codecSnapshot() {
  return {
    active: Boolean(codecRuntime),
    hasParsedDocument: Boolean(lastParsedDocument),
    parsedFixtureId: lastParsedDocument?.fixtureId ?? null,
  };
}

function parseFixture(id) {
  const fixture = requireFixture(id);
  prepareCodec();
  const startedAt = performance.now();
  const doc = codecRuntime.codec.parse(fixture.markdown);
  const completedAt = performance.now();
  if (!doc) {
    throw new Error(`Codec returned no document for fixture "${fixture.id}".`);
  }
  lastParsedDocument = { doc, fixtureId: fixture.id };
  return {
    durationMs: assertFiniteDuration(completedAt - startedAt, "Parse duration"),
    fixture: snapshotFixture(fixture),
    model: {
      childCount: doc.childCount,
      contentSize: doc.content.size,
      nodeCounts: countModelNodes(doc),
      nodeSize: doc.nodeSize,
    },
  };
}

function serializeParsed() {
  if (!codecRuntime || !lastParsedDocument) {
    throw new Error("Parse a resident fixture before measuring serialization.");
  }
  const fixture = requireFixture(lastParsedDocument.fixtureId);
  const startedAt = performance.now();
  const markdown = codecRuntime.codec.serialize(lastParsedDocument.doc);
  const completedAt = performance.now();
  return {
    characters: markdown.length,
    durationMs: assertFiniteDuration(completedAt - startedAt, "Serialization duration"),
    fixtureId: fixture.id,
    matchesInput: markdown === fixture.markdown,
    utf8Bytes: textEncoder.encode(markdown).byteLength,
  };
}

function releaseParsed() {
  const released = Boolean(lastParsedDocument);
  lastParsedDocument = null;
  return released;
}

function releaseCodec() {
  assertRuntimeIsolation("release the codec probe");
  releaseParsed();
  if (!codecRuntime) {
    codecHost.replaceChildren();
    return false;
  }
  let editor = codecRuntime.editor;
  codecRuntime = null;
  try {
    editor.destroy();
  } finally {
    editor = null;
    codecHost.replaceChildren();
  }
  return true;
}

function normalizeSnapshotMode(mode) {
  const normalized = mode ?? "none";
  if (normalized !== "none" && normalized !== "immediate" && normalized !== "animationFrame") {
    throw new TypeError('snapshotMode must be "none", "immediate", or "animationFrame".');
  }
  return normalized;
}

function mount(input) {
  assertPlainRecord(input, "Mount options");
  assertCodecIsolation("mount a measured editor");
  if (activeMount) {
    throw new Error("A measured editor is already mounted.");
  }
  if (pendingKeystroke) {
    throw new Error("Cannot mount while a keystroke sample is pending.");
  }
  const fixture = requireFixture(input.fixtureId);
  const snapshotMode = normalizeSnapshotMode(input.snapshotMode);
  editorHost.replaceChildren();

  const options = {
    ariaLabel: "Markora packed performance editor",
    attributes: {
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
      spellcheck: "false",
    },
    autofocus: false,
    codeBlockLanguages: deterministicCodeBlockLanguages,
    editable: true,
    element: editorHost,
    initialSelection: "start",
    markdown: fixture.markdown,
    resources: deterministicResources,
    ...(snapshotMode === "none" ? {} : {
      onChange() {
        // Receiving the snapshot is enough to include Markora serialization;
        // benchmark instrumentation intentionally adds no host work here.
      },
      onChangeMode: snapshotMode,
    }),
  };

  const startedAt = performance.now();
  let editor;
  try {
    editor = createEditor(options);
  } catch (error) {
    editorHost.replaceChildren();
    throw error;
  }
  const completedAt = performance.now();
  activeMount = {
    changedSinceSnapshot: false,
    editor,
    fixtureId: fixture.id,
    mountStartedAt: startedAt,
    snapshotMode,
  };

  return {
    dom: assertDomState("mounted"),
    fixture: snapshotFixture(fixture),
    model: readModelSnapshot(editor),
    snapshotMode,
    syncDurationMs: assertFiniteDuration(completedAt - startedAt, "Mount duration"),
  };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function afterPresentationOpportunity() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(() => resolve(performance.now()), 0));
  });
}

async function settlePage() {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await Promise.resolve();
  await Promise.resolve();
  // Resolve style/layout before the two clean presentation opportunities.
  void editorHost.getBoundingClientRect();
  await nextFrame();
  await nextFrame();
  await nextTask();
  return readDomCounts();
}

async function settle() {
  const dom = await settlePage();
  return {
    dom,
    model: activeMount ? readModelSnapshot(activeMount.editor) : null,
    now: performance.now(),
  };
}

async function mountAndSettle(input) {
  const mounted = mount(input);
  const presentedAt = await afterPresentationOpportunity();
  const toPresentationMs = assertFiniteDuration(
    presentedAt - activeMount.mountStartedAt,
    "Mount-to-presentation duration",
  );
  await settlePage();
  return {
    ...mounted,
    dom: assertDomState("mounted"),
    initialDom: mounted.dom,
    model: readModelSnapshot(activeMount.editor),
    toPresentationMs,
  };
}

function editorSnapshot() {
  if (!activeMount) {
    return {
      active: false,
      dom: readDomCounts(),
    };
  }
  return {
    active: true,
    changedSinceSnapshot: activeMount.changedSinceSnapshot,
    dom: readDomCounts(),
    fixtureId: activeMount.fixtureId,
    focused: activeMount.editor.view.hasFocus(),
    model: readModelSnapshot(activeMount.editor),
    snapshotMode: activeMount.snapshotMode,
  };
}

function disableSnapshots() {
  if (!activeMount) {
    throw new Error("Mount an editor before disabling snapshots.");
  }
  if (pendingKeystroke) {
    throw new Error("Await the pending keystroke before disabling snapshots.");
  }
  // updateOptions flushes any pending animation-frame snapshot through the
  // previous callback before removing it. The current document therefore
  // remains the serialization cache baseline; the next change becomes dirty.
  activeMount.editor.updateOptions({ onChange: null });
  activeMount.snapshotMode = "none";
  activeMount.changedSinceSnapshot = false;
  return editorSnapshot();
}

function typingCandidates(editor) {
  const ordinary = [];
  const fallback = [];
  editor.view.state.doc.descendants((node, pos, parent) => {
    if (!node.isTextblock || node.content.size === 0) {
      return;
    }
    const item = { node, pos };
    fallback.push(item);
    if (
      node.type.name === "paragraph"
      && parent?.type.name === "doc"
      && node.textContent.length >= 32
      && node.textContent.length <= 2_048
    ) {
      ordinary.push(item);
    }
  });
  return ordinary.length > 0 ? ordinary : fallback;
}

function focusTypingTarget(target = "middle") {
  if (!activeMount) {
    throw new Error("Mount an editor before focusing a typing target.");
  }
  if (target !== "start" && target !== "middle" && target !== "end") {
    throw new TypeError('Typing target must be "start", "middle", or "end".');
  }
  const candidates = typingCandidates(activeMount.editor);
  if (candidates.length === 0) {
    throw new Error("The mounted document has no editable text block.");
  }
  const index = target === "start"
    ? 0
    : target === "end"
      ? candidates.length - 1
      : Math.floor((candidates.length - 1) / 2);
  const { node, pos } = candidates[index];
  const innerOffset = Math.max(1, Math.min(node.content.size, Math.floor(node.content.size / 2)));
  const anchor = pos + 1 + innerOffset;
  activeMount.editor.focus({ anchor });
  return {
    anchor,
    candidateCount: candidates.length,
    target,
    textBlock: node.type.name,
  };
}

function installEventTimingObserver() {
  eventTimingSupported = typeof PerformanceObserver === "function"
    && PerformanceObserver.supportedEntryTypes?.includes("event");
  if (!eventTimingSupported) {
    return;
  }
  try {
    eventTimingObserver = new PerformanceObserver((list) => {
      ingestEventTimingEntries(list.getEntries());
    });
    eventTimingObserver.observe({
      buffered: true,
      durationThreshold: EVENT_TIMING_THRESHOLD_MS,
      type: "event",
    });
  } catch {
    eventTimingSupported = false;
    eventTimingObserver = null;
  }
}

function eventTimestamp(event) {
  return event.timeStamp > performance.timeOrigin
    ? event.timeStamp - performance.timeOrigin
    : event.timeStamp;
}

function ingestEventTimingEntries(entries) {
  for (const entry of entries) {
    eventTimingEntries.push({
      duration: entry.duration,
      interactionId: entry.interactionId ?? 0,
      name: entry.name,
      processingEnd: entry.processingEnd,
      processingStart: entry.processingStart,
      startTime: entry.startTime,
    });
  }
  if (eventTimingEntries.length > 2_000) {
    eventTimingEntries.splice(0, eventTimingEntries.length - 1_000);
  }
}

function drainEventTimingObserver() {
  if (eventTimingObserver) {
    ingestEventTimingEntries(eventTimingObserver.takeRecords());
  }
}

function summarizeEventTiming(startIndex, keydownStart) {
  const matching = eventTimingEntries.slice(startIndex).filter((entry) => (
    Math.abs(entry.startTime - keydownStart) < 1
  ));
  if (matching.length === 0) {
    return null;
  }
  const interactionId = matching.find((entry) => entry.interactionId > 0)?.interactionId ?? 0;
  const interaction = interactionId > 0
    ? matching.filter((entry) => entry.interactionId === interactionId)
    : matching;
  return {
    durationMs: Math.max(...interaction.map((entry) => entry.duration)),
    entryNames: [...new Set(interaction.map((entry) => entry.name))].sort(),
    interactionId,
    processingEnd: Math.max(...interaction.map((entry) => entry.processingEnd)),
    processingStart: Math.min(...interaction.map((entry) => entry.processingStart)),
  };
}

function armKeystroke(options = {}) {
  assertPlainRecord(options, "Keystroke options");
  if (!activeMount) {
    throw new Error("Mount an editor before arming a keystroke sample.");
  }
  if (pendingKeystroke) {
    throw new Error("A keystroke sample is already pending.");
  }
  if (!activeMount.editor.view.hasFocus()) {
    throw new Error("Focus and settle the measured typing target before arming a keystroke.");
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new RangeError("Keystroke timeoutMs must be between 100 and 30000.");
  }

  const id = nextKeystrokeId++;
  const entryStartIndex = eventTimingEntries.length;
  const record = {
    armedAt: performance.now(),
    capturedAt: null,
    code: null,
    eventStart: null,
    isTrusted: null,
    key: null,
    updateOrigins: [],
    updateTimes: [],
  };
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  let finished = false;

  const unsubscribe = activeMount.editor.subscribe("update", (event) => {
    record.updateOrigins.push(event.origin);
    record.updateTimes.push(performance.now());
    if (activeMount?.snapshotMode === "none") {
      activeMount.changedSinceSnapshot = true;
    }
  });

  const cleanupAndResolve = (error = null, presentationAt = performance.now()) => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(timeoutId);
    document.removeEventListener("keydown", handleKeydown, true);
    unsubscribe();

    drainEventTimingObserver();
    const eventTiming = record.eventStart === null
      ? null
      : summarizeEventTiming(entryStartIndex, record.eventStart);
    const keydownToPresentationProxyMs = record.eventStart === null
      ? null
      : presentationAt - record.eventStart;
    const updateCount = record.updateTimes.length;
    const invariantError = error
      ?? (record.isTrusted !== true ? "The measured keydown was not trusted." : null)
      ?? (updateCount !== 1 ? `Expected one document update, observed ${updateCount}.` : null)
      ?? (record.updateOrigins[0] !== "user" ? `Expected user update origin, observed ${record.updateOrigins[0] ?? "none"}.` : null)
      ?? (
        eventTimingSupported
        && eventTiming === null
        && keydownToPresentationProxyMs !== null
        && keydownToPresentationProxyMs >= EVENT_TIMING_THRESHOLD_MS
          ? "Chromium omitted Event Timing for a keydown above the censoring threshold."
          : null
      );

    finish({
      code: record.code,
      dom: readDomCounts(),
      error: invariantError,
      eventStart: record.eventStart,
      eventTiming,
      eventTimingCensoredBelowMs: eventTimingSupported && !eventTiming
        ? EVENT_TIMING_THRESHOLD_MS
        : null,
      eventTimingSupported,
      id,
      key: record.key,
      keydownToPresentationProxyMs,
      processingCaptureDelayMs: record.eventStart === null
        ? null
        : record.capturedAt - record.eventStart,
      trusted: record.isTrusted,
      updateCount,
      updateOrigin: record.updateOrigins[0] ?? null,
      updateToPresentationProxyMs: updateCount === 1
        ? presentationAt - record.updateTimes[0]
        : null,
    });
  };

  const handleKeydown = (event) => {
    if (record.eventStart !== null || !event.composedPath().includes(activeMount.editor.view.dom)) {
      return;
    }
    record.capturedAt = performance.now();
    record.code = event.code;
    record.eventStart = eventTimestamp(event);
    record.isTrusted = event.isTrusted;
    record.key = event.key;

    if (!event.isTrusted) {
      cleanupAndResolve("The measured keydown was not trusted.");
      return;
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        const presentationAt = performance.now();
        // Event Timing is delivered after the presentation boundary. Keep that
        // observer delay outside the measured proxy while allowing Chromium to
        // distinguish a reported event from a threshold-censored one.
        setTimeout(
          () => cleanupAndResolve(null, presentationAt),
          EVENT_TIMING_DELIVERY_WAIT_MS,
        );
      }, 0);
    });
  };

  document.addEventListener("keydown", handleKeydown, true);
  const timeoutId = setTimeout(() => {
    cleanupAndResolve("Timed out waiting for a trusted editor keystroke.");
  }, timeoutMs);
  pendingKeystroke = { id, promise };

  return {
    armedAt: record.armedAt,
    eventTimingSupported,
    id,
    selection: readModelSnapshot(activeMount.editor).selection,
    timeoutMs,
  };
}

async function awaitKeystroke(id = pendingKeystroke?.id) {
  if (!pendingKeystroke || id !== pendingKeystroke.id) {
    throw new Error(`No pending keystroke sample ${String(id)}.`);
  }
  const pending = pendingKeystroke;
  const result = await pending.promise;
  if (pendingKeystroke === pending) {
    pendingKeystroke = null;
  }
  if (result.error) {
    throw new Error(result.error);
  }
  const { error: _error, ...successfulResult } = result;
  return successfulResult;
}

function primeDirty() {
  if (!activeMount) {
    throw new Error("Mount an editor before priming dirty teardown.");
  }
  if (activeMount.snapshotMode !== "none") {
    throw new Error("Dirty teardown requires snapshotMode \"none\" so no change callback refreshes the serialization cache.");
  }
  if (activeMount.changedSinceSnapshot) {
    return { applied: false, model: readModelSnapshot(activeMount.editor) };
  }
  if (!activeMount.editor.commands.insertHardBreak()) {
    throw new Error("Could not create a deterministic unsnapshotted document change.");
  }
  activeMount.changedSinceSnapshot = true;
  return { applied: true, model: readModelSnapshot(activeMount.editor) };
}

function primeClean() {
  if (!activeMount) {
    throw new Error("Mount an editor before priming clean teardown.");
  }
  const markdown = activeMount.editor.getMarkdown();
  activeMount.editor.flushChange();
  activeMount.changedSinceSnapshot = false;
  return {
    characters: markdown.length,
    utf8Bytes: textEncoder.encode(markdown).byteLength,
  };
}

async function destroy(mode) {
  if (mode !== "clean" && mode !== "dirty") {
    throw new TypeError('Destroy mode must be "clean" or "dirty".');
  }
  if (!activeMount) {
    throw new Error("No measured editor is mounted.");
  }
  if (pendingKeystroke) {
    throw new Error("Await the pending keystroke before destroying the editor.");
  }
  const fixtureId = activeMount.fixtureId;
  const priming = mode === "clean" ? primeClean() : primeDirty();
  await settlePage();
  const beforeDom = assertDomState("mounted");
  let editor = activeMount.editor;
  const startedAt = performance.now();
  let destroyError = null;
  try {
    editor.destroy();
  } catch (error) {
    destroyError = error;
  }
  const completedAt = performance.now();
  const afterDestroyDom = readDomCounts();

  activeMount = null;
  editor = null;
  editorHost.replaceChildren();
  const afterSettleDom = await settlePage();
  assertDomState("released");

  if (destroyError) {
    throw destroyError;
  }
  return {
    afterDestroyDom,
    afterSettleDom,
    beforeDom,
    fixtureId,
    fixtureResident: fixtures.has(fixtureId),
    mode,
    priming,
    syncDurationMs: assertFiniteDuration(completedAt - startedAt, "Destroy duration"),
  };
}

const schema = deepFreeze({
  durationUnit: "milliseconds",
  fixtureInput: {
    id: "string",
    markdown: "string",
    stats: "JSON object",
  },
  keystroke: {
    eventTimingDeliveryWaitMs: EVENT_TIMING_DELIVERY_WAIT_MS,
    eventTimingThresholdMs: EVENT_TIMING_THRESHOLD_MS,
    sequence: ["focusTypingTarget", "settle", "armKeystroke", "trusted Playwright key", "awaitKeystroke"],
  },
  mountInput: {
    fixtureId: "string",
    snapshotMode: ["none", "immediate", "animationFrame"],
  },
  name: "markora-packed-performance-consumer",
  teardownModes: ["clean", "dirty"],
  version: API_VERSION,
});

const api = Object.freeze({
  armKeystroke,
  assertDomState,
  awaitKeystroke,
  clearFixtures,
  codecSnapshot,
  destroy,
  disableSnapshots,
  editorSnapshot,
  fixtureSnapshot,
  focusTypingTarget,
  installFixture,
  mount,
  mountAndSettle,
  parseFixture,
  prepareCodec,
  primeClean,
  primeDirty,
  ready: true,
  releaseCodec,
  releaseParsed,
  removeFixture,
  schema,
  serializeParsed,
  settle,
  version: API_VERSION,
});

Object.defineProperty(window, "__MARKORA_PERFORMANCE__", {
  configurable: false,
  enumerable: false,
  value: api,
  writable: false,
});
document.body.dataset.markoraPerformanceReady = "true";
