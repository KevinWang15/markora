import { builtInThemes, createThemeController, defineTheme, type MarkdownTheme } from "../src/themes";

const brand: MarkdownTheme = defineTheme({
  id: "brand",
  label: "Brand",
  extends: "night",
  tokens: { "--mdw-document-font-size": "18px", "--mdw-color-accent": "#b9d9c2" },
});
const controller = createThemeController({
  element: document.createElement("section"),
  themes: [...builtInThemes, brand],
  initialTheme: brand.id,
});
controller.setTheme("github");
controller.subscribe(() => { const theme: MarkdownTheme = controller.getSnapshot(); void theme; });
// @ts-expect-error Themes only accept namespaced editor tokens.
defineTheme({ id: "invalid", label: "Invalid", tokens: { color: "red" } });
// @ts-expect-error Reference theme names are checked.
defineTheme({ id: "invalid", label: "Invalid", extends: "missing" });
controller.destroy();
