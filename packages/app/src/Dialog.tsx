import { useEffect, useId, useRef, type ReactNode } from "react";
import AlertTriangle from "@lucide/icons/icons/triangle-alert";
import { Icon } from "./Icon";

export function Dialog({ title, message, children, onCancel, busy = false, error }: Readonly<{
  title: string;
  message: string;
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
  error?: string;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected && !document.querySelector("dialog[open]")) previous.focus();
    };
  }, []);
  return <dialog ref={ref} role="alertdialog" aria-modal="true" aria-busy={busy}
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`} className="app-dialog"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="app-dialog-icon"><Icon icon={AlertTriangle} size={22} /></div>
    <div className="app-dialog-copy">
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-message`}>{message}</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="app-dialog-actions">{children}</div>
  </dialog>;
}
