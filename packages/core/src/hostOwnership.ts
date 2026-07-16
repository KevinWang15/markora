const activeEditorHosts = new WeakMap<HTMLElement, symbol>();

function createHostOwnershipError() {
  return new Error("Markora already has a live editor mounted on this element.");
}

export function assertEditorHostAvailable(element: HTMLElement) {
  if (activeEditorHosts.has(element)) {
    throw createHostOwnershipError();
  }
}

export function claimEditorHost(element: HTMLElement) {
  assertEditorHostAvailable(element);

  const claim = Symbol("Markora editor host claim");
  const hostHadClass = element.classList.contains("mdw-host");
  let released = false;

  activeEditorHosts.set(element, claim);

  try {
    element.classList.add("mdw-host");
  } catch (error) {
    activeEditorHosts.delete(element);
    throw error;
  }

  return () => {
    if (released) {
      return;
    }

    released = true;

    if (activeEditorHosts.get(element) !== claim) {
      return;
    }

    activeEditorHosts.delete(element);

    if (!hostHadClass) {
      element.classList.remove("mdw-host");
    }
  };
}
