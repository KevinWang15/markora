import { afterEach, describe, expect, it, vi } from "vitest";
import { builtInThemes, createThemeController, defineTheme, type MarkdownThemeController } from "../src/themes";

const controllers: MarkdownThemeController[] = [];
function scope() {
  const element = document.createElement("section");
  document.body.append(element);
  return element;
}
function create(options: Parameters<typeof createThemeController>[0]) {
  const controller = createThemeController(options);
  controllers.push(controller);
  return controller;
}
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.destroy());
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

describe("theme definitions and scoped lifecycle", () => {
  it("derives immutable custom themes without changing their parent or caller tokens", () => {
    const tokens = { "--mdw-color-accent": "purple" };
    const parent = defineTheme({ id: "brand", label: "Brand", extends: "night", tokens });
    const child = defineTheme({ id: "brand-large", label: "Large", extends: parent, tokens: { "--mdw-document-font-size": "20px" } });
    tokens["--mdw-color-accent"] = "red";
    expect(child.cssTheme).toBe("night");
    expect(child.colorScheme).toBe("dark");
    expect(child.tokens).toEqual({ "--mdw-color-accent": "purple", "--mdw-document-font-size": "20px" });
    expect(parent.tokens).toEqual({ "--mdw-color-accent": "purple" });
    expect(Object.isFrozen(child)).toBe(true);
    expect(Object.isFrozen(child.tokens)).toBe(true);
  });

  it.each(["", "Uppercase", "has spaces", 'bad\"] {}'])("rejects invalid theme id %j", id => {
    expect(() => defineTheme({ id, label: "Theme" })).toThrow(TypeError);
  });

  it("validates definitions and the whole catalog before taking ownership", () => {
    expect(() => defineTheme({ id: "bad", label: " " })).toThrow(TypeError);
    expect(() => defineTheme({ id: "bad", label: "Bad", tokens: { color: "red" } as never })).toThrow(TypeError);
    expect(() => defineTheme({ id: "bad", label: "Bad", tokens: { "--mdw-color-accent": "" } })).toThrow(TypeError);
    const element = scope();
    element.dataset.mdwTheme = "sepia";
    expect(() => createThemeController({ element, themes: [...builtInThemes, builtInThemes[0]] })).toThrow(/Duplicate/);
    expect(() => createThemeController({ element, initialTheme: "missing" })).toThrow(/Unknown initial/);
    expect(element.dataset.mdwTheme).toBe("sepia");
    expect(create({ element }).getSnapshot().id).toBe("auto");
  });

  it("switches independent scopes, clears custom overrides, and restores owned state", () => {
    const element = scope();
    const other = scope();
    element.className = "host mdw-theme-dark";
    element.dataset.mdwTheme = "dark";
    element.style.setProperty("--mdw-color-accent", "red", "important");
    const custom = defineTheme({ id: "brand", label: "Brand", extends: "github", tokens: { "--mdw-color-accent": "purple", "--mdw-document-font-size": "20px" } });
    const controller = create({ element, themes: [...builtInThemes, custom] });
    const second = create({ element: other, initialTheme: "night" });
    expect(() => createThemeController({ element })).toThrow(/already/);
    controller.setTheme("brand");
    expect(element.dataset.mdwTheme).toBe("github");
    expect(element.dataset.mdwThemeId).toBe("brand");
    expect(element.style.getPropertyValue("--mdw-color-accent")).toBe("purple");
    expect(second.getSnapshot().id).toBe("night");
    controller.setTheme("newsprint");
    expect(element.style.getPropertyValue("--mdw-document-font-size")).toBe("");
    expect(element.style.getPropertyValue("--mdw-color-accent")).toBe("red");
    expect(element.style.getPropertyPriority("--mdw-color-accent")).toBe("important");
    controller.destroy();
    controller.destroy();
    expect(element.className).toBe("host mdw-theme-dark");
    expect(element.dataset.mdwTheme).toBe("dark");
    expect(element.hasAttribute("data-mdw-theme-id")).toBe(false);
    expect(() => controller.setTheme("light")).toThrow(/destroyed/);
    expect(create({ element }).getSnapshot().id).toBe("auto");
  });

  it("preserves host changes made after the controller's last write", () => {
    const element = scope();
    const custom = defineTheme({ id: "custom", label: "Custom", tokens: { "--mdw-color-accent": "purple" } });
    const controller = create({ element, initialTheme: "custom", themes: [custom] });
    element.style.setProperty("--mdw-color-accent", "green");
    element.dataset.mdwTheme = "night";
    controller.destroy();
    expect(element.style.getPropertyValue("--mdw-color-accent")).toBe("green");
    expect(element.dataset.mdwTheme).toBe("night");
  });

  it("provides stable snapshots and notifies only on a valid selection change", () => {
    const controller = create({ element: scope() });
    const notify = vi.fn();
    const unsubscribe = controller.subscribe(notify);
    const first = controller.getSnapshot();
    controller.setTheme("auto");
    expect(controller.getSnapshot()).toBe(first);
    expect(() => controller.setTheme("missing")).toThrow(RangeError);
    expect(notify).not.toHaveBeenCalled();
    controller.setTheme("sepia");
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.setTheme("light");
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("opt-in theme preferences", () => {
  it("restores and persists valid choices, and follows storage events without echoing writes", () => {
    localStorage.setItem("theme", "sepia");
    const controller = create({ element: scope(), storageKey: "theme" });
    expect(controller.getSnapshot().id).toBe("sepia");
    controller.setTheme("night");
    expect(localStorage.getItem("theme")).toBe("night");
    const write = vi.spyOn(Storage.prototype, "setItem");
    window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "github", storageArea: localStorage }));
    expect(controller.getSnapshot().id).toBe("github");
    expect(write).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "dark", storageArea: localStorage }));
    expect(controller.getSnapshot().id).toBe("github");
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(controller.getSnapshot().id).toBe("auto");
    controller.destroy();
    window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark", storageArea: localStorage }));
    expect(controller.getSnapshot().id).toBe("auto");
  });

  it.each(["system", "removed-custom-theme", "{invalid-json}"])("falls back safely from stored %s", value => {
    localStorage.setItem("theme", value);
    expect(create({ element: scope(), storageKey: "theme" }).getSnapshot().id).toBe("auto");
  });

  it("keeps the controller usable when persistence is unavailable", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    const controller = create({ element: scope(), storageKey: "theme" });
    controller.setTheme("night");
    expect(controller.getSnapshot().id).toBe("night");
  });

  it("keeps the selected theme when a storage write fails", () => {
    const controller = create({ element: scope(), storageKey: "theme" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    controller.setTheme("newsprint");
    expect(controller.getSnapshot().id).toBe("newsprint");
  });
});
