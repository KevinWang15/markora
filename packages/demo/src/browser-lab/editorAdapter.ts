import {
  createEditor,
  type MarkdownEditor,
  type MarkdownEditorEventName,
  type OpaqueMarkdownEditRequest,
} from "markora";
import {
  defaultAlertsMessages,
  type AlertsExtension,
  type AlertsMessageOverrides,
  type AlertsMessages,
} from "markora-extension-alerts";
import "markora-extension-alerts/styles.css";
import {
  defaultDiagramMessages,
  type DiagramEditRequest,
  type DiagramKind,
  type DiagramMessageOverrides,
  type DiagramMessages,
  type DiagramRenderer,
  type DiagramRenderRequest,
  type DiagramsExtension,
} from "markora-extension-diagrams";
import "markora-extension-diagrams/styles.css";
import { type FootnotesExtension } from "markora-extension-footnotes";
import "markora-extension-footnotes/styles.css";
import {
  type FrontmatterEditRequest,
  type FrontmatterExtension,
} from "markora-extension-frontmatter";
import "markora-extension-frontmatter/styles.css";
import {
  defaultHtmlMessages,
  type HtmlEditRequest,
  type HtmlExtension,
  type HtmlMessageOverrides,
  type HtmlMessages,
  type HtmlRenderRequest,
} from "markora-extension-html";
import "markora-extension-html/styles.css";
import {
  defaultMathMessages,
  type MathEditRequest,
  type MathExtension,
  type MathKind,
  type MathMessageOverrides,
  type MathMessages,
  type MathRenderRequest,
} from "markora-extension-math";
import "markora-extension-math/styles.css";
import {
  defaultTocMessages,
  type TocExtension,
  type TocMessageOverrides,
  type TocMessages,
} from "markora-extension-toc";
import "markora-extension-toc/styles.css";
import { publicCalloutExtension } from "../extensions/publicExampleExtensions";
import type {
  BrowserLabActiveRequest,
  BrowserLabAlertsCommandRequest,
  BrowserLabAlertsMessages,
  BrowserLabAlertsStateRequest,
  BrowserLabCommandRequest,
  BrowserLabDiagramCommandRequest,
  BrowserLabDiagramMessages,
  BrowserLabDiagramRendererMode,
  BrowserLabEditorSpec,
  BrowserLabEventRecord,
  BrowserLabExtensionSnapshot,
  BrowserLabHtmlCommandRequest,
  BrowserLabHtmlMessages,
  BrowserLabHtmlRendererMode,
  BrowserLabMathCommandRequest,
  BrowserLabMathMessages,
  BrowserLabMathRendererMode,
  BrowserLabResourceLog,
  BrowserLabSnapshot,
  BrowserLabTocCommandRequest,
  BrowserLabTocMessages,
  BrowserLabTocStateRequest,
} from "./protocol";

const BROWSER_LAB_DIAGRAM_KINDS = [
  "mermaid",
  "plantuml",
  "geojson",
  "topojson",
  "stl",
] as const;
export type MountedEditor = {
  localRenderers?: import("markora-renderers").MarkoraRenderers;
  activationObserver: MutationObserver;
  alertsExtension: AlertsExtension | null;
  changeCount: number;
  controlledEcho: boolean;
  diagramEditRequest: DiagramEditRequest | null;
  diagramExtension: DiagramsExtension | null;
  diagramRendererArtifacts: Set<Node>;
  diagramRendererCalls: Array<{
    aborted: boolean;
    id: number;
    info: string;
    kind: DiagramKind;
    settled: "pending" | "rejected" | "resolved" | "threw";
    source: string;
  }>;
  diagramRendererDeferred: Map<
    number,
    {
      reject(reason: unknown): void;
      request: DiagramRenderRequest;
      resolve(value: Node | DocumentFragment): void;
    }
  >;
  editor: MarkdownEditor;
  entry: "minimal" | "root";
  eventCounts: Record<MarkdownEditorEventName, number>;
  eventLog: BrowserLabEventRecord[];
  eventUnsubscribes: Map<MarkdownEditorEventName, () => void>;
  extensionActions?: HTMLElement;
  extensionMode?:
    | "alerts"
    | "all-advanced"
    | "diagrams"
    | "footnotes"
    | "frontmatter"
    | "html"
    | "math"
    | "public-example"
    | "toc";
  footnotesExtension: FootnotesExtension | null;
  frontmatterEditRequest: FrontmatterEditRequest | null;
  frontmatterExtension: FrontmatterExtension | null;
  htmlEditRequest: HtmlEditRequest | null;
  htmlExtension: HtmlExtension | null;
  htmlRendererArtifacts: Set<Node>;
  htmlRendererCalls: Array<{
    aborted: boolean;
    id: number;
    kind: HtmlRenderRequest["kind"];
    settled: "pending" | "rejected" | "resolved" | "threw";
    source: string;
  }>;
  htmlRendererDeferred: Map<
    number,
    {
      reject(reason: unknown): void;
      request: HtmlRenderRequest;
      resolve(value: Node | DocumentFragment): void;
    }
  >;
  explicitPortalRoot?: HTMLElement | ShadowRoot;
  host: HTMLElement;
  id: string;
  mathEditRequest: MathEditRequest | null;
  mathExtension: MathExtension | null;
  mathRendererArtifacts: Set<Node>;
  mathRendererCalls: Array<{
    aborted: boolean;
    id: number;
    kind: MathKind;
    settled: "pending" | "rejected" | "resolved" | "threw";
    source: string;
  }>;
  mathRendererDeferred: Map<
    number,
    {
      reject(reason: unknown): void;
      request: MathRenderRequest;
      resolve(value: Node | DocumentFragment): void;
    }
  >;
  output: HTMLOutputElement;
  opaqueEditRequest: OpaqueMarkdownEditRequest | null;
  portalRoot: HTMLElement | ShadowRoot;
  root: Document | ShadowRoot;
  resourceLog: BrowserLabResourceLog;
  section: HTMLElement;
  tocExtension: TocExtension | null;
  transactionCount: number;
};

