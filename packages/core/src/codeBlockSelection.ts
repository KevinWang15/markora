import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { Selection, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

type CodeBlockInfo = {
  node: ProseMirrorNode;
  pos: number;
  textStart: number;
  textEnd: number;
};

export function createCodeBlockSelectionHelpers(options: { schema: Schema }) {
  const { schema } = options;

  function createCodeBlockInfo(node: ProseMirrorNode, pos: number): CodeBlockInfo {
    return {
      node,
      pos,
      textStart: pos + 1,
      textEnd: pos + node.nodeSize - 1,
    };
  }

  function getCodeBlockInfoAtPos(state: EditorState, pos: number): CodeBlockInfo | null {
    const $pos = state.doc.resolve(pos);

    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);

      if (node.type === schema.nodes.code_block) {
        return createCodeBlockInfo(node, $pos.before(depth));
      }
    }

    const nodeBefore = $pos.nodeBefore;

    if (nodeBefore?.type === schema.nodes.code_block) {
      return createCodeBlockInfo(nodeBefore, pos - nodeBefore.nodeSize);
    }

    const nodeAfter = $pos.nodeAfter;

    if (nodeAfter?.type === schema.nodes.code_block) {
      return createCodeBlockInfo(nodeAfter, pos);
    }

    return null;
  }

  function getAdjacentCodeBlockForVerticalSelection(view: EditorView, direction: -1 | 1): CodeBlockInfo | null {
    const { selection, doc } = view.state;

    if (!(selection instanceof TextSelection)) {
      return null;
    }

    const { $head } = selection;

    if (!$head.parent.isTextblock) {
      return null;
    }

    const endOfTextblock = view.endOfTextblock(direction < 0 ? "up" : "down");

    if (!endOfTextblock) {
      return null;
    }

    const boundaryPos = direction < 0 ? $head.before() : $head.after();
    const $boundary = doc.resolve(boundaryPos);
    const adjacentNode = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;

    if (adjacentNode?.type !== schema.nodes.code_block) {
      return null;
    }

    const adjacentPos = direction < 0 ? boundaryPos - adjacentNode.nodeSize : boundaryPos;
    return createCodeBlockInfo(adjacentNode, adjacentPos);
  }

  function getCodeBlockLineInfo(codeBlock: CodeBlockInfo, pos: number) {
    const offset = Math.max(0, Math.min(codeBlock.node.textContent.length, pos - codeBlock.textStart));
    const lines = codeBlock.node.textContent.split("\n");
    let consumed = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const lineLength = lines[index].length;
      const lineEnd = consumed + lineLength;

      if (offset <= lineEnd || index === lines.length - 1) {
        return {
          lineNumber: index + 1,
          lineCount: lines.length,
          isFirstLine: index === 0,
          isLastLine: index === lines.length - 1,
        };
      }

      consumed = lineEnd + 1;
    }

    return {
      lineNumber: lines.length,
      lineCount: lines.length,
      isFirstLine: true,
      isLastLine: true,
    };
  }

  function maybeExtendSelectionAcrossCodeBlock(view: EditorView, direction: -1 | 1) {
    const { selection, doc } = view.state;

    if (!(selection instanceof TextSelection)) {
      return false;
    }

    const directCodeBlock = getCodeBlockInfoAtPos(view.state, selection.head);
    const headInsideCodeBlock = !!directCodeBlock && selection.head >= directCodeBlock.textStart && selection.head <= directCodeBlock.textEnd;
    const adjacentCodeBlock = headInsideCodeBlock ? null : getAdjacentCodeBlockForVerticalSelection(view, direction);
    const codeBlock = headInsideCodeBlock ? directCodeBlock : adjacentCodeBlock;

    if (!codeBlock) {
      return false;
    }

    const lineInfo = headInsideCodeBlock ? getCodeBlockLineInfo(codeBlock, selection.head) : null;

    if (headInsideCodeBlock && direction < 0 && !lineInfo!.isFirstLine) {
      return false;
    }

    if (headInsideCodeBlock && direction > 0 && !lineInfo!.isLastLine) {
      return false;
    }

    const boundaryPos = direction < 0 ? codeBlock.pos : codeBlock.pos + codeBlock.node.nodeSize;
    const outerSelection = Selection.findFrom(doc.resolve(boundaryPos), direction, true);
    const fallbackOuterHead = direction < 0 ? codeBlock.textStart : codeBlock.textEnd;

    if (!outerSelection) {
      if ((direction < 0 && boundaryPos === codeBlock.pos) || (direction > 0 && boundaryPos === codeBlock.pos + codeBlock.node.nodeSize)) {
        const tr = view.state.tr.setSelection(TextSelection.create(doc, selection.anchor, fallbackOuterHead));
        view.dispatch(tr.scrollIntoView());
        view.focus();
        return true;
      }

      return false;
    }

    const tr = view.state.tr.setSelection(TextSelection.create(doc, selection.anchor, outerSelection.head));
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return true;
  }

  return {
    maybeExtendSelectionAcrossCodeBlock,
  };
}
