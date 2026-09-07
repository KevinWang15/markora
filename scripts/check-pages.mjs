import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { publicRouteMetadata } from "../packages/demo/src/lib/siteRoutes.ts";

const base = process.argv[2] ?? "/markora/";
assert(base.startsWith("/") && base.endsWith("/"), "Pass the site's absolute base path with a trailing slash.");
const root = fileURLToPath(new URL("../packages/demo/dist/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
// Deliberately no SPA fallback: this exercises the same directory entries Pages serves.
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!pathname.startsWith(base)) throw new Error("Outside site");
    let file = resolve(root, pathname.slice(base.length));
    if (file !== resolve(root) && !file.startsWith(resolve(root) + sep)) throw new Error("Outside site");
    if ((await stat(file)).isDirectory()) {
      if (!pathname.endsWith("/")) { response.writeHead(301, { Location: pathname + "/" }); response.end(); return; }
      file = resolve(file, "index.html");
    }
    const content = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    response.end(content);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(origin + base);
  const editor = page.locator("#editor .ProseMirror");
  await expect(editor).toBeVisible();
  await expect(editor.locator(".mdw-math math")).toHaveCount(2);
  await editor.locator("p").first().click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.insertText", { text: "Pages CDP edit " });
  await expect(editor).toContainText("Pages CDP edit");
  await page.getByRole("button", { name: /^Insert math/ }).click();
  const mathDialog = page.getByRole("dialog", { name: "Insert math", exact: true });
  await expect(mathDialog.getByRole("textbox", { name: "LaTeX source" })).toBeFocused();
  await cdp.send("Input.insertText", { text: String.raw`\sqrt{x}` });
  await expect(mathDialog.locator("math msqrt")).toHaveCount(1);
  await mathDialog.getByRole("button", { name: "Insert formula", exact: true }).click();
  await expect(editor.locator(".mdw-math math")).toHaveCount(3);
  const picker = page.getByRole("combobox", { name: "Theme", exact: true });
  await picker.selectOption("night");
  await expect(editor).toHaveCSS("background-color", "rgb(32, 37, 45)");
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "API overview", exact: true }).click();
  await expect(page).toHaveURL(origin + base + "docs/api");
  await expect(page).toHaveTitle(publicRouteMetadata["/docs/api"].title);
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Core playground", exact: true }).click();
  await expect(editor).toContainText("Pages CDP edit");
  await expect(editor.locator(".mdw-math math")).toHaveCount(3);
  for (const [route, metadata] of Object.entries(publicRouteMetadata)) {
    const response = await page.goto(origin + base + route.slice(1));
    assert.equal(response.status(), 200, `Direct navigation: ${route}`);
    await expect(page).toHaveTitle(metadata.title);
    await expect(picker).toHaveValue("night");
    assert.equal((await page.reload()).status(), 200, `Refresh: ${route}`);
    await expect(page).toHaveTitle(metadata.title);
    if (route === "/docs/getting-started") await expect(page.locator("#site-hero")).toBeVisible();
  }
  assert.deepEqual(errors, []);
  console.log(`Pages checks passed: ${Object.keys(publicRouteMetadata).length} routes, refresh, base path, theme persistence, CDP editing, and math insertion/previews.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
