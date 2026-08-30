import { createEditor } from "markora";
import { Plugin, defineMarkdownEditorExtension } from "markora/extension-api";
import "markora/styles.css";

const API_VERSION = "1.0.0";
const EVENT_TIMING_DELIVERY_WAIT_MS = 100;
const EVENT_TIMING_THRESHOLD_MS = 16;
const CODE_BLOCK_ACTIVATION_TIMEOUT_MS = 8_000;
const CODE_BLOCK_CAPACITY_PRESSURE_SHELLS = 9;
const CODE_BLOCK_ACTIVATION_STRATEGY = "viewport-bounded-static-shell";
const CODE_BLOCK_STATE_ATTRIBUTE = "data-mdw-code-block-state";
const CODE_BLOCK_VIEWPORT_PROBE = "first-middle-last-selection";
const fixtures = new Map();
const textEncoder = new TextEncoder();
const MAX_SETTLED_CODE_MIRROR_EDITORS = 8;
const editorHost = requireElement("editor-host");
const codecHost = requireElement("codec-host");
const emptyCodeMirrorExtension = Object.freeze([]);

// Override every built-in alias so a future fixture label cannot accidentally
// add a dynamic grammar import to a runtime measurement. The representative
// fixtures use plain fences and exercise the viewport-bounded editor runtime.
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

const hotPathProbeExtension = defineMarkdownEditorExtension({
  name: "@markora-benchmark/hot-path-probe",
  version: "1.0.0",
  compatibility: {
    extensionApi: "^1.0.0",
    markora: "^0.0.1",
  },
  createRuntime() {
    return {
      plugins: [{
        id: "trusted-key-insert",
        create: () => new Plugin({
          props: {
            handleKeyDown(view, event) {
              if (event.code !== "F8") {
                return false;
              }
              if (!activeMount?.hotPathProbe) {
                throw new Error("The hot-path probe received a keydown without an active probe mount.");
              }
              activeMount.hotPathKeydowns.push(Object.freeze({
                code: event.code,
                eventStart: eventTimestamp(event),
                key: event.key,
                observedAt: performance.now(),
                snapshotCountBeforeDispatch: activeMount.snapshots.length,
                trusted: event.isTrusted,
              }));
              view.dispatch(view.state.tr.insertText("x"));
              return true;
            },
          },
        }),
      }],
    };
  },
});

