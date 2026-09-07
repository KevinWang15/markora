import { DOMSerializer, type Node as MarkdownNode } from "prosemirror-model";
import DOMPurify from "dompurify";
import { renderMath, renderMermaid } from "./renderers";
import type { ExportTheme } from "./exportTheme";

export const exportStyles = `
:host,body {
  color:var(--mdw-color-text,#222); background:var(--mdw-color-surface,white);
  font-family:var(--export-font-family,Georgia,serif); font-size:var(--export-font-size,16px);
  line-height:var(--export-line-height,1.65); color-scheme:var(--mdw-color-scheme,light);
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
article { max-width:var(--mdw-document-max-inline-size,760px); margin:40px auto; padding:0 28px; overflow-wrap:anywhere; }
article > * { margin-block:0; }
article > * + *, li > * + * { margin-block-start:var(--mdw-block-spacing,.75rem); }
h1,h2,h3,h4,h5,h6 {
  line-height:1.25; break-after:avoid; font-family:var(--mdw-heading-font-family,inherit);
  font-weight:var(--mdw-heading-font-weight,700); letter-spacing:var(--mdw-heading-letter-spacing,normal);
}
h1 { font-size:var(--mdw-heading-1-font-size,2.2em); }
h2 { font-size:var(--mdw-heading-2-font-size,1.5em); }
h3 { font-size:var(--mdw-heading-3-font-size,1.25em); }
h4 { font-size:var(--mdw-heading-4-font-size,1.125em); }
h5 { font-size:var(--mdw-heading-5-font-size,1em); }
h6 { font-size:var(--mdw-heading-6-font-size,.875em); }
h1,h2 { border-block-end:var(--mdw-heading-rule-width,0px) solid var(--mdw-color-border,#ccc); padding-block-end:var(--mdw-heading-rule-padding,0px); }
pre { white-space:pre-wrap; padding:16px; background:var(--mdw-color-surface-subtle,#f5f5f5); border-radius:var(--mdw-code-block-radius,4px); }
code { font-family:var(--mdw-font-mono,ui-monospace,monospace); font-size:.88em; }
blockquote { margin-inline-start:0; padding-inline-start:20px; border-inline-start:3px solid var(--mdw-color-border,#ccc); color:var(--mdw-color-quote,#555); }
table { width:100%; border-collapse:collapse; } th,td { border:1px solid var(--mdw-color-border,#ccc); padding:8px; text-align:start; }
th > p,td > p { margin:0; }
th { background:var(--mdw-color-surface-muted,#f5f5f5); }
img,svg { max-width:100%; height:auto; } math { font-size:1.15em; }
a { color:var(--mdw-color-accent,#245c9c); } hr { border:0; border-top:1px solid var(--mdw-color-border,#ccc); }
.export-diagram { background:var(--mdw-color-surface,white); color:var(--mdw-color-text,#222); margin:1em 0; }
.export-diagram .node rect,.export-diagram .node polygon,.export-diagram .node circle { fill:var(--mdw-color-surface-subtle,#f4f4f4); stroke:var(--mdw-color-muted,#555); }
.export-diagram .flowchart-link,.export-diagram .messageLine0,.export-diagram .messageLine1 { stroke:var(--mdw-color-muted,#555); fill:none; }
.export-diagram marker path { fill:var(--mdw-color-muted,#555); stroke:var(--mdw-color-muted,#555); } .export-diagram text { fill:var(--mdw-color-text,#222); font:16px sans-serif; }
@media print { article { margin:0 auto; padding:0; } pre,blockquote,img,svg { break-inside:avoid; } }
`;

// A CSS string can contain an HTML closing tag even when it came from CSSOM.
const escapeStyleText = (css: string) => css.replace(/</gu, "\\3c ");

export type ExportOptions = Readonly<{
  resolveImage?: (url: string) => Promise<string>;
  theme?: ExportTheme;
}>;