export const OVERLAY_SELECTOR =
  ".mdw-link-editor, .mdw-image-editor, .mdw-code-language-editor, .mdw-table-size-editor, .mdw-table-toolbar, .mdw-table-edge-controls";
export const EVENT_NAMES: MarkdownEditorEventName[] = [
  "focus",
  "blur",
  "selection",
  "state",
  "update",
  "error",
  "asset",
];

export function createEventCounts(): Record<MarkdownEditorEventName, number> {
  return {
    asset: 0,
    blur: 0,
    error: 0,
    focus: 0,
    selection: 0,
    state: 0,
    update: 0,
  };
}

export function createResourceLog(): BrowserLabResourceLog {
  return { loads: [], opens: [], resolutions: [], uploads: [] };
}

export function createBrowserLabResources(
  mounted: MountedEditor,
  mode: BrowserLabEditorSpec["resourceMode"],
) {
  if (!mode) {
    return undefined;
  }

  if (mode === "immediate-upload") {
    return {
      assets: {
        allowedMimeTypes: ["*/*"],
        upload({
          file,
          reportProgress,
          source,
        }: Parameters<
          NonNullable<
            NonNullable<
              Parameters<typeof createEditor>[0]["resources"]
            >["assets"]
          >["upload"]
        >[0]) {
          mounted.resourceLog.uploads.push({ fileName: file.name, source });
          reportProgress(0.5);
          return Promise.resolve({
            kind: "link" as const,
            label: file.name,
            url: `/uploads/${encodeURIComponent(file.name)}`,
          });
        },
      },
    };
  }

  return {
    ...(mode === "custom-protocol"
      ? {
          images: { allowedProtocols: ["asset:"] },
          links: { allowedProtocols: ["acme:"] },
        }
      : {}),
    images:
      mode === "custom-protocol"
        ? { allowedProtocols: ["asset:"] }
        : { referrerPolicy: "no-referrer" as const },
    links:
      mode === "custom-protocol" ? { allowedProtocols: ["acme:"] } : undefined,
    loadImage:
      mode === "proxy-images"
        ? ({ storedUrl, url }: { storedUrl: string; url: string }) => {
            mounted.resourceLog.loads.push({ storedUrl, url });
            return { src: url };
          }
        : undefined,
    openUrl({
      kind,
      storedUrl,
      url,
    }: {
      kind: "image" | "link";
      storedUrl: string;
      url: string;
    }) {
      mounted.resourceLog.opens.push({ kind, storedUrl, url });
    },
    resolveUrl({
      kind,
      purpose,
      url,
    }: {
      kind: "image" | "link";
      purpose: "load" | "open";
      url: string;
    }) {
      mounted.resourceLog.resolutions.push({ kind, purpose, url });
      if (mode === "deny-images" && kind === "image") {
        return null;
      }
      if (mode === "proxy-images" && kind === "image" && purpose === "load") {
        return "/__markora_resource_proxy.png";
      }
      return url;
    },
  };
}

export function clearEventTracking(mounted: MountedEditor) {
  mounted.eventCounts = createEventCounts();
  mounted.eventLog.length = 0;
}

export function recordEvent(
  mounted: MountedEditor,
  event: BrowserLabEventRecord,
) {
  mounted.eventCounts[event.type] += 1;
  mounted.eventLog.push(event);
}

