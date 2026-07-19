import { describe, expect, it } from "vitest";
import {
  EditorState,
  Schema,
  type Node as ProseMirrorNode,
  type NodeType,
} from "markora/extension-api";
import { defaultTocMessages } from "../src/messages";
import {
  applyTocIndexTransaction,
  buildTocIndex,
  findTocDocumentIssue,
  findTocTransactionIssue,
  normalizeTocHeadingLabel,
  transactionChangesTocSemantics,
  transactionChangesTocStructure,
  type TocNodeTypes,
} from "../src/model";

function createSchema() {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      blockquote: { content: "block+", group: "block" },
      heading: {
        attrs: { level: { default: 1 } },
        content: "inline*",
        group: "block",
      },
      toc: { atom: true, group: "block", selectable: true },
      image: {
        atom: true,
        attrs: { alt: { default: null } },
        group: "inline",
        inline: true,
      },
      source_leaf: {
        atom: true,
        attrs: { source: { default: "" } },
        group: "inline",
        inline: true,
        leafText: (node) => String(node.attrs.source),
      },
      text: { group: "inline" },
    },
    marks: {},
  });
}

function nodeTypes(schema: Schema): TocNodeTypes {
  return Object.freeze({
    heading: schema.nodes.heading,
    toc: schema.nodes.toc,
  });
}

function paragraph(schema: Schema, text = "") {
  return schema.nodes.paragraph.create(
    null,
    text ? schema.text(text) : undefined,
  );
}

function heading(
  schema: Schema,
  level: number,
  content: ProseMirrorNode | readonly ProseMirrorNode[] | undefined,
) {
  return schema.nodes.heading.create({ level }, content);
}

function positionOf(doc: ProseMirrorNode, nodeType: NodeType, occurrence = 1) {
  let seen = 0;
  let found = -1;

  doc.descendants((node, position) => {
    if (node.type === nodeType) {
      seen += 1;

      if (seen === occurrence) {
        found = position;
        return false;
      }
    }

    return found < 0;
  });

  if (found < 0) {
    throw new RangeError(`Missing ${nodeType.name} occurrence ${occurrence}.`);
  }

  return found;
}

describe("TOC heading model", () => {
  it("normalizes text, image alt, leafText, and localized untitled labels", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const richHeading = heading(schema, 2, [
      schema.text("  Alpha\t"),
      schema.nodes.image.create({ alt: " Diagram " }),
      schema.text("\n"),
      schema.nodes.source_leaf.create({ source: " β  " }),
    ]);
    const untitled = heading(schema, 3, [
      schema.text(" \t "),
      schema.nodes.image.create({ alt: "" }),
      schema.nodes.source_leaf.create({ source: "  " }),
    ]);
    const imageOnly = heading(
      schema,
      4,
      schema.nodes.image.create({ alt: " Architecture diagram " }),
    );
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.toc.create(),
      richHeading,
      untitled,
      imageOnly,
      schema.nodes.toc.create(),
    ]);
    const index = buildTocIndex(doc, types, defaultTocMessages);

    expect(normalizeTocHeadingLabel("  one\n\t two  ")).toBe("one two");
    expect(index.snapshot.headings.map(({ label, level }) => ({ label, level })))
      .toEqual([
        { label: "Alpha Diagram β", level: 2 },
        { label: "Untitled heading 2, level 3", level: 3 },
        { label: "Architecture diagram", level: 4 },
      ]);
    expect(index.snapshot.tocs).toEqual([
      { position: positionOf(doc, types.toc, 1) },
      { position: positionOf(doc, types.toc, 2) },
    ]);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.snapshot)).toBe(true);
    expect(Object.isFrozen(index.snapshot.headings)).toBe(true);
    expect(Object.isFrozen(index.snapshot.headings[0])).toBe(true);
    expect(Object.isFrozen(index.snapshot.tocs)).toBe(true);
    expect(Object.isFrozen(index.snapshot.tocs[0])).toBe(true);
  });

  it("rejects a localized untitled formatter that normalizes to empty text", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, heading(
      schema,
      1,
      schema.text(" "),
    ));

    expect(() => buildTocIndex(doc, types, {
      ...defaultTocMessages,
      untitledHeadingLabel: () => " \n ",
    })).toThrow("TOC untitled-heading label must not be empty");
  });
});