export async function buildExport(doc: MarkdownNode, title: string, options: ExportOptions = {}) {
  const { resolveImage = async (url: string) => url, theme } = options;
  const ownerDocument = document;
  const article = ownerDocument.createElement("article");
  if (theme) article.dataset.theme = theme.id;
  const renderJobs: (() => Promise<void>)[] = [];
  const nodes = DOMSerializer.nodesFromSchema(doc.type.schema);
  for (const name of ["math_inline", "math_block", "diagram"]) if (nodes[name]) {
    nodes[name] = node => {
      const math = name !== "diagram";
      const source = math ? String(node.attrs.source) : node.textContent;
      const element = ownerDocument.createElement(name === "math_inline" ? "span" : "div");
      element.className = math ? "export-math" : "export-diagram";
      const fallback = ownerDocument.createElement(name === "math_inline" ? "code" : "pre");
      fallback.textContent = source;
      element.append(fallback);
      renderJobs.push(async () => {
        if (!math && node.attrs.kind !== "mermaid") return;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const request = { source, ownerDocument, signal: controller.signal };
          const output = math ? await renderMath({ ...request, kind: name === "math_inline" ? "inline" : "block" })
            : await renderMermaid({ ...request, kind: "mermaid", info: String(node.attrs.info ?? "mermaid") });
          element.replaceChildren(output);
        } catch { element.setAttribute("data-export-fallback", "true"); }
        finally { clearTimeout(timeout); }
      });
      return element;
    };
  }
  const serializer = new DOMSerializer(nodes, DOMSerializer.marksFromSchema(doc.type.schema));
  article.append(serializer.serializeFragment(doc.content, { document: ownerDocument }));
  // Serialize work deliberately: each renderer can allocate a substantial layout tree.
  for (const job of renderJobs) await job();
  for (const image of article.querySelectorAll("img")) {
    image.src = await resolveImage(image.getAttribute("src") ?? "");
  }
  const clean = DOMPurify.sanitize(article.outerHTML, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS: ["style", "script", "foreignObject", "iframe", "form", "input", "button"],
    FORBID_ATTR: ["style", "contenteditable", "autofocus"],
  });
  const exported = ownerDocument.implementation.createHTMLDocument(title);
  exported.documentElement.lang = ownerDocument.documentElement.lang || "en";
  const charset = exported.createElement("meta"); charset.setAttribute("charset", "utf-8"); exported.head.prepend(charset);
  const viewport = exported.createElement("meta"); viewport.name = "viewport"; viewport.content = "width=device-width, initial-scale=1"; exported.head.append(viewport);
  const policy = exported.createElement("meta"); policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; img-src data: https: http: file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  exported.head.append(policy);
  const css = escapeStyleText((theme ? `:host,body { ${theme.declarations} }\n` : "") + exportStyles);
  const pageStyles = escapeStyleText(`@page { margin:20mm; ${theme?.pageDeclarations ?? ""} }\n`
    + (theme ? `@media print { html,body { ${theme.pageDeclarations} -webkit-print-color-adjust:exact; print-color-adjust:exact; } }` : ""));
  const styles = exported.createElement("style"); styles.textContent = css + pageStyles; exported.head.append(styles);
  exported.body.innerHTML = clean;
  return { html: "<!doctype html>\n" + exported.documentElement.outerHTML, body: clean, styles: css, pageStyles };
}

let clearPreviousPrint: (() => void) | undefined;
export async function printExport(output: Awaited<ReturnType<typeof buildExport>>, print: () => void | Promise<void>, cleanupAfter = false) {
  clearPreviousPrint?.();
  const host = document.createElement("div"); host.id = "markora-print";
  // Page canvas styles must live outside Shadow DOM. Removing this host restores
  // the app's print rules without changing its theme controller or inline styles.
  const pageStyle = document.createElement("style"); pageStyle.textContent = output.pageStyles; host.append(pageStyle);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style"); style.textContent = output.styles;
  shadow.append(style);
  const content = document.createElement("div"); content.innerHTML = output.body; shadow.append(content);
  document.body.append(host);
  const cleanup = () => { host.remove(); window.removeEventListener("afterprint", cleanup); if (clearPreviousPrint === cleanup) clearPreviousPrint = undefined; };
  clearPreviousPrint = cleanup;
  window.addEventListener("afterprint", cleanup, { once: true });
  try {
    await Promise.all([...shadow.querySelectorAll("img")].map(image => image.decode().catch(() => undefined)));
    await document.fonts.ready;
    await print();
    if (cleanupAfter) cleanup();
  } catch (error) { cleanup(); throw error; }
}