let activeMount = null;
let codecRuntime = null;
let lastParsedDocument = null;
let capturedSnapshotVerification = null;
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
    activeCodeBlocks: host.querySelectorAll(`[${CODE_BLOCK_STATE_ATTRIBUTE}="active"]`).length,
    animations: document.getAnimations().length,
    blockquotes: host.querySelectorAll("blockquote").length,
    bulletLists: host.querySelectorAll("ul").length,
    codeBlockActiveHosts: host.querySelectorAll(".mdw-code-block-active").length,
    codeBlockErrors: host.querySelectorAll(`[${CODE_BLOCK_STATE_ATTRIBUTE}="error"]`).length,
    codeBlockShells: host.querySelectorAll(".mdw-code-block").length,
    codeBlocksLoading: host.querySelectorAll(`[${CODE_BLOCK_STATE_ATTRIBUTE}="loading"]`).length,
    codeMirrorEditors: host.querySelectorAll(".cm-editor").length,
    descendantElements: host.querySelectorAll("*").length,
    descendantNodes: countDescendantNodes(host),
    hostChildNodes: host.childNodes.length,
    imageViews: host.querySelectorAll(".mdw-image").length,
    listItems: host.querySelectorAll("li").length,
    inactiveCodeBlocks: host.querySelectorAll(`[${CODE_BLOCK_STATE_ATTRIBUTE}="inactive"]`).length,
    orderedLists: host.querySelectorAll("ol").length,
    proseMirrorEditors: host.querySelectorAll(".ProseMirror").length,
    staticCodeBlocks: host.querySelectorAll(".mdw-code-block-static").length,
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
    ["codeBlocks", "codeBlockShells"],
    ["images", "imageViews"],
    ["tables", "tables"],
  ]) {
    if (typeof stats[statName] === "number" && counts[countName] !== stats[statName]) {
      throw new Error(`Mounted ${countName} count ${counts[countName]} does not match fixture ${statName} ${stats[statName]}.`);
    }
  }

  if (counts.activeCodeBlocks !== counts.codeMirrorEditors) {
    throw new Error(
      `Mounted active code-block count ${counts.activeCodeBlocks} does not match CodeMirror editor count ${counts.codeMirrorEditors}.`,
    );
  }

  const codeBlockStateCount = counts.inactiveCodeBlocks
    + counts.codeBlocksLoading
    + counts.activeCodeBlocks
    + counts.codeBlockErrors;

  if (codeBlockStateCount !== counts.codeBlockShells) {
    throw new Error(
      `Mounted code-block states account for ${codeBlockStateCount} of ${counts.codeBlockShells} shells.`,
    );
  }

  if (
    counts.staticCodeBlocks !== counts.codeBlockShells
    || counts.codeBlockActiveHosts !== counts.codeBlockShells
  ) {
    throw new Error(
      `Mounted code-block surfaces are incomplete: static=${counts.staticCodeBlocks}, activeHosts=${counts.codeBlockActiveHosts}, shells=${counts.codeBlockShells}.`,
    );
  }

  if (counts.codeBlocksLoading !== 0) {
    throw new Error(`Mounted editor retained ${counts.codeBlocksLoading} loading code blocks after settlement.`);
  }

  if (counts.codeBlockErrors !== 0) {
    throw new Error(`Mounted editor retained ${counts.codeBlockErrors} failed code-block activations.`);
  }

  if (counts.codeMirrorEditors > Math.min(stats.codeBlocks ?? 0, MAX_SETTLED_CODE_MIRROR_EDITORS)) {
    throw new Error(
      `Mounted CodeMirror editor count ${counts.codeMirrorEditors} exceeded the viewport cap ${MAX_SETTLED_CODE_MIRROR_EDITORS}.`,
    );
  }

  if ((stats.codeBlocks ?? 0) > 1 && counts.codeMirrorEditors >= stats.codeBlocks) {
    throw new Error("Every code block activated CodeMirror; viewport activation is not bounded.");
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
  if (normalized !== "none" && normalized !== "default") {
    throw new TypeError(
      'snapshotMode must be "none" or "default".',
    );
  }
  return normalized;
}

