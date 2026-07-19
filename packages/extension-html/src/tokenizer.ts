import {
  readMarkdownEditorOpaqueTokenSource,
  type MarkdownEditorTokenizerRule,
} from "markora/extension-api";

type CoreRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "core" }
>["createRule"]>;

type MarkdownToken = Parameters<CoreRule>[0]["tokens"][number];

export type HtmlTokenMeta = Readonly<{
  kind: "html-block" | "html-comment" | "inline-html";
  source: string;
}>;

function exactAttrs(token: MarkdownToken, display: "block" | "inline") {
  const source = readMarkdownEditorOpaqueTokenSource(token);

  if (source === null) {
    return null;
  }

  const comment = source.trimStart().startsWith("<!--");
  return Object.freeze({
    kind: comment
      ? "html-comment"
      : display === "block" ? "html-block" : "inline-html",
    source,
  } satisfies HtmlTokenMeta);
}

function attachAttrs(token: MarkdownToken, attrs: HtmlTokenMeta) {
  const current = token.meta;

  if (typeof current === "object" && current !== null) {
    try {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      delete descriptors.kind;
      delete descriptors.source;
      const next = Object.create(null) as Record<PropertyKey, unknown>;
      Object.defineProperties(next, descriptors);
      Object.defineProperties(next, {
        kind: {
          configurable: true,
          enumerable: true,
          value: attrs.kind,
          writable: true,
        },
        source: {
          configurable: true,
          enumerable: true,
          value: attrs.source,
          writable: true,
        },
      });
      token.meta = next;
      return;
    } catch {
      // A foreign proxy may refuse descriptor reads; package attrs still win.
    }
  }

  token.meta = { kind: attrs.kind, source: attrs.source };
}

/** Reclassify only HTML tokens already accepted and exactly hydrated by root. */
export function createHtmlClaimRule(
  blockType: string,
  inlineType: string,
): CoreRule {
  return (state) => {
    for (const token of state.tokens) {
      if (token.type === "html_block") {
        const attrs = exactAttrs(token, "block");

        if (attrs) {
          token.type = blockType;
          attachAttrs(token, attrs);
        }
        continue;
      }

      if (token.type !== "inline" || !token.children) {
        continue;
      }

      for (const child of token.children) {
        if (child.type !== "html_inline") {
          continue;
        }

        const attrs = exactAttrs(child, "inline");

        if (attrs) {
          child.type = inlineType;
          attachAttrs(child, attrs);
        }
      }
    }
  };
}

export function htmlTokenAttrs(token: MarkdownToken) {
  const meta = token.meta as Partial<HtmlTokenMeta> | null;
  return {
    kind: meta?.kind,
    source: meta?.source,
  };
}
