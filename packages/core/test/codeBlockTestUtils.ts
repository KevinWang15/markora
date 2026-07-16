import { vi } from "vitest";

type EditorLike = {
  view: {
    dom: HTMLElement;
  };
};

type ControlledObserver = IntersectionObserver & {
  emit(target: Element, isIntersecting: boolean): void;
  observed: Set<Element>;
};

export type ControlledIntersectionObservers = {
  emitAll(isIntersecting: boolean): void;
  emitFor(target: Element, isIntersecting: boolean): void;
  observedElements(): Element[];
  restore(): void;
};

function createEntry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  const bounds = target.getBoundingClientRect();

  return {
    boundingClientRect: bounds,
    intersectionRatio: isIntersecting ? 1 : 0,
    intersectionRect: isIntersecting ? bounds : new DOMRectReadOnly(),
    isIntersecting,
    rootBounds: null,
    target,
    time: performance.now(),
  };
}

export function installControlledIntersectionObservers(
  targetWindow: Window & typeof globalThis = window,
  options: { initiallyIntersecting?: boolean } = {},
): ControlledIntersectionObservers {
  const originalDescriptor = Object.getOwnPropertyDescriptor(targetWindow, "IntersectionObserver");
  const observers = new Set<ControlledObserver>();

  class TestIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds: readonly number[];
    readonly observed = new Set<Element>();

    constructor(
      private readonly callback: IntersectionObserverCallback,
      observerOptions: IntersectionObserverInit = {},
    ) {
      this.root = observerOptions.root ?? null;
      this.rootMargin = observerOptions.rootMargin ?? "0px";
      this.thresholds = Array.isArray(observerOptions.threshold)
        ? observerOptions.threshold
        : [observerOptions.threshold ?? 0];
      observers.add(this as ControlledObserver);
    }

    disconnect() {
      this.observed.clear();
    }

    emit(target: Element, isIntersecting: boolean) {
      if (!this.observed.has(target)) {
        return;
      }

      this.callback([createEntry(target, isIntersecting)], this);
    }

    observe(target: Element) {
      this.observed.add(target);

      if (options.initiallyIntersecting !== undefined) {
        this.emit(target, options.initiallyIntersecting);
      }
    }

    takeRecords() {
      return [];
    }

    unobserve(target: Element) {
      this.observed.delete(target);
    }
  }

  Object.defineProperty(targetWindow, "IntersectionObserver", {
    configurable: true,
    value: TestIntersectionObserver,
    writable: true,
  });

  return {
    emitAll(isIntersecting) {
      for (const observer of observers) {
        for (const target of observer.observed) {
          observer.emit(target, isIntersecting);
        }
      }
    },
    emitFor(target, isIntersecting) {
      for (const observer of observers) {
        observer.emit(target, isIntersecting);
      }
    },
    observedElements() {
      return [...observers].flatMap((observer) => [...observer.observed]);
    },
    restore() {
      for (const observer of observers) {
        observer.disconnect();
      }
      observers.clear();

      if (originalDescriptor) {
        Object.defineProperty(targetWindow, "IntersectionObserver", originalDescriptor);
      } else {
        delete (targetWindow as Partial<Window & typeof globalThis>).IntersectionObserver;
      }
    },
  };
}

export function codeBlockStates(editor: EditorLike) {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(".mdw-code-block")].map((block) => (
    block.getAttribute("data-mdw-code-block-state")
  ));
}

export async function waitForCodeBlockState(
  editor: EditorLike,
  state: "active" | "error" | "inactive" | "loading",
  count = 1,
) {
  await vi.waitFor(() => {
    const actual = codeBlockStates(editor).filter((candidate) => candidate === state).length;

    if (actual !== count) {
      throw new Error(`Expected ${count} code blocks in state ${state}, received ${actual}.`);
    }
  });
}

export async function waitForCodeMirrorEditors(editor: EditorLike, count = 1) {
  await vi.waitFor(() => {
    const actual = editor.view.dom.querySelectorAll(".cm-editor").length;

    if (actual !== count) {
      throw new Error(`Expected ${count} CodeMirror editors, received ${actual}.`);
    }
  });
}
