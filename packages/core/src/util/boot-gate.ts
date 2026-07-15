/**
 * Two-phase init: open resolves independently of health so UI can paint,
 * while queries await ensureHealthy() (open + health).
 */
export interface TwoPhaseBootGate {
  /** Complete phase 1 (e.g. open DB + migrate). Idempotent / single-flight. */
  open: () => Promise<void>;
  /** Complete phase 1 + 2 (health / rebuild). Idempotent / single-flight. */
  ensureHealthy: () => Promise<void>;
  /** True after open phase succeeded. */
  isOpen: () => boolean;
  /** True after health phase succeeded. */
  isHealthy: () => boolean;
}

export function createTwoPhaseBootGate(hooks: {
  open: () => Promise<void>;
  health: () => Promise<void>;
}): TwoPhaseBootGate {
  let opened = false;
  let healthy = false;
  let openPromise: Promise<void> | null = null;
  let healthPromise: Promise<void> | null = null;
  let fatalError: Error | null = null;

  const open = async (): Promise<void> => {
    if (opened) {
      return;
    }
    if (fatalError) {
      throw fatalError;
    }
    if (!openPromise) {
      openPromise = hooks
        .open()
        .then(() => {
          opened = true;
        })
        .catch((err: unknown) => {
          fatalError = err instanceof Error ? err : new Error(String(err));
          throw fatalError;
        })
        .finally(() => {
          openPromise = null;
        });
    }
    await openPromise;
  };

  const ensureHealthy = async (): Promise<void> => {
    await open();
    if (healthy) {
      return;
    }
    if (fatalError) {
      throw fatalError;
    }
    if (!healthPromise) {
      healthPromise = hooks
        .health()
        .then(() => {
          healthy = true;
        })
        .catch((err: unknown) => {
          fatalError = err instanceof Error ? err : new Error(String(err));
          throw fatalError;
        })
        .finally(() => {
          healthPromise = null;
        });
    }
    await healthPromise;
  };

  return {
    open,
    ensureHealthy,
    isOpen: () => opened,
    isHealthy: () => healthy,
  };
}
