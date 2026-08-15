import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Subscription } from "@collector/api";
import {
  createCoalescedVaultRevisionBump,
  subscribeVaultPresentationRevision,
  VAULT_REVISION_BUMP_COALESCE_MS,
  type VaultPresentationIndex,
} from "./vault-shell.ts";
import { nextItemPruneSignal } from "./useItemPruneEffect.ts";

function subscriptionFrom(teardown: () => void): Subscription {
  const unsub = () => {
    teardown();
  };
  unsub.unsubscribe = unsub;
  return unsub as Subscription;
}

describe("subscribeVaultPresentationRevision (#669)", () => {
  it("calls onBump when vault presentation changes", () => {
    let listener: (() => void) | undefined;
    const index: VaultPresentationIndex = {
      subscribeVaultPresentationChanged: (onUpdate) => {
        listener = onUpdate;
        return subscriptionFrom(() => {
          listener = undefined;
        });
      },
    };
    let bumps = 0;
    const unsubscribe = subscribeVaultPresentationRevision(index, () => {
      bumps += 1;
    });
    assert.equal(typeof listener, "function");
    listener?.();
    assert.equal(bumps, 1);
    unsubscribe();
    assert.equal(listener, undefined);
  });
});

describe("vault prune signal (#669)", () => {
  it("advances seq when prune is bound to dashboard prune", () => {
    const pruned: string[] = [];
    let signal = nextItemPruneSignal(null, "a");
    assert.equal(signal.itemId, "a");
    assert.equal(signal.seq, 1);
    pruned.push("a");
    signal = nextItemPruneSignal(signal, "b");
    assert.equal(signal.itemId, "b");
    assert.equal(signal.seq, 2);
    assert.deepEqual(pruned, ["a"]);
  });
});

describe("createCoalescedVaultRevisionBump (#653)", () => {
  it("runs the first bump immediately", () => {
    let bumps = 0;
    let t = 0;
    const bump = createCoalescedVaultRevisionBump(
      () => {
        bumps += 1;
      },
      VAULT_REVISION_BUMP_COALESCE_MS,
      () => t,
    );
    bump();
    assert.equal(bumps, 1);
  });

  it("coalesces presentation-changed + refreshVault after one delete into a single bump", () => {
    let bumps = 0;
    let t = 0;
    const bump = createCoalescedVaultRevisionBump(
      () => {
        bumps += 1;
      },
      VAULT_REVISION_BUMP_COALESCE_MS,
      () => t,
    );

    // Host vaultPresentationChanged mid/after deleteItem.
    bump();
    // Explicit refreshVault from useItemDetail / ItemRowActions onUpdated.
    t = 40;
    bump();

    assert.equal(bumps, 1);
  });

  it("still bumps once for MCP deletes that only emit presentation-changed", () => {
    let bumps = 0;
    let t = 0;
    const bump = createCoalescedVaultRevisionBump(
      () => {
        bumps += 1;
      },
      VAULT_REVISION_BUMP_COALESCE_MS,
      () => t,
    );

    bump();
    assert.equal(bumps, 1);
  });

  it("allows a later independent bump after the coalesce window", () => {
    let bumps = 0;
    let t = 0;
    const bump = createCoalescedVaultRevisionBump(
      () => {
        bumps += 1;
      },
      VAULT_REVISION_BUMP_COALESCE_MS,
      () => t,
    );

    bump();
    t = VAULT_REVISION_BUMP_COALESCE_MS;
    bump();
    assert.equal(bumps, 2);
  });

  it("wires presentation subscription through the same coalesced bump (#653)", () => {
    let listener: (() => void) | undefined;
    const index: VaultPresentationIndex = {
      subscribeVaultPresentationChanged: (onUpdate) => {
        listener = onUpdate;
        return subscriptionFrom(() => {
          listener = undefined;
        });
      },
    };

    let bumps = 0;
    let t = 0;
    const bump = createCoalescedVaultRevisionBump(
      () => {
        bumps += 1;
      },
      VAULT_REVISION_BUMP_COALESCE_MS,
      () => t,
    );
    subscribeVaultPresentationRevision(index, bump);

    // Delete: presentation event then explicit refreshVault.
    listener?.();
    t = 10;
    bump();
    assert.equal(bumps, 1);

    // External MCP delete: presentation only.
    t = VAULT_REVISION_BUMP_COALESCE_MS + 10;
    listener?.();
    assert.equal(bumps, 2);
  });
});
