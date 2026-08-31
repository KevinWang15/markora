import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const markdownEditorCodeHighlightStyle = HighlightStyle.define([
  { tag: [tags.meta, tags.comment], color: "var(--mdw-syntax-comment, #6e7781)" },
  { tag: tags.link, color: "var(--mdw-syntax-literal, #0550ae)", textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.keyword, color: "var(--mdw-syntax-keyword, #cf222e)" },
  {
    tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName, tags.number],
    color: "var(--mdw-syntax-literal, #0550ae)",
  },
  { tag: [tags.literal, tags.inserted], color: "var(--mdw-syntax-literal, #0550ae)" },
  {
    tag: [tags.string, tags.deleted, tags.regexp, tags.escape, tags.special(tags.string)],
    color: "var(--mdw-syntax-string, #0a3069)",
  },
  {
    tag: [tags.definition(tags.variableName), tags.local(tags.variableName)],
    color: "var(--mdw-syntax-name, #24292f)",
  },
  {
    tag: [tags.definition(tags.propertyName), tags.propertyName, tags.special(tags.variableName), tags.macroName],
    color: "var(--mdw-syntax-property, #8250df)",
  },
  { tag: [tags.typeName, tags.namespace, tags.className], color: "var(--mdw-syntax-type, #953800)" },
  { tag: [tags.operator, tags.punctuation], color: "var(--mdw-syntax-operator, #57606a)" },
  { tag: tags.invalid, color: "var(--mdw-color-danger, #cf222e)" },
]);