export function runBrowserLabCommand(
  editor: MarkdownEditor,
  request: BrowserLabCommandRequest,
) {
  switch (request.type) {
    case "addTableColumn":
      return editor.commands.addTableColumn(request.side);
    case "addTableRow":
      return editor.commands.addTableRow(request.side);
    case "deleteTable":
      return editor.commands.deleteTable();
    case "deleteTableColumn":
      return editor.commands.deleteTableColumn();
    case "deleteTableRow":
      return editor.commands.deleteTableRow();
    case "insertHardBreak":
      return editor.commands.insertHardBreak();
    case "insertHorizontalRule":
      return editor.commands.insertHorizontalRule();
    case "insertImage":
      return editor.commands.insertImage(request.attrs);
    case "insertTable":
      return editor.commands.insertTable(request.options);
    case "liftListItem":
      return editor.commands.liftListItem();
    case "moveTableColumn":
      return editor.commands.moveTableColumn(request.direction);
    case "moveTableRow":
      return editor.commands.moveTableRow(request.direction);
    case "pasteMarkdown":
      return editor.commands.pasteMarkdown(request.text);
    case "pastePlainText":
      return editor.commands.pastePlainText(request.text);
    case "redo":
      return editor.commands.redo();
    case "removeImage":
      return editor.commands.removeImage();
    case "removeLink":
      return editor.commands.removeLink();
    case "resizeTable":
      return editor.commands.resizeTable(request.options);
    case "setCodeBlock":
      return editor.commands.setCodeBlock(request.options);
    case "setHeading":
      return editor.commands.setHeading(request.level);
    case "setLink":
      return editor.commands.setLink(request.href);
    case "setParagraph":
      return editor.commands.setParagraph();
    case "setTableColumnAlignment":
      return editor.commands.setTableColumnAlignment(request.alignment);
    case "setTaskChecked":
      return editor.commands.setTaskChecked(request.checked);
    case "sinkListItem":
      return editor.commands.sinkListItem();
    case "toggleBlockquote":
      return editor.commands.toggleBlockquote();
    case "toggleBulletList":
      return editor.commands.toggleBulletList();
    case "toggleMark":
      return editor.commands.toggleMark(request.mark);
    case "toggleOrderedList":
      return editor.commands.toggleOrderedList();
    case "toggleTaskList":
      return editor.commands.toggleTaskList();
    case "undo":
      return editor.commands.undo();
  }
}

export function canRunBrowserLabCommand(
  editor: MarkdownEditor,
  request: BrowserLabCommandRequest,
) {
  switch (request.type) {
    case "addTableColumn":
      return editor.state.can.addTableColumn(request.side);
    case "addTableRow":
      return editor.state.can.addTableRow(request.side);
    case "deleteTable":
      return editor.state.can.deleteTable();
    case "deleteTableColumn":
      return editor.state.can.deleteTableColumn();
    case "deleteTableRow":
      return editor.state.can.deleteTableRow();
    case "insertHardBreak":
      return editor.state.can.insertHardBreak();
    case "insertHorizontalRule":
      return editor.state.can.insertHorizontalRule();
    case "insertImage":
      return editor.state.can.insertImage();
    case "insertTable":
      return editor.state.can.insertTable(request.options);
    case "liftListItem":
      return editor.state.can.liftListItem();
    case "moveTableColumn":
      return editor.state.can.moveTableColumn(request.direction);
    case "moveTableRow":
      return editor.state.can.moveTableRow(request.direction);
    case "pasteMarkdown":
      return editor.state.can.pasteMarkdown();
    case "pastePlainText":
      return editor.state.can.pastePlainText();
    case "redo":
      return editor.state.can.redo();
    case "removeImage":
      return editor.state.can.removeImage();
    case "removeLink":
      return editor.state.can.removeLink();
    case "resizeTable":
      return editor.state.can.resizeTable(request.options);
    case "setCodeBlock":
      return editor.state.can.setCodeBlock(request.options);
    case "setHeading":
      return editor.state.can.setHeading(request.level);
    case "setLink":
      return editor.state.can.setLink();
    case "setParagraph":
      return editor.state.can.setParagraph();
    case "setTableColumnAlignment":
      return editor.state.can.setTableColumnAlignment(request.alignment);
    case "setTaskChecked":
      return editor.state.can.setTaskChecked(request.checked);
    case "sinkListItem":
      return editor.state.can.sinkListItem();
    case "toggleBlockquote":
      return editor.state.can.toggleBlockquote();
    case "toggleBulletList":
      return editor.state.can.toggleBulletList();
    case "toggleMark":
      return editor.state.can.toggleMark(request.mark);
    case "toggleOrderedList":
      return editor.state.can.toggleOrderedList();
    case "toggleTaskList":
      return editor.state.can.toggleTaskList();
    case "undo":
      return editor.state.can.undo();
  }
}

export function readBrowserLabActiveState(
  editor: MarkdownEditor,
  request: BrowserLabActiveRequest,
) {
  switch (request.type) {
    case "blockquote":
      return editor.state.isActive.blockquote();
    case "bulletList":
      return editor.state.isActive.bulletList();
    case "codeBlock":
      return editor.state.isActive.codeBlock(request.options);
    case "hardBreak":
      return editor.state.isActive.hardBreak();
    case "heading":
      return editor.state.isActive.heading(request.level);
    case "horizontalRule":
      return editor.state.isActive.horizontalRule();
    case "orderedList":
      return editor.state.isActive.orderedList();
    case "paragraph":
      return editor.state.isActive.paragraph();
    case "table":
      return editor.state.isActive.table();
    case "tableCellSelection":
      return editor.state.isActive.tableCellSelection();
    case "tableColumnAlignment":
      return editor.state.isActive.tableColumnAlignment(request.alignment);
    case "taskChecked":
      return editor.state.isActive.taskChecked(request.checked);
    case "taskList":
      return editor.state.isActive.taskList();
  }
}

