import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { createGlobalListenerLedger } from "../src/browser-lab/listenerLedger";

const playwrightInputTypes = [
  "auxclick",
  "click",
  "contextmenu",
  "dblclick",
  "mousedown",
  "mousemove",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchcancel",
  "touchend",
  "touchstart",
] as const;

const windows: Array<Window & typeof globalThis> = [];

function createWindow() {
  const targetWindow = new JSDOM("<!doctype html><html><body></body></html>").window as unknown as Window & typeof globalThis;
  windows.push(targetWindow);
  return targetWindow;
}

afterEach(() => {
  windows.splice(0).forEach((targetWindow) => targetWindow.close());
});

describe("BrowserLab global listener ledger", () => {
  it("accepts only Playwright's sentinel batch and leaves additional listeners visible", () => {
    const targetWindow = createWindow();
    const ledger = createGlobalListenerLedger(targetWindow);
    const harnessListener = () => {};
    const productClickListener = () => {};
    const productResizeListener = () => {};

    targetWindow.addEventListener("__playwright_global_listeners_check__", harnessListener, true);
    for (const type of playwrightInputTypes) {
      targetWindow.addEventListener(type, harnessListener, true);
    }
    targetWindow.addEventListener("click", productClickListener);
    targetWindow.addEventListener("resize", productResizeListener);

    expect(ledger.acceptPlaywrightHarnessBaseline()).toBe(true);
    expect(ledger.snapshot()).toEqual({
      total: 2,
      byTargetAndType: {
        "window:click": 1,
        "window:resize": 1,
      },
    });

    ledger.restore();
  });

  it("does not accept an incomplete sentinel batch", () => {
    const targetWindow = createWindow();
    const ledger = createGlobalListenerLedger(targetWindow);
    const listener = () => {};

    targetWindow.addEventListener("__playwright_global_listeners_check__", listener, true);
    targetWindow.addEventListener("click", listener, true);

    expect(ledger.acceptPlaywrightHarnessBaseline()).toBe(false);
    expect(ledger.snapshot().total).toBe(2);

    ledger.restore();
  });

  it("accepts Playwright's complete sentinel batch only once", () => {
    const targetWindow = createWindow();
    const ledger = createGlobalListenerLedger(targetWindow);
    const firstListener = () => {};

    targetWindow.addEventListener("__playwright_global_listeners_check__", firstListener, true);
    for (const type of playwrightInputTypes) {
      targetWindow.addEventListener(type, firstListener, true);
    }

    expect(ledger.acceptPlaywrightHarnessBaseline()).toBe(true);
    expect(ledger.snapshot().total).toBe(0);

    const secondListener = () => {};
    targetWindow.addEventListener("__playwright_global_listeners_check__", secondListener, true);
    for (const type of playwrightInputTypes) {
      targetWindow.addEventListener(type, secondListener, true);
    }

    expect(ledger.acceptPlaywrightHarnessBaseline()).toBe(false);
    expect(ledger.snapshot().total).toBe(13);

    ledger.restore();
  });

  it("accepts only axe-core's identifiable frame messenger once", () => {
    const targetWindow = createWindow();
    Object.defineProperty(targetWindow, "axe", {
      configurable: true,
      value: { version: "4.12.1" },
    });
    const ledger = createGlobalListenerLedger(targetWindow);
    const axeMessageListener = new Function(
      "messageEvent",
      "return messageHandler(messageEvent, topicHandler);",
    ) as EventListener;
    const productMessageListener = () => {};

    targetWindow.addEventListener("message", axeMessageListener);
    targetWindow.addEventListener("message", productMessageListener);

    expect(ledger.acceptAxeCoreBaseline()).toBe(true);
    expect(ledger.snapshot()).toEqual({
      total: 1,
      byTargetAndType: { "window:message": 1 },
    });

    targetWindow.addEventListener("message", new Function(
      "messageEvent",
      "return messageHandler(messageEvent, topicHandler);",
    ) as EventListener);
    expect(ledger.acceptAxeCoreBaseline()).toBe(false);
    expect(ledger.snapshot().total).toBe(2);

    ledger.restore();
  });

  it("accepts Firefox's CodeMirror copy/cut pair only once", () => {
    const targetWindow = createWindow();
    Object.defineProperty(targetWindow.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 Firefox/140.0",
    });
    const ledger = createGlobalListenerLedger(targetWindow);
    const firstCopy = () => {};
    const firstCut = () => {};

    targetWindow.document.addEventListener("copy", firstCopy);
    targetWindow.document.addEventListener("cut", firstCut);

    expect(ledger.acceptFirefoxCodeMirrorCopyCutBaseline()).toBe(true);
    expect(ledger.snapshot().total).toBe(0);

    targetWindow.document.addEventListener("copy", () => {});
    targetWindow.document.addEventListener("cut", () => {});

    expect(ledger.acceptFirefoxCodeMirrorCopyCutBaseline()).toBe(false);
    expect(ledger.snapshot()).toEqual({
      total: 2,
      byTargetAndType: {
        "document:copy": 1,
        "document:cut": 1,
      },
    });

    ledger.restore();
  });
});
