import type { Node as ProseMirrorNode } from "prosemirror-model";

export type ActiveImageInfo = {
  pos: number;
  node: ProseMirrorNode;
};