describe("TOC index transactions", () => {
  it("maps positions without changing render identity for ordinary edits", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, [
      paragraph(schema, "prefix"),
      heading(schema, 2, schema.text("Details")),
      schema.nodes.toc.create(),
    ]);
    const previous = buildTocIndex(doc, types, defaultTocMessages);
    const transaction = EditorState.create({ doc, schema }).tr.insertText(
      " expanded",
      3,
    );
    const next = applyTocIndexTransaction(
      previous,
      transaction,
      types,
      defaultTocMessages,
    );

    expect(transactionChangesTocSemantics(transaction, types)).toBe(false);
    expect(next.renderIdentity).toBe(previous.renderIdentity);
    expect(next.snapshot.headings[0]?.position).toBeGreaterThan(
      previous.snapshot.headings[0]!.position,
    );
    expect(next.snapshot.tocs[0]?.position).toBeGreaterThan(
      previous.snapshot.tocs[0]!.position,
    );
    expect(next.snapshot.headings[0]?.label).toBe("Details");
  });

  it("preserves identity for a position-only insertion at a TOC boundary", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, [
      heading(schema, 1, schema.text("Title")),
      schema.nodes.toc.create(),
    ]);
    const previous = buildTocIndex(doc, types, defaultTocMessages);
    const transaction = EditorState.create({ doc, schema }).tr.insert(
      previous.snapshot.tocs[0]!.position,
      paragraph(schema, "inserted"),
    );
    const next = applyTocIndexTransaction(
      previous,
      transaction,
      types,
      defaultTocMessages,
    );

    expect(transactionChangesTocStructure(transaction, types)).toBe(false);
    expect(next.renderIdentity).toBe(previous.renderIdentity);
    expect(next.snapshot.tocs[0]!.position).toBeGreaterThan(
      previous.snapshot.tocs[0]!.position,
    );
  });

  it("rebuilds semantic headings but retains identity for semantic no-ops", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, [
      heading(schema, 2, schema.text("Details")),
      schema.nodes.toc.create(),
    ]);
    const previous = buildTocIndex(doc, types, defaultTocMessages);
    const headingPosition = previous.snapshot.headings[0]!.position;
    const edit = EditorState.create({ doc, schema }).tr.insertText(
      "More ",
      headingPosition + 1,
    );
    const edited = applyTocIndexTransaction(
      previous,
      edit,
      types,
      defaultTocMessages,
    );

    expect(transactionChangesTocSemantics(edit, types)).toBe(true);
    expect(edited.snapshot.headings[0]?.label).toBe("More Details");
    expect(edited.renderIdentity).not.toBe(previous.renderIdentity);

    const sameMarkup = EditorState.create({ doc, schema }).tr.setNodeMarkup(
      headingPosition,
      types.heading,
      { level: 2 },
    );
    const unchanged = applyTocIndexTransaction(
      previous,
      sameMarkup,
      types,
      defaultTocMessages,
    );

    expect(transactionChangesTocSemantics(sameMarkup, types)).toBe(true);
    expect(unchanged.renderIdentity).toBe(previous.renderIdentity);
    expect(unchanged.snapshot).toEqual(previous.snapshot);
  });

  it("changes render identity when TOC count or order may have changed", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, [
      heading(schema, 1, schema.text("Title")),
      schema.nodes.toc.create(),
    ]);
    const previous = buildTocIndex(doc, types, defaultTocMessages);
    const transaction = EditorState.create({ doc, schema }).tr.insert(
      doc.content.size,
      schema.nodes.toc.create(),
    );
    const next = applyTocIndexTransaction(
      previous,
      transaction,
      types,
      defaultTocMessages,
    );

    expect(transactionChangesTocStructure(transaction, types)).toBe(true);
    expect(next.snapshot.tocs).toHaveLength(2);
    expect(next.renderIdentity).not.toBe(previous.renderIdentity);
  });
});

describe("TOC top-level invariant", () => {
  it("reports a nested TOC with its model position and parent", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const topLevel = schema.nodes.doc.create(null, schema.nodes.toc.create());
    const nested = schema.nodes.doc.create(null, schema.nodes.blockquote.create(
      null,
      schema.nodes.toc.create(),
    ));

    expect(findTocDocumentIssue(topLevel, types)).toBeNull();
    expect(findTocDocumentIssue(nested, types)).toEqual({
      parentType: "blockquote",
      position: 1,
      stepIndex: -1,
    });
  });

  it("finds an invalid intermediate document even when the final doc is valid", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, schema.nodes.blockquote.create(
      null,
      paragraph(schema),
    ));
    const transaction = EditorState.create({ doc, schema }).tr
      .setNodeMarkup(1, types.toc)
      .setNodeMarkup(1, schema.nodes.paragraph);

    expect(transaction.doc.eq(doc)).toBe(true);
    expect(transactionChangesTocStructure(transaction, types)).toBe(true);
    expect(findTocTransactionIssue(transaction, types)).toEqual({
      parentType: "blockquote",
      position: 1,
      stepIndex: 0,
    });
  });

  it("detects a ReplaceAroundStep that nests a preserved root TOC", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.toc.create(),
      paragraph(schema, "tail"),
    ]);
    const range = doc.resolve(0).blockRange(doc.resolve(1));

    expect(range).not.toBeNull();
    const transaction = EditorState.create({ doc, schema }).tr.wrap(
      range!,
      [{ type: schema.nodes.blockquote }],
    );

    expect(transactionChangesTocStructure(transaction, types)).toBe(true);
    expect(findTocTransactionIssue(transaction, types)).toEqual({
      parentType: "blockquote",
      position: 1,
      stepIndex: 0,
    });
  });

  it("keeps the invariant fast path inert for ordinary text edits", () => {
    const schema = createSchema();
    const types = nodeTypes(schema);
    const doc = schema.nodes.doc.create(null, [
      paragraph(schema, "body"),
      schema.nodes.toc.create(),
    ]);
    const transaction = EditorState.create({ doc, schema }).tr.insertText(
      "!",
      2,
    );

    expect(transactionChangesTocStructure(transaction, types)).toBe(false);
    expect(findTocTransactionIssue(transaction, types)).toBeNull();
  });
});
