import type { ContextMenuItem } from "markora-ui";

export type ApplicationActionId =
  | "new"
  | "open"
  | "save"
  | "saveAs"
  | "undo"
  | "redo"
  | "exportHtml"
  | "exportPdf"
  | "math"
  | "search"
  | "source"
  | "sidebar";
export type ApplicationAction = Readonly<{
  enabled(): boolean;
  run(): void | Promise<void>;
}>;
export type ApplicationActionBindings = Readonly<
  Record<ApplicationActionId, ApplicationAction>
>;

/** Stable callbacks for all host command surfaces. Availability is read at execution
 * time, including for native menu callbacks installed before the latest render. */
export function createApplicationActions(
  getBindings: () => ApplicationActionBindings,
) {
  const can = (id: ApplicationActionId) => getBindings()[id].enabled();
  const run = (id: ApplicationActionId) => {
    const action = getBindings()[id];
    if (!action.enabled()) return false;
    return action.run();
  };
  const bindHistoryMenu = (
    items: readonly ContextMenuItem[],
  ): readonly ContextMenuItem[] =>
    items.map((item) => {
      if (item.type === "submenu")
        return { ...item, items: bindHistoryMenu(item.items) };
      if (item.type !== "action") return item;
      const id =
        item.id === "history.undo"
          ? "undo"
          : item.id === "history.redo"
            ? "redo"
            : null;
      return id ? { ...item, enabled: can(id), run: () => run(id) } : item;
    });
  return { can, run, bindHistoryMenu };
}

/** Match only supported modifier combinations. The host supplies editing-surface
 * ownership so an input or dialog keeps its own Undo/Redo behavior. */
export function matchApplicationShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "ctrlKey"
    | "metaKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
  >,
  ownsHistory: boolean,
): ApplicationActionId | null {
  if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey))
    return null;
  const key = event.key.toLowerCase();
  if (ownsHistory && (key === "z" || (key === "y" && !event.shiftKey))) {
    return key === "y" || event.shiftKey ? "redo" : "undo";
  }
  if (event.shiftKey) {
    if (key === "s") return "saveAs";
    if (key === "m") return "math";
    if (key === "\\") return "sidebar";
    return null;
  }
  if (event.code === "Slash" || key === "/") return "source";
  switch (key) {
    case "n":
      return "new";
    case "o":
      return "open";
    case "s":
      return "save";
    case "f":
    case "h":
      return "search";
    default:
      return null;
  }
}
