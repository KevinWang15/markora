type BrowserLabTestSpec = {
  direction?: "auto" | "ltr" | "rtl";
  id: string;
  markdown?: string;
  placement?: "bottom-right" | "normal";
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
    command(
      id: string,
      command: "insertImage" | "redo" | "setLink" | "toggleMark" | "undo",
      value?: string | { alt?: string | null; src: string; title?: string | null },
    ): boolean;
    destroy(id: string): boolean;
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
    getMarkdown(id: string): string;
    listenerSnapshot(id?: string): { total: number; byTargetAndType: Record<string, number> };
    mount(spec: BrowserLabTestSpec): BrowserLabTestSnapshot;
    mountedIds(): string[];
    openUi(id: string, kind: "image" | "link"): boolean;
    pendingOpaqueEdit(id: string): { kind: string; source: string } | null;
    ready: true;
    reset(id: string, markdown: string): string;
    selectText(id: string, text: string, mode?: "all" | "end" | "start", occurrence?: number): boolean;
    settle(id?: string): Promise<void>;
    snapshot(id: string): BrowserLabTestSnapshot;
    updateOpaque(id: string, source: string): boolean;
  };
}
