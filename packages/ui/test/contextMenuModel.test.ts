import { expect, it, vi } from "vitest";
import { composeMenuItems, normalizeContextMenuConfig, snapshotMenuItems } from "../src/contextMenuModel";
import type { ContextMenuAction, ContextMenuContext } from "../src/contextMenuTypes";
const action = (id: string): ContextMenuAction => ({ type: "action", id, label: id, run: () => true });
const context = { editor: { extensions: { uiActions: [] } } } as unknown as ContextMenuContext;
const unchanged = (_id: string, fallback: string) => fallback;

it("composes stable provider groups, trims separators, localizes once, and freezes snapshots", () => {
  const supplied = [action("custom")];
  const config = normalizeContextMenuConfig({ includeExtensionActions: false,
    providers: [{ id: "custom", order: 5, items: () => supplied }],
    messages: { itemLabel: (id, label) => id === "custom" ? "Custom translated" : label },
  });
  const items = composeMenuItems(config, context, [{ id: "markora.default", order: 10, items: () => [{ type: "separator" }, action("default"), { type: "separator" }] }]);
  expect(items).toEqual([{ ...action("custom"), label: "Custom translated", run: supplied[0].run }, { type: "separator" }, expect.objectContaining({ id: "default" })]);
  supplied.length = 0;
  expect(items).toHaveLength(3); expect(Object.isFrozen(items)).toBe(true); expect(Object.isFrozen(items[0])).toBe(true);
});

it("isolates a failed provider and lets hosts replace built-in actions", () => {
  const error = new Error("provider failed"); const onError = vi.fn(); const replacement = vi.fn();
  const config = normalizeContextMenuConfig({ includeExtensionActions: false, onError,
    providers: [{ id: "broken", items() { throw error; } }],
    transform: items => items.map(item => item.type === "action" ? { ...item, run: replacement } : item),
  });
  const items = composeMenuItems(config, context, [{ id: "markora.default", items: () => [action("history.undo")] }]);
  expect(onError).toHaveBeenCalledWith(error, context);
  (items[0] as ContextMenuAction).run(context); expect(replacement).toHaveBeenCalledOnce();
});

it("rejects ambiguous IDs, malformed items, empty labels, and unbounded trees", () => {
  expect(() => normalizeContextMenuConfig({ providers: [{ id: "a", items: () => [] }, { id: "a", items: () => [] }] })).toThrow(/duplicate/);
  expect(() => snapshotMenuItems([action("a"), action("a")], unchanged)).toThrow(/Duplicate/);
  expect(() => snapshotMenuItems([action("a")], () => " ")).toThrow(/nonblank/);
  const recursive: any = { type: "submenu", id: "cycle", label: "Cycle", items: [] }; recursive.items.push(recursive);
  expect(() => snapshotMenuItems([recursive], unchanged)).toThrow();
});

it("adapts qualified extension actions without introducing another command registry", () => {
  const run = vi.fn(() => true);
  const current = { editor: { view: { editable: true }, extensions: { uiActions: [
    { id: "sample:refresh", defaultLabel: "Refresh", order: 2, isEnabled: () => true, isActive: () => false, run },
  ] } } } as unknown as ContextMenuContext;
  const items = composeMenuItems(normalizeContextMenuConfig({ includeDefaults: false }), current, []);
  expect(items[0]).toMatchObject({ id: "extensions", items: [{ id: "extension.sample:refresh", label: "Refresh", enabled: true }] });
  if (items[0].type !== "submenu" || items[0].items[0].type !== "action") throw new Error("Missing extension action");
  items[0].items[0].run(current); expect(run).toHaveBeenCalledOnce();
});
