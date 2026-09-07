import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MathDialog, type MathEdit } from "../src/MathDialog";
import { renderMath } from "../src/renderMath";

vi.mock("../src/renderMath", () => ({ renderMath: vi.fn() }));
const nativeMethods = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  vi.mocked(renderMath).mockImplementation(async ({ source, ownerDocument }) => {
    const result = ownerDocument.createElement("span"); result.textContent = source; return result;
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.mocked(renderMath).mockReset();
  for (const [name, descriptor] of nativeMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
const request = (overrides: Partial<MathEdit> = {}): MathEdit => ({ mode: "insert", source: "", kind: "block", apply: vi.fn(() => true), ...overrides });

it("does not commit a formula until Apply and leaves Cancel without mutations", async () => {
  const edit = request(); const onClose = vi.fn();
  render(createElement(MathDialog, { request: edit, onClose, onSaved: vi.fn() }));
  fireEvent.change(screen.getByLabelText("LaTeX source"), { target: { value: "x^2" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Insert formula" }).hasAttribute("disabled")).toBe(false));
  expect(edit.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(edit.apply).not.toHaveBeenCalled();
});

it("rejects late preview results from earlier source edits", async () => {
  let finishFirst: (value: Node) => void = () => {};
  vi.mocked(renderMath).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  render(createElement(MathDialog, { request: request({ source: "old" }), onClose: vi.fn(), onSaved: vi.fn() }));
  await waitFor(() => expect(renderMath).toHaveBeenCalledOnce());
  const signal = vi.mocked(renderMath).mock.calls[0][0].signal;
  fireEvent.change(screen.getByLabelText("LaTeX source"), { target: { value: "new" } });
  await waitFor(() => expect(screen.getByRole("region", { name: "Formula preview" }).textContent).toContain("new"));
  expect(signal.aborted).toBe(true);
  const stale = document.createElement("span"); stale.textContent = "obsolete preview";
  await act(async () => { finishFirst(stale); });
  expect(screen.getByRole("region", { name: "Formula preview" }).textContent).not.toContain("obsolete preview");
});

it("keeps stale formula edits open without claiming a successful save", async () => {
  const edit = request({ mode: "edit", source: "x", apply: vi.fn(() => false) });
  const onClose = vi.fn(), onSaved = vi.fn();
  render(createElement(MathDialog, { request: edit, onClose, onSaved }));
  fireEvent.change(screen.getByLabelText("LaTeX source"), { target: { value: "y" } });
  const apply = screen.getByRole("button", { name: "Apply formula" });
  await waitFor(() => expect(apply.hasAttribute("disabled")).toBe(false));
  fireEvent.click(apply);
  expect(screen.getByRole("alert").textContent).toContain("formula has changed");
  expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
});

it("blocks multiline inline source and rendering errors", async () => {
  render(createElement(MathDialog, { request: request({ kind: "inline", source: "x\ny" }), onClose: vi.fn(), onSaved: vi.fn() }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("one line"));
  expect(renderMath).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Insert formula" }).hasAttribute("disabled")).toBe(true);
  vi.mocked(renderMath).mockRejectedValueOnce(new Error("Unknown LaTeX command"));
  fireEvent.change(screen.getByLabelText("LaTeX source"), { target: { value: "invalid" } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Unknown LaTeX command"));
  expect(screen.getByRole("button", { name: "Insert formula" }).hasAttribute("disabled")).toBe(true);
});
