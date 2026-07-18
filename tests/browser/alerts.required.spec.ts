import AxeBuilder from "@axe-core/playwright";
import {
  copyEditorSelection,
  dispatchTransfer,
  editorLocator,
  expect,
  focusEditor,
  getAlertsSnapshot,
  getAlertsState,
  getExtensionSnapshot,
  getMarkdown,
  mountEditor,
  reconcileEditor,
  resetEditor,
  runAlertsCommand,
  runEditorCommand,
  settleEditor,
  snapshotEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

const PARITY_SOURCE = [
  "> [!note]",
  "> Note body.",
  ">",
  "> - Parent item",
  ">   - Nested item",
  "",
  ">\t[!tIp]\t",
  "> Tip body.",
  "",
  "> [!IMPORTANT]",
  "> > Nested quote.",
  "",
  "> [!warning]",
  "",
  "> [!caution]",
  "> ```text",
  "> safe code",
  "> ```",
  "",
  "> Ordinary quote.",
  "",
  "> [!UNKNOWN]",
  "> Unknown stays quoted.",
  "",
  "> [!NOTE] trailing",
  "> Trailing content stays quoted.",
  "",
  "> \\[!NOTE]",
  "> Escaped marker stays quoted.",
  "",
  "> **[!NOTE]**",
  "> Styled marker stays quoted.",
  "",
  ":::note",
  "Directive syntax is not an alert.",
  ":::",
].join("\n");

test("@required alerts round-trip all kinds and preserve negatives in root and minimal embeds", async ({
  labPage,
}) => {
  for (const [id, entry, root] of [
    ["alerts-root-document", "root", "document"],
    ["alerts-minimal-shadow", "minimal", "shadow"],
  ] as const) {
    await mountEditor(labPage, {
      entry,
      extensionMode: "alerts",
      id,
      markdown: PARITY_SOURCE,
      root,
    });

    const editor = editorLocator(labPage, id);
    const alerts = editor.locator(":scope > [data-mdw-alert]");
    await expect(alerts).toHaveCount(5);
    await expect(editor.locator(":scope > blockquote")).toHaveCount(5);
    await expect(alerts.nth(0).locator("[data-mdw-alert-body]")).toContainText(
      "Nested item",
    );
    await expect(alerts.nth(2).locator("blockquote")).toContainText(
      "Nested quote.",
    );
    await expect(alerts.nth(3).locator("[data-mdw-alert-body] > p")).toBeEmpty();
    await expect(alerts.nth(4).locator("pre")).toContainText("safe code");

    const snapshot = await getAlertsSnapshot(labPage, id);
    expect(snapshot.alerts.map(({ kind }) => kind)).toEqual([
      "note",
      "tip",
      "important",
      "warning",
      "caution",
    ]);
    expect((await getExtensionSnapshot(labPage, id)).manifest).toContainEqual({
      name: "markora-extension-alerts",
      version: "0.0.1",
    });

    const canonical = await getMarkdown(labPage, id);
    for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      expect(canonical).toContain(`> [!${kind}]`);
    }
    expect(canonical).toContain("> \\[!UNKNOWN\\]");
    expect(canonical).toContain("Directive syntax is not an alert.");
    expect(await resetEditor(labPage, id, canonical)).toBe(canonical);
    expect(
      (await getAlertsSnapshot(labPage, id)).alerts.map(({ kind }) => kind),
    ).toEqual(snapshot.alerts.map(({ kind }) => kind));

    const reconciled = await reconcileEditor(
      labPage,
      id,
      canonical.replace("> [!WARNING]", "> [!WARNING]\n> Reconciled warning body."),
    );
    expect(reconciled.changed).toBe(true);
    await expect(
      editor.locator('[data-mdw-alert-kind="warning"]'),
    ).toContainText("Reconciled warning body.");
  }
});

