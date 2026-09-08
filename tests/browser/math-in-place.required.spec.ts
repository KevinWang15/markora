import {
  expect,
  test,
  mountEditor,
  editorLocator,
  getMarkdown,
  updateEditorOptions,
  reconcileEditor,
} from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

for (const root of ["document", "shadow"] as const) {
  test(`@required in-place math in ${root} DOM respects composition, replacement and read-only state`, async ({
    labPage,
  }) => {
    const id = `math-input-${root}`;
    await mountEditor(labPage, {
      id,
      root,
      extensionMode: "math",
      mathEditMode: "in-place",
      mathRendererMode: "sync",
      markdown: "Before $x$ after.",
    });
    const editor = editorLocator(labPage, id);
    const formula = editor.locator(".mdw-math");
    await formula.focus();
    await formula.press("Enter");
    const input = editor.getByRole("textbox", {
      name: "LaTeX source",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.dispatchEvent("compositionstart");
    await input.evaluate(element => {
      const textarea = element as HTMLTextAreaElement;
      textarea.value = "中文";
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    });
    await input.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    expect(await getMarkdown(labPage, id)).toBe("Before $x$ after.");
    await expect(input).toBeFocused();
    await input.dispatchEvent("compositionend");
    await expect
      .poll(() => getMarkdown(labPage, id))
      .toBe("Before $中文$ after.");
    await reconcileEditor(labPage, id, "Replacement $y$.");
    await expect(input).toHaveCount(0);
    await formula.click();
    await expect(input).toHaveValue("y");
    await updateEditorOptions(labPage, id, { editable: false });
    await expect(input).toHaveCount(0);
    await formula.click();
    await expect(input).toHaveCount(0);
    expect(await getMarkdown(labPage, id)).toBe("Replacement $y$.");
  });
}

test("@required highlighted math source has accessible labeling and keeps native clipboard ownership", async ({
  labPage,
}) => {
  const id = "accessible-math-input";
  await mountEditor(labPage, {
    id,
    extensionMode: "math",
    mathEditMode: "in-place",
    mathRendererMode: "sync",
    theme: "github",
    markdown: "$$\nx^2\n$$",
  });
  const editor = editorLocator(labPage, id);
  await editor.locator(".mdw-math").click();
  const input = editor.getByRole("textbox", {
    name: "LaTeX source",
    exact: true,
  });
  await expect(input).toBeFocused();
  const results = await new AxeBuilder({ page: labPage })
    .include(".mdw-math")
    .analyze();
  expect(results.violations).toEqual([]);
  await input.press("Shift+F10");
  await expect(
    labPage.getByRole("menu", { name: "Editor context menu", exact: true }),
  ).toHaveCount(0);
});
