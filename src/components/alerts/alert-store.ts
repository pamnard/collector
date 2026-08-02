import type { ReactNode } from "react";
import type { AlertTone } from "./Alert";

export type { AlertTone };
export { errorMessage } from "../../services/runtime-error.ts";

export type AlertEntry = {
  id: string;
  tone: AlertTone;
  message: ReactNode;
  dismissible: boolean;
  onDismiss?: () => void;
};

export type PushAlertInput = {
  id?: string;
  tone: AlertTone;
  message: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
};

export type AlertsApi = {
  push: (input: PushAlertInput) => string;
  upsert: (id: string, input: Omit<PushAlertInput, "id">) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

export type AlertStore = AlertsApi & {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly AlertEntry[];
};

export function createAlertStore(): AlertStore {
  let entries: AlertEntry[] = [];
  const listeners = new Set<() => void>();
  let seq = 0;

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function replaceOrAppend(entry: AlertEntry): void {
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      entries = [...entries.slice(0, idx), entry, ...entries.slice(idx + 1)];
    } else {
      entries = [...entries, entry];
    }
    emit();
  }

  const store: AlertStore = {
    push(input) {
      const id = input.id ?? `alert-${++seq}`;
      replaceOrAppend({
        id,
        tone: input.tone,
        message: input.message,
        dismissible: input.dismissible ?? true,
        onDismiss: input.onDismiss,
      });
      return id;
    },
    upsert(id, input) {
      store.push({ ...input, id });
    },
    dismiss(id) {
      const next = entries.filter((e) => e.id !== id);
      if (next.length !== entries.length) {
        entries = next;
        emit();
      }
    },
    clear() {
      if (entries.length === 0) {
        return;
      }
      entries = [];
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return entries;
    },
  };
  return store;
}
