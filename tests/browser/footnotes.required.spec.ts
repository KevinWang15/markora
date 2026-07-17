import AxeBuilder from "@axe-core/playwright";
import {
  copyEditorSelection,
  dispatchTransfer,
  editorLocator,
  expect,
  focusEditor,
  getExtensionSnapshot,
  getFootnotesSnapshot,
  getMarkdown,
  mountEditor,
  reconcileEditor,
  resetEditor,
  runEditorCommand,
  runFootnotesCommand,
  selectFootnote,
  settleEditor,
  snapshotEditor,
  test,
  updateEditorOptions,
} from "./fixtures";

const PARITY_SOURCE = [
  "# Heading[^alpha]",
  "",
  "First[^alpha] and again[^alpha]. Missing[^missing].",
  "",
  "`[^code]` and \\[^escaped] stay literal.",
  "",
  "[^alpha]: First paragraph.",
  "",
  "    > Continued quote.",
  "",
  "[^alpha]: Duplicate definition.",
].join("\n");

test("@required footnotes round-trip with diagnostics in root and minimal embedded editors", async ({ labPage }) => {
  const normalized: string[] = [];

  for (const [id, entry, root] of [
    ["footnotes-root", "root", "document"],
    ["footnotes-minimal-shadow", "minimal", "shadow"],
  ] as const) {
    await mountEditor(labPage, {
      entry,
      extensionMode: "footnotes",
      id,
      markdown: PARITY_SOURCE,
      root,
    });

    const editor = editorLocator(labPage, id);
    await expect(editor.locator("[data-mdw-footnote-reference]")).toHaveCount(4);
    await expect(editor.locator("[data-mdw-footnote-definition]")).toHaveCount(2);
    await expect(editor.locator('[data-mdw-footnote-state="duplicate"]')).toHaveCount(1);
    await expect(
      editor.locator(
        '[data-mdw-footnote-state="duplicate"] .mdw-footnote-definition__label',
      ),
    ).toContainText("Duplicate definition");
    await expect(editor.locator('[data-mdw-footnote-state="unresolved"]')).toHaveCount(1);

    const snapshot = await getFootnotesSnapshot(labPage, id);
    expect(snapshot.references.map(({ label }) => label)).toEqual([
      "alpha",
      "alpha",
      "alpha",
      "missing",
    ]);
    expect(snapshot.definitions.map(({ duplicate, label, occurrence }) => ({
      duplicate,
      label,
      occurrence,
    }))).toEqual([
      { duplicate: false, label: "alpha", occurrence: 1 },
      { duplicate: true, label: "alpha", occurrence: 2 },
    ]);
    expect(snapshot.definitions[0]?.referencePositions).toHaveLength(3);
    expect(snapshot.definitions[1]?.referencePositions).toEqual([]);
    expect(snapshot.diagnostics.map(({ code, label, occurrence }) => ({
      code,
      label,
      occurrence,
    }))).toEqual([
      { code: "unresolved-reference", label: "missing", occurrence: 1 },
      { code: "duplicate-definition", label: "alpha", occurrence: 2 },
    ]);
    expect((await getExtensionSnapshot(labPage, id)).manifest).toContainEqual({
      name: "markora-extension-footnotes",
      version: "0.0.1",
    });

    const firstCanonical = await getMarkdown(labPage, id);
    normalized.push(firstCanonical);
    expect(firstCanonical).toContain("# Heading[^alpha]");
    expect(firstCanonical).toContain("`[^code]`");
    expect(firstCanonical).toContain("\\[^escaped\\]");
    expect(firstCanonical).toContain("[^alpha]: First paragraph.");
    expect(firstCanonical).toContain("    > Continued quote.");

    expect(await resetEditor(labPage, id, firstCanonical)).toBe(firstCanonical);
    expect(await getFootnotesSnapshot(labPage, id)).toEqual(snapshot);

    const reconciled = await reconcileEditor(
      labPage,
      id,
      firstCanonical.replace("First paragraph.", "Reconciled paragraph."),
    );
    expect(reconciled.changed).toBe(true);
    expect(reconciled.snapshot.markdown).toContain("Reconciled paragraph.");
    expect((await getFootnotesSnapshot(labPage, id)).diagnostics).toHaveLength(2);
  }

  expect(normalized[1]).toBe(normalized[0]);
});