export function subscribeToEditorEvents(mounted: MountedEditor) {
  for (const unsubscribe of mounted.eventUnsubscribes.values()) {
    unsubscribe();
  }

  mounted.eventUnsubscribes.clear();
  mounted.eventUnsubscribes.set(
    "focus",
    mounted.editor.subscribe("focus", () => {
      recordEvent(mounted, { type: "focus" });
    }),
  );
  mounted.eventUnsubscribes.set(
    "blur",
    mounted.editor.subscribe("blur", () => {
      recordEvent(mounted, { type: "blur" });
    }),
  );
  mounted.eventUnsubscribes.set(
    "selection",
    mounted.editor.subscribe("selection", (event) => {
      recordEvent(mounted, {
        previousSelection: event.previousSelection,
        selection: event.selection,
        type: "selection",
      });
    }),
  );
  mounted.eventUnsubscribes.set(
    "state",
    mounted.editor.subscribe("state", (event) => {
      recordEvent(mounted, {
        docChanged: event.docChanged,
        selection: event.selection,
        selectionChanged: event.selectionChanged,
        type: "state",
      });
    }),
  );
  mounted.eventUnsubscribes.set(
    "update",
    mounted.editor.subscribe("update", (event) => {
      recordEvent(mounted, {
        selection: event.selection,
        type: "update",
      });
    }),
  );
  mounted.eventUnsubscribes.set(
    "error",
    mounted.editor.subscribe("error", (event) => {
      recordEvent(mounted, {
        code: event.code,
        contribution:
          "contribution" in event.context
            ? event.context.contribution
            : undefined,
        extension:
          "extension" in event.context ? event.context.extension : undefined,
        language:
          "language" in event.context ? event.context.language : undefined,
        message:
          event.error instanceof Error
            ? event.error.message
            : String(event.error),
        phase: "phase" in event.context ? event.context.phase : undefined,
        type: "error",
      });
    }),
  );
  mounted.eventUnsubscribes.set(
    "asset",
    mounted.editor.subscribe("asset", (event) => {
      recordEvent(mounted, {
        fileName: event.upload.file.name,
        progress: event.upload.progress,
        reason: event.reason,
        status: event.upload.status,
        type: "asset",
      });
    }),
  );
}

export function requireEditor(editors: Map<string, MountedEditor>, id: string) {
  const mounted = editors.get(id);

  if (!mounted) {
    throw new Error(`Browser lab editor \"${id}\" is not mounted.`);
  }

  return mounted;
}

export function requireAlertsHandle(mounted: MountedEditor) {
  if (!mounted.alertsExtension) {
    throw new Error(
      `Browser lab editor "${mounted.id}" has no alerts extension.`,
    );
  }

  return mounted.editor.extensions.get(mounted.alertsExtension);
}

export function requireDiagramsHandle(mounted: MountedEditor) {
  if (!mounted.diagramExtension) {
    throw new Error(
      `Browser lab editor "${mounted.id}" has no diagrams extension.`,
    );
  }

  return mounted.editor.extensions.get(mounted.diagramExtension);
}

export function requireFrontmatterHandle(mounted: MountedEditor) {
  if (!mounted.frontmatterExtension) {
    throw new Error(
      `Browser lab editor "${mounted.id}" has no front matter extension.`,
    );
  }

  return mounted.editor.extensions.get(mounted.frontmatterExtension);
}

export function requireHtmlHandle(mounted: MountedEditor) {
  if (!mounted.htmlExtension) {
    throw new Error(
      `Browser lab editor "${mounted.id}" has no HTML extension.`,
    );
  }

  return mounted.editor.extensions.get(mounted.htmlExtension);
}

export function requireFootnotesHandle(mounted: MountedEditor) {
  if (!mounted.footnotesExtension) {
    throw new Error(
      `Browser lab editor "${mounted.id}" has no footnotes extension.`,
    );
  }

  return mounted.editor.extensions.get(mounted.footnotesExtension);
}

export function requireMathHandle(mounted: MountedEditor) {
  if (!mounted.mathExtension) {
    throw new Error(
      `Browser lab editor "${mounted.id}" has no math extension.`,
    );
  }

  return mounted.editor.extensions.get(mounted.mathExtension);
}

export function requireTocHandle(mounted: MountedEditor) {
  if (!mounted.tocExtension) {
    throw new Error(`Browser lab editor "${mounted.id}" has no TOC extension.`);
  }

  return mounted.editor.extensions.get(mounted.tocExtension);
}

export function normalizeBrowserLabAlertsMessages(
  overrides: BrowserLabAlertsMessages | undefined,
): AlertsMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(overrides).map(([key, message]) => [
      key,
      typeof defaultAlertsMessages[key as keyof AlertsMessages] === "function"
        ? () => message
        : message,
    ]),
  ) as AlertsMessageOverrides;
}

export function normalizeBrowserLabDiagramMessages(
  overrides: BrowserLabDiagramMessages | undefined,
): DiagramMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(overrides).map(([key, message]) => [
      key,
      typeof defaultDiagramMessages[key as keyof DiagramMessages] === "function"
        ? () => message
        : message,
    ]),
  ) as DiagramMessageOverrides;
}

export function normalizeBrowserLabMathMessages(
  overrides: BrowserLabMathMessages | undefined,
): MathMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(overrides).map(([key, message]) => [
      key,
      typeof defaultMathMessages[key as keyof MathMessages] === "function"
        ? () => message
        : message,
    ]),
  ) as MathMessageOverrides;
}