test("@required alert commands preserve content and are guarded, stateful, and one-step undoable", async ({
  labPage,
}) => {
  const id = "alerts-commands";
  await mountEditor(labPage, {
    extensionMode: "alerts",
    id,
    markdown: "Alpha paragraph.\n\nBeta paragraph.",
  });

  expect(
    await labPage.evaluate(
      (editorId) =>
        window.__MARKORA_BROWSER_LAB__!.selectText(
          editorId,
          "Alpha paragraph.",
        ),
      id,
    ),
  ).toBe(true);
  expect(
    await getAlertsState(labPage, id, { kind: "tip", type: "canWrap" }),
  ).toBe(true);
  expect(
    await runAlertsCommand(labPage, id, { kind: "tip", type: "wrap" }),
  ).toBe(true);
  await settleEditor(labPage, id);
  expect((await getAlertsSnapshot(labPage, id)).active?.kind).toBe("tip");
  expect(await getAlertsState(labPage, id, { type: "isActive" })).toBe(true);
  expect(await getAlertsState(labPage, id, { type: "canUnwrap" })).toBe(true);
  await expect(
    editorLocator(labPage, id).locator("[data-mdw-alert-body]"),
  ).toContainText("Alpha paragraph.");

  const beforeNoop = await snapshotEditor(labPage, id);
  expect(
    await runAlertsCommand(labPage, id, { kind: "tip", type: "setKind" }),
  ).toBe(false);
  expect(await snapshotEditor(labPage, id)).toEqual(beforeNoop);

  expect(
    await getAlertsState(labPage, id, { kind: "warning", type: "canSetKind" }),
  ).toBe(true);
  expect(
    await runAlertsCommand(labPage, id, { kind: "warning", type: "setKind" }),
  ).toBe(true);
  expect(await getMarkdown(labPage, id)).toContain("> [!WARNING]");
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toContain("> [!TIP]");
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);

  const editor = editorLocator(labPage, id);
  await editor.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", {
        bubbles: true,
        composed: true,
      }),
    );
  });
  expect(
    await runAlertsCommand(labPage, id, { kind: "important", type: "setKind" }),
  ).toBe(false);
  expect(await runAlertsCommand(labPage, id, { type: "unwrap" })).toBe(false);
  await editor.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        composed: true,
      }),
    );
  });

  await updateEditorOptions(labPage, id, { editable: false });
  const readOnlyMarkdown = await getMarkdown(labPage, id);
  expect(
    await runAlertsCommand(labPage, id, { kind: "caution", type: "setKind" }),
  ).toBe(false);
  expect(await runAlertsCommand(labPage, id, { type: "unwrap" })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe(readOnlyMarkdown);

  await updateEditorOptions(labPage, id, { editable: true });
  expect(await runAlertsCommand(labPage, id, { type: "toggle" })).toBe(true);
  expect((await getAlertsSnapshot(labPage, id)).alerts).toEqual([]);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect((await getAlertsSnapshot(labPage, id)).alerts[0]?.kind).toBe(
    "warning",
  );
  expect(await runAlertsCommand(labPage, id, { type: "unwrap" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(
    "Alpha paragraph.\n\nBeta paragraph.",
  );
});

test("@required alert Markdown and rich clipboard data paste back semantically", async ({
  labPage,
}) => {
  const id = "alerts-clipboard";
  await mountEditor(labPage, {
    extensionMode: "alerts",
    id,
    initialSelection: "all",
    markdown: "> [!warning]\n> Clipboard **body**.",
  });

  const canonical = await getMarkdown(labPage, id);
  const copied = await copyEditorSelection(labPage, id);
  expect(copied.defaultPrevented).toBe(true);
  expect(copied.markdown).toBe(canonical);
  expect(copied.plain).toContain("[!WARNING]");
  expect(copied.html).toContain('data-mdw-alert-kind="warning"');
  expect(copied.html).toContain("data-mdw-alert-body");

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  expect(
    await runEditorCommand(labPage, id, {
      text: copied.markdown,
      type: "pasteMarkdown",
    }),
  ).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe(canonical);
  expect((await getAlertsSnapshot(labPage, id)).alerts[0]?.kind).toBe(
    "warning",
  );

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  const richPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: copied.html,
    plain: copied.plain,
  });
  expect(richPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect((await getAlertsSnapshot(labPage, id)).alerts[0]?.kind).toBe(
    "warning",
  );
  await expect(
    editorLocator(labPage, id).locator("[data-mdw-alert-body] strong"),
  ).toHaveText("body");

  expect(
    await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "body"),
      id,
    ),
  ).toBe(true);
  const partial = await copyEditorSelection(labPage, id);
  expect(partial.markdown).toBe("**body**");
  expect(partial.plain).toBe("body");
  expect(partial.html).toContain("<strong>body</strong>");
  expect(partial.html).not.toContain("data-mdw-alert");

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  expect(
    await runEditorCommand(labPage, id, {
      text: copied.markdown,
      type: "pastePlainText",
    }),
  ).toBe(true);
  expect((await getAlertsSnapshot(labPage, id)).alerts).toEqual([]);
});

