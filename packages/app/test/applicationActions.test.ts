import { describe, expect, it, vi } from "vitest";
import { createApplicationActions, matchApplicationShortcut, type ApplicationActionBindings } from "../src/applicationActions";

describe("application command routing", () => {
  it("rechecks availability and uses current handlers for nested menu actions", () => {
    const old = vi.fn();
    const current = vi.fn();
    let enabled = true;
    let bindings = { undo: { enabled: () => enabled, run: old } } as ApplicationActionBindings;
    const actions = createApplicationActions(() => bindings);
    const menu = actions.bindHistoryMenu([{ type: "submenu", id: "edit", label: "Edit", items: [{ type: "action", id: "history.undo", label: "Undo", run: vi.fn() }] }]);
    const submenu = menu[0];
    if (submenu.type !== "submenu" || submenu.items[0].type !== "action") throw Error("missing action");
    const invoke = () => submenu.items[0].type === "action" && submenu.items[0].run(null!);
    enabled = false;
    invoke();
    expect(old).not.toHaveBeenCalled();
    bindings = { undo: { enabled: () => true, run: current } } as ApplicationActionBindings;
    invoke();
    expect(current).toHaveBeenCalledOnce();
    expect(old).not.toHaveBeenCalled();
  });

  it("leaves input history, composition and unsupported modifiers alone", () => {
    const event = { key: "z", code: "KeyZ", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false };
    expect(matchApplicationShortcut(event, false)).toBeNull();
    expect(matchApplicationShortcut(event, true)).toBe("undo");
    expect(matchApplicationShortcut({ ...event, shiftKey: true }, true)).toBe("redo");
    expect(matchApplicationShortcut({ ...event, isComposing: true }, true)).toBeNull();
    expect(matchApplicationShortcut({ ...event, altKey: true }, true)).toBeNull();
    expect(matchApplicationShortcut({ ...event, key: "s", shiftKey: true }, true)).toBe("saveAs");
    expect(matchApplicationShortcut({ ...event, key: "n", shiftKey: true }, true)).toBeNull();
  });
});