export function normalizeBrowserLabHtmlMessages(
  overrides: BrowserLabHtmlMessages | undefined,
): HtmlMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(overrides).map(([key, message]) => [
      key,
      typeof defaultHtmlMessages[key as keyof HtmlMessages] === "function"
        ? () => message
        : message,
    ]),
  ) as HtmlMessageOverrides;
}

export function normalizeBrowserLabTocMessages(
  overrides: BrowserLabTocMessages | undefined,
): TocMessageOverrides | undefined {
  if (!overrides) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(overrides).map(([key, message]) => [
      key,
      typeof defaultTocMessages[key as keyof TocMessages] === "function"
        ? () => message
        : message,
    ]),
  ) as TocMessageOverrides;
}

export function createBrowserLabMathOutput(
  request: MathRenderRequest,
  callId: number,
) {
  const output = request.ownerDocument.createElement("span");
  output.className = "browser-lab-math-rendered";
  output.textContent = `Rendered ${request.kind} math ${callId}: ${request.source}`;
  return output;
}

export function createBrowserLabDiagramOutput(
  request: DiagramRenderRequest,
  callId: number,
) {
  const svg = request.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  svg.setAttribute("viewBox", "0 0 640 40");
  const title = request.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "title",
  );
  title.textContent = `Rendered ${request.kind} diagram ${callId}`;
  const text = request.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );
  text.setAttribute("x", "8");
  text.setAttribute("y", "24");
  text.textContent = `${request.info}: ${request.source}`;
  svg.append(title, text);
  return svg;
}

export function clearDiagramRendererArtifacts(mounted: MountedEditor) {
  for (const artifact of mounted.diagramRendererArtifacts) {
    artifact.parentNode?.removeChild(artifact);
  }

  mounted.diagramRendererArtifacts.clear();
}

export function createBrowserLabDiagramRenderer(
  mounted: MountedEditor,
  mode: BrowserLabDiagramRendererMode | undefined,
) {
  if (!mode || mode === "missing") {
    return undefined;
  }

  return (
    request: DiagramRenderRequest,
  ): Node | DocumentFragment | Promise<Node | DocumentFragment> => {
    const call = {
      aborted: request.signal.aborted,
      id: mounted.diagramRendererCalls.length + 1,
      info: request.info,
      kind: request.kind,
      settled: "pending" as "pending" | "rejected" | "resolved" | "threw",
      source: request.source,
    };
    mounted.diagramRendererCalls.push(call);
    request.signal.addEventListener(
      "abort",
      () => {
        call.aborted = true;
      },
      { once: true },
    );

    if (mode === "throw") {
      call.settled = "threw";
      throw new Error(
        `Browser lab ${request.kind} diagram renderer threw for call ${call.id}.`,
      );
    }

    if (mode === "reject") {
      call.settled = "rejected";
      return Promise.reject(
        new Error(
          `Browser lab ${request.kind} diagram renderer rejected call ${call.id}.`,
        ),
      );
    }

    if (mode === "deferred") {
      return new Promise<Node | DocumentFragment>((resolve, reject) => {
        mounted.diagramRendererDeferred.set(call.id, {
          reject,
          request,
          resolve,
        });
      });
    }

    call.settled = "resolved";

    if (mode === "wrong-document") {
      const foreignDocument =
        request.ownerDocument.implementation.createHTMLDocument(
          "Browser lab foreign diagram renderer",
        );
      const output = foreignDocument.createElement("div");
      output.textContent = request.source;
      return output;
    }

    if (mode === "string") {
      return "<svg><text>renderer strings are forbidden</text></svg>" as unknown as Node;
    }

    if (mode === "unsafe") {
      const wrapper = request.ownerDocument.createElement("div");
      const script = request.ownerDocument.createElement("script");
      script.textContent = "window.__markoraUnsafeDiagramRenderer = true";
      const image = request.ownerDocument.createElement("img");
      image.setAttribute(
        "onerror",
        "window.__markoraUnsafeDiagramRenderer = true",
      );
      const frame = request.ownerDocument.createElement("iframe");
      const sourceProbe = request.ownerDocument.createElement("div");
      sourceProbe.setAttribute(
        "src",
        "https://markora-diagrams.invalid/image.png",
      );
      const form = request.ownerDocument.createElement("form");
      form.action = "https://markora-diagrams.invalid/submit";
      form.append(request.ownerDocument.createElement("input"));
      const custom = request.ownerDocument.createElement(
        "markora-diagram-probe",
      );
      const svg = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      svg.setAttribute(
        "onload",
        "window.__markoraUnsafeDiagramRenderer = true",
      );
      const svgImage = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "image",
      );
      const use = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "use",
      );
      use.setAttribute("href", "#missing-local-reference");
      const link = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "a",
      );
      link.setAttribute("href", "https://markora-diagrams.invalid/navigation");
      const foreignObject = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "foreignObject",
      );
      foreignObject.append(request.ownerDocument.createElement("button"));
      const animate = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "animate",
      );
      animate.setAttribute(
        "onbegin",
        "window.__markoraUnsafeDiagramRenderer = true",
      );
      const styled = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      styled.setAttribute(
        "style",
        "fill:url(https://markora-diagrams.invalid/fill.svg#probe)",
      );
      svg.append(svgImage, use, link, foreignObject, animate, styled);
      wrapper.append(script, image, frame, sourceProbe, form, custom, svg);
      return wrapper;
    }

    if (mode === "unsafe-css-var") {
      const svg = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      const rect = request.ownerDocument.createElementNS(
        svg.namespaceURI,
        "rect",
      );
      rect.setAttribute("style", "fill:var(--markora-diagram-network-probe)");
      svg.append(rect);
      return svg;
    }

    const output = createBrowserLabDiagramOutput(request, call.id);

    if (mode === "connected") {
      (output as SVGSVGElement).dataset.e2eDiagramRendererArtifact = mounted.id;
      request.ownerDocument.body.append(output);
      mounted.diagramRendererArtifacts.add(output);
      request.signal.addEventListener(
        "abort",
        () => {
          output.remove();
          mounted.diagramRendererArtifacts.delete(output);
        },
        { once: true },
      );
    }

    return output;
  };
}

