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

export function isManagedBlockNodeFromSchema(
  schema: ProseMirrorNode["type"]["schema"],
  node: ProseMirrorNode | null | undefined,
): node is ProseMirrorNode {
  return !!node && (node.type === schema.nodes.table || node.type === schema.nodes.code_block);
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
    return new ManagedBlockCursor(doc.resolve(pos), blockPos, side, isManagedBlockNode);
  }

  map(doc: ProseMirrorNode, mapping: Parameters<Selection["map"]>[1]): Selection {
    const assoc = this.side === "before" ? -1 : 1;
    const mappedBlockPos = mapping.map(this.blockPos, assoc);

    return (
      ManagedBlockCursor.create(doc, mappedBlockPos, this.side, this.isManagedBlockNode) ??
      Selection.near(doc.resolve(mappedBlockPos), assoc)
    );
  }

  content() {
    return Slice.empty;
  }

  eq(other: Selection): boolean {
    return (
      other instanceof ManagedBlockCursor &&
      other.head === this.head &&
      other.blockPos === this.blockPos &&
      other.side === this.side
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
      ManagedBlockCursor.create(doc, json.blockPos, json.side, (node): node is ProseMirrorNode => {
        if (!node) {
          return false;
        }

        return isManagedBlockNodeFromSchema(doc.type.schema, node);
      }) ??
      Selection.near(doc.resolve(json.blockPos), json.side === "before" ? 1 : -1)
    );
  }

  getBookmark(): SelectionBookmark {
    return new ManagedBlockBookmark(this.blockPos, this.side, this.isManagedBlockNode);
  }
}

ManagedBlockCursor.prototype.visible = false;
Selection.jsonID("managed-block-cursor", ManagedBlockCursor);

class ManagedBlockBookmark implements SelectionBookmark {
  constructor(
    readonly blockPos: number,
    readonly side: BoundarySide,
    readonly isManagedBlockNode: (node: ProseMirrorNode | null | undefined) => node is ProseMirrorNode,
  ) {}

  map(mapping: Parameters<Selection["map"]>[1]) {
    return new ManagedBlockBookmark(mapping.map(this.blockPos, this.side === "before" ? -1 : 1), this.side, this.isManagedBlockNode);
  }

  resolve(doc: ProseMirrorNode) {
    return (
      ManagedBlockCursor.create(doc, this.blockPos, this.side, this.isManagedBlockNode) ??
      Selection.near(doc.resolve(this.blockPos), this.side === "before" ? 1 : -1)
    );
  }
}