test("@required footnote commands are composition-safe, read-only guarded, and one-step undoable", async ({ labPage }) => {
  const id = "footnotes-commands";
  await mountEditor(labPage, {
    extensionMode: "footnotes",
    id,
    initialSelection: "end",
    markdown: "Alpha",
  });

  expect(await runFootnotesCommand(labPage, id, {
    label: "note",
    type: "insertReference",
  })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("Alpha[^note]");
  expect(await runFootnotesCommand(labPage, id, {
    label: "note",
    type: "insertDefinition",
  })).toBe(true);
  const inserted = "Alpha[^note]\n\n[^note]: ";
  expect(await getMarkdown(labPage, id)).toBe(inserted);

  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("Alpha[^note]");
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("Alpha");
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  expect(await runEditorCommand(labPage, id, { type: "redo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(inserted);

  const editor = editorLocator(labPage, id);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      composed: true,
    }));
  });
  expect(await runFootnotesCommand(labPage, id, {
    nextLabel: "renamed",
    references: "rename",
    target: { label: "note" },
    type: "renameDefinition",
  })).toBe(false);
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      composed: true,
    }));
  });

  expect(await runFootnotesCommand(labPage, id, {
    nextLabel: "renamed",
    references: "rename",
    target: { label: "note" },
    type: "renameDefinition",
  })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("Alpha[^renamed]\n\n[^renamed]: ");
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(inserted);

  expect(await runFootnotesCommand(labPage, id, {
    nextLabel: "definition-only",
    references: "preserve",
    target: { label: "note" },
    type: "renameDefinition",
  })).toBe(true);
  expect((await getFootnotesSnapshot(labPage, id)).diagnostics.map(({ code }) => code))
    .toEqual(["unresolved-reference"]);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);

  expect(await runFootnotesCommand(labPage, id, {
    references: "preserve",
    target: { label: "note" },
    type: "removeDefinition",
  })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("Alpha[^note]");
  expect((await getFootnotesSnapshot(labPage, id)).diagnostics.map(({ code }) => code))
    .toEqual(["unresolved-reference"]);
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);

  expect(await runFootnotesCommand(labPage, id, {
    references: "remove",
    target: { label: "note" },
    type: "removeDefinition",
  })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe("Alpha");
  expect(await runEditorCommand(labPage, id, { type: "undo" })).toBe(true);
  expect(await getMarkdown(labPage, id)).toBe(inserted);

  await updateEditorOptions(labPage, id, { editable: false });
  expect(await runFootnotesCommand(labPage, id, {
    label: "blocked",
    type: "insertReference",
  })).toBe(false);
  expect(await runFootnotesCommand(labPage, id, {
    references: "remove",
    target: { label: "note" },
    type: "removeDefinition",
  })).toBe(false);
  expect(await getMarkdown(labPage, id)).toBe(inserted);
});

