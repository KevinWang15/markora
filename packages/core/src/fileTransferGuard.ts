import { Plugin } from "prosemirror-state";

type TransferItemLike = {
  readonly kind?: string | null;
};

type TransferDataLike = {
  readonly files?: { readonly length: number } | null;
  readonly items?: ArrayLike<TransferItemLike | null | undefined> | null;
  readonly types?: ArrayLike<string | null | undefined> | null;
  dropEffect?: string;
};

type TransferEventLike = Event & {
  readonly clipboardData?: TransferDataLike | null;
  readonly dataTransfer?: TransferDataLike | null;
};

function getTransferData(event: Event): TransferDataLike | null {
  const transferEvent = event as TransferEventLike;

  try {
    const clipboardData = transferEvent.clipboardData;

    if (clipboardData) {
      return clipboardData;
    }
  } catch {
    // Some browsers restrict transfer data access outside the event callback.
  }

  try {
    return transferEvent.dataTransfer ?? null;
  } catch {
    return null;
  }
}

export function hasTransferredFiles(transfer: TransferDataLike | null | undefined): boolean {
  if (!transfer) {
    return false;
  }

  try {
    if ((transfer.files?.length ?? 0) > 0) {
      return true;
    }
  } catch {
    // Fall back to inspecting items when the browser hides the FileList.
  }

  try {
    const types = transfer.types;

    if (types) {
      for (let index = 0; index < types.length; index += 1) {
        if (types[index]?.toLowerCase() === "files") {
          return true;
        }
      }
    }
  } catch {
    // Fall back to inspecting items when transfer types are protected.
  }

  try {
    const items = transfer.items;

    if (!items) {
      return false;
    }

    for (let index = 0; index < items.length; index += 1) {
      if (items[index]?.kind === "file") {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export function rejectFileTransferEvent(event: Event): boolean {
  const transfer = getTransferData(event);

  if (!hasTransferredFiles(transfer)) {
    return false;
  }

  event.preventDefault();

  try {
    if (transfer && "dropEffect" in transfer) {
      transfer.dropEffect = "none";
    }
  } catch {
    // Rejecting the event still works when dropEffect is read-only.
  }

  return true;
}

export function createFileTransferGuardPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        paste: (_view, event) => rejectFileTransferEvent(event),
        dragover: (_view, event) => rejectFileTransferEvent(event),
        drop: (_view, event) => rejectFileTransferEvent(event),
      },
    },
  });
}
