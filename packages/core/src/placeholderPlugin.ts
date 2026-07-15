import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export function createPlaceholderPlugin(getPlaceholder: () => string | null) {
  return new Plugin({
    props: {
      decorations(state) {
        const placeholder = getPlaceholder();

        if (
          !placeholder
          || state.doc.childCount !== 1
          || state.doc.firstChild?.type !== state.schema.nodes.paragraph
          || state.doc.firstChild.content.size !== 0
        ) {
          return null;
        }

        return DecorationSet.create(state.doc, [
          Decoration.node(0, state.doc.firstChild.nodeSize, {
            class: "mdw-placeholder",
            "data-placeholder": placeholder,
          }),
        ]);
      },
    },
  });
}
