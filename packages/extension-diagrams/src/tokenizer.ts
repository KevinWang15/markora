import type { MarkdownEditorTokenizerRule } from "markora/extension-api";
import {
  classifyDiagramInfo,
  type DiagramKind,
} from "./source";

type CoreRule = ReturnType<Extract<
  MarkdownEditorTokenizerRule,
  { phase: "core" }
>["createRule"]>;

type MarkdownToken = Parameters<CoreRule>[0]["tokens"][number];

export type DiagramTokenMeta = Readonly<{
  info?: string;
  kind?: DiagramKind;
}>;

const attrsByToken = new WeakMap<object, Readonly<{ info: string; kind: DiagramKind }>>();

function ownDataValue(object: object, key: PropertyKey) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function tokenInfo(token: object) {
  const value = ownDataValue(token, "info");
  return typeof value === "string" ? value.trim() : "";
}

function attachAttrs(token: MarkdownToken, attrs: Readonly<{ info: string; kind: DiagramKind }>) {
  attrsByToken.set(token, attrs);
  const current = ownDataValue(token, "meta");

  if (typeof current === "object" && current !== null) {
    try {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      delete descriptors.info;
      delete descriptors.kind;
      const next = Object.create(null) as Record<PropertyKey, unknown>;
      Object.defineProperties(next, descriptors);
      Object.defineProperties(next, {
        info: { configurable: true, enumerable: true, value: attrs.info, writable: true },
        kind: { configurable: true, enumerable: true, value: attrs.kind, writable: true },
      });
      Object.defineProperty(token, "meta", {
        configurable: true,
        enumerable: true,
        value: next,
        writable: true,
      });
      return;
    } catch {
      // Hostile proxies/accessors cannot prevent the package-owned WeakMap.
    }
  }
  try {
    Object.defineProperty(token, "meta", {
      configurable: true,
      enumerable: true,
      value: Object.assign(Object.create(null), attrs),
      writable: true,
    });
  } catch {
    // Parser attrs are retained in the WeakMap even if a hostile token made
    // its public metadata slot non-writable or accessor-backed.
  }
}

/**
 * Retag only fences already accepted by Markdown-it. The foundation remains
 * authoritative for indentation, closing delimiters, unclosed fences, and
 * body normalization in both root and minimal codecs.
 */
export function createDiagramFenceTransformRule(tokenType: string): CoreRule {
  return (state) => {
    for (const token of state.tokens as MarkdownToken[]) {
      if (token.type !== "fence") {
        continue;
      }
      const info = tokenInfo(token);
      const kind = classifyDiagramInfo(info);
      if (!kind) {
        continue;
      }
      token.type = tokenType;
      token.tag = "code";
      attachAttrs(token, Object.freeze({ info, kind }));
    }
  };
}

export function diagramTokenAttrs(token: { info?: unknown; meta?: unknown }) {
  const retained = attrsByToken.get(token);
  if (retained) {
    return retained;
  }
  const meta = ownDataValue(token, "meta");
  const infoValue = typeof meta === "object" && meta !== null
    ? ownDataValue(meta, "info")
    : undefined;
  const kindValue = typeof meta === "object" && meta !== null
    ? ownDataValue(meta, "kind")
    : undefined;
  const info = typeof infoValue === "string" ? infoValue : tokenInfo(token);
  const kind = typeof kindValue === "string" && classifyDiagramInfo(info) === kindValue
    ? kindValue as DiagramKind
    : classifyDiagramInfo(info);
  return kind ? { info, kind } : null;
}
