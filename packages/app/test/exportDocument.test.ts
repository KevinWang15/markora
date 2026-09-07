import { expect, it } from "vitest";
import { createEditor } from "markora";
import { createMathExtension } from "markora-extension-math";
import { buildExport } from "../src/exportDocument";

it("exports semantic formatting and MathML while keeping authored HTML inert", async () => {
  const editor = createEditor({ element: document.createElement("div"), extensions: [createMathExtension()],
    markdown: '# <unsafe>\n\n**Bold** and $x^2$\n\n<script>window.compromised = true</script>\n\n![image](local.png)' });
  try {
    const output = await buildExport(editor.view.state.doc, '</title><script>bad()</script>', async () => 'data:image/png;base64,eA==');
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
