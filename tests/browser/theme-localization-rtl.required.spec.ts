import {
  editorLocator,
  expect,
  getMarkdown,
  mountEditor,
  ownedOverlay,
  settleEditor,
  test,
} from "./fixtures";

const ARABIC_CORE_MESSAGES = {
  imageBlockedByPolicy: "حُجبت الصورة وفق سياسة الموارد",
} as const;

const ARABIC_UI_MESSAGES = {
  cancelButtonLabel: "إلغاء",
  linkDialogLabel: "تحرير الرابط",
  linkUrlInputLabel: "عنوان الرابط",
  linkUrlInputPlaceholder: "https://example.com",
  removeButtonLabel: "إزالة",
  saveButtonLabel: "حفظ",
  unlinkButtonLabel: "إلغاء الرابط",
} as const;

async function openLocalizedLinkEditor(
  page: Parameters<typeof editorLocator>[0],
  id: string,
  text = "رابط",
) {
  const selected = await page.evaluate(
    ({ editorId, linkText }) => (
      window.__MARKORA_BROWSER_LAB__!.selectText(editorId, linkText, "start")
    ),
    { editorId: id, linkText: text },
  );
  expect(selected).toBe(true);

  const opened = await page.evaluate(
    (editorId) => window.__MARKORA_BROWSER_LAB__!.openUi(editorId, "link"),
    id,
  );
  expect(opened).toBe(true);

  const overlay = ownedOverlay(page, id, ".mdw-link-editor");
  await expect(overlay).toBeVisible();
  return overlay;
}

for (const root of ["document", "shadow"] as const) {
  test(`@required localizes, themes, and preserves physical RTL behavior in a ${root} embed`, async ({ labPage }) => {
    const id = `rtl-${root}`;
    const portal = root === "document" ? "body" : "default";
    await labPage.evaluate(() => {
      document.body.dataset.mdwTheme = "light";
    });
    await mountEditor(labPage, {
      direction: "rtl",
      id,
      language: "ar",
      markdown: [
        "> اقتباس",
        "",
        "**אבג** ونص [رابط](#قبل).",
        "",
        "![صورة](https://assets.invalid/image.png)",
      ].join("\n"),
      messages: ARABIC_CORE_MESSAGES,
      motion: "reduce",
      portal,
      resourceMode: "deny-images",
      root,
      theme: "dark",
      uiMessages: ARABIC_UI_MESSAGES,
    });

    const editor = editorLocator(labPage, id);
    const frame = labPage.locator(`[data-e2e-frame="${id}"]`);
    await expect(editor).toBeVisible();
    await expect(editor.locator(".mdw-image-status-text")).toHaveText(
      "حُجبت الصورة وفق سياسة الموارد",
    );

    const editorEnvironment = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      const quoteStyle = getComputedStyle(element.querySelector("blockquote")!);
      return {
        background: style.backgroundColor,
        color: style.color,
        direction: style.direction,
        quoteBorderLeft: quoteStyle.borderLeftWidth,
        quoteBorderRight: quoteStyle.borderRightWidth,
      };
    });
    expect(editorEnvironment).toEqual({
      background: "rgb(13, 17, 23)",
      color: "rgb(230, 237, 243)",
      direction: "rtl",
      quoteBorderLeft: "0px",
      quoteBorderRight: "3px",
    });

    await frame.evaluate((element) => {
      (element as HTMLElement).style.setProperty("--mdw-ui-overlay-radius", "19px");
    });
    const overlay = await openLocalizedLinkEditor(labPage, id);
    await expect(overlay).toHaveAccessibleName("تحرير الرابط");
    await expect(overlay.getByLabel("عنوان الرابط")).toBeFocused();
    await expect(overlay.getByRole("button", { name: "حفظ" })).toBeVisible();
    await expect(overlay.getByRole("button", { exact: true, name: "إلغاء" })).toBeVisible();
    await expect(overlay).toHaveAttribute("dir", "rtl");
    await expect(overlay).toHaveAttribute("lang", "ar");
    await expect(overlay).toHaveAttribute("data-mdw-theme", "dark");
    await expect(overlay).toHaveAttribute("data-mdw-motion", "reduce");

    const overlayEnvironment = await overlay.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderRadius: style.borderRadius,
        direction: style.direction,
        spinnerAnimation: style.getPropertyValue("--mdw-spinner-animation").trim(),
      };
    });
    expect(overlayEnvironment).toEqual({
      background: "rgb(13, 17, 23)",
      borderRadius: "19px",
      direction: "rtl",
      spinnerAnimation: "none",
    });

    const [linkBox, overlayBox] = await Promise.all([
      editor.locator("a").boundingBox(),
      overlay.boundingBox(),
    ]);
    expect(linkBox).not.toBeNull();
    expect(overlayBox).not.toBeNull();
    expect(Math.abs((overlayBox!.x + overlayBox!.width) - (linkBox!.x + linkBox!.width)))
      .toBeLessThanOrEqual(3);

    await frame.evaluate((element) => {
      (element as HTMLElement).dataset.mdwTheme = "contrast";
    });
    await expect(overlay).toHaveAttribute("data-mdw-theme", "contrast");
    await expect.poll(() => editor.evaluate((element) => getComputedStyle(element).borderRightWidth))
      .toBe("2px");
    await expect.poll(() => overlay.evaluate((element) => ({
      borderWidth: getComputedStyle(element).borderRightWidth,
      shadow: getComputedStyle(element).boxShadow,
    }))).toEqual({ borderWidth: "2px", shadow: "none" });

    await frame.evaluate((element) => {
      (element as HTMLElement).dir = "ltr";
      element.setAttribute("lang", "");
    });
    await expect(overlay).toHaveAttribute("dir", "ltr");
    await expect(overlay).toHaveAttribute("lang", "");
    await expect.poll(async () => {
      const [nextLinkBox, nextOverlayBox] = await Promise.all([
        editor.locator("a").boundingBox(),
        overlay.boundingBox(),
      ]);
      return nextLinkBox && nextOverlayBox
        ? Math.abs(nextOverlayBox.x - (nextLinkBox.x + nextLinkBox.width))
        : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(3);

    await frame.evaluate((element) => {
      (element as HTMLElement).dir = "rtl";
      (element as HTMLElement).lang = "ar";
    });
    await expect(overlay).toHaveAttribute("dir", "rtl");

    await overlay.getByRole("button", { exact: true, name: "إلغاء" }).click();
    await expect(overlay).toBeHidden();

    const selectedStrong = await labPage.evaluate(
      (editorId) => window.__MARKORA_BROWSER_LAB__!.selectText(editorId, "אבג", "start"),
      id,
    );
    expect(selectedStrong).toBe(true);
    await labPage.keyboard.press("ArrowRight");
    await labPage.keyboard.type("X");
    await settleEditor(labPage, id);
    expect(await getMarkdown(labPage, id)).toContain("X**אבג**");
  });
}

