import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  createDefaultUi,
  defaultUiMessages,
  type DefaultUiConfig,
  type DefaultUiMessages,
} from '../src/index';

const foreignWindows: Window[] = [];
type ControllerOptions = Parameters<ReturnType<typeof createDefaultUi>>[0];

function trackWindow(win: Window) {
  foreignWindows.push(win);
  return win;
}

function createControllers(
  hostElement: HTMLElement,
  config?: DefaultUiConfig,
  overrides: Partial<Omit<ControllerOptions, 'hostElement'>> = {},
) {
  const factory = createDefaultUi(config);

  return factory({
    addTableColumn() { return true; },
    addTableRow() { return true; },
    appendTableColumn() { return true; },
    appendTableRow() { return true; },
    getTableContext() {
      return null;
    },
    hostElement,
    insertTable() { return true; },
    insertTableColumnAt() { return true; },
    insertTableRowAt() { return true; },
    moveTableColumn() { return true; },
    moveTableRow() { return true; },
    normalizeTableAlignment() {
      return null;
    },
    removeActiveImage() {},
    removeActiveLink() {},
    removeActiveTable() { return true; },
    removeTableColumn() { return true; },
    removeTableRow() { return true; },
    resizeTable() { return true; },
    selectTableColumn() { return true; },
    selectTableRow() { return true; },
    setTableColumnAlignment() { return true; },
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
    editable: true,
    focus() {},
    state: {
      selection: {
        from: 1,
      },
    },
  } as any;
}

function createTableContext(overrides: Partial<{
  tablePos: number;
  cell: { attrs: Record<string, unknown> };
  isCellSelection: boolean;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  selectedRowFrom: number;
  selectedRowTo: number;
  selectedColumnFrom: number;
  selectedColumnTo: number;
}> = {}) {
  return {
    tablePos: 0,
    cell: { attrs: {} },
    isCellSelection: false,
    rowIndex: 0,
    columnIndex: 0,
    rowCount: 3,
    columnCount: 3,
    selectedRowFrom: 0,
    selectedRowTo: 0,
    selectedColumnFrom: 0,
    selectedColumnTo: 0,
    ...overrides,
  };
}

const localizedMessages: DefaultUiMessages = {
  cancelButtonLabel: 'ui:cancel',
  codeBlockLanguageDialogLabel: 'ui:code-dialog',
  codeBlockLanguageInputLabel: 'ui:code-input',
  codeBlockLanguageInputPlaceholder: 'ui:code-placeholder',
  codeBlockLanguageInvalidError: ({ maximumLength }) => `ui:code-invalid:${maximumLength}`,
  codeBlockLanguageStaleError: 'ui:code-stale',
  imageAltInputLabel: 'ui:image-alt',
  imageAltInputPlaceholder: 'ui:image-alt-placeholder',
  imageDialogLabel: 'ui:image-dialog',
  imageTitleInputLabel: 'ui:image-title',
  imageTitleInputPlaceholder: 'ui:image-title-placeholder',
  imageUrlInputLabel: 'ui:image-url',
  imageUrlInputPlaceholder: 'ui:image-url-placeholder',
  imageUrlInvalidError: 'ui:image-invalid',
  linkDialogLabel: 'ui:link-dialog',
  linkUrlInputLabel: 'ui:link-url',
  linkUrlInputPlaceholder: 'ui:link-placeholder',
  linkUrlInvalidError: 'ui:link-invalid',
  removeButtonLabel: 'ui:remove',
  saveButtonLabel: 'ui:save',
  tableActionStatus: ({ action, selection }) => (
    `ui:action:${action}:${selection
      ? `${selection.rowFrom}-${selection.rowTo}:${selection.columnFrom}-${selection.columnTo}`
      : 'none'}`
  ),
  tableColumnsInputLabel: 'ui:columns',
  tableColumnInsertionControlsLabel: 'ui:insert-column-between-group',
  tableColumnSelectionControlsLabel: 'ui:select-column-group',
  tableControlLabel: (control) => `ui:control:${control}`,
  tableDialogLabel: (mode) => `ui:table-dialog:${mode}`,
  tableDimensionsInvalidError: ({ maximum, minimum }) => `ui:dimensions:${minimum}-${maximum}`,
  tableGroupLabel: (group) => `ui:group:${group}`,
  tableInsertColumnBetweenLabel: ({ columnBefore, columnAfter }) => (
    `ui:insert-column:${columnBefore}-${columnAfter}`
  ),
  tableInsertRowBetweenLabel: ({ rowBefore, rowAfter }) => (
    `ui:insert-row:${rowBefore}-${rowAfter}`
  ),
  tableOperationError: (mode) => `ui:table-error:${mode}`,
  tableRowInsertionControlsLabel: 'ui:insert-row-between-group',
  tableRowSelectionControlsLabel: 'ui:select-row-group',
  tableRowsInputLabel: 'ui:rows',
  tableSelectColumnLabel: ({ column }) => `ui:select-column:${column}`,
  tableSelectRowLabel: ({ row }) => `ui:select-row:${row}`,
  tableSelectionStatus: ({ columnFrom, columnTo, rowFrom, rowTo }) => (
    `ui:selection:${rowFrom}-${rowTo}:${columnFrom}-${columnTo}`
  ),
  tableSubmitButtonLabel: (mode) => `ui:submit:${mode}`,
  tableToolbarLabel: 'ui:table-toolbar',
  unlinkButtonLabel: 'ui:unlink',
};

function destroyControllers(controllers: ReturnType<ReturnType<typeof createDefaultUi>>) {
  controllers.clearSelectionAnchor();
  controllers.codeBlockLanguageEditor?.destroy();
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
  it('publishes frozen English defaults and validates copied partial message overrides', () => {
    expect(Object.isFrozen(defaultUiMessages)).toBe(true);
    expect(defaultUiMessages.saveButtonLabel).toBe('Save');
    expect(defaultUiMessages.tableSelectionStatus({
      columnFrom: 2,
      columnTo: 3,
      rowFrom: 3,
      rowTo: 4,
    })).toBe('Rectangular selection: rows 3 through 4 and columns 2 through 3.');

    const overrides = { saveButtonLabel: 'Stored save' };
    const factory = createDefaultUi({ messages: overrides });
    overrides.saveButtonLabel = 'Mutated save';
    const hostElement = document.createElement('div');
    document.body.append(hostElement);
    const controllers = factory({
      addTableColumn() { return true; },
      addTableRow() { return true; },
      appendTableColumn() { return true; },
      appendTableRow() { return true; },
      getTableContext() { return null; },
      hostElement,
      insertTable() { return true; },
      insertTableColumnAt() { return true; },
      insertTableRowAt() { return true; },
      moveTableColumn() { return true; },
      moveTableRow() { return true; },
      normalizeTableAlignment() { return null; },
      removeActiveImage() {},
      removeActiveLink() {},
      removeActiveTable() { return true; },
      removeTableColumn() { return true; },
      removeTableRow() { return true; },
      resizeTable() { return true; },
      selectTableColumn() { return true; },
      selectTableRow() { return true; },
      setTableColumnAlignment() { return true; },
      updateActiveImage() { return true; },
      updateLinkHref() { return true; },
    });
    expect(document.querySelector('.mdw-link-editor')?.textContent).toContain('Stored save');
    expect(document.querySelector('.mdw-link-editor')?.textContent).not.toContain('Mutated save');
    destroyControllers(controllers);

    expect(() => createDefaultUi({ messages: null as never }))
      .toThrowError('Default UI messages must be an object.');
    expect(() => createDefaultUi({ messages: [] as never }))
      .toThrowError('Default UI messages must be an object.');
    expect(() => createDefaultUi({ messages: { unknownMessage: 'no' } as never }))
      .toThrowError('Unknown default UI message key unknownMessage.');
    expect(() => createDefaultUi({ messages: { saveButtonLabel: '  ' } }))
      .toThrowError('messages.saveButtonLabel must be a nonblank string.');
    expect(() => createDefaultUi({
      messages: { tableControlLabel: 'not a function' as never },
    })).toThrowError('messages.tableControlLabel must be a function.');
    expect(() => createDefaultUi({
      messages: { tableControlLabel: () => '' },
    })).toThrowError('messages.tableControlLabel result must be a nonblank string.');

    const symbol = Symbol('unknown');
    expect(() => createDefaultUi({ messages: { [symbol]: 'no' } as never }))
      .toThrowError('Unknown default UI message key Symbol(unknown).');
  });

  it('threads complete localized copy and whole table formatters through every overlay', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('button');
    const tableMarker = document.createElement('table');
    document.body.append(hostElement, marker, tableMarker);
    const tableContext = createTableContext({
      columnCount: 5,
      rowCount: 6,
      selectedColumnFrom: 1,
      selectedColumnTo: 2,
      selectedRowFrom: 2,
      selectedRowTo: 3,
    });
    const controllers = createControllers(hostElement, { messages: localizedMessages }, {
      getTableContext() {
        return tableContext;
      },
      insertTable() {
        return false;
      },
      resizeTable() {
        return false;
      },
      updateActiveImage() {
        return false;
      },
      updateLinkHref() {
        return false;
      },
    });
    const view = createView();
    view.nodeDOM = () => tableMarker;

    const languageEditor = controllers.codeBlockLanguageEditor!;
    languageEditor.open(view, marker, {
      language: 'ts',
      update() {
        return false;
      },
    });
    const codeDialog = document.querySelector<HTMLElement>('.mdw-code-language-editor')!;
    const codeInput = codeDialog.querySelector<HTMLInputElement>('input')!;
    expect(codeDialog.getAttribute('aria-label')).toBe('ui:code-dialog');
    expect(codeInput.getAttribute('aria-label')).toBe('ui:code-input');
    expect(codeInput.placeholder).toBe('ui:code-placeholder');
    expect(Array.from(codeDialog.querySelectorAll('button')).map((button) => button.textContent))
      .toEqual(['ui:save', 'ui:cancel']);
    codeInput.value = 'bad\0info';
    codeDialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(codeDialog.querySelector('[role="alert"]')?.textContent).toBe('ui:code-invalid:128');
    codeInput.value = 'rust';
    codeInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    codeDialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(codeDialog.querySelector('[role="alert"]')?.textContent).toBe('ui:code-stale');
    languageEditor.close(false);

    controllers.linkEditor.open(view, marker, 'https://example.com');
    const linkDialog = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const linkInput = linkDialog.querySelector<HTMLInputElement>('input')!;
    expect(linkDialog.getAttribute('aria-label')).toBe('ui:link-dialog');
    expect(linkInput.getAttribute('aria-label')).toBe('ui:link-url');
    expect(linkInput.placeholder).toBe('ui:link-placeholder');
    expect(Array.from(linkDialog.querySelectorAll('button')).map((button) => button.textContent))
      .toEqual(['ui:save', 'ui:unlink', 'ui:cancel']);
    linkDialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(linkDialog.querySelector('[role="alert"]')?.textContent).toBe('ui:link-invalid');
    controllers.linkEditor.close(false);

    controllers.imageEditor.open(view, marker, { node: { attrs: {} } } as never);
    const imageDialog = document.querySelector<HTMLElement>('.mdw-image-editor')!;
    const imageInputs = Array.from(imageDialog.querySelectorAll<HTMLInputElement>('input'));
    expect(imageDialog.getAttribute('aria-label')).toBe('ui:image-dialog');
    expect(imageInputs.map((input) => input.getAttribute('aria-label')))
      .toEqual(['ui:image-url', 'ui:image-alt', 'ui:image-title']);
    expect(imageInputs.map((input) => input.placeholder)).toEqual([
      'ui:image-url-placeholder',
      'ui:image-alt-placeholder',
      'ui:image-title-placeholder',
    ]);
    expect(Array.from(imageDialog.querySelectorAll('button')).map((button) => button.textContent))
      .toEqual(['ui:save', 'ui:remove', 'ui:cancel']);
    imageDialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(imageDialog.querySelector('[role="alert"]')?.textContent).toBe('ui:image-invalid');
    controllers.imageEditor.close(false);

    controllers.tableToolbar.update(view);
    const toolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    expect(toolbar.getAttribute('aria-label')).toBe('ui:table-toolbar');
    expect(Array.from(toolbar.querySelectorAll('[role="group"]')).map((group) => (
      group.getAttribute('aria-label')
    ))).toEqual(['ui:group:row', 'ui:group:column', 'ui:group:alignment', 'ui:group:table']);
    const tableButtons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'));
    expect(tableButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'ui:control:insert-row-before',
      'ui:control:insert-row-after',
      'ui:control:move-row-up',
      'ui:control:move-row-down',
      'ui:control:delete-row',
      'ui:control:insert-column-before',
      'ui:control:insert-column-after',
      'ui:control:move-column-left',
      'ui:control:move-column-right',
      'ui:control:delete-column',
      'ui:control:automatic-alignment',
      'ui:control:align-left',
      'ui:control:align-center',
      'ui:control:align-right',
      'ui:control:resize-table',
      'ui:control:delete-table',
    ]);
    expect(tableButtons.map((button) => button.title))
      .toEqual(tableButtons.map((button) => button.getAttribute('aria-label')));
    const tableIcons = tableButtons.map((button) => button.querySelector<SVGElement>('svg'));
    expect(tableIcons).toHaveLength(16);
    for (const icon of tableIcons) {
      expect(icon).not.toBeNull();
      expect(icon?.classList.contains('lucide')).toBe(true);
      expect(icon?.classList.contains('mdw-table-toolbar-icon')).toBe(true);
      expect(icon?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.getAttribute('focusable')).toBe('false');
      expect(icon?.childElementCount).toBeGreaterThan(0);
    }
    expect(toolbar.querySelector('[aria-label="ui:control:delete-row"] svg')?.classList)
      .toContain('lucide-trash-2');
    expect(toolbar.querySelector('[aria-label="ui:control:delete-column"] svg')?.classList)
      .toContain('lucide-trash-2');
    expect(toolbar.querySelector('[role="status"]')?.textContent).toBe('ui:selection:3-4:2-3');
    const edgeControls = document.querySelector<HTMLElement>('.mdw-table-edge-controls')!;
    expect(Array.from(edgeControls.querySelectorAll('[role="group"]')).map((group) => (
      group.getAttribute('aria-label')
    ))).toEqual([
      'ui:select-row-group',
      'ui:select-column-group',
      'ui:insert-row-between-group',
      'ui:insert-column-between-group',
    ]);
    expect(Array.from(edgeControls.querySelectorAll<HTMLButtonElement>(
      '.mdw-table-edge-selector[data-mdw-table-axis="row"]',
    )).map((button) => button.getAttribute('aria-label'))).toEqual([
      'ui:select-row:1',
      'ui:select-row:2',
      'ui:select-row:3',
      'ui:select-row:4',
      'ui:select-row:5',
      'ui:select-row:6',
    ]);
    expect(Array.from(edgeControls.querySelectorAll<HTMLButtonElement>(
      '.mdw-table-edge-insertion[data-mdw-table-axis="column"]',
    )).map((button) => button.getAttribute('aria-label'))).toEqual([
      'ui:insert-column:1-2',
      'ui:insert-column:2-3',
      'ui:insert-column:3-4',
      'ui:insert-column:4-5',
    ]);
    expect(edgeControls.querySelector('svg.mdw-table-edge-insertion-icon.lucide')).not.toBeNull();
    tableButtons[0]!.click();
    expect(toolbar.querySelector('[role="status"]')?.textContent)
      .toBe('ui:action:insert-row-before:3-4:2-3');

    controllers.tableToolbar.create?.(view, marker);
    const sizeDialog = document.querySelector<HTMLElement>('.mdw-table-size-editor')!;
    const sizeForm = sizeDialog.querySelector<HTMLFormElement>('form')!;
    const sizeInputs = Array.from(sizeDialog.querySelectorAll<HTMLInputElement>('input'));
    expect(sizeDialog.getAttribute('aria-label')).toBe('ui:table-dialog:create');
    expect(sizeInputs.map((input) => input.getAttribute('aria-label'))).toEqual(['ui:rows', 'ui:columns']);
    expect(Array.from(sizeDialog.querySelectorAll('button')).map((button) => button.textContent))
      .toEqual(['ui:submit:create', 'ui:cancel']);
    sizeInputs[0]!.value = '0';
    sizeForm.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(sizeDialog.querySelector('[role="alert"]')?.textContent).toBe('ui:dimensions:1-100');
    sizeInputs[0]!.value = '2';
    sizeInputs[1]!.value = '3';
    sizeForm.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(sizeDialog.querySelector('[role="alert"]')?.textContent).toBe('ui:table-error:create');
    Array.from(sizeDialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'ui:cancel')!
      .click();

    tableButtons[14]!.click();
    expect(sizeDialog.getAttribute('aria-label')).toBe('ui:table-dialog:resize');
    expect(Array.from(sizeDialog.querySelectorAll('button')).map((button) => button.textContent))
      .toEqual(['ui:submit:resize', 'ui:cancel']);
    sizeForm.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(sizeDialog.querySelector('[role="alert"]')?.textContent).toBe('ui:table-error:resize');

    destroyControllers(controllers);
  });

  it('edits exact code-fence info with accessible, IME-safe trigger focus', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('button');
    marker.type = 'button';
    document.body.append(hostElement, marker);
    const updates: string[] = [];
    const controllers = createControllers(hostElement);
    const languageEditor = controllers.codeBlockLanguageEditor!;
    const view = createView();

    expect(languageEditor.open(view, marker, {
      language: 'lang`variant metadata=true',
      update(nextLanguage) {
        updates.push(nextLanguage);
        return true;
      },
    })).toBe(true);

    const dialog = document.querySelector<HTMLElement>('.mdw-code-language-editor')!;
    const input = dialog.querySelector<HTMLInputElement>(
      '[aria-label="Code block language or fence info"]',
    )!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(input.value).toBe('lang`variant metadata=true');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);

    input.value = 'typescript\0strict=true';
    Array.from(dialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save')
      ?.click();
    expect(updates).toEqual([]);
    expect(dialog.hidden).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    input.value = 'typescript strict=true';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));
    Array.from(dialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save')
      ?.click();
    expect(updates).toEqual([]);
    expect(languageEditor.isComposing?.()).toBe(true);
    expect(dialog.hidden).toBe(false);

    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));
    expect(updates).toEqual(['typescript strict=true']);
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(marker);

    const hostButton = document.createElement('button');
    document.body.append(hostButton);
    expect(languageEditor.open(view, marker, {
      language: 'old',
      update() {
        hostButton.focus();
        return true;
      },
    })).toBe(true);
    input.value = 'new';
    Array.from(dialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save')
      ?.click();
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(hostButton);

    expect(languageEditor.open(view, marker, {
      language: 'old',
      update() {
        return false;
      },
    })).toBe(true);
    input.value = 'new';
    Array.from(dialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save')
      ?.click();
    expect(dialog.hidden).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-errormessage')!)?.hidden).toBe(false);

    destroyControllers(controllers);
  });

  it('cleans up a code-language open invalidated during focus reentrancy', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('button');
    document.body.append(hostElement, marker);
    const controllers = createControllers(hostElement);
    const languageEditor = controllers.codeBlockLanguageEditor!;
    const input = document.querySelector<HTMLInputElement>(
      '.mdw-code-language-editor-input',
    )!;
    input.addEventListener('focus', () => marker.remove(), { once: true });

    expect(languageEditor.open(createView(), marker, {
      language: 'ts',
      update: () => true,
    })).toBe(false);
    expect(document.querySelector<HTMLElement>('.mdw-code-language-editor')?.hidden).toBe(true);

    destroyControllers(controllers);
  });

  it('exposes named non-modal dialogs, selects the primary value, and submits with Enter', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    document.body.append(hostElement, marker);
    const linkUpdates: string[] = [];
    const imageUpdates: Array<{ src: string; alt: string | null; title: string | null }> = [];
    const focus = vi.fn();
    const controllers = createControllers(hostElement, undefined, {
      updateActiveImage(_view, attrs) {
        imageUpdates.push(attrs);
        return true;
      },
      updateLinkHref(_view, href) {
        linkUpdates.push(href);
        return true;
      },
    });
    const view = { ...createView(), focus };

    controllers.linkEditor.open(view, marker, 'https://example.com/docs');
    const linkDialog = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const linkInput = linkDialog.querySelector<HTMLInputElement>('[aria-label="Link URL"]')!;

    expect(linkDialog.getAttribute('role')).toBe('dialog');
    expect(linkDialog.getAttribute('aria-label')).toBe('Edit link');
    expect(linkDialog.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement).toBe(linkInput);
    expect([linkInput.selectionStart, linkInput.selectionEnd]).toEqual([0, linkInput.value.length]);

    linkInput.value = 'https://example.com/guide';
    linkInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));

    expect(linkUpdates).toEqual(['https://example.com/guide']);
    expect(linkDialog.hidden).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    controllers.imageEditor.open(view, marker, {
      node: { attrs: { alt: 'Diagram', src: 'diagram.png', title: 'Architecture' } },
    });
    const imageDialog = document.querySelector<HTMLElement>('.mdw-image-editor')!;
    const srcInput = imageDialog.querySelector<HTMLInputElement>('[aria-label="Image URL"]')!;

    expect(imageDialog.getAttribute('role')).toBe('dialog');
    expect(imageDialog.getAttribute('aria-label')).toBe('Edit image');
    expect(imageDialog.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement).toBe(srcInput);
    expect([srcInput.selectionStart, srcInput.selectionEnd]).toEqual([0, srcInput.value.length]);

    srcInput.value = 'updated.png';
    srcInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));

    expect(imageUpdates).toEqual([{
      alt: 'Diagram',
      src: 'updated.png',
      title: 'Architecture',
    }]);
    expect(imageDialog.hidden).toBe(true);
    expect(focus).toHaveBeenCalledTimes(2);

    destroyControllers(controllers);
  });

  it('keeps editing overlays closed and inert while the editor is read-only', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('table');
    document.body.append(hostElement, marker);
    let editable = false;
    const linkUpdates = vi.fn();
    const imageRemovals = vi.fn();
    const tableUpdates = vi.fn();
    const controllers = createControllers(hostElement, undefined, {
      addTableColumn: tableUpdates,
      getTableContext() {
        return createTableContext();
      },
      removeActiveImage: imageRemovals,
      updateLinkHref() {
        linkUpdates();
        return true;
      },
    });
    const view = {
      ...createView(),
      get editable() {
        return editable;
      },
      nodeDOM() {
        return marker;
      },
    };
    const linkEditor = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const imageEditor = document.querySelector<HTMLElement>('.mdw-image-editor')!;
    const tableToolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const tableEdgeControls = document.querySelector<HTMLElement>('.mdw-table-edge-controls')!;

    controllers.linkEditor.open(view, marker, 'https://example.com');
    controllers.imageEditor.open(view, marker, { node: { attrs: { src: '/image.png' } } });
    controllers.tableToolbar.update(view);
    expect(linkEditor.hidden).toBe(true);
    expect(imageEditor.hidden).toBe(true);
    expect(tableToolbar.hidden).toBe(true);
    expect(tableEdgeControls.hidden).toBe(true);

    editable = true;
    controllers.linkEditor.open(view, marker, 'https://example.com');
    controllers.imageEditor.open(view, marker, { node: { attrs: { src: '/image.png' } } });
    controllers.tableToolbar.update(view);
    expect(linkEditor.hidden).toBe(false);
    expect(imageEditor.hidden).toBe(false);
    expect(tableToolbar.hidden).toBe(false);
    expect(tableEdgeControls.hidden).toBe(false);

    editable = false;
    Array.from(linkEditor.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save')
      ?.click();
    Array.from(imageEditor.querySelectorAll('button'))
      .find((button) => button.textContent === 'Remove')
      ?.click();
    tableToolbar.querySelector<HTMLButtonElement>('[aria-label="Insert column after"]')?.click();
    controllers.tableToolbar.update(view);

    expect(linkUpdates).not.toHaveBeenCalled();
    expect(imageRemovals).not.toHaveBeenCalled();
    expect(tableUpdates).not.toHaveBeenCalled();
    expect(linkEditor.hidden).toBe(true);
    expect(imageEditor.hidden).toBe(true);
    expect(tableToolbar.hidden).toBe(true);
    expect(tableEdgeControls.hidden).toBe(true);

    editable = true;
    controllers.linkEditor.open(view, marker, 'https://example.com');
    const linkInput = linkEditor.querySelector<HTMLInputElement>('[aria-label="Link URL"]')!;
    linkInput.focus();
    editable = false;
    linkInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));
    expect(linkEditor.hidden).toBe(true);

    destroyControllers(controllers);
  });

  it('closes media dialogs on outside pointer intent without treating their marker as outside', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    const outsideButton = document.createElement('button');
    document.body.append(hostElement, marker, outsideButton);
    const focus = vi.fn();
    const controllers = createControllers(hostElement);
    const view = { ...createView(), focus };
    const linkDialog = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const imageDialog = document.querySelector<HTMLElement>('.mdw-image-editor')!;

    controllers.linkEditor.open(view, marker, '/docs');
    marker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(linkDialog.hidden).toBe(false);

    outsideButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(linkDialog.hidden).toBe(true);
    expect(focus).not.toHaveBeenCalled();

    controllers.imageEditor.open(view, marker, { node: { attrs: { src: 'image.png' } } });
    imageDialog.querySelector('button')?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      composed: true,
    }));
    expect(imageDialog.hidden).toBe(false);

    outsideButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(imageDialog.hidden).toBe(true);
    expect(focus).not.toHaveBeenCalled();

    destroyControllers(controllers);
  });

  it('appends overlays and selection anchors to the host document by default', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    const hostElement = foreignWindow.document.createElement('div');
    foreignWindow.document.body.append(hostElement);

    const controllers = createControllers(hostElement);
    const anchor = controllers.createSelectionAnchor(createView());

    expect(foreignWindow.document.body.querySelector('.mdw-link-editor')).not.toBeNull();
    expect(foreignWindow.document.body.querySelector('.mdw-code-language-editor')).not.toBeNull();
    expect(foreignWindow.document.body.querySelector('.mdw-image-editor')).not.toBeNull();
    expect(foreignWindow.document.body.querySelector('.mdw-table-toolbar')).not.toBeNull();
    expect(anchor).not.toBeNull();
    expect(foreignWindow.document.body.contains(anchor)).toBe(true);
    expect(document.body.querySelector('.mdw-link-editor')).toBeNull();
    expect(document.body.querySelector('.mdw-code-language-editor')).toBeNull();
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
    expect(shadowRoot.querySelector('.mdw-code-language-editor')).not.toBeNull();
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

  it('uses the owner realm and deep Shadow DOM focus when restoring dialog focus', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    const shadowHost = foreignWindow.document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const hostElement = foreignWindow.document.createElement('div');
    const marker = foreignWindow.document.createElement('span');
    const outsideButton = foreignWindow.document.createElement('button');
    shadowRoot.append(hostElement, marker);
    foreignWindow.document.body.append(shadowHost, outsideButton);
    const focus = vi.fn();
    const controllers = createControllers(hostElement);
    const view = { ...createView(), focus };

    controllers.linkEditor.open(view, marker, '/docs');
    const dialog = shadowRoot.querySelector<HTMLElement>('.mdw-link-editor')!;
    const input = dialog.querySelector<HTMLInputElement>('[aria-label="Link URL"]')!;

    expect(shadowRoot.activeElement).toBe(input);
    input.dispatchEvent(new foreignWindow.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));
    expect(focus).toHaveBeenCalledOnce();

    controllers.linkEditor.open(view, marker, '/docs');
    outsideButton.focus();
    controllers.linkEditor.close(true);

    expect(foreignWindow.document.activeElement).toBe(outsideButton);
    expect(focus).toHaveBeenCalledOnce();

    destroyControllers(controllers);
  });

  it('restores focus from a closed Shadow DOM portal', () => {
    const shadowHost = document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    shadowRoot.append(hostElement, marker);
    document.body.append(shadowHost);
    const focus = vi.fn();
    const controllers = createControllers(hostElement);
    const view = { ...createView(), focus };

    controllers.imageEditor.open(view, marker, { node: { attrs: { src: 'image.png' } } });
    const dialog = shadowRoot.querySelector<HTMLElement>('.mdw-image-editor')!;
    const input = dialog.querySelector<HTMLInputElement>('[aria-label="Image URL"]')!;

    expect(shadowRoot.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));

    expect(dialog.hidden).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    destroyControllers(controllers);
  });

  it('keeps code-language controls live through closed Shadow DOM pointer retargeting', async () => {
    const shadowHost = document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
    const hostElement = document.createElement('div');
    const marker = document.createElement('button');
    shadowRoot.append(hostElement, marker);
    document.body.append(shadowHost);
    const controllers = createControllers(hostElement);
    const updates: string[] = [];
    const view = createView();

    expect(controllers.codeBlockLanguageEditor?.open(view, marker, {
      language: 'ts',
      update(nextLanguage) {
        updates.push(nextLanguage);
        return true;
      },
    })).toBe(true);
    const dialog = shadowRoot.querySelector<HTMLElement>('.mdw-code-language-editor')!;
    const input = dialog.querySelector<HTMLInputElement>(
      '[aria-label="Code block language or fence info"]',
    )!;
    const save = Array.from(dialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save')!;
    input.value = 'typescript';
    save.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await Promise.resolve();

    expect(dialog.hidden).toBe(false);
    save.click();
    expect(updates).toEqual(['typescript']);
    expect(dialog.hidden).toBe(true);

    destroyControllers(controllers);
  });

  it('roves table-toolbar focus safely in a foreign Shadow DOM realm', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    const shadowHost = foreignWindow.document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const hostElement = foreignWindow.document.createElement('div');
    const marker = foreignWindow.document.createElement('table');
    shadowRoot.append(hostElement, marker);
    foreignWindow.document.body.append(shadowHost);
    const focus = vi.fn();
    const controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return createTableContext({ cell: { attrs: { align: 'right' } } });
      },
      normalizeTableAlignment(value) {
        return value === 'right' ? 'right' : null;
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

    const toolbar = shadowRoot.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'));
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new foreignWindow.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    }));

    expect(shadowRoot.activeElement).toBe(buttons[1]);
    expect(toolbar.querySelector('[aria-label="Align right"]')?.getAttribute('aria-pressed')).toBe('true');

    buttons[1]!.dispatchEvent(new foreignWindow.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));
    expect(focus).toHaveBeenCalledOnce();

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
    expect(portalRoot.querySelector('.mdw-code-language-editor')).not.toBeNull();
    expect(portalRoot.querySelector('.mdw-image-editor')).not.toBeNull();
    expect(portalRoot.querySelector('.mdw-table-toolbar')).not.toBeNull();
    expect(shadowRoot.querySelector('.mdw-link-editor')).toBeNull();
    expect(anchor).not.toBeNull();
    expect(portalRoot.contains(anchor)).toBe(true);
    expect(anchor?.style.left).toBe('12px');
    expect(anchor?.style.top).toBe('24px');

    destroyControllers(controllers);
  });

  it('keeps body-portaled overlays in the active editor theme, language, and direction', async () => {
    setWindowMetrics(window, { height: 600, width: 800 });
    const hostElement = document.createElement('div');
    const editorDom = document.createElement('div');
    const marker = document.createElement('span');
    hostElement.className = 'mdw-theme-dark';
    hostElement.dataset.mdwTheme = 'dark';
    hostElement.lang = 'ar';
    editorDom.dir = 'rtl';
    editorDom.style.direction = 'rtl';
    editorDom.style.setProperty('--mdw-color-accent', 'rgb(12, 34, 56)');
    hostElement.append(editorDom, marker);
    document.body.append(hostElement);
    setElementRect(marker, { bottom: 220, left: 420, right: 440, top: 200 });

    const controllers = createControllers(hostElement);
    const view = {
      ...createView(),
      dom: editorDom,
    };
    const linkEditor = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    setOverlaySize(linkEditor, 100, 80);
    controllers.linkEditor.open(view, marker, 'https://example.com');

    expect(linkEditor.classList.contains('mdw-ui')).toBe(true);
    expect(linkEditor.classList.contains('mdw-theme-dark')).toBe(true);
    expect(linkEditor.dataset.mdwTheme).toBe('dark');
    expect(linkEditor.lang).toBe('ar');
    expect(linkEditor.dir).toBe('rtl');
    expect(linkEditor.style.getPropertyValue('--mdw-color-accent')).toBe('rgb(12, 34, 56)');
    expect(linkEditor.style.left).toBe('340px');

    hostElement.classList.replace('mdw-theme-dark', 'mdw-theme-light');
    hostElement.dataset.mdwTheme = 'light';
    hostElement.lang = 'fr';
    editorDom.dir = 'ltr';
    editorDom.style.direction = 'ltr';
    editorDom.style.setProperty('--mdw-color-accent', 'rgb(65, 43, 21)');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(linkEditor.classList.contains('mdw-theme-dark')).toBe(false);
    expect(linkEditor.classList.contains('mdw-theme-light')).toBe(true);
    expect(linkEditor.dataset.mdwTheme).toBe('light');
    expect(linkEditor.lang).toBe('fr');
    expect(linkEditor.dir).toBe('ltr');
    expect(linkEditor.style.getPropertyValue('--mdw-color-accent')).toBe('rgb(65, 43, 21)');
    expect(linkEditor.style.left).toBe('420px');

    editorDom.lang = '';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(linkEditor.getAttribute('lang')).toBe('');

    editorDom.dataset.mdwTheme = 'contrast';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(linkEditor.dataset.mdwTheme).toBe('contrast');
    expect(linkEditor.classList.contains('mdw-theme-light')).toBe(false);

    destroyControllers(controllers);
  });

  it('refreshes a body-portaled overlay after the editor is reparented between scopes', () => {
    const darkScope = document.createElement('div');
    const lightScope = document.createElement('div');
    const hostElement = document.createElement('div');
    const editorDom = document.createElement('div');
    const marker = document.createElement('span');
    darkScope.className = 'mdw-theme-dark';
    darkScope.dataset.mdwTheme = 'dark';
    darkScope.lang = 'ar';
    lightScope.className = 'mdw-theme-light';
    lightScope.dataset.mdwTheme = 'light';
    lightScope.lang = 'fr';
    hostElement.append(editorDom, marker);
    darkScope.append(hostElement);
    document.body.append(darkScope, lightScope);

    const controllers = createControllers(hostElement);
    const view = {
      ...createView(),
      dom: editorDom,
    };
    const linkEditor = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    controllers.linkEditor.open(view, marker, 'https://example.com');
    expect(linkEditor.dataset.mdwTheme).toBe('dark');
    expect(linkEditor.lang).toBe('ar');

    lightScope.append(hostElement);
    controllers.linkEditor.open(view, marker, 'https://example.com');
    expect(linkEditor.dataset.mdwTheme).toBe('light');
    expect(linkEditor.classList.contains('mdw-theme-dark')).toBe(false);
    expect(linkEditor.classList.contains('mdw-theme-light')).toBe(true);
    expect(linkEditor.lang).toBe('fr');

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

  it('restores media-dialog focus through synchronous controller updates without stealing host focus', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    const hostButton = document.createElement('button');
    document.body.append(hostElement, marker, hostButton);
    const focus = vi.fn();
    let controllers: ReturnType<ReturnType<typeof createDefaultUi>>;
    let focusHostDuringUpdate = false;

    controllers = createControllers(hostElement, undefined, {
      removeActiveImage() {
        controllers.imageEditor.close(false);
      },
      removeActiveLink() {
        controllers.linkEditor.close(false);
      },
      updateLinkHref() {
        if (focusHostDuringUpdate) {
          hostButton.focus();
        }
        return true;
      },
    });
    const view = { ...createView(), focus };

    controllers.linkEditor.open(view, marker, '/docs');
    const linkDialog = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const unlinkButton = Array.from(linkDialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Unlink')!;
    unlinkButton.focus();
    unlinkButton.click();

    expect(linkDialog.hidden).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    controllers.imageEditor.open(view, marker, { node: { attrs: { src: 'image.png' } } });
    const imageDialog = document.querySelector<HTMLElement>('.mdw-image-editor')!;
    const removeButton = Array.from(imageDialog.querySelectorAll('button'))
      .find((button) => button.textContent === 'Remove')!;
    removeButton.focus();
    removeButton.click();

    expect(imageDialog.hidden).toBe(true);
    expect(focus).toHaveBeenCalledTimes(2);

    controllers.linkEditor.open(view, marker, '/docs');
    const linkInput = linkDialog.querySelector<HTMLInputElement>('[aria-label="Link URL"]')!;
    focusHostDuringUpdate = true;
    linkInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));

    expect(linkDialog.hidden).toBe(true);
    expect(document.activeElement).toBe(hostButton);
    expect(focus).toHaveBeenCalledTimes(2);

    controllers.imageEditor.open(view, marker, { node: { attrs: { src: 'image.png' } } });
    hostButton.focus();
    controllers.imageEditor.close(true);

    expect(imageDialog.hidden).toBe(true);
    expect(document.activeElement).toBe(hostButton);
    expect(focus).toHaveBeenCalledTimes(2);

    destroyControllers(controllers);
  });

  it('does not close or refocus over a replacement media-dialog session', () => {
    const hostElement = document.createElement('div');
    const firstMarker = document.createElement('span');
    const replacementMarker = document.createElement('span');
    document.body.append(hostElement, firstMarker, replacementMarker);
    const focus = vi.fn();
    let controllers: ReturnType<ReturnType<typeof createDefaultUi>>;
    const view = { ...createView(), focus };

    controllers = createControllers(hostElement, undefined, {
      updateActiveImage() {
        controllers.imageEditor.open(view, replacementMarker, {
          node: { attrs: { alt: 'Replacement', src: 'replacement.png' } },
        });
        return true;
      },
      updateLinkHref() {
        controllers.linkEditor.open(view, replacementMarker, '/replacement');
        return true;
      },
    });

    controllers.linkEditor.open(view, firstMarker, '/first');
    const linkDialog = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const linkInput = linkDialog.querySelector<HTMLInputElement>('[aria-label="Link URL"]')!;
    linkInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));

    expect(linkDialog.hidden).toBe(false);
    expect(linkInput.value).toBe('/replacement');
    expect(document.activeElement).toBe(linkInput);
    expect(focus).not.toHaveBeenCalled();

    controllers.imageEditor.open(view, firstMarker, { node: { attrs: { src: 'first.png' } } });
    const imageDialog = document.querySelector<HTMLElement>('.mdw-image-editor')!;
    const imageInput = imageDialog.querySelector<HTMLInputElement>('[aria-label="Image URL"]')!;
    imageInput.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));

    expect(imageDialog.hidden).toBe(false);
    expect(imageInput.value).toBe('replacement.png');
    expect(document.activeElement).toBe(imageInput);
    expect(focus).not.toHaveBeenCalled();

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
      addTableColumn() {
        tableUpdates += 1;
      },
      getTableContext() {
        return createTableContext();
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
    const insertColumn = document.querySelector<HTMLButtonElement>('.mdw-table-toolbar [aria-label="Insert column after"]');
    const linkDialog = document.querySelector<HTMLElement>('.mdw-link-editor')!;
    const imageDialog = document.querySelector<HTMLElement>('.mdw-image-editor')!;
    const tableToolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;

    controllers.linkEditor.destroy();
    controllers.imageEditor.destroy();
    controllers.tableToolbar.destroy();
    controllers.linkEditor.destroy();
    controllers.imageEditor.destroy();
    controllers.tableToolbar.destroy();
    linkSave?.click();
    imageSave?.click();
    insertColumn?.click();
    controllers.linkEditor.open(view, marker, 'https://example.com/reopened');
    controllers.imageEditor.open(view, marker, { node: { attrs: { src: 'reopened.png' } } });
    controllers.tableToolbar.update(view);

    expect(linkUpdates).toBe(0);
    expect(imageUpdates).toBe(0);
    expect(tableUpdates).toBe(0);
    expect(linkDialog.isConnected).toBe(false);
    expect(imageDialog.isConnected).toBe(false);
    expect(tableToolbar.isConnected).toBe(false);
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
    const removeViewportListener = vi.spyOn(visualViewport, 'removeEventListener');
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

    Object.defineProperty(foreignWindow, 'visualViewport', {
      configurable: true,
      value: new foreignWindow.EventTarget(),
    });
    destroyControllers(controllers);
    expect(removeViewportListener).toHaveBeenCalledTimes(10);
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
        return createTableContext({ cell: { attrs: { align: 'center' } } });
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

  it('preserves the contenteditable selection and toolbar focus across table mutations', () => {
    const hostElement = document.createElement('div');
    hostElement.contentEditable = 'true';
    const paragraph = document.createElement('p');
    const text = document.createTextNode('selected text');
    const marker = document.createElement('table');
    paragraph.append(text);
    hostElement.append(paragraph, marker);
    document.body.append(hostElement);
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 9);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    let alignment: 'left' | 'center' | 'right' = 'left';
    let columnInsertions = 0;
    let controllers: ReturnType<ReturnType<typeof createDefaultUi>>;
    const view = {
      ...createView(),
      nodeDOM() {
        return marker;
      },
    };
    controllers = createControllers(hostElement, undefined, {
      addTableColumn() {
        columnInsertions += 1;
        controllers.tableToolbar.update(view);
      },
      getTableContext() {
        return createTableContext({
          cell: { attrs: { align: alignment } },
          columnIndex: 1,
          selectedColumnFrom: 1,
          selectedColumnTo: 1,
        });
      },
      normalizeTableAlignment(value) {
        return value === 'left' || value === 'center' || value === 'right' ? value : null;
      },
      setTableColumnAlignment(_view, value) {
        alignment = value;
        controllers.tableToolbar.update(view);
      },
    });
    controllers.tableToolbar.update(view);

    const toolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const insertColumn = toolbar.querySelector<HTMLButtonElement>('[aria-label="Insert column after"]')!;
    const alignCenter = toolbar.querySelector<HTMLButtonElement>('[aria-label="Align center"]')!;
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true });
    insertColumn.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.getSelection()?.toString()).toBe('elected ');

    insertColumn.focus();
    insertColumn.click();
    expect(columnInsertions).toBe(1);
    expect(document.activeElement).toBe(insertColumn);

    alignCenter.focus();
    alignCenter.click();
    expect(document.activeElement).toBe(alignCenter);
    expect(alignCenter.getAttribute('aria-pressed')).toBe('true');
    expect(toolbar.querySelector('[aria-label="Align left"]')?.getAttribute('aria-pressed')).toBe('false');

    destroyControllers(controllers);
  });

  it('restores focus after deleting a table unless the command moved it to a host control', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('table');
    const hostButton = document.createElement('button');
    document.body.append(hostElement, marker, hostButton);
    let hasTable = true;
    let focusHostDuringDelete = false;
    let controllers: ReturnType<ReturnType<typeof createDefaultUi>>;
    const focus = vi.fn();
    const view = {
      ...createView(),
      focus,
      nodeDOM() {
        return marker;
      },
    };
    controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return hasTable ? createTableContext() : null;
      },
      removeActiveTable() {
        hasTable = false;

        if (focusHostDuringDelete) {
          hostButton.focus();
        }

        controllers.tableToolbar.update(view);
      },
    });

    controllers.tableToolbar.update(view);
    const toolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const deleteTable = toolbar.querySelector<HTMLButtonElement>('[aria-label="Delete table"]')!;
    deleteTable.focus();
    deleteTable.click();

    expect(toolbar.hidden).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    hasTable = true;
    focusHostDuringDelete = true;
    controllers.tableToolbar.update(view);
    deleteTable.focus();
    deleteTable.click();

    expect(toolbar.hidden).toBe(true);
    expect(document.activeElement).toBe(hostButton);
    expect(focus).toHaveBeenCalledOnce();

    destroyControllers(controllers);
  });

  it('exposes pressed alignment state and roves table-toolbar focus', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('table');
    document.body.append(hostElement, marker);
    const focus = vi.fn();
    const alignments: Array<string | null> = [];
    let tableRemovals = 0;
    const controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return createTableContext({ cell: { attrs: { align: 'center' } } });
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
    const alignAutomatic = toolbar.querySelector<HTMLButtonElement>('[aria-label="Automatic alignment"]')!;
    const alignLeft = toolbar.querySelector<HTMLButtonElement>('[aria-label="Align left"]')!;
    const alignCenter = toolbar.querySelector<HTMLButtonElement>('[aria-label="Align center"]')!;
    const alignRight = toolbar.querySelector<HTMLButtonElement>('[aria-label="Align right"]')!;
    const deleteTable = toolbar.querySelector<HTMLButtonElement>('[aria-label="Delete table"]')!;

    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(toolbar.getAttribute('aria-label')).toBe('Table controls');
    expect(Array.from(toolbar.querySelectorAll('[role="group"]')).map((group) => group.getAttribute('aria-label')))
      .toEqual(['Row', 'Column', 'Alignment', 'Table']);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Insert row before',
      'Insert row after',
      'Move row up',
      'Move row down',
      'Delete row',
      'Insert column before',
      'Insert column after',
      'Move column left',
      'Move column right',
      'Delete column',
      'Automatic alignment',
      'Align left',
      'Align center',
      'Align right',
      'Resize table',
      'Delete table',
    ]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    expect(toolbar.querySelector<HTMLButtonElement>('[aria-label="Move row up"]')?.disabled).toBe(true);
    expect(toolbar.querySelector<HTMLButtonElement>('[aria-label="Move column left"]')?.disabled).toBe(true);
    expect(alignAutomatic.getAttribute('aria-pressed')).toBe('false');
    expect(alignLeft.getAttribute('aria-pressed')).toBe('false');
    expect(alignCenter.getAttribute('aria-pressed')).toBe('true');
    expect(alignRight.getAttribute('aria-pressed')).toBe('false');

    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);

    buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: 'ArrowRight',
    }));
    expect(document.activeElement).toBe(buttons[1]);

    buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    expect(document.activeElement).toBe(buttons[4]);
    buttons[4]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(deleteTable);

    deleteTable.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Home' }));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' }));
    expect(document.activeElement).toBe(deleteTable);
    deleteTable.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Home' }));
    expect(document.activeElement).toBe(buttons[0]);

    expect(controllers.tableToolbar.focus(view)).toBe(true);
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

  it('routes explicit table operations, moves focus off disabled boundaries, and announces selections', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('table');
    document.body.append(hostElement, marker);
    let context = createTableContext({
      cell: { attrs: {} },
      columnCount: 4,
      columnIndex: 1,
      rowIndex: 2,
      rowCount: 5,
      selectedColumnFrom: 1,
      selectedColumnTo: 2,
      selectedRowFrom: 2,
      selectedRowTo: 3,
    });
    const rowInsertions: string[] = [];
    const columnInsertions: string[] = [];
    const rowMoves: string[] = [];
    const columnMoves: string[] = [];
    const alignments: Array<string | null> = [];
    let rowRemovals = 0;
    let columnRemovals = 0;
    const controllers = createControllers(hostElement, undefined, {
      addTableColumn(_view, side) {
        columnInsertions.push(side);
      },
      addTableRow(_view, side) {
        rowInsertions.push(side);
      },
      getTableContext() {
        return context;
      },
      moveTableColumn(_view, direction) {
        columnMoves.push(direction);
      },
      moveTableRow(_view, direction) {
        rowMoves.push(direction);
      },
      removeTableColumn() {
        columnRemovals += 1;
      },
      removeTableRow() {
        rowRemovals += 1;
      },
      setTableColumnAlignment(_view, alignment) {
        alignments.push(alignment);
      },
    });
    const view = {
      ...createView(),
      nodeDOM() {
        return marker;
      },
    };
    controllers.tableToolbar.update(view);

    const toolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const click = (label: string) => toolbar.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
    expect(toolbar.querySelector('[role="status"]')?.textContent)
      .toBe('Rectangular selection: rows 3 through 4 and columns 2 through 3.');
    expect(toolbar.querySelector('[aria-label="Automatic alignment"]')?.getAttribute('aria-pressed')).toBe('true');

    click('Insert row before');
    click('Insert row after');
    click('Move row up');
    click('Move row down');
    click('Delete row');
    click('Insert column before');
    click('Insert column after');
    click('Move column left');
    click('Move column right');
    click('Delete column');
    click('Automatic alignment');
    click('Align right');

    expect(rowInsertions).toEqual(['before', 'after']);
    expect(columnInsertions).toEqual(['before', 'after']);
    expect(rowMoves).toEqual(['up', 'down']);
    expect(columnMoves).toEqual(['left', 'right']);
    expect(rowRemovals).toBe(1);
    expect(columnRemovals).toBe(1);
    expect(alignments).toEqual([null, 'right']);
    expect(toolbar.querySelector('[role="status"]')?.textContent)
      .toBe('Aligned column right. Rectangular selection: rows 3 through 4 and columns 2 through 3.');

    const moveRowUp = toolbar.querySelector<HTMLButtonElement>('[aria-label="Move row up"]')!;
    const moveRowDown = toolbar.querySelector<HTMLButtonElement>('[aria-label="Move row down"]')!;
    moveRowUp.focus();
    context = createTableContext();
    controllers.tableToolbar.update(view);

    expect(moveRowUp.disabled).toBe(true);
    expect(moveRowDown.disabled).toBe(true);
    const deleteRow = toolbar.querySelector<HTMLButtonElement>('[aria-label="Delete row"]')!;
    expect(document.activeElement).toBe(deleteRow);
    expect(Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.tabIndex === 0))
      .toEqual([deleteRow]);

    destroyControllers(controllers);
  });

  it('offers direct, labeled deletion only for a complete selected row or column', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('table');
    document.body.append(hostElement, marker);
    let context = createTableContext({
      isCellSelection: true,
      selectedColumnFrom: 0,
      selectedColumnTo: 2,
      selectedRowFrom: 1,
      selectedRowTo: 1,
    });
    let rowRemovals = 0;
    let columnRemovals = 0;
    const focus = vi.fn();
    const controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return context;
      },
      removeTableColumn() {
        columnRemovals += 1;
      },
      removeTableRow() {
        rowRemovals += 1;
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
    const edgeControls = document.querySelector<HTMLElement>('.mdw-table-edge-controls')!;
    const axisDelete = edgeControls.querySelector<HTMLButtonElement>('.mdw-table-axis-delete')!;
    expect(axisDelete.hidden).toBe(false);
    expect(axisDelete.getAttribute('aria-label')).toBe('Delete row');
    expect(axisDelete.textContent).toBe('Delete row');
    expect(axisDelete.querySelector('svg')?.classList).toContain('lucide-trash-2');
    axisDelete.focus();
    axisDelete.click();
    expect(rowRemovals).toBe(1);
    expect(columnRemovals).toBe(0);
    expect(focus).toHaveBeenCalledOnce();

    context = createTableContext({
      isCellSelection: true,
      selectedColumnFrom: 1,
      selectedColumnTo: 1,
      selectedRowFrom: 0,
      selectedRowTo: 2,
    });
    controllers.tableToolbar.update(view);
    expect(axisDelete.getAttribute('aria-label')).toBe('Delete column');
    axisDelete.click();
    expect(rowRemovals).toBe(1);
    expect(columnRemovals).toBe(1);

    context = createTableContext();
    controllers.tableToolbar.update(view);
    expect(axisDelete.hidden).toBe(true);

    destroyControllers(controllers);
  });

  it('maps table-toolbar navigation and physical column movement in RTL', async () => {
    const hostElement = document.createElement('div');
    const editorDom = document.createElement('div');
    const marker = document.createElement('table');
    editorDom.dir = 'rtl';
    editorDom.style.direction = 'rtl';
    hostElement.append(editorDom, marker);
    document.body.append(hostElement);
    let context = createTableContext({
      columnCount: 4,
      columnIndex: 1,
      rowIndex: 2,
      rowCount: 5,
      selectedColumnFrom: 1,
      selectedColumnTo: 1,
      selectedRowFrom: 2,
      selectedRowTo: 2,
    });
    const columnMoves: string[] = [];
    const controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return context;
      },
      moveTableColumn(_view, direction) {
        columnMoves.push(direction);
      },
    });
    const view = {
      ...createView(),
      dom: editorDom,
      nodeDOM() {
        return marker;
      },
    };
    controllers.tableToolbar.update(view);

    const toolbar = document.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'));
    const moveLeft = toolbar.querySelector<HTMLButtonElement>('[aria-label="Move column left"]')!;
    const moveRight = toolbar.querySelector<HTMLButtonElement>('[aria-label="Move column right"]')!;
    expect(toolbar.dir).toBe('rtl');

    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowLeft',
    }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    }));
    expect(document.activeElement).toBe(buttons[0]);

    moveLeft.click();
    moveRight.click();
    expect(columnMoves).toEqual(['right', 'left']);

    context = createTableContext({
      columnCount: 4,
      selectedColumnFrom: 0,
      selectedColumnTo: 0,
    });
    controllers.tableToolbar.update(view);
    expect(moveLeft.disabled).toBe(false);
    expect(moveRight.disabled).toBe(true);

    context = createTableContext({
      columnCount: 4,
      columnIndex: 3,
      selectedColumnFrom: 3,
      selectedColumnTo: 3,
    });
    controllers.tableToolbar.update(view);
    expect(moveLeft.disabled).toBe(true);
    expect(moveRight.disabled).toBe(false);

    editorDom.dir = 'ltr';
    editorDom.style.direction = 'ltr';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(toolbar.dir).toBe('ltr');
    expect(moveLeft.disabled).toBe(false);
    expect(moveRight.disabled).toBe(true);

    destroyControllers(controllers);
  });

  it('creates tables through validated dimensions and restores focus on submit and cancel', () => {
    const hostElement = document.createElement('div');
    const marker = document.createElement('span');
    const trigger = document.createElement('button');
    document.body.append(hostElement, marker, trigger);
    const insertions: Array<{ rows: number; columns: number }> = [];
    let editable = true;
    const controllers = createControllers(hostElement, undefined, {
      insertTable(_view, dimensions) {
        insertions.push(dimensions);
        return true;
      },
    });
    const view = {
      ...createView(),
      get editable() {
        return editable;
      },
    };

    trigger.focus();
    const onCancelClose = vi.fn();
    expect(controllers.tableToolbar.create?.(view, marker, onCancelClose)).toBe(true);
    const dialog = document.querySelector<HTMLElement>('.mdw-table-size-editor')!;
    const form = dialog.querySelector<HTMLFormElement>('form')!;
    const rows = dialog.querySelector<HTMLInputElement>('[aria-label="Rows"]')!;
    const columns = dialog.querySelector<HTMLInputElement>('[aria-label="Columns"]')!;
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!;

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Create table');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(rows.value).toBe('2');
    expect(columns.value).toBe('3');
    expect([rows.min, rows.max, rows.step]).toEqual(['1', '100', '1']);
    expect([columns.min, columns.max, columns.step]).toEqual(['1', '100', '1']);
    expect(document.activeElement).toBe(rows);

    rows.value = '0';
    columns.value = '1.5';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(insertions).toEqual([]);
    expect(rows.getAttribute('aria-invalid')).toBe('true');
    expect(columns.getAttribute('aria-invalid')).toBe('true');
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Enter whole numbers from 1 through 100.');
    expect(dialog.hidden).toBe(false);

    cancel.click();
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onCancelClose).toHaveBeenCalledOnce();

    const onSubmitClose = vi.fn();
    expect(controllers.tableToolbar.create?.(view, marker, onSubmitClose)).toBe(true);
    rows.value = '4';
    columns.value = '5';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(insertions).toEqual([{ columns: 5, rows: 4 }]);
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onSubmitClose).toHaveBeenCalledOnce();

    editable = false;
    expect(controllers.tableToolbar.create?.(view, marker)).toBe(false);
    expect(dialog.hidden).toBe(true);

    destroyControllers(controllers);
  });

  it('resizes from current dimensions in a Shadow DOM and handles rejection, Escape, read-only, and destroy', () => {
    const foreignWindow = trackWindow(new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window);
    const shadowHost = foreignWindow.document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const hostElement = foreignWindow.document.createElement('div');
    const marker = foreignWindow.document.createElement('table');
    shadowRoot.append(hostElement, marker);
    foreignWindow.document.body.append(shadowHost);
    let editable = true;
    let acceptResize = false;
    const resizes: Array<{ rows: number; columns: number }> = [];
    const controllers = createControllers(hostElement, undefined, {
      getTableContext() {
        return createTableContext({ columnCount: 5, rowCount: 4 });
      },
      resizeTable(_view, dimensions) {
        resizes.push(dimensions);
        return acceptResize;
      },
    });
    const view = {
      ...createView(),
      get editable() {
        return editable;
      },
      nodeDOM() {
        return marker;
      },
    };
    controllers.tableToolbar.update(view);

    const toolbar = shadowRoot.querySelector<HTMLElement>('.mdw-table-toolbar')!;
    const resize = toolbar.querySelector<HTMLButtonElement>('[aria-label="Resize table"]')!;
    const dialog = shadowRoot.querySelector<HTMLElement>('.mdw-table-size-editor')!;
    const form = dialog.querySelector<HTMLFormElement>('form')!;
    const rows = dialog.querySelector<HTMLInputElement>('[aria-label="Rows"]')!;
    const columns = dialog.querySelector<HTMLInputElement>('[aria-label="Columns"]')!;

    resize.focus();
    resize.click();
    expect(dialog.hidden).toBe(false);
    expect(dialog.getAttribute('aria-label')).toBe('Resize table');
    expect(rows.value).toBe('4');
    expect(columns.value).toBe('5');
    rows.value = '2';
    columns.value = '2';
    form.dispatchEvent(new foreignWindow.Event('submit', { bubbles: true, cancelable: true }));

    expect(resizes).toEqual([{ columns: 2, rows: 2 }]);
    expect(dialog.hidden).toBe(false);
    expect(dialog.querySelector('[role="alert"]')?.textContent)
      .toContain('Clear content outside the new size');

    acceptResize = true;
    rows.value = '6';
    columns.value = '7';
    marker.tabIndex = -1;
    marker.focus();
    form.dispatchEvent(new foreignWindow.Event('submit', { bubbles: true, cancelable: true }));
    expect(resizes.at(-1)).toEqual({ columns: 7, rows: 6 });
    expect(dialog.hidden).toBe(true);
    expect(shadowRoot.activeElement).toBe(resize);

    resize.click();
    rows.dispatchEvent(new foreignWindow.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));
    expect(dialog.hidden).toBe(true);
    expect(shadowRoot.activeElement).toBe(resize);

    resize.click();
    editable = false;
    controllers.tableToolbar.update(view);
    expect(dialog.hidden).toBe(true);
    expect(toolbar.hidden).toBe(true);

    editable = true;
    controllers.tableToolbar.update(view);
    resize.click();
    const submissionsBeforeDestroy = resizes.length;
    controllers.tableToolbar.destroy();
    form.dispatchEvent(new foreignWindow.Event('submit', { bubbles: true, cancelable: true }));
    expect(resizes).toHaveLength(submissionsBeforeDestroy);
    expect(dialog.isConnected).toBe(false);
    expect(controllers.tableToolbar.create?.(view, marker)).toBe(false);

    controllers.linkEditor.destroy();
    controllers.imageEditor.destroy();
  });
});
