/** A resolved appearance snapshot, independent of the live editor and system preference. */
export type ExportTheme = Readonly<{
  id: string;
  declarations: string;
  pageDeclarations: string;
}>;

export function captureExportTheme(element: HTMLElement, id: string): ExportTheme {
  const doc = element.ownerDocument;
  const computed = doc.defaultView!.getComputedStyle(element);
  const declarations = doc.createElement("span").style;
  for (let index = 0; index < computed.length; index++) {
    const name = computed.item(index);
    if (name.startsWith("--mdw-")) declarations.setProperty(name, computed.getPropertyValue(name));
  }
  // CSS-wide initial tokens are absent from computed-style enumeration. Clear
  // these optional export roles explicitly so later host themes cannot leak in.
  for (const name of ["--mdw-heading-font-family", "--mdw-font-mono",
    "--mdw-heading-3-font-size", "--mdw-heading-4-font-size", "--mdw-heading-5-font-size", "--mdw-heading-6-font-size"]) {
    if (!computed.getPropertyValue(name)) declarations.setProperty(name, "initial");
  }
  // Neutral themes inherit typography from the app. Capture that fallback too,
  // including when the rich editor is hidden while exporting from source mode.
  declarations.setProperty("--export-font-family", computed.fontFamily);
  declarations.setProperty("--export-font-size", computed.fontSize);
  declarations.setProperty("--export-line-height", computed.lineHeight);
  declarations.setProperty("direction", computed.direction);
  const schemes = computed.colorScheme.split(/\s+/u);
  const colorScheme = schemes.includes("dark") && (!schemes.includes("light")
    || doc.defaultView!.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  declarations.setProperty("--mdw-color-scheme", colorScheme);
  const page = doc.createElement("span").style;
  // The app's editable canvas is transparent; the theme surface owns the paper color.
  page.setProperty("background-color", computed.getPropertyValue("--mdw-color-surface") || "white", "important");
  page.setProperty("color-scheme", colorScheme, "important");
  return Object.freeze({ id, declarations: declarations.cssText, pageDeclarations: page.cssText });
}
