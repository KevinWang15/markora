import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createDefaultUi } from '../src/index';

const foreignWindows: Window[] = [];

function trackWindow(win: Window) {
  foreignWindows.push(win);
  return win;
}

function createControllers(hostElement: HTMLElement, config?: { portalRoot?: HTMLElement | ShadowRoot }) {
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
    updateActiveImage() {},
    updateLinkHref() {},
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

    destroyControllers(controllers);
  });
});
