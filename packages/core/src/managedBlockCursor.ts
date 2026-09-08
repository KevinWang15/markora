import { Slice, type Node as ProseMirrorNode, type ResolvedPos } from "prosemirror-model";
import { Selection, type SelectionBookmark } from "prosemirror-state";

export type BoundarySide = "before" | "after";

export type ManagedBlockBoundaryMeta = {
  blockPos: number;
  pos: number;
  side: BoundarySide;
};

export type ManagedBlockBoundary = ManagedBlockBoundaryMeta & {
  node: ProseMirrorNode;
};

const managedTypes = new WeakMap<ProseMirrorNode["type"]["schema"], ReadonlySet<string>>();
export function registerManagedBlockTypes(schema: ProseMirrorNode["type"]["schema"], names: ReadonlySet<string>) {
  managedTypes.set(schema, new Set(names));
}

export function isManagedBlockNodeFromSchema(
  schema: ProseMirrorNode["type"]["schema"],
  node: ProseMirrorNode | null | undefined,
  registered?: ReadonlySet<string>,
): node is ProseMirrorNode {
  return !!node && (
    node.isBlock && node.isAtom ||
    (registered ?? managedTypes.get(schema))?.has(node.type.name) ||
    node.type === schema.nodes.blockquote ||
    node.type === schema.nodes.table ||
    node.type === schema.nodes.code_block ||
    node.type === schema.nodes.raw_block
  );
}

export class ManagedBlockCursor extends Selection {
  constructor(
    $pos: ResolvedPos,
    readonly blockPos: number,
    readonly side: BoundarySide,
    private readonly isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => node is ProseMirrorNode,
  ) {
    super($pos, $pos);
  }

  static create(
    doc: ProseMirrorNode,
    blockPos: number,
    side: BoundarySide,
    isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => node is ProseMirrorNode,
  ) {
    const block = doc.nodeAt(blockPos);

    if (!block || !isManagedBlockNode(block)) {
      return null;
    }

    const pos = side === "before" ? blockPos : blockPos + block.nodeSize;
    return ManagedBlockCursor.at(doc, pos, isManagedBlockNode);
  }

  /** A boundary belongs to its document position, not either neighboring
   * element. Prefer the following element only as a stable decoration anchor. */
  static at(doc: ProseMirrorNode, pos: number, isManagedBlockNode: ManagedBlockCursor["isManagedBlockNode"]) {
    if (pos < 0 || pos > doc.content.size) return null;
    const $pos = doc.resolve(pos);
    if ($pos.nodeAfter && isManagedBlockNode($pos.nodeAfter)) return new ManagedBlockCursor($pos, pos, "before", isManagedBlockNode);
    if ($pos.nodeBefore && isManagedBlockNode($pos.nodeBefore)) return new ManagedBlockCursor($pos, pos - $pos.nodeBefore.nodeSize, "after", isManagedBlockNode);
    return null;
  }

  map(doc: ProseMirrorNode, mapping: Parameters<Selection["map"]>[1]): Selection {
    const assoc = this.side === "before" ? -1 : 1;
    const pos = mapping.map(this.head, assoc);
    return ManagedBlockCursor.at(doc, pos, this.isManagedBlockNode)
      ?? Selection.near(doc.resolve(Math.max(0, Math.min(pos, doc.content.size))), assoc);
  }

  content() {
    return Slice.empty;
  }

  eq(other: Selection): boolean {
    return (
      other instanceof ManagedBlockCursor &&
      other.head === this.head
    );
  }

  toJSON() {
    return { type: "managed-block-cursor", blockPos: this.blockPos, side: this.side };
  }

  static fromJSON(doc: ProseMirrorNode, json: { blockPos: number; side: BoundarySide }) {
    if (typeof json.blockPos !== "number" || (json.side !== "before" && json.side !== "after")) {
      throw new RangeError("Invalid input for ManagedBlockCursor.fromJSON");
    }

    return (
      ManagedBlockCursor.create(doc, json.blockPos, json.side, (node): node is ProseMirrorNode => (
        isManagedBlockNodeFromSchema(doc.type.schema, node)
      )) ??
      Selection.near(doc.resolve(json.blockPos), json.side === "before" ? 1 : -1)
    );
  }

  getBookmark(): SelectionBookmark {
    return new ManagedBlockBookmark(this.head, this.side, this.isManagedBlockNode);
  }
}

ManagedBlockCursor.prototype.visible = false;
Selection.jsonID("managed-block-cursor", ManagedBlockCursor);

class ManagedBlockBookmark implements SelectionBookmark {
  constructor(
    readonly pos: number,
    readonly side: BoundarySide,
    readonly isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => node is ProseMirrorNode,
  ) {}

  map(mapping: Parameters<Selection["map"]>[1]) {
    return new ManagedBlockBookmark(mapping.map(this.pos, this.side === "before" ? -1 : 1), this.side, this.isManagedBlockNode);
  }

  resolve(doc: ProseMirrorNode) {
    return (
      ManagedBlockCursor.at(doc, this.pos, this.isManagedBlockNode) ??
      Selection.near(doc.resolve(Math.max(0, Math.min(this.pos, doc.content.size))), this.side === "before" ? 1 : -1)
    );
  }
}