function recordSnapshot(mountRecord, markdown, context) {
  const snapshot = Object.freeze({
    at: performance.now(),
    characters: markdown.length,
    markdown,
    origin: context.origin,
  });
  mountRecord.snapshots.push(snapshot);
  mountRecord.changedSinceSnapshot = false;
  pendingKeystroke?.observeSnapshot?.(mountRecord, snapshot);
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
  const hotPathProbe = input.hotPathProbe ?? false;
  if (typeof hotPathProbe !== "boolean") {
    throw new TypeError("hotPathProbe must be boolean when provided.");
  }
  editorHost.replaceChildren();

  let mountRecord;

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
    ...(hotPathProbe ? { extensions: [hotPathProbeExtension] } : {}),
    ...(snapshotMode === "none" ? {} : {
      onChange(markdown, context) {
        // Keep host work constant-time inside the measured callback. Snapshot
        // parsing, UTF-8 sizing, and semantic verification happen after all
        // latency boundaries have been captured.
        recordSnapshot(mountRecord, markdown, context);
      },
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
  mountRecord = {
    changedSinceSnapshot: false,
    editor,
    fixtureId: fixture.id,
    hotPathKeydowns: [],
    hotPathProbe,
    mountStartedAt: startedAt,
    snapshotMode,
    snapshots: [],
  };
  activeMount = mountRecord;

  return {
    dom: assertDomState("mounted"),
    fixture: snapshotFixture(fixture),
    hotPathProbe,
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
  const activationDeadline = performance.now() + CODE_BLOCK_ACTIVATION_TIMEOUT_MS;

  while (editorHost.querySelector(`[${CODE_BLOCK_STATE_ATTRIBUTE}="loading"]`)) {
    if (performance.now() >= activationDeadline) {
      throw new Error(
        `Code-block activation did not settle within ${CODE_BLOCK_ACTIVATION_TIMEOUT_MS} ms.`,
      );
    }
    await nextFrame();
    await nextTask();
  }
  return readDomCounts();
}

function codeBlockProbeIndexes(count) {
  return [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
}

async function waitForCodeBlockActivation(shell, index) {
  const deadline = performance.now() + CODE_BLOCK_ACTIVATION_TIMEOUT_MS;

  while (performance.now() < deadline) {
    await settlePage();
    const state = shell.getAttribute(CODE_BLOCK_STATE_ATTRIBUTE);

    if (state === "active") {
      const dom = assertDomState("mounted");

      if (!shell.querySelector(".cm-editor")) {
        throw new Error(`Activated code block ${index} did not contain a CodeMirror editor.`);
      }

      return dom;
    }

    if (state === "error") {
      throw new Error(`Code block ${index} entered the activation error state.`);
    }

    await nextFrame();
  }

  throw new Error(
    `Code block ${index} did not activate within ${CODE_BLOCK_ACTIVATION_TIMEOUT_MS} ms.`,
  );
}

async function pressureCodeBlockCapacity(shells) {
  if (!activeMount) {
    throw new Error("Mount an editor before applying code-block capacity pressure.");
  }

  if (shells.length < CODE_BLOCK_CAPACITY_PRESSURE_SHELLS) {
    throw new Error(
      `Code-block capacity pressure requires ${CODE_BLOCK_CAPACITY_PRESSURE_SHELLS} shells, received ${shells.length}.`,
    );
  }

  const pressureShells = shells.slice(0, CODE_BLOCK_CAPACITY_PRESSURE_SHELLS);

  let resetPosition = null;
  activeMount.editor.view.state.doc.descendants((node, position) => {
    if (resetPosition !== null) {
      return false;
    }
    if (node.isTextblock && node.type.name !== "code_block") {
      resetPosition = position + 1;
      return false;
    }
    return true;
  });

  if (resetPosition === null) {
    throw new Error("Code-block capacity pressure requires a non-code text position for focus reset.");
  }

  activeMount.editor.focus({ anchor: resetPosition });
  activeMount.editor.blur();
  window.scrollTo(0, 0);

  if (activeMount.editor.view.dom.contains(document.activeElement)) {
    throw new Error("Code-block capacity pressure could not clear composite editor focus.");
  }

  // Start from a provably cold pool. Prior first/middle/last visits may have
  // left live editors behind, so counting only the final global total could
  // otherwise pass without putting nine fresh shells under pressure.
  shells.forEach((shell, index) => {
    Object.assign(shell.style, {
      height: "1px",
      left: `${-100_000 - index}px`,
      margin: "0",
      pointerEvents: "none",
      position: "fixed",
      top: "-100000px",
      width: "1px",
      zIndex: "-1",
    });
  });

  const coldDeadline = performance.now() + CODE_BLOCK_ACTIVATION_TIMEOUT_MS;
  let coldDom = readDomCounts();

  while (performance.now() < coldDeadline) {
    await settlePage();
    coldDom = readDomCounts();

    if (coldDom.codeBlockErrors !== 0) {
      throw new Error(
        `Code-block capacity reset encountered ${coldDom.codeBlockErrors} activation errors.`,
      );
    }

    if (
      coldDom.activeCodeBlocks === 0
      && coldDom.codeBlocksLoading === 0
      && coldDom.codeMirrorEditors === 0
    ) {
      break;
    }

    await nextFrame();
  }

  const coldStates = shells.map((shell) => shell.getAttribute(CODE_BLOCK_STATE_ATTRIBUTE));
  if (
    coldDom.activeCodeBlocks !== 0
    || coldDom.codeBlocksLoading !== 0
    || coldDom.codeMirrorEditors !== 0
    || coldStates.some((state) => state !== "inactive")
  ) {
    throw new Error(
      `Code-block capacity reset did not reach a cold pool: ${JSON.stringify({ dom: coldDom, states: coldStates })}.`,
    );
  }

  // Put nine real shells inside the viewport at once. This benchmark-only
  // layout pressure makes the observer request one editor beyond the pool
  // limit and leaves the settled eight-editor worst case mounted for the CDP
  // memory snapshot. The editor and all inline styles are discarded at the
  // end of the isolated lifecycle.
  pressureShells.forEach((shell, index) => {
    Object.assign(shell.style, {
      height: "1px",
      left: `${index}px`,
      margin: "0",
      pointerEvents: "none",
      position: "fixed",
      top: `${index}px`,
      width: "1px",
      zIndex: "-1",
    });
  });

  const deadline = performance.now() + CODE_BLOCK_ACTIVATION_TIMEOUT_MS;
  let dom = readDomCounts();
  let pressureStates = pressureShells.map((shell) => (
    shell.getAttribute(CODE_BLOCK_STATE_ATTRIBUTE)
  ));

  while (performance.now() < deadline) {
    await settlePage();
    dom = readDomCounts();
    pressureStates = pressureShells.map((shell) => (
      shell.getAttribute(CODE_BLOCK_STATE_ATTRIBUTE)
    ));
    const activePressureShells = pressureStates.filter((state) => state === "active").length;
    const inactivePressureShells = pressureStates.filter((state) => state === "inactive").length;

    if (dom.codeBlockErrors !== 0) {
      throw new Error(
        `Code-block capacity pressure encountered ${dom.codeBlockErrors} activation errors.`,
      );
    }

    if (
      dom.activeCodeBlocks === MAX_SETTLED_CODE_MIRROR_EDITORS
      && dom.codeBlocksLoading === 0
      && dom.codeMirrorEditors === MAX_SETTLED_CODE_MIRROR_EDITORS
      && activePressureShells === MAX_SETTLED_CODE_MIRROR_EDITORS
      && inactivePressureShells === 1
    ) {
      break;
    }

    await nextFrame();
  }

  dom = assertDomState("mounted");
  pressureStates = pressureShells.map((shell) => shell.getAttribute(CODE_BLOCK_STATE_ATTRIBUTE));
  const activePressureShells = pressureStates.filter((state) => state === "active").length;
  const inactivePressureShells = pressureStates.filter((state) => state === "inactive").length;

  if (
    dom.activeCodeBlocks !== MAX_SETTLED_CODE_MIRROR_EDITORS
    || dom.codeBlocksLoading !== 0
    || dom.codeMirrorEditors !== MAX_SETTLED_CODE_MIRROR_EDITORS
    || activePressureShells !== MAX_SETTLED_CODE_MIRROR_EDITORS
    || inactivePressureShells !== 1
  ) {
    throw new Error(
      `Code-block capacity pressure did not settle at an exact eight-plus-one split: ${JSON.stringify({ dom, states: pressureStates })}.`,
    );
  }

  return Object.freeze({
    activeEditors: dom.codeMirrorEditors,
    activePressureShells,
    inactivePressureShells,
    pressureShells: pressureShells.length,
    states: Object.freeze(pressureStates),
  });
}

function codeBlockSelectionPositions(editor) {
  const positions = [];
  editor.view.state.doc.descendants((node, position) => {
    if (node.type.name === "code_block") {
      positions.push(position + 1);
    }
  });
  return positions;
}

async function probeCodeBlockActivation() {
  if (!activeMount) {
    throw new Error("Mount an editor before probing code-block activation.");
  }

  await settlePage();
  const shells = [...editorHost.querySelectorAll(".mdw-code-block")];
  const selectionPositions = codeBlockSelectionPositions(activeMount.editor);
  const expectedCodeBlocks = requireFixture(activeMount.fixtureId).stats.codeBlocks;

  if (
    typeof expectedCodeBlocks !== "number"
    || shells.length !== expectedCodeBlocks
    || selectionPositions.length !== expectedCodeBlocks
  ) {
    throw new Error(
      `Code-block activation probe found ${shells.length} shells and ${selectionPositions.length} model positions for fixture count ${expectedCodeBlocks}.`,
    );
  }

  const visits = [];
  let peakCodeMirrorEditors = readDomCounts().codeMirrorEditors;

  for (const index of codeBlockProbeIndexes(shells.length)) {
    const shell = shells[index];
    shell.scrollIntoView({ block: "center", inline: "nearest" });
    await settlePage();
    const viewportDom = assertDomState("mounted");
    const viewportState = shell.getAttribute(CODE_BLOCK_STATE_ATTRIBUTE);
    peakCodeMirrorEditors = Math.max(peakCodeMirrorEditors, viewportDom.codeMirrorEditors);
    activeMount.editor.focus({ anchor: selectionPositions[index] });
    const dom = await waitForCodeBlockActivation(shell, index);
    peakCodeMirrorEditors = Math.max(peakCodeMirrorEditors, dom.codeMirrorEditors);
    visits.push(Object.freeze({
      activeCodeBlocks: dom.activeCodeBlocks,
      codeMirrorEditors: dom.codeMirrorEditors,
      index,
      state: shell.getAttribute(CODE_BLOCK_STATE_ATTRIBUTE),
      viewportCodeMirrorEditors: viewportDom.codeMirrorEditors,
      viewportState,
    }));
  }

  const capacityPressure = await pressureCodeBlockCapacity(shells);
  peakCodeMirrorEditors = Math.max(
    peakCodeMirrorEditors,
    capacityPressure.activeEditors,
  );

  const finalDom = assertDomState("mounted");

  if (finalDom.codeMirrorEditors === 0) {
    throw new Error("Code-block activation probe completed without a live CodeMirror editor.");
  }

  return Object.freeze({
    capacityPressure,
    finalDom,
    maxSettledEditors: MAX_SETTLED_CODE_MIRROR_EDITORS,
    peakCodeMirrorEditors,
    probe: CODE_BLOCK_VIEWPORT_PROBE,
    strategy: CODE_BLOCK_ACTIVATION_STRATEGY,
    visits: Object.freeze(visits),
  });
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
    hotPathProbe: activeMount.hotPathProbe,
    model: readModelSnapshot(activeMount.editor),
    snapshotCount: activeMount.snapshots.length,
    snapshotMode: activeMount.snapshotMode,
  };
}

function hotPathTelemetry() {
  if (!activeMount?.hotPathProbe) {
    throw new Error("Mount the hot-path probe before reading its telemetry.");
  }
  return {
    keydowns: activeMount.hotPathKeydowns.map((entry) => ({ ...entry })),
    snapshotCount: activeMount.snapshots.length,
  };
}

function captureSnapshotVerification() {
  if (!activeMount) {
    throw new Error("Mount an editor before capturing snapshot verification state.");
  }
  if (pendingKeystroke) {
    throw new Error("Await the pending keystroke before capturing snapshot verification state.");
  }
  if (capturedSnapshotVerification) {
    throw new Error("Verify or release the previous captured snapshot first.");
  }
  if (activeMount.snapshots.length === 0) {
    throw new Error("No emitted Markdown snapshot is available for verification.");
  }

  const snapshot = activeMount.snapshots.at(-1);
  const cachedMarkdown = activeMount.editor.getMarkdown();
  capturedSnapshotVerification = {
    expectedDocumentJson: JSON.stringify(activeMount.editor.view.state.doc.toJSON()),
    markdown: snapshot.markdown,
  };
  return {
    cachedMatchesEmitted: cachedMarkdown === snapshot.markdown,
    characters: snapshot.characters,
    origin: snapshot.origin,
    snapshotCount: activeMount.snapshots.length,
    utf8Bytes: textEncoder.encode(snapshot.markdown).byteLength,
  };
}

function verifyCapturedSnapshot() {
  if (activeMount) {
    throw new Error("Destroy the measured editor before verifying its captured snapshot.");
  }
  if (!capturedSnapshotVerification) {
    throw new Error("Capture an emitted Markdown snapshot before verifying it.");
  }

  prepareCodec();
  const captured = capturedSnapshotVerification;
  capturedSnapshotVerification = null;
  const parsed = codecRuntime.codec.parse(captured.markdown);

  if (!parsed) {
    throw new Error("The public codec could not parse the emitted Markdown snapshot.");
  }

  const canonicalMarkdown = codecRuntime.codec.serialize(parsed);
  const parsedDocumentJson = JSON.stringify(parsed.toJSON());
  const canonicalDifferenceIndex = (() => {
    const limit = Math.min(canonicalMarkdown.length, captured.markdown.length);
    for (let index = 0; index < limit; index += 1) {
      if (canonicalMarkdown[index] !== captured.markdown[index]) {
        return index;
      }
    }
    return canonicalMarkdown.length === captured.markdown.length ? -1 : limit;
  })();
  return {
    canonicalMatchesEmitted: canonicalMarkdown === captured.markdown,
    canonicalDifferenceIndex,
    canonicalLength: canonicalMarkdown.length,
    emittedLength: captured.markdown.length,
    expectedDocumentJsonLength: captured.expectedDocumentJson.length,
    parsedDocumentJsonLength: parsedDocumentJson.length,
    parsedDocumentMatchesEditor:
      parsedDocumentJson === captured.expectedDocumentJson,
  };
}

function disableSnapshots() {
  if (!activeMount) {
    throw new Error("Mount an editor before disabling snapshots.");
  }
  if (pendingKeystroke) {
    throw new Error("Await the pending keystroke before disabling snapshots.");
  }
  // updateOptions flushes any pending snapshot through the previous callback
  // before removing it. The current document therefore
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
  const mountRecord = activeMount;
  const snapshotStartIndex = mountRecord.snapshots.length;
  const requiresSnapshot = mountRecord.snapshotMode !== "none";
  const entryStartIndex = eventTimingEntries.length;
  const record = {
    armedAt: performance.now(),
    bubbledAt: null,
    capturedAt: null,
    code: null,
    event: null,
    eventStart: null,
    eventTimingReady: false,
    isTrusted: null,
    key: null,
    microtaskAfterBubbleAt: null,
    presentationAt: null,
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

  const observedSnapshots = () => mountRecord.snapshots.slice(snapshotStartIndex);

  const cleanupAndResolve = (error = null) => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(timeoutId);
    document.removeEventListener("keydown", handleKeydownCapture, true);
    document.removeEventListener("keydown", handleKeydownBubble);
    unsubscribe();

    drainEventTimingObserver();
    const eventTiming = record.eventStart === null
      ? null
      : summarizeEventTiming(entryStartIndex, record.eventStart);
    const keydownToPresentationProxyMs = record.eventStart === null
      ? null
      : record.presentationAt - record.eventStart;
    const updateCount = record.updateTimes.length;
    const snapshots = observedSnapshots();
    const snapshot = snapshots[0] ?? null;
    const snapshotDelayedAfterKeydown = snapshot && record.microtaskAfterBubbleAt !== null
      ? snapshot.at >= record.microtaskAfterBubbleAt
      : null;
    const invariantError = error
      ?? (record.isTrusted !== true ? "The measured keydown was not trusted." : null)
      ?? (record.bubbledAt === null ? "The measured keydown did not reach the document bubble boundary." : null)
      ?? (updateCount !== 1 ? `Expected one document update, observed ${updateCount}.` : null)
      ?? (record.updateOrigins[0] !== "user" ? `Expected user update origin, observed ${record.updateOrigins[0] ?? "none"}.` : null)
      ?? (
        requiresSnapshot && snapshots.length !== 1
          ? `Expected one Markdown snapshot, observed ${snapshots.length}.`
          : null
      )
      ?? (
        mountRecord.snapshotMode === "default" && snapshot?.origin !== "user"
          ? `Expected a user-origin default snapshot, observed ${snapshot?.origin ?? "none"}.`
          : null
      )
      ?? (
        mountRecord.snapshotMode === "default" && snapshotDelayedAfterKeydown !== true
          ? "The shipped-default snapshot ran before the keydown returned."
          : null
      )
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
      snapshot: snapshot ? {
        beforeDocumentBubble: snapshot.at < record.bubbledAt,
        beforePresentation: snapshot.at < record.presentationAt,
        characters: snapshot.characters,
        count: snapshots.length,
        delayedAfterKeydown: snapshotDelayedAfterKeydown,
        latencyMs: snapshot.at - record.eventStart,
        origin: snapshot.origin,
      } : null,
      synchronousProcessingMs: record.bubbledAt === null || record.capturedAt === null
        ? null
        : record.bubbledAt - record.capturedAt,
      trusted: record.isTrusted,
      updateCount,
      updateOrigin: record.updateOrigins[0] ?? null,
      updateToPresentationProxyMs: updateCount === 1
        ? record.presentationAt - record.updateTimes[0]
        : null,
    });
  };

  const maybeResolve = () => {
    if (
      finished
      || !record.eventTimingReady
      || record.bubbledAt === null
      || record.microtaskAfterBubbleAt === null
      || record.presentationAt === null
      || (requiresSnapshot && observedSnapshots().length === 0)
    ) {
      return;
    }

    cleanupAndResolve();
  };

  const observeSnapshot = (observedMount) => {
    if (observedMount === mountRecord) {
      maybeResolve();
    }
  };

  const handleKeydownCapture = (event) => {
    if (record.eventStart !== null || !event.composedPath().includes(activeMount.editor.view.dom)) {
      return;
    }
    record.capturedAt = performance.now();
    record.code = event.code;
    record.event = event;
    record.eventStart = eventTimestamp(event);
    record.isTrusted = event.isTrusted;
    record.key = event.key;

    if (!event.isTrusted) {
      cleanupAndResolve("The measured keydown was not trusted.");
      return;
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        record.presentationAt = performance.now();
        // Event Timing is delivered after the presentation boundary. Keep that
        // observer delay outside the measured proxy while allowing Chromium to
        // distinguish a reported event from a threshold-censored one.
        setTimeout(() => {
          record.eventTimingReady = true;
          maybeResolve();
        }, EVENT_TIMING_DELIVERY_WAIT_MS);
      }, 0);
    });
  };

  const handleKeydownBubble = (event) => {
    if (event !== record.event || record.bubbledAt !== null) {
      return;
    }

    record.bubbledAt = performance.now();
    queueMicrotask(() => {
      record.microtaskAfterBubbleAt = performance.now();
      maybeResolve();
    });
  };

  document.addEventListener("keydown", handleKeydownCapture, true);
  document.addEventListener("keydown", handleKeydownBubble);
  const timeoutId = setTimeout(() => {
    cleanupAndResolve("Timed out waiting for a trusted editor keystroke.");
  }, timeoutMs);
  pendingKeystroke = { id, observeSnapshot, promise };

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
  const mountRecord = activeMount;
  const priming = mode === "clean" ? primeClean() : primeDirty();
  await settlePage();
  const beforeDom = assertDomState("mounted");
  const snapshotCountBeforeDestroy = mountRecord.snapshots.length;
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
  const snapshotCountAfterDestroy = mountRecord.snapshots.length;

  activeMount = null;
  editor = null;
  editorHost.replaceChildren();
  const afterSettleDom = await settlePage();
  const snapshotCountAfterSettle = mountRecord.snapshots.length;
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
    snapshotCounts: {
      afterDestroy: snapshotCountAfterDestroy,
      afterSettle: snapshotCountAfterSettle,
      beforeDestroy: snapshotCountBeforeDestroy,
    },
    syncDurationMs: assertFiniteDuration(completedAt - startedAt, "Destroy duration"),
  };
}

