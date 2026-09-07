import { DOMSerializer, type Node as MarkdownNode } from "prosemirror-model";
import DOMPurify from "dompurify";
import { renderMath, renderMermaid } from "./renderers";

export const exportStyles = `
:host,body { color:#222; background:white; font:16px/1.65 Georgia,serif; }
article { max-width:760px; margin:40px auto; padding:0 28px; overflow-wrap:anywhere; }
h1,h2,h3,h4,h5,h6 { line-height:1.25; break-after:avoid; } h1 { font-size:2.2em; }
pre { white-space:pre-wrap; padding:16px; background:#f5f5f5; border-radius:4px; }
code { font-family:ui-monospace,monospace; font-size:.88em; }
blockquote { margin-left:0; padding-left:20px; border-left:3px solid #ccc; color:#555; }
table { width:100%; border-collapse:collapse; } th,td { border:1px solid #ccc; padding:8px; text-align:left; }
img,svg { max-width:100%; height:auto; } math { font-size:1.15em; }
a { color:#245c9c; } hr { border:0; border-top:1px solid #ccc; }
.export-diagram { background:white; color:#222; margin:1em 0; }
.export-diagram .node rect,.export-diagram .node polygon,.export-diagram .node circle { fill:#f4f4f4; stroke:#555; }
.export-diagram .flowchart-link,.export-diagram .messageLine0,.export-diagram .messageLine1 { stroke:#555; fill:none; }
.export-diagram marker path { fill:#555; stroke:#555; } .export-diagram text { fill:#222; font:16px sans-serif; }
@media print { article { margin:0; padding:0; max-width:none; } pre,blockquote,img,svg { break-inside:avoid; } }
@page { margin:20mm; }
`;

export async function buildExport(doc: MarkdownNode, title: string, resolveImage: (url: string) => Promise<string> = async url => url) {
  const ownerDocument = document;
  const article = ownerDocument.createElement("article");
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
  const styles = exported.createElement("style"); styles.textContent = exportStyles; exported.head.append(styles);
  exported.body.innerHTML = clean;
  return { html: "<!doctype html>\n" + exported.documentElement.outerHTML, body: clean, styles: exportStyles };
}

let clearPreviousPrint: (() => void) | undefined;
export async function printExport(output: Awaited<ReturnType<typeof buildExport>>, print: () => void | Promise<void>, cleanupAfter = false) {
  clearPreviousPrint?.();
  const host = document.createElement("div"); host.id = "markora-print";
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
