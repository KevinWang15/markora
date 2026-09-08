import { afterEach, expect, it, vi } from "vitest";
import { desktop, type DesktopMenuActions } from "../src/desktop";

class MenuItem {
  checked?: boolean;
  label?: string;
  submenu?: Menu;
  click?: () => void;
  enabled?: boolean;
  modifiers?: string;
  constructor(options: Record<string, unknown>) { Object.assign(this, options); }
}
class Menu {
  items: MenuItem[] = [];
  append(item: MenuItem) { this.items.push(item); }
  insert(item: MenuItem, index: number) { this.items.splice(index, 0, item); }
  createMacBuiltin = vi.fn(() => {
    for (const label of ["Markora", "Edit", "Window"]) this.append(new MenuItem({ label, submenu: new Menu() }));
  });
}

afterEach(() => { delete window.nw; });

it.each(["win32", "darwin"])("keeps native theme selection and its checkmark consistent on %s", platform => {
  const nativeWindow = { menu: null as Menu | null };
  window.nw = {
    Menu, MenuItem, Window: { get: () => nativeWindow }, process: { platform },
  } as unknown as NonNullable<Window["nw"]>;
  const actions: DesktopMenuActions = {
    newDocument: vi.fn(), openDocument: vi.fn(), saveDocument: vi.fn(), saveDocumentAs: vi.fn(),
    toggleSidebar: vi.fn(), toggleSourceMode: vi.fn(), setTheme: vi.fn(),
    exportPdf: vi.fn(), exportHtml: vi.fn(), canExport: true, insertMath: vi.fn(), canInsertMath: true,
    themes: [{ id: "newsprint", label: "Newsprint" }, { id: "night", label: "Night" }], theme: "newsprint",
  };
  desktop.installMenu(actions);
  const items = nativeWindow.menu!.items.find(item => item.label === "Themes")!.submenu!.items;
  expect(items.map(item => item.checked)).toEqual([true, false]);
  // NW.js toggles a checkbox before dispatching its callback, including an already selected one.
  items[0].checked = false;
  items[0].click!();
  expect(items[0].checked).toBe(true);
  expect(actions.setTheme).toHaveBeenLastCalledWith("newsprint");
  items[1].checked = true;
  items[1].click!();
  expect(actions.setTheme).toHaveBeenLastCalledWith("night");
  desktop.installMenu({ ...actions, theme: "night" });
  const selected = nativeWindow.menu!.items.find(item => item.label === "Themes")!.submenu!.items;
  expect(selected.map(item => item.checked)).toEqual([false, true]);
});

it.each(["win32", "darwin"])("exports through File on %s and disables export while busy", platform => {
  const nativeWindow = { menu: null as Menu | null };
  window.nw = {
    Menu, MenuItem, Window: { get: () => nativeWindow }, process: { platform },
  } as unknown as NonNullable<Window["nw"]>;
  const actions: DesktopMenuActions = {
    newDocument: vi.fn(), openDocument: vi.fn(), saveDocument: vi.fn(), saveDocumentAs: vi.fn(),
    toggleSidebar: vi.fn(), toggleSourceMode: vi.fn(), setTheme: vi.fn(),
    exportPdf: vi.fn(), exportHtml: vi.fn(), canExport: true, insertMath: vi.fn(), canInsertMath: true, themes: [], theme: "night",
  };
  desktop.installMenu(actions);
  expect(nativeWindow.menu!.items.map(item => item.label)).toEqual(platform === "darwin"
    ? ["Markora", "File", "Edit", "Insert", "View", "Window", "Themes"]
    : ["File", "Insert", "View", "Themes"]);
  const math = () => nativeWindow.menu!.items.find(item => item.label === "Insert")!.submenu!.items[0];
  expect(math().label).toBe("Math");
  expect(math().modifiers).toBe(platform === "darwin" ? "cmd-shift" : "ctrl-shift");
  math().click!();
  expect(actions.insertMath).toHaveBeenCalledOnce();
  const file = () => nativeWindow.menu!.items.find(item => item.label === "File")!.submenu!;
  expect(file().items.find(item => item.label === "Save")!.modifiers).toBe(platform === "darwin" ? "cmd" : "ctrl");
  const exports = () => file().items.find(item => item.label === "Export")!.submenu!.items;
  expect(exports().map(item => [item.label, item.enabled])).toEqual([["PDF…", true], ["HTML…", true]]);
  exports()[0].click!();
  expect(actions.exportPdf).toHaveBeenCalledOnce();
  expect(actions.exportHtml).not.toHaveBeenCalled();
  exports()[1].click!();
  expect(actions.exportHtml).toHaveBeenCalledOnce();
  desktop.installMenu({ ...actions, canExport: false, canInsertMath: false });
  expect(math().enabled).toBe(false);
  expect(exports().map(item => item.enabled)).toEqual([false, false]);
});