test("@required footnote keyboard relationships are scoped, localized, RTL-safe, and read-only navigable", async ({ labPage }) => {
  const label = 'quote"/path#fragment';
  const markdown = `Reference[^${label}].\n\n[^${label}]: Definition body.`;
  const firstId = "footnotes-scoped-document";
  const secondId = "footnotes-scoped-shadow";

  await mountEditor(labPage, {
    extensionMode: "footnotes",
    id: firstId,
    markdown,
    root: "document",
  });
  await mountEditor(labPage, {
    direction: "rtl",
    extensionMode: "footnotes",
    footnotesMessages: {
      backReferenceLabel: "Retour vers la référence",
      definitionLabel: "Définition localisée",
      definitionText: "Note localisée",
      referenceLabel: "Référence localisée",
      referenceText: "N",
      referencesLabel: "Références localisées",
    },
    id: secondId,
    language: "fr",
    markdown,
    root: "shadow",
  });

  const first = editorLocator(labPage, firstId);
  const second = editorLocator(labPage, secondId);
  const firstReference = first.locator(".mdw-footnote-reference__action");
  const secondReference = second.getByRole("link", { name: "Référence localisée" });
  const firstDefinition = first.locator("[data-mdw-footnote-definition]");
  const secondDefinition = second.getByRole("group", { name: "Définition localisée" });
  const relationships = await Promise.all([
    firstReference.evaluate((element) => ({
      controls: element.getAttribute("aria-controls"),
      id: element.id,
    })),
    firstDefinition.evaluate((element) => element.id),
    secondReference.evaluate((element) => ({
      controls: element.getAttribute("aria-controls"),
      id: element.id,
    })),
    secondDefinition.evaluate((element) => element.id),
  ]);
  const [firstReferenceIds, firstDefinitionId, secondReferenceIds, secondDefinitionId] = relationships;

  expect(firstReferenceIds.controls).toBe(firstDefinitionId);
  expect(secondReferenceIds.controls).toBe(secondDefinitionId);
  expect(firstReferenceIds.id).not.toBe(secondReferenceIds.id);
  expect(firstDefinitionId).not.toBe(secondDefinitionId);
  expect(firstReferenceIds.id).not.toContain(label);
  expect(firstDefinitionId).not.toContain(label);

  await expect(secondReference).toHaveText("N");
  await expect(secondDefinition).toContainText("Note localisée");
  await expect(secondDefinition.getByRole("group", {
    name: "Références localisées",
  }).getByRole("button", {
    name: "Retour vers la référence",
  })).toHaveCount(1);

  await updateEditorOptions(labPage, firstId, { editable: false });
  const firstSnapshot = await getFootnotesSnapshot(labPage, firstId);
  await firstReference.focus();
  await labPage.keyboard.press("Enter");
  let selection = (await snapshotEditor(labPage, firstId)).selection;
  expect(selection.from).toBeGreaterThan(firstSnapshot.definitions[0]!.position);
  expect(selection.to).toBeLessThanOrEqual(
    firstSnapshot.definitions[0]!.position
      + (await firstDefinition.evaluate((element) => element.textContent?.length ?? 0))
      + 8,
  );

  const backReference = firstDefinition.getByRole("button", {
    name: /Back to reference 1/,
  });
  await backReference.focus();
  await labPage.keyboard.press("Space");
  selection = (await snapshotEditor(labPage, firstId)).selection;
  expect(selection.from).toBe(firstSnapshot.references[0]!.position);
  expect(selection.to).toBe(firstSnapshot.references[0]!.position + 1);

  const reflow = await secondDefinition.evaluate((element) => {
    const definition = element as HTMLElement;
    definition.style.fontSize = "200%";
    definition.style.inlineSize = "220px";
    const header = definition.querySelector<HTMLElement>(".mdw-footnote-definition__header")!;
    const content = definition.querySelector<HTMLElement>(".mdw-footnote-definition__content")!;
    return {
      contentClientWidth: content.clientWidth,
      contentScrollWidth: content.scrollWidth,
      definitionClientWidth: definition.clientWidth,
      definitionScrollWidth: definition.scrollWidth,
      headerClientWidth: header.clientWidth,
      headerScrollWidth: header.scrollWidth,
    };
  });
  expect(reflow.definitionScrollWidth).toBeLessThanOrEqual(reflow.definitionClientWidth);
  expect(reflow.headerScrollWidth).toBeLessThanOrEqual(reflow.headerClientWidth);
  expect(reflow.contentScrollWidth).toBeLessThanOrEqual(reflow.contentClientWidth);

  const results = await new AxeBuilder({ page: labPage }).analyze();
  expect(results.violations.map(({ id: rule }) => rule)).toEqual([]);
});

test("@required footnotes inside links leave pointer and keyboard activation with the outer link", async ({ labPage }) => {
  const id = "footnotes-link-label";
  await mountEditor(labPage, {
    extensionMode: "footnotes",
    id,
    markdown: "[Outer[^note]](#footnote-link-target)\n\n[^note]: Definition.",
  });
  const editor = editorLocator(labPage, id);
  const outerLink = editor.locator('a[href="#footnote-link-target"]');
  const marker = outerLink.locator(".mdw-footnote-reference__action");
  const footnotes = await getFootnotesSnapshot(labPage, id);

  await expect(outerLink).toHaveCount(1);
  await expect(marker).toHaveAttribute("role", "note");
  await expect(marker).toHaveAttribute("tabindex", "-1");
  await outerLink.evaluate((element) => {
    element.addEventListener("click", (event) => {
      element.setAttribute(
        "data-test-delegated-click",
        event.defaultPrevented ? "prevented" : "native",
      );
    }, { once: true });
  });
  await marker.click();
  await expect(outerLink).toHaveAttribute("data-test-delegated-click", "native");
  const editableSelection = (await snapshotEditor(labPage, id)).selection;
  expect(editableSelection.from).toBeGreaterThanOrEqual(
    footnotes.references[0]!.position,
  );
  expect(editableSelection.to).toBeLessThanOrEqual(
    footnotes.references[0]!.position + 1,
  );

  // Editable content owns an ordinary click as an editing gesture. Once the
  // host switches to read-only presentation, the same delegated activation is
  // the anchor's native navigation contract.
  await updateEditorOptions(labPage, id, { editable: false });
  await labPage.evaluate(() => {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  });
  const readOnlySelection = (await snapshotEditor(labPage, id)).selection;
  await marker.click();
  expect(await labPage.evaluate(() => location.hash)).toBe("#footnote-link-target");
  expect((await snapshotEditor(labPage, id)).selection).toEqual(readOnlySelection);
  await labPage.evaluate(() => {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  });
  await outerLink.focus();
  await expect(outerLink).toBeFocused();
  await labPage.keyboard.press("Enter");
  expect(await labPage.evaluate(() => location.hash)).toBe("#footnote-link-target");
  expect((await snapshotEditor(labPage, id)).selection.from).toBeLessThan(
    footnotes.definitions[0]!.position,
  );
});