const schema = deepFreeze({
  codeBlockActivation: {
    capacityPressureShells: CODE_BLOCK_CAPACITY_PRESSURE_SHELLS,
    maxSettledEditors: MAX_SETTLED_CODE_MIRROR_EDITORS,
    probe: CODE_BLOCK_VIEWPORT_PROBE,
    stateAttribute: CODE_BLOCK_STATE_ATTRIBUTE,
    strategy: CODE_BLOCK_ACTIVATION_STRATEGY,
  },
  durationUnit: "milliseconds",
  fixtureInput: {
    id: "string",
    markdown: "string",
    stats: "JSON object",
  },
  hotPathTelemetry: {
    key: "F8",
    records: ["eventStart", "observedAt", "trusted", "snapshotCountBeforeDispatch"],
  },
  keystroke: {
    eventTimingDeliveryWaitMs: EVENT_TIMING_DELIVERY_WAIT_MS,
    eventTimingThresholdMs: EVENT_TIMING_THRESHOLD_MS,
    sequence: ["focusTypingTarget", "settle", "armKeystroke", "trusted Playwright key", "awaitKeystroke"],
  },
  mountInput: {
    fixtureId: "string",
    hotPathProbe: "boolean",
    snapshotMode: ["none", "default"],
  },
  name: "markora-packed-performance-consumer",
  teardownModes: ["clean", "dirty"],
  version: API_VERSION,
});

const api = Object.freeze({
  armKeystroke,
  assertDomState,
  awaitKeystroke,
  captureSnapshotVerification,
  clearFixtures,
  codecSnapshot,
  destroy,
  disableSnapshots,
  editorSnapshot,
  fixtureSnapshot,
  focusTypingTarget,
  hotPathTelemetry,
  installFixture,
  mount,
  mountAndSettle,
  parseFixture,
  prepareCodec,
  primeClean,
  primeDirty,
  probeCodeBlockActivation,
  ready: true,
  releaseCodec,
  releaseParsed,
  removeFixture,
  schema,
  serializeParsed,
  settle,
  verifyCapturedSnapshot,
  version: API_VERSION,
});

Object.defineProperty(window, "__MARKORA_PERFORMANCE__", {
  configurable: false,
  enumerable: false,
  value: api,
  writable: false,
});
document.body.dataset.markoraPerformanceReady = "true";
