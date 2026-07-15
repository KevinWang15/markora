import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createDefaultUi } from '../src/index';

const foreignWindows: Window[] = [];
type ControllerOptions = Parameters<ReturnType<typeof createDefaultUi>>[0];

function trackWindow(win: Window) {
  foreignWindows.push(win);
  return win;
}

function createControllers(
  hostElement: HTMLElement,
  config?: { portalRoot?: HTMLElement | ShadowRoot },
  overrides: Partial<Omit<ControllerOptions, 'hostElement'>> = {},
) {
  const factory = createDefaultUi(config);

  return factory({
    appendTableColumn() {},
    appendTableRow() {},
    getTableContext() {
      return null;
    },
    hostElement,
    normalizeTableAlignment() {
      return null;
    },
    removeActiveImage() {},
    removeActiveLink() {},
    removeActiveTable() {},
    removeTableColumn() {},
    removeTableRow() {},
    setTableColumnAlignment() {},
    updateActiveImage() { return true; },
    updateLinkHref() { return true; },
    ...overrides,
  });
}

function createView() {
  return {
    coordsAtPos() {
      return { bottom: 24, left: 12, right: 12, top: 8 };
    },
    focus() {},
    state: {
      selection: {
        from: 1,
      },
    },
  } as any;
}

function destroyControllers(controllers: ReturnType<ReturnType<typeof createDefaultUi>>) {
  controllers.clearSelectionAnchor();
  controllers.linkEditor.destroy();
  controllers.imageEditor.destroy();
  controllers.tableToolbar.destroy();
}

function setWindowMetrics(win: Window, metrics: {
  height: number;
  scrollX?: number;
  scrollY?: number;
  width: number;
}) {
  Object.defineProperties(win, {
    innerHeight: { configurable: true, value: metrics.height },
    innerWidth: { configurable: true, value: metrics.width },
    scrollX: { configurable: true, value: metrics.scrollX ?? 0 },
    scrollY: { configurable: true, value: metrics.scrollY ?? 0 },
  });
}

function setElementRect(element: HTMLElement, rect: { bottom: number; left: number; right: number; top: number }) {
  element.getBoundingClientRect = () => ({
    ...rect,
    height: rect.bottom - rect.top,
    toJSON() {},
    width: rect.right - rect.left,
    x: rect.left,
    y: rect.top,
  });
}

function setOverlaySize(element: HTMLElement, width: number, height: number) {
  Object.defineProperties(element, {
    offsetHeight: { configurable: true, value: height },
    offsetWidth: { configurable: true, value: width },
  });
}

function setScaledPositionRect(element: HTMLElement, origin: { left: number; top: number }, scale: number) {
  element.getBoundingClientRect = () => {
    const left = origin.left + (Number.parseFloat(element.style.left) || 0) * scale;
    const top = origin.top + (Number.parseFloat(element.style.top) || 0) * scale;
    const width = element.offsetWidth * scale;
    const height = element.offsetHeight * scale;

    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      toJSON() {},
      top,
      width,
      x: left,
      y: top,
    };
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  foreignWindows.splice(0).forEach((win) => win.close());
});

