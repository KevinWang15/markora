import { useState } from "react";
import { Dialog } from "./Dialog";
export type SourceEdit = { title: string; source: string; update: (source: string) => boolean };
export function SourceDialog({ request, onClose, onSaved }: { request: SourceEdit; onClose: () => void; onSaved: () => void }) {
  const [source, setSource] = useState(request.source);
  const [error, setError] = useState<string>();
  return <Dialog title={request.title} message="Edit the source used to render this preview." onCancel={onClose} error={error}>
    <textarea autoFocus className="app-syntax-source" aria-label="Preview source" value={source} spellCheck={false}
      onChange={event => setSource(event.target.value)} />
    <button className="app-dialog-button" type="button" onClick={onClose}>Cancel</button>
    <button className="app-dialog-button app-dialog-button-primary" type="button" onClick={() => {
      if (source === request.source) { onClose(); return; }
      if (!request.update(source)) { setError("The source is invalid or this block has changed. Review the source, or reopen this dialog."); return; }
      onSaved(); onClose();
    }}>Apply source</button>
  </Dialog>;
}