export function createBrowserLabDiagramRenderers(
  mounted: MountedEditor,
  modes: BrowserLabEditorSpec["diagramRendererModes"],
) {
  const renderers: Partial<Record<DiagramKind, DiagramRenderer>> = {};

  for (const kind of BROWSER_LAB_DIAGRAM_KINDS) {
    const renderer = createBrowserLabDiagramRenderer(mounted, modes?.[kind]);

    if (renderer) {
      renderers[kind] = renderer;
    }
  }

  return renderers;
}

export function runBrowserLabDiagramCommand(
  mounted: MountedEditor,
  request: BrowserLabDiagramCommandRequest,
) {
  const commands = requireDiagramsHandle(mounted).commands;

  switch (request.type) {
    case "convert":
      return commands.convert(request.target, request.kind);
    case "convertCodeBlock":
      return commands.convertCodeBlock(request.kind);
    case "insert":
      return commands.insert(request.options);
    case "remove":
      return commands.remove(request.target);
    case "restoreCodeBlock":
      return commands.restoreCodeBlock(request.target);
    case "retryPreview":
      return commands.retryPreview(request.target);
    case "togglePreview":
      return commands.togglePreview(request.target);
    case "update":
      return commands.update(request.target, request.patch);
  }
}

export function createBrowserLabHtmlOutput(
  request: HtmlRenderRequest,
  callId: number,
) {
  const output = request.ownerDocument.createElement("article");
  output.className = "browser-lab-html-rendered";
  output.textContent = `Rendered ${request.kind} HTML ${callId}: ${request.source}`;
  return output;
}

export function clearHtmlRendererArtifacts(mounted: MountedEditor) {
  for (const artifact of mounted.htmlRendererArtifacts) {
    artifact.parentNode?.removeChild(artifact);
  }

  mounted.htmlRendererArtifacts.clear();
}

export function createBrowserLabHtmlRenderer(
  mounted: MountedEditor,
  mode: BrowserLabHtmlRendererMode | undefined,
) {
  if (!mode || mode === "missing") {
    return undefined;
  }

  return (
    request: HtmlRenderRequest,
  ): Node | DocumentFragment | Promise<Node | DocumentFragment> => {
    const call = {
      aborted: request.signal.aborted,
      id: mounted.htmlRendererCalls.length + 1,
      kind: request.kind,
      settled: "pending" as "pending" | "rejected" | "resolved" | "threw",
      source: request.source,
    };
    mounted.htmlRendererCalls.push(call);
    request.signal.addEventListener(
      "abort",
      () => {
        call.aborted = true;
      },
      { once: true },
    );

    if (mode === "throw") {
      call.settled = "threw";
      throw new Error(`Browser lab HTML renderer threw for call ${call.id}.`);
    }

    if (mode === "reject") {
      call.settled = "rejected";
      return Promise.reject(
        new Error(`Browser lab HTML renderer rejected call ${call.id}.`),
      );
    }

    if (mode === "deferred") {
      return new Promise<Node | DocumentFragment>((resolve, reject) => {
        mounted.htmlRendererDeferred.set(call.id, { reject, request, resolve });
      });
    }

    call.settled = "resolved";

    if (mode === "wrong-document") {
      const foreignDocument =
        request.ownerDocument.implementation.createHTMLDocument(
          "Browser lab foreign HTML renderer",
        );
      const output = foreignDocument.createElement("article");
      output.textContent = request.source;
      return output;
    }

    const output = createBrowserLabHtmlOutput(request, call.id);

    if (mode === "string") {
      return "<article>renderer strings are forbidden</article>" as unknown as Node;
    }

    if (mode === "unsafe") {
      const wrapper = request.ownerDocument.createElement("div");
      const script = request.ownerDocument.createElement("script");
      script.textContent = "window.__markoraUnsafeHtmlRenderer = true";
      const image = request.ownerDocument.createElement("img");
      const frame = request.ownerDocument.createElement("iframe");
      const link = request.ownerDocument.createElement("a");
      link.href = "https://markora-html.invalid/renderer-link";
      link.textContent = "unsafe renderer link";
      const form = request.ownerDocument.createElement("form");
      form.action = "https://markora-html.invalid/renderer-submit";
      form.append(request.ownerDocument.createElement("input"));
      const svg = request.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      wrapper.append(script, image, frame, link, form, svg);
      return wrapper;
    }

    if (mode === "connected") {
      output.dataset.e2eHtmlRendererArtifact = mounted.id;
      request.ownerDocument.body.append(output);
      mounted.htmlRendererArtifacts.add(output);
      request.signal.addEventListener(
        "abort",
        () => {
          output.remove();
          mounted.htmlRendererArtifacts.delete(output);
        },
        { once: true },
      );
    }

    return output;
  };
}

