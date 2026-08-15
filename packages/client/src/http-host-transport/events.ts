import type { CollectorHostTransport } from "./types.js";

export function wireOnEvent(
  eventHandlers: Map<string, Set<(payload: unknown) => void>>,
): CollectorHostTransport["onEvent"] {
  return (event, handler) => {
    let set = eventHandlers.get(event);
    if (!set) {
      set = new Set();
      eventHandlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) {
        eventHandlers.delete(event);
      }
    };
  };
}
