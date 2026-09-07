import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import AlertTriangle from "@lucide/icons/icons/triangle-alert";
import { Icon } from "./Icon";

export function Dialog({ title, message, children, onCancel, busy = false, error, content, variant = "alert", icon = AlertTriangle, initialFocus }: Readonly<{
  title: string;
  message: string;
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
  error?: string;
  content?: ReactNode;
  variant?: "alert" | "editor";
  icon?: Parameters<typeof Icon>[0]["icon"];
  initialFocus?: RefObject<HTMLElement | null>;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected && !document.querySelector("dialog[open]")) previous.focus();
    };
  }, []);
  return <dialog ref={ref} role={variant === "alert" ? "alertdialog" : "dialog"} aria-modal="true" aria-busy={busy}
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`} className={`app-dialog${variant === "editor" ? " app-dialog-editor" : ""}`}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...ref.current!.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0);
      const stops = controls.filter(element => !(element instanceof HTMLInputElement) || element.type !== "radio"
        || element.checked || !controls.some(other => other instanceof HTMLInputElement && other.type === "radio" && other.name === element.name && other.checked));
      const first = stops[0], last = stops.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="app-dialog-icon"><Icon icon={icon} size={22} /></div>
    <div className="app-dialog-copy">
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-message`}>{message}</p>
      {error && <p role="alert">{error}</p>}
    </div>
    {content && <div className="app-dialog-content">{content}</div>}
    <div className="app-dialog-actions">{children}</div>
  </dialog>;
}
