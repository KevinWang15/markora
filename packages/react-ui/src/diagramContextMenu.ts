import type { DiagramsExtension } from "markora-extension-diagrams";
import type { ContextMenuProvider } from "markora-ui";

const examples = Object.freeze({
  mermaid: "flowchart LR\n  Start --> Finish",
  plantuml: "@startuml\nAlice -> Bob: Hello\n@enduml",
});

/** Host menu actions use the same extension commands as source editing. */
export function createDiagramContextMenuProvider(extension: DiagramsExtension): ContextMenuProvider {
  return {
    id: "diagrams", order: 36,
    items({ editor, selection }) {
      const handle = editor.extensions.get(extension);
      const editable = editor.view.editable;
      const target = handle.state.getNodes().find(node => selection.from >= node.position
        && selection.to <= node.position + (editor.view.state.doc.nodeAt(node.position)?.nodeSize ?? 0));
      if (!target) return Object.entries(examples).map(([kind, source]) => ({
        type: "action" as const, id: `diagram.insert.${kind}`,
        label: `Insert ${kind === "mermaid" ? "Mermaid" : "PlantUML"} diagram`,
        enabled: editable && editor.state.can.pasteMarkdown(),
        run: () => handle.commands.insert({ info: kind, source }),
      }));
      return [
        { type: "action", id: "diagram.preview", label: "Toggle diagram preview", enabled: editable,
          run: () => handle.commands.togglePreview(target) },
        { type: "action", id: "diagram.remove", label: "Remove diagram", enabled: editable, danger: true,
          run: () => handle.commands.remove(target) },
      ];
    },
  };
}
