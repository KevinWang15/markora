import { afterEach, expect, it, vi } from "vitest";
import { desktop } from "../src/desktop";
afterEach(() => { delete window.nw; });

it("uses one native write for both rich and plain text formats", async () => {
  const set = vi.fn();
  window.nw = { Clipboard: { get: () => ({ set, readAvailableTypes: () => ["text", "html"], get: (type: string) => type === "text" ? "hello" : "<strong>hello</strong>" }) } } as unknown as NonNullable<Window["nw"]>;
  const clipboard = desktop.getClipboard()!;
  await clipboard.write!({ text: "hello", html: "<strong>hello</strong>" });
  expect(set).toHaveBeenCalledExactlyOnceWith([{ type: "text", data: "hello" }, { type: "html", data: "<strong>hello</strong>" }]);
  await expect(clipboard.read!()).resolves.toEqual({ text: "hello", html: "<strong>hello</strong>" });
});

it("leaves browser transport to the UI and reports unsupported native contents", async () => {
  expect(desktop.getClipboard()).toBeUndefined();
  window.nw = { Clipboard: { get: () => ({ set() {}, get: () => "", readAvailableTypes: () => ["png"] }) } } as unknown as NonNullable<Window["nw"]>;
  await expect(desktop.getClipboard()!.read!()).rejects.toThrow("supported text");
});
