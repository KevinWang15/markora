import { test, expect, mountEditor, resetEditor, editorLocator, destroyEditorOnly,
  getMarkdown, focusEditor, getDiagramSnapshot } from "./fixtures";

test("@required local engines load independently on demand and release PlantUML on teardown", async ({ labPage, context, browserName }, testInfo) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  labPage.on("request", request => requests.push(request.url()));
  const engines = () => requests.filter(url => /\/(?:math-engine|mermaid-engine|plantuml-frame)-/u.test(url));
  await mountEditor(labPage, { id: "local", extensionMode: "all-advanced", localRenderers: true,
    mathEditMode: "in-place", markdown: "Ordinary Markdown", root: "shadow" });
  await labPage.waitForTimeout(400); // Observe the deferred-preview scheduling window.
  expect(engines()).toEqual([]);
  const host = editorLocator(labPage, "local");
  await resetEditor(labPage, "local", "$\\frac{a}{b}$");
  await expect(host.locator("math mfrac")).toBeVisible();
  expect(engines().filter(url => url.includes("math-engine"))).toHaveLength(1);
  expect(engines().some(url => /mermaid-engine|plantuml-frame/u.test(url))).toBe(false);

  await resetEditor(labPage, "local", "```mermaid\nflowchart LR\n Start --> Finish\n```");
  await expect(host.locator("[data-mdw-diagram-preview] svg")).toBeVisible({ timeout: 20_000 });
  expect(engines().filter(url => url.includes("mermaid-engine"))).toHaveLength(1);
  expect(engines().some(url => url.includes("plantuml-frame"))).toBe(false);

  const source = "@startuml\nAlice -> Bob: Hello\n@enduml";
  await resetEditor(labPage, "local", `\`\`\`plantuml\n${source}\n\`\`\`\n\nAfter`);
  const shell = host.locator('[data-mdw-diagram-kind="plantuml"]');
  await expect(shell.locator("[data-mdw-diagram-preview] svg")).toBeVisible({ timeout: 20_000 });
  await expect(shell.locator("[data-mdw-diagram-preview]")).toContainText("Hello");
  expect(engines().filter(url => url.includes("plantuml-frame"))).toHaveLength(1);

  await shell.getByRole("button", { name: "Show diagram source", exact: true }).click();
  const target = (await getDiagramSnapshot(labPage, "local")).nodes[0]!;
  const anchor = target.position + 1 + source.indexOf("Hello");
  await focusEditor(labPage, "local", { anchor, head: anchor + 5 });
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(labPage);
    await cdp.send("Input.insertText", { text: "Updated" });
    await cdp.detach();
  } else await labPage.keyboard.insertText("Updated");
  expect(await getMarkdown(labPage, "local")).toContain("Alice -> Bob: Updated");
  await host.locator("p").last().click();
  await shell.getByRole("button", { name: "Show diagram preview", exact: true }).click();
  await expect(shell.locator("[data-mdw-diagram-preview]")).toContainText("Updated", { timeout: 20_000 });
  await labPage.screenshot({ path: testInfo.outputPath("local-plantuml.png") });
  expect(requests.every(url => new URL(url).origin === "http://127.0.0.1:4173")).toBe(true);
  await destroyEditorOnly(labPage, "local");
  await expect(labPage.locator('iframe[title="Local PlantUML rendering engine"]')).toHaveCount(0);
});

test("@required public playground supports Mermaid and PlantUML previews", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/demo");
  await page.locator("#source").fill("```mermaid\nsequenceDiagram\n Alice->>Bob: Mermaid\n```\n\n```plantuml\n@startuml\nclass User\nclass Account\nUser --> Account\n@enduml\n```");
  await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
  for (const kind of ["mermaid", "plantuml"]) {
    const shell = page.locator(`#editor [data-mdw-diagram-kind="${kind}"]`);
    await shell.scrollIntoViewIfNeeded();
    await expect(shell.locator("[data-mdw-diagram-preview] svg")).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.locator('#editor [data-mdw-diagram-kind="plantuml"] [data-mdw-diagram-preview]')).toContainText("Account");
  await page.locator(".docs-theme-picker select").selectOption("night");
  await expect(page.locator('#editor [data-mdw-diagram-kind="mermaid"] svg text tspan').first()).toHaveCSS("fill", "rgb(220, 226, 235)");
  await page.screenshot({ path: testInfo.outputPath("playground-diagrams-night.png"), fullPage: true });
});

