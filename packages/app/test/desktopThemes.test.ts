import { afterEach, expect, it, vi } from "vitest";
import { desktop, type DesktopMenuActions } from "../src/desktop";

class MenuItem {
  checked?: boolean;
  label?: string;
  submenu?: Menu;
  click?: () => void;
  constructor(options: Record<string, unknown>) { Object.assign(this, options); }
}
class Menu {
  items: MenuItem[] = [];
  append(item: MenuItem) { this.items.push(item); }
  createMacBuiltin = vi.fn();
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
