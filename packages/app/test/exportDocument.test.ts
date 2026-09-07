import { expect, it } from "vitest";
import { createEditor } from "markora";
import { createMathExtension } from "markora-extension-math";
import { buildExport } from "../src/exportDocument";

it("exports semantic formatting and MathML while keeping authored HTML inert", async () => {
  const editor = createEditor({ element: document.createElement("div"), extensions: [createMathExtension()],
    markdown: '# <unsafe>\n\n**Bold** and $x^2$\n\n<script>window.compromised = true</script>\n\n![image](local.png)' });
  try {
    const output = await buildExport(editor.view.state.doc, '</title><script>bad()</script>', { resolveImage: async () => 'data:image/png;base64,eA==' });
    const parsed = new DOMParser().parseFromString(output.html, 'text/html');
    expect(parsed.title).toBe('</title><script>bad()</script>');
    expect(parsed.querySelectorAll('script,button,[contenteditable]')).toHaveLength(0);
    expect(parsed.querySelector('strong')?.textContent).toBe('Bold');
    expect(parsed.querySelector('math')).not.toBeNull();
    expect(parsed.querySelector('img')?.src).toBe('data:image/png;base64,eA==');
    expect(editor.getMarkdown()).toContain('local.png');
    expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("default-src 'none'");
  } finally { editor.destroy(); }
});

it("snapshots inherited theme tokens and escapes CSS when exporting a standalone document", async () => {
  const { captureExportTheme } = await import("../src/exportTheme");
  const element = document.createElement("div");
  document.body.append(element);
  element.style.cssText = '--mdw-color-surface:#fbf5e9;--mdw-color-text:#44382b;--mdw-color-scheme:light;font-family:Georgia;font-size:18px;line-height:1.85';
  element.style.setProperty("--mdw-font-mono", '"</style><script>bad()</script>"');
  const theme = captureExportTheme(element, "sepia");
  element.style.setProperty("--mdw-color-surface", "black");
  expect(Object.isFrozen(theme)).toBe(true);
  expect(theme.declarations).toContain("--mdw-heading-font-family: initial");
  const editor = createEditor({ element: document.createElement("div"), markdown: "# Paper\n\nText" });
  try {
    const output = await buildExport(editor.view.state.doc, "Paper", { theme });
    const parsed = new DOMParser().parseFromString(output.html, "text/html");
    expect(parsed.querySelector("script")).toBeNull();
    expect(parsed.querySelector("article")?.dataset.theme).toBe("sepia");
    expect(output.styles).toContain("--mdw-color-surface: #fbf5e9");
    expect(output.styles).toContain("--export-font-size: 18px");
    expect(output.pageStyles).toContain("background-color: rgb(251, 245, 233) !important");
  } finally { editor.destroy(); element.remove(); }
});

it("removes print-only theme styles after export or a printer failure", async () => {
  const { printExport } = await import("../src/exportDocument");
  const output = { html: "", body: "<article>Paper</article>", styles: "article{color:brown}", pageStyles: "@media print{body{background:tan}}" };
  const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  try {
    await printExport(output, () => {
      expect(document.querySelector("#markora-print > style")?.textContent).toBe(output.pageStyles);
      expect(document.querySelector("#markora-print")?.shadowRoot?.querySelector("article")?.textContent).toBe("Paper");
    }, true);
    expect(document.querySelector("#markora-print")).toBeNull();
    await expect(printExport(output, () => { throw new Error("Printer unavailable"); })).rejects.toThrow("Printer unavailable");
    expect(document.querySelector("#markora-print")).toBeNull();
  } finally {
    if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
    else Reflect.deleteProperty(document, "fonts");
  }
});