test("@required footnote whole and partial clipboard data stay semantic and preserve paste collisions", async ({ labPage }) => {
  const id = "footnotes-clipboard";
  const original = "Text[^note].\n\n[^note]: Definition body.";
  await mountEditor(labPage, {
    extensionMode: "footnotes",
    id,
    markdown: original,
  });

  expect(await selectFootnote(labPage, id, {
    kind: "reference",
    label: "note",
  })).toBe(true);
  const reference = await copyEditorSelection(labPage, id);
  expect(reference.defaultPrevented).toBe(true);
  expect(reference.html).toContain('role="note"');
  expect(reference.html).not.toContain("tabindex=");
  expect(reference.plain).toContain("[^note]");

  expect(await selectFootnote(labPage, id, {
    kind: "definition",
    label: "note",
  })).toBe(true);
  const whole = await copyEditorSelection(labPage, id);
  expect(whole.defaultPrevented).toBe(true);
  expect(whole.markdown).toBe("[^note]: Definition body.");
  expect(whole.html).toContain("data-mdw-footnote-definition");
  expect(whole.html).toContain("data-mdw-footnote-content");
  expect(whole.plain).toContain("Definition body.");

  expect(await selectFootnote(labPage, id, {
    content: { from: 1, to: 11 },
    kind: "definition",
    label: "note",
  })).toBe(true);
  const partial = await copyEditorSelection(labPage, id);
  expect(partial.defaultPrevented).toBe(true);
  expect(partial.markdown).toBe("[^note]: Definition");
  expect(partial.html).toContain("data-mdw-footnote-definition");

  await resetEditor(labPage, id, original);
  await focusEditor(labPage, id, "end");
  const markdownPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    markdown: whole.markdown,
    plain: whole.plain,
  });
  expect(markdownPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  let snapshot = await getFootnotesSnapshot(labPage, id);
  expect(snapshot.definitions).toHaveLength(2);
  expect(snapshot.diagnostics.map(({ code }) => code)).toEqual(["duplicate-definition"]);

  await resetEditor(labPage, id, original);
  await focusEditor(labPage, id, "end");
  const richPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    html: whole.html,
    plain: whole.plain,
  });
  expect(richPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  snapshot = await getFootnotesSnapshot(labPage, id);
  expect(snapshot.definitions).toHaveLength(2);
  expect(snapshot.diagnostics.map(({ code }) => code)).toEqual(["duplicate-definition"]);

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  const partialPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    markdown: partial.markdown,
    plain: partial.plain,
  });
  expect(partialPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect(await getMarkdown(labPage, id)).toBe("[^note]: Definition");
  expect((await getFootnotesSnapshot(labPage, id)).definitions).toHaveLength(1);

  await resetEditor(labPage, id, "");
  await focusEditor(labPage, id, "end");
  const plainPaste = await dispatchTransfer(labPage, id, {
    event: "paste",
    plain: "[^plain]: literal text",
  });
  expect(plainPaste.defaultPrevented).toBe(true);
  await settleEditor(labPage, id);
  expect((await getFootnotesSnapshot(labPage, id)).definitions).toHaveLength(0);
  await expect(editorLocator(labPage, id)).toContainText("[^plain]: literal text");
});

test("@required footnote source-only workload stays within the reviewed index bound", async ({ labPage }) => {
  const id = "footnotes-workload";
  const count = 1_000;
  const references = Array.from(
    { length: count },
    (_, index) => `reference-${index}[^note-${index}]`,
  ).join(" ");
  const definitions = Array.from(
    { length: count },
    (_, index) => `[^note-${index}]: definition-${index}`,
  ).join("\n\n");
  const markdown = `${references}\n\n${definitions}`;
  const mountStarted = Date.now();
  await mountEditor(labPage, {
    extensionMode: "footnotes",
    id,
    markdown,
    motion: "reduce",
  });
  const mountMs = Date.now() - mountStarted;
  let snapshot = await getFootnotesSnapshot(labPage, id);
  expect(snapshot.references).toHaveLength(count);
  expect(snapshot.definitions).toHaveLength(count);
  expect(snapshot.diagnostics).toEqual([]);
  expect(mountMs).toBeLessThan(5_000);

  const reconcileStarted = Date.now();
  const reconciled = await reconcileEditor(
    labPage,
    id,
    markdown.replace("definition-500", "updated-definition-500"),
  );
  const reconcileMs = Date.now() - reconcileStarted;
  expect(reconciled.changed).toBe(true);
  expect(reconcileMs).toBeLessThan(5_000);
  snapshot = await getFootnotesSnapshot(labPage, id);
  expect(snapshot.references).toHaveLength(count);
  expect(snapshot.definitions).toHaveLength(count);
  expect(snapshot.diagnostics).toEqual([]);
});
