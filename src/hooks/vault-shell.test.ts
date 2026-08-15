import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Subscription } from "@collector/api";
import {
  subscribeVaultPresentationRevision,
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
