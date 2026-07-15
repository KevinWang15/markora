type BrowserLabSelectionTarget =
  | "all"
  | "end"
  | "start"
  | { anchor: number; head?: number };

type BrowserLabEventName = "blur" | "error" | "focus" | "selection" | "update";

type BrowserLabSelectionSnapshot = {
  anchor: number;
  empty: boolean;
  from: number;
  head: number;
  kind: "all" | "managed-block" | "node" | "other" | "text";
  to: number;
};

type BrowserLabEventRecord = {
  code?: string;
  language?: string;
  message?: string;
  previousSelection?: BrowserLabSelectionSnapshot;
  selection?: BrowserLabSelectionSnapshot;
  type: BrowserLabEventName;
};

type BrowserLabUpdateOptions = {
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  attributes?: Record<string, string> | null;
  editable?: boolean;
  placeholder?: string | null;
};

type BrowserLabTestSpec = {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  attributes?: Record<string, string>;
  autofocus?: boolean;
  controlledEcho?: boolean;
  direction?: "auto" | "ltr" | "rtl";
  editable?: boolean;
  id: string;
  initialSelection?: BrowserLabSelectionTarget;
  markdown?: string;
  placement?: "bottom-right" | "normal";
  placeholder?: string;
  portal?: "body" | "default" | "local" | "positioned" | "transformed";
  root?: "document" | "shadow";
};

type BrowserLabTestSnapshot = {
  activeElement: string | null;
  changeCount: number;
  codeMirrorFocused: boolean;
  id: string;
  markdown: string;
  prosemirrorFocused: boolean;
  selection: { anchor: number; from: number; head: number; to: number };
  transactionCount: number;
};

interface Window {
  __MARKORA_BROWSER_LAB__?: {
    blur(id: string): void;
    clearEvents(id: string): void;
    command(
      id: string,
      command: "insertImage" | "redo" | "setLink" | "toggleMark" | "undo",
      value?: string | { alt?: string | null; src: string; title?: string | null },
    ): boolean;
    copySelection(id: string): { defaultPrevented: boolean; html: string; plain: string };
    destroy(id: string): boolean;
    destroyEditor(id: string): boolean;
    destroyAll(): void;
    dispatchTransfer(id: string, spec: {
      event: "dragover" | "drop" | "paste";
      files?: Array<{ contents: string; name: string; type: string }>;
      html?: string;
      markdown?: string;
      plain?: string;
      target?: "code-mirror" | "prosemirror";
    }): { defaultPrevented: boolean; fileCount: number; types: string[] };
    dispatchViewportEvent(type: "resize" | "scroll"): void;
    events(id: string): {
      counts: Record<BrowserLabEventName, number>;
      log: BrowserLabEventRecord[];
    };
    focus(id: string, selection?: BrowserLabSelectionTarget): void;
    getMarkdown(id: string): string;
    isDestroyed(id: string): boolean;
    listenerSnapshot(id?: string): { total: number; byTargetAndType: Record<string, number> };
    mount(spec: BrowserLabTestSpec): BrowserLabTestSnapshot;
    mountedIds(): string[];
    openUi(id: string, kind: "image" | "link"): boolean;
    pendingOpaqueEdit(id: string): { kind: string; source: string } | null;
    ready: true;
    reconcile(
      id: string,
      markdown: string,
      options?: { emitChange?: boolean },
    ): { changed: boolean; snapshot: BrowserLabTestSnapshot };
    remount(
      id: string,
      options?: Omit<BrowserLabTestSpec, "direction" | "id" | "placement" | "portal" | "root">,
    ): BrowserLabTestSnapshot;
    reset(id: string, markdown: string): string;
    selectText(id: string, text: string, mode?: "all" | "end" | "start", occurrence?: number): boolean;
    settle(id?: string): Promise<void>;
    snapshot(id: string): BrowserLabTestSnapshot;
    unsubscribe(id: string, type: BrowserLabEventName): boolean;
    updateOpaque(id: string, source: string): boolean;
    updateOptions(id: string, options: BrowserLabUpdateOptions): {
      snapshot: BrowserLabTestSnapshot;
      statePreserved: boolean;
    };
  };
}