export function runBrowserLabHtmlCommand(
  mounted: MountedEditor,
  request: BrowserLabHtmlCommandRequest,
) {
  const commands = requireHtmlHandle(mounted).commands;

  switch (request.type) {
    case "remove":
      return commands.remove(request.target);
    case "retryPreview":
      return commands.retryPreview(request.target);
    case "togglePreview":
      return commands.togglePreview(request.target);
    case "update":
      return commands.update(request.target, request.source);
  }
}

export function clearMathRendererArtifacts(mounted: MountedEditor) {
  for (const artifact of mounted.mathRendererArtifacts) {
    artifact.parentNode?.removeChild(artifact);
  }

  mounted.mathRendererArtifacts.clear();
}

export function createBrowserLabMathRenderer(
  mounted: MountedEditor,
  mode: BrowserLabMathRendererMode | undefined,
) {
  if (!mode || mode === "missing") {
    return undefined;
  }

  return (
    request: MathRenderRequest,
  ): Node | DocumentFragment | Promise<Node | DocumentFragment> => {
    const call = {
      aborted: request.signal.aborted,
      id: mounted.mathRendererCalls.length + 1,
      kind: request.kind,
      settled: "pending" as "pending" | "rejected" | "resolved" | "threw",
      source: request.source,
    };
    mounted.mathRendererCalls.push(call);
    request.signal.addEventListener(
      "abort",
      () => {
        call.aborted = true;
      },
      { once: true },
    );

    if (mode === "throw") {
      call.settled = "threw";
      throw new Error(`Browser lab math renderer threw for call ${call.id}.`);
    }

    if (mode === "reject") {
      call.settled = "rejected";
      return Promise.reject(
        new Error(`Browser lab math renderer rejected call ${call.id}.`),
      );
    }

    if (mode === "deferred") {
      return new Promise<Node | DocumentFragment>((resolve, reject) => {
        mounted.mathRendererDeferred.set(call.id, { reject, request, resolve });
      });
    }

    call.settled = "resolved";

    if (mode === "wrong-document") {
      const foreignDocument =
        request.ownerDocument.implementation.createHTMLDocument(
          "Browser lab foreign math renderer",
        );
      const output = foreignDocument.createElement("span");
      output.textContent = request.source;
      return output;
    }

    const output = createBrowserLabMathOutput(request, call.id);

    if (mode === "unsafe") {
      output.setAttribute(
        "onclick",
        "window.__markoraUnsafeMathRenderer = true",
      );
      return output;
    }

    if (mode === "connected") {
      output.dataset.e2eMathRendererArtifact = mounted.id;
      request.ownerDocument.body.append(output);
      mounted.mathRendererArtifacts.add(output);
      request.signal.addEventListener(
        "abort",
        () => {
          output.remove();
          mounted.mathRendererArtifacts.delete(output);
        },
        { once: true },
      );
    }

    return output;
  };
}

export function runBrowserLabMathCommand(
  mounted: MountedEditor,
  request: BrowserLabMathCommandRequest,
) {
  const commands = requireMathHandle(mounted).commands;

  switch (request.type) {
    case "convert":
      return commands.convert(request.target, request.kind);
    case "insertBlock":
      return commands.insertBlock(request.source);
    case "insertInline":
      return commands.insertInline(request.source);
    case "remove":
      return commands.remove(request.target);
    case "retryPreview":
      return commands.retryPreview(request.target);
    case "togglePreview":
      return commands.togglePreview(request.target);
    case "update":
      return commands.update(request.target, request.source);
  }
}

export function runBrowserLabAlertsCommand(
  mounted: MountedEditor,
  request: BrowserLabAlertsCommandRequest,
) {
  const commands = requireAlertsHandle(mounted).commands;

  switch (request.type) {
    case "setKind":
      return commands.setKind(request.kind);
    case "toggle":
      return commands.toggle(request.kind);
    case "unwrap":
      return commands.unwrap();
    case "wrap":
      return commands.wrap(request.kind);
  }
}

export function readBrowserLabAlertsState(
  mounted: MountedEditor,
  request: BrowserLabAlertsStateRequest,
) {
  const state = requireAlertsHandle(mounted).state;

  switch (request.type) {
    case "canSetKind":
      return state.canSetKind(request.kind);
    case "canToggle":
      return state.canToggle(request.kind);
    case "canUnwrap":
      return state.canUnwrap();
    case "canWrap":
      return state.canWrap(request.kind);
    case "isActive":
      return state.isActive();
  }
}