test("@required the automatic reference theme and reduced-motion fallback follow user media preferences", async ({
  browserName,
  labPage,
}) => {
  const id = "automatic-theme";
  const cdp = browserName === "chromium"
    ? await labPage.context().newCDPSession(labPage)
    : null;
  if (cdp) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "dark" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
  } else {
    await labPage.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  }
  await mountEditor(labPage, {
    id,
    markdown: "[אבג](#theme)\n\n- [x] Task",
    theme: "auto",
  });

  const editor = editorLocator(labPage, id);
  const host = labPage.locator(`[data-e2e-host="${id}"]`);
  await expect.poll(() => editor.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(13, 17, 23)");
  const rtlOverlay = await openLocalizedLinkEditor(labPage, id, "אבג");
  await expect(rtlOverlay).toHaveAttribute("dir", "rtl");
  await rtlOverlay.getByRole("button", { exact: true, name: "Cancel" }).click();
  await labPage.evaluate((editorId) => {
    window.__MARKORA_BROWSER_LAB__!.reset(
      editorId,
      "[Automatic theme](#theme)\n\n- [x] Task",
    );
  }, id);
  await settleEditor(labPage, id);
  const expectedAutoDirection = await editor.evaluate((element) => (
    getComputedStyle(element).direction
  ));
  if (browserName !== "webkit") {
    expect(expectedAutoDirection).toBe("ltr");
  }
  const overlay = await openLocalizedLinkEditor(labPage, id, "Automatic theme");
  await expect(overlay).toHaveAttribute("dir", expectedAutoDirection);
  await expect.poll(() => overlay.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe("none");
  expect(await host.evaluate((element) => {
    const probe = document.createElement("span");
    probe.className = "mdw-image-spinner";
    element.append(probe);
    const animationName = getComputedStyle(probe).animationName;
    probe.remove();
    return animationName;
  })).toBe("none");

  if (cdp) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-reduced-motion", value: "no-preference" },
      ],
    });
  } else {
    await labPage.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  }
  await expect.poll(() => editor.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(255, 255, 255)");

  if (cdp) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "forced-colors", value: "active" },
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-reduced-motion", value: "no-preference" },
      ],
    });
  } else {
    await labPage.emulateMedia({
      colorScheme: "light",
      forcedColors: "active",
      reducedMotion: "no-preference",
    });
  }
  await expect.poll(() => labPage.evaluate(() => (
    matchMedia("(forced-colors: active)").matches
  ))).toBe(true);
  // WebKit can emulate the media query on macOS but does not apply a Windows
  // forced-colors presentation. Chromium and Firefox exercise the shipped
  // overrides; WebKit retains the platform-capability boundary explicitly.
  if (browserName === "webkit") {
    await expect.poll(() => overlay.evaluate((element) => (
      getComputedStyle(element).boxShadow === "none"
    ))).toBe(false);
  } else {
    await expect.poll(async () => ({
      shadowRemoved: await overlay.evaluate((element) => (
        getComputedStyle(element).boxShadow === "none"
      )),
      taskAdjustment: await editor.locator(".mdw-task-checkbox").evaluate((element) => (
        getComputedStyle(element, "::before").forcedColorAdjust
      )),
    })).toEqual({ shadowRemoved: true, taskAdjustment: "none" });
  }
  await cdp?.detach();
});
