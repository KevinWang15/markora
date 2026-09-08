import { chromiumTest,
  dispatchTransfer,
  editorLocator,
  expect,
  getEditorEvents,
  getMarkdown,
  mountEditor,
  settleEditor,
  test,
} from "./fixtures";

test("@required host uploads are ordered, observable, and one undo step", async ({ labPage }) => {
  const id = "asset-upload";
  await mountEditor(labPage, {
    id,
    initialSelection: "end",
    markdown: "",
    resourceMode: "immediate-upload",
  });

  const result = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: "<strong>must not accompany files</strong>",
    markdown: "**must not accompany files**",
    plain: "must not accompany files",
    files: [
      { contents: "first", name: "first.txt", type: "text/plain" },
      { contents: "second", name: "second.txt", type: "text/plain" },
    ],
  });
  expect(result.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);

  expect(await getMarkdown(labPage, id)).toBe(
    "[first.txt](/uploads/first.txt)[second.txt](/uploads/second.txt)",
  );
  const events = await getEditorEvents(labPage, id);
  expect(events.log.filter(({ type }) => type === "asset").map((event) => ({
    fileName: event.fileName,
    progress: event.progress,
    reason: event.reason,
    status: event.status,
  }))).toEqual([
    { fileName: "first.txt", progress: null, reason: "started", status: "uploading" },
    { fileName: "first.txt", progress: 0.5, reason: "progress", status: "uploading" },
    { fileName: "second.txt", progress: null, reason: "started", status: "uploading" },
    { fileName: "second.txt", progress: 0.5, reason: "progress", status: "uploading" },
    { fileName: "first.txt", progress: 1, reason: "completed", status: "completed" },
    { fileName: "second.txt", progress: 1, reason: "completed", status: "completed" },
  ]);

  const resourceLog = await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.resourceLog(editorId),
    id,
  );
  expect(resourceLog.uploads).toEqual([
    { fileName: "first.txt", source: "paste" },
    { fileName: "second.txt", source: "paste" },
  ]);

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "undo" }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("");

  expect(await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.command(editorId, { type: "redo" }),
    id,
  )).toBe(true);
  await settleEditor(labPage, id);
  expect((await labPage.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.resourceLog(editorId),
    id,
  )).uploads).toHaveLength(2);
});

test("@required resource protocol policy is isolated per editor and opening is host-owned", async ({ labPage }) => {
  await mountEditor(labPage, {
    id: "custom-resources",
    markdown: "[custom](acme:document/42) [web](https://example.com)",
    resourceMode: "custom-protocol",
  });
  await mountEditor(labPage, {
    id: "default-resources",
    markdown: "[custom](acme:document/42) [web](https://example.com)",
  });

  expect(await getMarkdown(labPage, "custom-resources")).toBe(
    "[custom](acme:document/42) web",
  );
  expect(await getMarkdown(labPage, "default-resources")).toBe(
    "custom [web](https://example.com/)",
  );

  const customLink = editorLocator(labPage, "custom-resources").locator("a");
  expect(await customLink.evaluate((anchor) => {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: true,
    });
    anchor.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  const log = await labPage.evaluate(
    () => window.__MARKORA_BROWSER_LAB__!.resourceLog("custom-resources"),
  );
  expect(log.opens).toEqual([{
    kind: "link",
    storedUrl: "acme:document/42",
    url: "acme:document/42",
  }]);
});

chromiumTest("@required Chromium CDP observes proxy-only image loading", async ({ context, labPage }) => {

  const proxyPath = "/__markora_resource_proxy.png";
  await labPage.route(`**${proxyPath}`, async (route) => {
    await route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z"/></svg>',
      contentType: "image/svg+xml",
      status: 200,
    });
  });

  const cdp = await context.newCDPSession(labPage);
  const requestedUrls: string[] = [];
  cdp.on("Network.requestWillBeSent", ({ request }) => {
    requestedUrls.push(request.url);
  });
  await cdp.send("Network.enable");

  const storedUrl = "https://private.invalid/original.png";
  await mountEditor(labPage, {
    id: "proxy-image",
    markdown: `![private](${storedUrl})`,
    resourceMode: "proxy-images",
  });
  await expect(editorLocator(labPage, "proxy-image").locator(".mdw-image img")).toHaveAttribute(
    "referrerpolicy",
    "no-referrer",
  );
  await settleEditor(labPage, "proxy-image");

  expect(requestedUrls.filter((url) => url === storedUrl)).toEqual([]);
  expect(requestedUrls.filter((url) => new URL(url).pathname === proxyPath)).toHaveLength(1);
  const log = await labPage.evaluate(
    () => window.__MARKORA_BROWSER_LAB__!.resourceLog("proxy-image"),
  );
  expect(log.loads).toEqual([{ storedUrl, url: proxyPath }]);
  expect(log.resolutions).toContainEqual({ kind: "image", purpose: "load", url: storedUrl });

  await cdp.send("Network.disable");
  await cdp.detach();
});