test("@required localized RTL alerts expose visible kind text, editable content, and accessible UI", async ({
  labPage,
}) => {
  const id = "alerts-rtl-localized";
  await mountEditor(labPage, {
    alertsMessages: {
      alertLabel: "تنبيه مخصص",
      cautionKindLabel: "حذر",
      importantKindLabel: "مهم",
      invalidDocumentDiagnostic: "تنبيه غير صالح",
      noteKindLabel: "ملاحظة",
      tipKindLabel: "نصيحة",
      toggleAlert: "تبديل التنبيه",
      warningKindLabel: "تحذير",
    },
    direction: "rtl",
    extensionMode: "alerts",
    id,
    language: "ar",
    markdown: "> [!WARNING]\n> نص قابل للتحرير.",
    motion: "reduce",
    root: "shadow",
    theme: "contrast",
  });

  const editor = editorLocator(labPage, id);
  const alert = editor.getByRole("note", { name: "تنبيه مخصص" });
  await expect(alert).toBeVisible();
  await expect(alert.locator("[data-mdw-alert-header]")).toHaveText("تحذير");
  await expect(alert.locator("[data-mdw-alert-header]")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  const environment = await alert.evaluate((element) => {
    const alertStyle = getComputedStyle(element);
    const header = element.querySelector<HTMLElement>(
      "[data-mdw-alert-header]",
    )!;
    const body = element.querySelector<HTMLElement>("[data-mdw-alert-body]")!;
    return {
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      direction: alertStyle.direction,
      headerText: header.textContent,
      leftBorder: alertStyle.borderLeftWidth,
      rightBorder: alertStyle.borderRightWidth,
    };
  });
  expect(environment).toMatchObject({
    direction: "rtl",
    headerText: "تحذير",
    leftBorder: "0px",
    rightBorder: "4px",
  });
  expect(environment.bodyScrollWidth).toBeLessThanOrEqual(
    environment.bodyClientWidth,
  );

  expect(
    await labPage.evaluate(
      (editorId) =>
        window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "للتحرير.", "end"),
      id,
    ),
  ).toBe(true);
  await labPage.keyboard.type(" الآن");
  await settleEditor(labPage, id);
  await expect(alert.locator("[data-mdw-alert-body]")).toContainText(
    "للتحرير. الآن",
  );

  const action = labPage.getByRole("button", { name: "تبديل التنبيه" });
  await expect(action).toBeEnabled();
  await updateEditorOptions(labPage, id, { editable: false });
  await expect(action).toBeDisabled();
  await expect(alert).toHaveAccessibleName("تنبيه مخصص");

  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);
});

test("@required Chromium CDP edits alert content and copies canonical semantic data", async ({
  browserName,
  context,
  labPage,
}) => {
  test.skip(
    browserName !== "chromium",
    "Chromium is the only Playwright engine exposing CDP input commands.",
  );

  const id = "alerts-cdp";
  await mountEditor(labPage, {
    extensionMode: "alerts",
    id,
    markdown: "> [!TIP]\n> CDP body.",
  });
  expect(
    await labPage.evaluate(
      (editorId) =>
        window.__MARKORA_BROWSER_LAB__!.selectText(
          editorId,
          "CDP body.",
          "end",
        ),
      id,
    ),
  ).toBe(true);

  const cdp = await context.newCDPSession(labPage);
  try {
    await cdp.send("Input.insertText", { text: " updated" });
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toContain("CDP body. updated");

    await focusEditor(labPage, id, "all");
    await labPage.evaluate((editorId) => {
      const section = document.querySelector(
        `[data-e2e-editor="${editorId}"]`,
      )!;
      const targetWindow = window as typeof window & {
        __markoraAlertsCdpCopy?: {
          html: string;
          markdown: string;
          plain: string;
        };
      };
      delete targetWindow.__markoraAlertsCdpCopy;
      section.addEventListener(
        "copy",
        (rawEvent) => {
          const transfer = (rawEvent as ClipboardEvent).clipboardData;
          targetWindow.__markoraAlertsCdpCopy = {
            html: transfer?.getData("text/html") ?? "",
            markdown: transfer?.getData("text/markdown") ?? "",
            plain: transfer?.getData("text/plain") ?? "",
          };
        },
        { once: true },
      );
    }, id);
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      commands: ["Copy"],
      key: "c",
      modifiers: 2,
      type: "keyDown",
      windowsVirtualKeyCode: 67,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "KeyC",
      key: "c",
      modifiers: 2,
      type: "keyUp",
      windowsVirtualKeyCode: 67,
    });
  } finally {
    await cdp.detach();
  }

  const copied = await labPage.evaluate(
    () =>
      (
        window as typeof window & {
          __markoraAlertsCdpCopy?: {
            html: string;
            markdown: string;
            plain: string;
          };
        }
      ).__markoraAlertsCdpCopy,
  );
  expect(copied?.markdown).toContain("> [!TIP]");
  expect(copied?.markdown).toContain("CDP body. updated");
  expect(copied?.plain).toContain("[!TIP]");
  expect(copied?.html).toContain('data-mdw-alert-kind="tip"');
});