describe('createDefaultUi', () => {
  it('appends overlays and selection anchors to the host document by default', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    const hostElement = foreignWindow.document.createElement('div');
    foreignWindow.document.body.append(hostElement);

    const controllers = createControllers(hostElement);
    const anchor = controllers.createSelectionAnchor(createView());

    expect(foreignWindow.document.body.querySelector('.mdw-link-editor')).not.toBeNull();
    expect(foreignWindow.document.body.querySelector('.mdw-image-editor')).not.toBeNull();
    expect(foreignWindow.document.body.querySelector('.mdw-table-toolbar')).not.toBeNull();
    expect(anchor).not.toBeNull();
    expect(foreignWindow.document.body.contains(anchor)).toBe(true);
    expect(document.body.querySelector('.mdw-link-editor')).toBeNull();
    expect(document.body.querySelector('.mdw-image-editor')).toBeNull();
    expect(document.body.querySelector('.mdw-table-toolbar')).toBeNull();

    destroyControllers(controllers);
  });

  it('uses the host shadow root as the default portal root', () => {
    const shadowHost = document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const hostElement = document.createElement('div');
    shadowRoot.append(hostElement);
    document.body.append(shadowHost);

    const controllers = createControllers(hostElement);
    const anchor = controllers.createSelectionAnchor(createView());

    expect(shadowRoot.querySelector('.mdw-link-editor')).not.toBeNull();
    expect(shadowRoot.querySelector('.mdw-image-editor')).not.toBeNull();
    expect(shadowRoot.querySelector('.mdw-table-toolbar')).not.toBeNull();
    expect(anchor?.getRootNode()).toBe(shadowRoot);
    expect(document.body.querySelector('.mdw-link-editor')).toBeNull();

    destroyControllers(controllers);
  });

  it('keeps Shadow DOM media editors active through composed button clicks', () => {
    const shadowHost = document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    shadowRoot.append(hostElement, marker);
    document.body.append(shadowHost);
    const linkUpdates: string[] = [];
    const imageUpdates: string[] = [];
    const controllers = createControllers(hostElement, undefined, {
      updateActiveImage(_view, attrs) {
        imageUpdates.push(attrs.src);
        return true;
      },
      updateLinkHref(_view, href) {
        linkUpdates.push(href);
        return true;
      },
    });
    const view = createView();

    controllers.linkEditor.open(view, marker, 'https://example.com');
    const linkEditor = shadowRoot.querySelector<HTMLElement>('.mdw-link-editor');
    const linkInput = linkEditor?.querySelector<HTMLInputElement>('[aria-label="Link URL"]');
    const linkSave = Array.from(linkEditor?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === 'Save');
    linkInput!.value = 'https://example.com/updated';
    linkSave?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    linkSave?.click();

    controllers.imageEditor.open(view, marker, { node: { attrs: { src: 'old.png' } } });
    const imageEditor = shadowRoot.querySelector<HTMLElement>('.mdw-image-editor');
    const imageInput = imageEditor?.querySelector<HTMLInputElement>('[aria-label="Image URL"]');
    const imageSave = Array.from(imageEditor?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === 'Save');
    imageInput!.value = 'updated.png';
    imageSave?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    imageSave?.click();

    expect(linkUpdates).toEqual(['https://example.com/updated']);
    expect(imageUpdates).toEqual(['updated.png']);

    destroyControllers(controllers);
  });

  it('respects an explicit portal root override', () => {
    const shadowHost = document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const hostElement = document.createElement('div');
    const portalRoot = document.createElement('div');
    shadowRoot.append(hostElement);
    document.body.append(shadowHost, portalRoot);

    const controllers = createControllers(hostElement, { portalRoot });
    const anchor = controllers.createSelectionAnchor(createView());

    expect(portalRoot.querySelector('.mdw-link-editor')).not.toBeNull();
    expect(portalRoot.querySelector('.mdw-image-editor')).not.toBeNull();
    expect(portalRoot.querySelector('.mdw-table-toolbar')).not.toBeNull();
    expect(shadowRoot.querySelector('.mdw-link-editor')).toBeNull();
    expect(anchor).not.toBeNull();
    expect(portalRoot.contains(anchor)).toBe(true);
    expect(anchor?.style.left).toBe('12px');
    expect(anchor?.style.top).toBe('24px');

    destroyControllers(controllers);
  });

  it('positions overlays relative to an offset portal containing block', () => {
    setWindowMetrics(window, { height: 600, width: 800 });
    const hostElement = document.createElement('div');
    const portalRoot = document.createElement('div');
    const marker = document.createElement('span');
    document.body.append(hostElement, portalRoot, marker);
    setElementRect(marker, { bottom: 220, left: 420, right: 440, top: 200 });

    const controllers = createControllers(hostElement, { portalRoot });
    const linkEditor = portalRoot.querySelector<HTMLElement>('.mdw-link-editor');

    expect(linkEditor).not.toBeNull();

    if (linkEditor) {
      setOverlaySize(linkEditor, 280, 100);
      setElementRect(linkEditor, { bottom: 180, left: 100, right: 380, top: 80 });
      controllers.linkEditor.open(createView(), marker, 'https://example.com');

      expect(linkEditor.style.left).toBe('320px');
      expect(linkEditor.style.top).toBe('148px');
    }

    destroyControllers(controllers);
  });

  it('converts viewport coordinates for a scaled portal containing block', () => {
    setWindowMetrics(window, { height: 800, width: 1200 });
    const hostElement = document.createElement('div');
    const portalRoot = document.createElement('div');
    const marker = document.createElement('span');
    document.body.append(hostElement, portalRoot, marker);
    setElementRect(marker, { bottom: 220, left: 420, right: 440, top: 200 });

    const append = portalRoot.append.bind(portalRoot);
    portalRoot.append = ((...nodes: (Node | string)[]) => {
      append(...nodes);
      nodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          setScaledPositionRect(node, { left: 100, top: 80 }, 2);
        }
      });
    }) as typeof portalRoot.append;

    const controllers = createControllers(hostElement, { portalRoot });
    const linkEditor = portalRoot.querySelector<HTMLElement>('.mdw-link-editor');

    expect(linkEditor).not.toBeNull();

    if (linkEditor) {
      setOverlaySize(linkEditor, 280, 100);
      controllers.linkEditor.open(createView(), marker, 'https://example.com');

      expect(linkEditor.style.maxWidth).toBe('588px');
      expect(linkEditor.style.left).toBe('160px');
      expect(linkEditor.style.top).toBe('74px');
    }

    const anchor = controllers.createSelectionAnchor({
      ...createView(),
      coordsAtPos() {
        return { bottom: 220, left: 420, right: 420, top: 200 };
      },
    });

    expect(anchor?.style.left).toBe('160px');
    expect(anchor?.style.top).toBe('70px');
    destroyControllers(controllers);
  });

  it('loads and submits the editable image title', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    document.body.append(hostElement, marker);

    const updates: Array<{ src: string; alt: string | null; title: string | null }> = [];
    const controllers = createControllers(hostElement, undefined, {
      updateActiveImage(_view, attrs) {
        updates.push(attrs);
        return true;
      },
    });
    const view = createView();

    controllers.imageEditor.open(view, marker, {
      node: {
        attrs: {
          alt: 'Original alt',
          src: 'https://example.com/original.png',
          title: 'Original title',
        },
      },
    });

    const editor = document.querySelector<HTMLElement>('.mdw-image-editor');
    const srcInput = editor?.querySelector<HTMLInputElement>('[aria-label="Image URL"]');
    const altInput = editor?.querySelector<HTMLInputElement>('[aria-label="Alt text"]');
    const titleInput = editor?.querySelector<HTMLInputElement>('[aria-label="Title"]');
    const saveButton = Array.from(editor?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Save');

    expect(titleInput?.value).toBe('Original title');

    if (srcInput && altInput && titleInput) {
      srcInput.value = 'https://example.com/updated.png';
      altInput.value = 'Updated alt';
      titleInput.value = 'Updated title';
    }
    saveButton?.click();

    expect(updates).toEqual([{
      alt: 'Updated alt',
      src: 'https://example.com/updated.png',
      title: 'Updated title',
    }]);

    destroyControllers(controllers);
  });

  it('preserves native media button actions and ignores composition keys', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    document.body.append(hostElement, marker);
    const imageUpdates: string[] = [];
    let imageRemovals = 0;
    let linkUpdates = 0;
    const focus = vi.fn();
    const controllers = createControllers(hostElement, undefined, {
      removeActiveImage() {
        imageRemovals += 1;
      },
      updateActiveImage(_view, attrs) {
        imageUpdates.push(attrs.alt ?? '');
        return true;
      },
      updateLinkHref() {
        linkUpdates += 1;
        return true;
      },
    });
    const view = { ...createView(), focus };

    controllers.imageEditor.open(view, marker, { node: { attrs: { alt: 'Original', src: '/image.png' } } });
    const imageEditor = document.querySelector<HTMLElement>('.mdw-image-editor')!;
    const altInput = imageEditor.querySelector<HTMLInputElement>('[aria-label="Alt text"]')!;
    const srcInput = imageEditor.querySelector<HTMLInputElement>('[aria-label="Image URL"]')!;
    const cancelButton = Array.from(imageEditor.querySelectorAll('button'))
      .find((button) => button.textContent === 'Cancel')!;
    altInput.value = 'Must not save';
    cancelButton.focus();
    cancelButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    cancelButton.click();

    expect(imageUpdates).toEqual([]);
    expect(imageEditor.hidden).toBe(true);

    controllers.imageEditor.open(view, marker, { node: { attrs: { alt: 'Original', src: '/image.png' } } });
    const removeButton = Array.from(imageEditor.querySelectorAll('button'))
      .find((button) => button.textContent === 'Remove')!;
    altInput.value = 'Must not save either';
    removeButton.focus();
    removeButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    removeButton.click();

    expect(imageUpdates).toEqual([]);
    expect(imageRemovals).toBe(1);

    controllers.imageEditor.open(view, marker, { node: { attrs: { alt: 'Original', src: '/image.png' } } });
    srcInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: 'Enter',
    }));
    expect(imageEditor.hidden).toBe(false);
    expect(imageUpdates).toEqual([]);

    controllers.linkEditor.open(view, marker, '/docs');
    const linkEditor = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const linkInput = linkEditor.querySelector<HTMLInputElement>('[aria-label="Link URL"]')!;
    const linkCancel = Array.from(linkEditor.querySelectorAll('button'))
      .find((button) => button.textContent === 'Cancel')!;
    linkInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: 'Enter',
    }));
    expect(linkUpdates).toBe(0);
    expect(linkEditor.hidden).toBe(false);

    linkCancel.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
    expect(linkEditor.hidden).toBe(true);
    expect(focus).toHaveBeenCalled();

    destroyControllers(controllers);
  });

  it('keeps media editors open when a URL update is rejected', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    document.body.append(hostElement, marker);
    const controllers = createControllers(hostElement, undefined, {
      updateActiveImage() {
        return false;
      },
      updateLinkHref() {
        return false;
      },
    });
    const view = createView();

    controllers.linkEditor.open(view, marker, 'https://example.com');
    const linkEditor = document.querySelector<HTMLElement>('.mdw-link-editor');
    const linkInput = linkEditor?.querySelector<HTMLInputElement>('[aria-label="Link URL"]');
    const linkSave = Array.from(linkEditor?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Save');
    linkInput!.value = 'javascript:alert(1)';
    linkSave?.click();

    expect(linkEditor?.hidden).toBe(false);
    expect(linkInput?.getAttribute('aria-invalid')).toBe('true');
    const linkErrorId = linkInput?.getAttribute('aria-errormessage');
    expect(linkErrorId).toBeTruthy();
    expect(linkInput?.getAttribute('aria-describedby')).toBe(linkErrorId);
    expect(document.getElementById(linkErrorId!)?.getAttribute('role')).toBe('alert');
    expect(document.getElementById(linkErrorId!)?.hidden).toBe(false);

    controllers.imageEditor.open(view, marker, { node: { attrs: {} } });
    const imageEditor = document.querySelector<HTMLElement>('.mdw-image-editor');
    const imageSrc = imageEditor?.querySelector<HTMLInputElement>('[aria-label="Image URL"]');
    const imageSave = Array.from(imageEditor?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Save');
    imageSrc!.value = '';
    imageSave?.click();

    expect(imageEditor?.hidden).toBe(false);
    expect(imageSrc?.getAttribute('aria-invalid')).toBe('true');
    const imageErrorId = imageSrc?.getAttribute('aria-errormessage');
    expect(imageErrorId).toBeTruthy();
    expect(imageSrc?.getAttribute('aria-describedby')).toBe(imageErrorId);
    expect(document.getElementById(imageErrorId!)?.getAttribute('role')).toBe('alert');
    expect(document.getElementById(imageErrorId!)?.hidden).toBe(false);

    destroyControllers(controllers);
  });

  it('clears active editor references when controllers are destroyed', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('table');
    document.body.append(hostElement, marker);
    let imageUpdates = 0;
    let linkUpdates = 0;
    let tableUpdates = 0;
    const controllers = createControllers(hostElement, undefined, {
      appendTableColumn() {
        tableUpdates += 1;
      },
      getTableContext() {
        return { cell: { attrs: {} }, tablePos: 0 };
      },
      updateActiveImage() {
        imageUpdates += 1;
        return true;
      },
      updateLinkHref() {
        linkUpdates += 1;
        return true;
      },
    });
    const view = {
      ...createView(),
      nodeDOM() {
        return marker;
      },
    };

    controllers.linkEditor.open(view, marker, 'https://example.com');
    controllers.imageEditor.open(view, marker, { node: { attrs: { src: 'https://example.com/image.png' } } });
    controllers.tableToolbar.update(view);

    const linkSave = Array.from(document.querySelectorAll<HTMLButtonElement>('.mdw-link-editor button'))
      .find((button) => button.textContent === 'Save');
    const imageSave = Array.from(document.querySelectorAll<HTMLButtonElement>('.mdw-image-editor button'))
      .find((button) => button.textContent === 'Save');
    const insertColumn = document.querySelector<HTMLButtonElement>('.mdw-table-toolbar [aria-label="Insert column"]');

    controllers.linkEditor.destroy();
    controllers.imageEditor.destroy();
    controllers.tableToolbar.destroy();
    linkSave?.click();
    imageSave?.click();
    insertColumn?.click();

    expect(linkUpdates).toBe(0);
    expect(imageUpdates).toBe(0);
    expect(tableUpdates).toBe(0);
  });

  it('keeps link and image editors inside a scrolled narrow viewport', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    setWindowMetrics(foreignWindow, { height: 240, scrollX: 40, scrollY: 100, width: 320 });

    const hostElement = foreignWindow.document.createElement('div');
    const marker = foreignWindow.document.createElement('span');
    foreignWindow.document.body.append(hostElement, marker);
    setElementRect(marker, { bottom: 230, left: 290, right: 310, top: 210 });

    const controllers = createControllers(hostElement);
    const view = createView();
    const linkEditor = foreignWindow.document.querySelector<HTMLElement>('.mdw-link-editor');
    const imageEditor = foreignWindow.document.querySelector<HTMLElement>('.mdw-image-editor');

    expect(linkEditor).not.toBeNull();
    expect(imageEditor).not.toBeNull();

    if (linkEditor && imageEditor) {
      setOverlaySize(linkEditor, 280, 100);
      setOverlaySize(imageEditor, 340, 150);
      setElementRect(linkEditor, { bottom: -100, left: -40, right: -40, top: -100 });
      setElementRect(imageEditor, { bottom: -100, left: -40, right: -40, top: -100 });

      controllers.linkEditor.open(view, marker, 'https://example.com');
      expect(linkEditor.style.maxWidth).toBe('296px');
      expect(linkEditor.style.maxHeight).toBe('216px');
      expect(linkEditor.style.left).toBe('68px');
      expect(linkEditor.style.top).toBe('202px');

      controllers.imageEditor.open(view, marker, { node: { attrs: {} } });
      expect(imageEditor.style.maxWidth).toBe('296px');
      expect(imageEditor.style.maxHeight).toBe('216px');
      expect(imageEditor.style.left).toBe('52px');
      expect(imageEditor.style.top).toBe('152px');
    }

    destroyControllers(controllers);
  });

  it('uses the visual viewport and responds when it resizes', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    setWindowMetrics(foreignWindow, { height: 600, width: 800 });
    const visualViewport = new foreignWindow.EventTarget() as EventTarget & {
      height: number;
      offsetLeft: number;
      offsetTop: number;
      width: number;
    };
    visualViewport.height = 200;
    visualViewport.offsetLeft = 20;
    visualViewport.offsetTop = 30;
    visualViewport.width = 280;
    Object.defineProperty(foreignWindow, 'visualViewport', { configurable: true, value: visualViewport });

    const hostElement = foreignWindow.document.createElement('div');
    const marker = foreignWindow.document.createElement('span');
    foreignWindow.document.body.append(hostElement, marker);
    setElementRect(marker, { bottom: 190, left: 290, right: 300, top: 150 });

    const controllers = createControllers(hostElement);
    const imageEditor = foreignWindow.document.querySelector<HTMLElement>('.mdw-image-editor');

    expect(imageEditor).not.toBeNull();

    if (imageEditor) {
      setOverlaySize(imageEditor, 320, 150);
      setElementRect(imageEditor, { bottom: 0, left: 0, right: 0, top: 0 });
      controllers.imageEditor.open(createView(), marker, { node: { attrs: {} } });

      expect(imageEditor.style.maxWidth).toBe('256px');
      expect(imageEditor.style.maxHeight).toBe('176px');
      expect(imageEditor.style.left).toBe('32px');
      expect(imageEditor.style.top).toBe('42px');

      visualViewport.width = 240;
      visualViewport.dispatchEvent(new foreignWindow.Event('resize'));
      expect(imageEditor.style.maxWidth).toBe('216px');
      expect(imageEditor.style.left).toBe('32px');
    }

    destroyControllers(controllers);
  });

  it('clamps and flips the table toolbar within a narrow viewport', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    setWindowMetrics(foreignWindow, { height: 240, scrollX: 40, scrollY: 100, width: 320 });

    const hostElement = foreignWindow.document.createElement('div');
    const marker = foreignWindow.document.createElement('table');
    foreignWindow.document.body.append(hostElement, marker);
    setElementRect(marker, { bottom: 80, left: 300, right: 320, top: 10 });

    const controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return { cell: { attrs: { align: 'center' } }, tablePos: 0 };
      },
      normalizeTableAlignment() {
        return 'center';
      },
    });
    const toolbar = foreignWindow.document.querySelector<HTMLElement>('.mdw-table-toolbar');

    expect(toolbar).not.toBeNull();

    if (toolbar) {
      setOverlaySize(toolbar, 360, 84);
      setElementRect(toolbar, { bottom: -100, left: -40, right: -40, top: -100 });
      controllers.tableToolbar.update({
        ...createView(),
        nodeDOM() {
          return marker;
        },
      });

      expect(toolbar.style.maxWidth).toBe('296px');
      expect(toolbar.style.maxHeight).toBe('216px');
      expect(toolbar.style.left).toBe('52px');
      expect(toolbar.style.top).toBe('188px');
      expect(toolbar.querySelector('[aria-label="Align center"]')?.classList.contains('is-active')).toBe(true);
    }

    destroyControllers(controllers);
  });

  it('exposes pressed alignment state and roves table-toolbar focus', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('table');
    document.body.append(hostElement, marker);
    const focus = vi.fn();
    const alignments: string[] = [];
    let tableRemovals = 0;
    const controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return { cell: { attrs: { align: 'center' } }, tablePos: 0 };
      },
      normalizeTableAlignment(value) {
        return value === 'center' ? 'center' : null;
      },
      removeActiveTable() {
        tableRemovals += 1;
      },
      setTableColumnAlignment(_view, align) {
        alignments.push(align);
      },
    });
    const view = {
      ...createView(),
      focus,
      nodeDOM() {
        return marker;
      },
    };
    controllers.tableToolbar.update(view);

    const toolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'));
    const alignLeft = toolbar.querySelector<HTMLButtonElement>('[aria-label="Align left"]')!;
    const alignCenter = toolbar.querySelector<HTMLButtonElement>('[aria-label="Align center"]')!;
    const alignRight = toolbar.querySelector<HTMLButtonElement>('[aria-label="Align right"]')!;
    const deleteTable = toolbar.querySelector<HTMLButtonElement>('[aria-label="Delete table"]')!;

    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1]);
    expect(alignLeft.getAttribute('aria-pressed')).toBe('false');
    expect(alignCenter.getAttribute('aria-pressed')).toBe('true');
    expect(alignRight.getAttribute('aria-pressed')).toBe('false');

    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1, -1, -1]);

    buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' }));
    expect(document.activeElement).toBe(deleteTable);
    deleteTable.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Home' }));
    expect(document.activeElement).toBe(buttons[0]);

    alignCenter.focus();
    alignCenter.click();
    expect(alignments).toEqual(['center']);
    expect(document.activeElement).toBe(alignCenter);
    expect(focus).not.toHaveBeenCalled();

    alignCenter.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
    expect(focus).toHaveBeenCalledOnce();

    deleteTable.click();
    expect(tableRemovals).toBe(1);
    expect(focus).toHaveBeenCalledTimes(2);

    destroyControllers(controllers);
  });
});