export function runBrowserLabTocCommand(
  mounted: MountedEditor,
  request: BrowserLabTocCommandRequest,
) {
  const commands = requireTocHandle(mounted).commands;
  return request.type === "insert" ? commands.insert() : commands.remove();
}

export function readBrowserLabTocState(
  mounted: MountedEditor,
  request: BrowserLabTocStateRequest,
) {
  const state = requireTocHandle(mounted).state;

  switch (request.type) {
    case "canInsert":
      return state.canInsert();
    case "canRemove":
      return state.canRemove();
    case "isActive":
      return state.isActive();
  }
}

export function cloneEditorStyles(shadowRoot: ShadowRoot) {
  for (const style of document.head.querySelectorAll<
    HTMLLinkElement | HTMLStyleElement
  >('link[rel="stylesheet"], style')) {
    shadowRoot.append(style.cloneNode(true));
  }

  const fixtureStyles = document.createElement("style");
  fixtureStyles.textContent = `
    :host { color: #0f172a; font-family: Inter, system-ui, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    .browser-lab-frame { min-width: 0; padding: 20px; background: #fff; }
    .browser-lab-editor-host { min-height: 260px; }
    .browser-lab-portal { position: relative; z-index: 10; }
  `;
  shadowRoot.append(fixtureStyles);
}

export function describeActiveElement(mounted: MountedEditor) {
  const activeElement =
    mounted.root instanceof ShadowRoot
      ? mounted.root.activeElement
      : document.activeElement;

  if (!(activeElement instanceof HTMLElement)) {
    return null;
  }

  if (activeElement.classList.contains("cm-content")) {
    return "code-mirror";
  }

  if (activeElement.classList.contains("ProseMirror")) {
    return "prosemirror";
  }

  return (
    activeElement.getAttribute("aria-label") ??
    activeElement.getAttribute("role") ??
    activeElement.tagName.toLowerCase()
  );
}

export function readSnapshot(mounted: MountedEditor): BrowserLabSnapshot {
  mounted.editor.flushChange();
  const { selection } = mounted.editor.view.state;
  const activeElement =
    mounted.root instanceof ShadowRoot
      ? mounted.root.activeElement
      : document.activeElement;

  return {
    activeElement: describeActiveElement(mounted),
    changeCount: mounted.changeCount,
    codeBlocks: {
      active: mounted.editor.view.dom.querySelectorAll(
        '[data-mdw-code-block-state="active"]',
      ).length,
      codeMirrorEditors:
        mounted.editor.view.dom.querySelectorAll(".cm-editor").length,
      error: mounted.editor.view.dom.querySelectorAll(
        '[data-mdw-code-block-state="error"]',
      ).length,
      inactive: mounted.editor.view.dom.querySelectorAll(
        '[data-mdw-code-block-state="inactive"]',
      ).length,
      loading: mounted.editor.view.dom.querySelectorAll(
        '[data-mdw-code-block-state="loading"]',
      ).length,
      staticViews: mounted.editor.view.dom.querySelectorAll(
        ".mdw-code-block-static",
      ).length,
      total: mounted.editor.view.dom.querySelectorAll(".mdw-code-block").length,
    },
    codeMirrorFocused:
      activeElement instanceof HTMLElement &&
      activeElement.classList.contains("cm-content"),
    id: mounted.section.dataset.e2eEditor ?? "",
    markdown: mounted.editor.getMarkdown(),
    prosemirrorFocused: mounted.editor.view.hasFocus(),
    selection: {
      anchor: selection.anchor,
      from: selection.from,
      head: selection.head,
      to: selection.to,
    },
    transactionCount: mounted.transactionCount,
  };
}

export function readExtensionSnapshot(
  mounted: MountedEditor,
): BrowserLabExtensionSnapshot {
  const registry = mounted.editor.extensions;
  const calloutLifecycle = registry.has(publicCalloutExtension)
    ? { ...registry.get(publicCalloutExtension).storage }
    : null;

  return {
    calloutLifecycle,
    manifest: registry.manifest.extensions.map(({ name, version }) => ({
      name,
      version,
    })),
    uiActions: registry.uiActions.map(({ defaultLabel, group, id }) => ({
      defaultLabel,
      group,
      id,
    })),
  };
}

export function renderExtensionActions(mounted: MountedEditor) {
  mounted.extensionActions?.remove();
  mounted.extensionActions = undefined;

  if (mounted.editor.extensions.uiActions.length === 0) {
    return;
  }

  const toolbar = mounted.section.ownerDocument.createElement("div");
  toolbar.className = "browser-lab-extension-actions";
  toolbar.dataset.e2eExtensionActions = mounted.id;
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", `${mounted.id} extension actions`);

  for (const action of mounted.editor.extensions.uiActions) {
    const button = toolbar.ownerDocument.createElement("button");
    button.type = "button";
    button.dataset.e2eExtensionAction = action.id;
    button.textContent = action.defaultLabel;
    button.disabled = !action.isEnabled();
    button.addEventListener("click", () => {
      action.run();
      mounted.editor.flushChange();
      mounted.output.textContent = mounted.editor.getMarkdown();
      button.disabled = !action.isEnabled();
    });
    toolbar.append(button);
  }

  mounted.section.insertBefore(toolbar, mounted.output);
  mounted.extensionActions = toolbar;
}
