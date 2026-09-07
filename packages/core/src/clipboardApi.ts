/** Portable clipboard formats; no browser permission or system clipboard access is implied. */
export type MarkdownEditorClipboardContent = Readonly<{ text: string; html?: string; markdown?: string }>;

export type MarkdownEditorClipboardSelection = Readonly<{
  content: MarkdownEditorClipboardContent;
  /** Delete only the captured selection, after a successful host clipboard write. Stale/read-only requests return false. */
  deleteSelection: () => boolean;
}>;

export type MarkdownEditorClipboard = Readonly<{
  /** Capture the outer editor selection, including table and extension serialization rules. */
  captureSelection: () => MarkdownEditorClipboardSelection | null;
  /** Paste through the editor's native clipboard handlers, transforms, and resource policies. */
  paste: (content: MarkdownEditorClipboardContent) => boolean;
}>;