test("@required diagram menu insertion uses shared commands and document undo", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/demo");
  for (const kind of ["Mermaid", "PlantUML"]) {
    const initial = `Before ${kind}`;
    await page.locator("#source").fill(initial);
    await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
    await page.locator("#editor .ProseMirror p").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: `Insert ${kind} diagram`, exact: true }).click();
    await expect(page.locator(`#editor [data-mdw-diagram-kind="${kind.toLowerCase()}"] svg`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#output")).toContainText(`\`\`\`${kind.toLowerCase()}`);
    await page.getByRole("button", { name: /^Undo \(/ }).click();
    await expect(page.locator("#output")).toHaveText(initial);
  }
});

test("@required invalid diagram source stays editable and recovers without uncaught errors", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo");
  for (const [kind, invalid, valid] of [
    ["mermaid", "invalid diagram !!!", "flowchart LR\nStart --> Recovered"],
    ["plantuml", "@startuml\ninvalid UML !!!\n@enduml", "Alice -> Bob: Recovered"],
    ["plantuml", "@startuml\n!include https://example.invalid/diagram.puml\nAlice -> Bob\n@enduml", "Alice -> Bob: Recovered include"],
  ]) {
    const shell = page.locator(`#editor [data-mdw-diagram-kind="${kind}"]`);
    for (const source of [invalid, valid]) {
      const markdown = `\`\`\`${kind}\n${source}\n\`\`\``;
      await page.locator("#source").fill(markdown);
      await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
      await shell.scrollIntoViewIfNeeded();
      await expect(shell).toHaveAttribute("data-mdw-diagram-state", source === invalid ? "error" : "rendered", { timeout: 20_000 });
      await expect(page.locator("#output")).toHaveText(markdown);
      if (source === invalid) await expect(shell.getByRole("button", { name: "Retry diagram preview", exact: true })).toBeVisible();
      else await expect(shell.locator("[data-mdw-diagram-preview]")).toContainText("Recovered");
    }
  }
  expect(errors).toEqual([]);
});

test("@required Mermaid families retain engine styling, references, and authored colors", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo");
  for (const [name, source] of [
    ["er", "erDiagram\n CUSTOMER ||--o{ ORDER : places"],
    ["mindmap", "mindmap\n root((Idea))\n  First\n  Second"],
    ["gantt", "gantt\n title Plan\n dateFormat YYYY-MM-DD\n section Work\n Task :a1, 2026-09-01, 5d"],
    ["authored", "flowchart LR\n 客户[Client]:::red --> 订单[Order]\n classDef red fill:#ff0000,stroke:#000000"],
  ]) {
    await page.locator("#source").fill(`\`\`\`mermaid\n${source}\n\`\`\``);
    await page.getByRole("button", { name: "Apply Markdown", exact: true }).click();
    const shell = page.locator('#editor [data-mdw-diagram-kind="mermaid"]');
    await shell.scrollIntoViewIfNeeded();
    await expect(shell).toHaveAttribute("data-mdw-diagram-state", "rendered", { timeout: 20_000 });
    if (name === "er") await expect(shell.locator(".edgePaths path").first()).not.toHaveCSS("stroke", "none");
    if (name === "authored") await expect(shell.locator(".red rect").first()).toHaveCSS("fill", "rgb(255, 0, 0)");
    await page.locator(".docs-theme-picker select").selectOption("night");
    if (name === "authored") await expect(shell.locator(".red rect").first()).toHaveCSS("fill", "rgb(255, 0, 0)");
    await shell.screenshot({ path: testInfo.outputPath(`mermaid-${name}.png`) });
  }
  expect(errors).toEqual([]);
});
