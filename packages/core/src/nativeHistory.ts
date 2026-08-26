import { redo, undo } from "prosemirror-history";
import { Plugin } from "prosemirror-state";

export function createNativeHistoryPlugin() {
  return new Plugin({
    props: {
      handleDOMEvents: {
        input(view, event) {
          if (!view.editable || view.composing || !("inputType" in event)) {
            return false;
          }

          const { inputType, isComposing } = event as InputEvent;

          if (isComposing) {
            return false;
          }

          if (inputType === "historyUndo") {
            return undo(view.state, view.dispatch, view);
          }

          if (inputType === "historyRedo") {
            return redo(view.state, view.dispatch, view);
          }

          return false;
        },
      },
    },
  });
}
