import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Subscription, VaultPresentationChangedPayload } from "@collector/api";
import {
  createCoalescedVaultRevisionBump,
  createTrailingPresentationBatch,
  planVaultPresentationBatch,
  subscribeVaultPresentationChanged,
  VAULT_PRESENTATION_BATCH_MS,
  VAULT_REVISION_BUMP_COALESCE_MS,
  type VaultPresentationIndex,
} from "./vault-shell.ts";
import { nextItemPruneSignal } from "./useItemPruneEffect.ts";
import {
  dashboardLiveActionForEvent,
  folderCountPatchPlanForEvent,
  isVaultPresentationPayload,
  openItemAffectedByEvent,
  itemLiveSignalTriggerForEvent,
  sidebarTagsAffectedByEvent,
  sidebarSearchAffectedByEvent,
} from "../lib/vault-presentation-affects.ts";
import { patchFolderTreeItemCounts } from "../lib/folder-tree-count-patch.ts";
import type { FolderTreeNode } from "@collector/core";

function subscriptionFrom(teardown: () => void): Subscription {
  const unsub = () => {
    teardown();
  };
  unsub.unsubscribe = unsub;
  return unsub as Subscription;
}

const baseUpsert = (folderPath: string): VaultPresentationChangedPayload => ({
  vaultId: "v",
  kind: "itemUpserted",
  itemId: `${folderPath}/n.md`,
  folderPath,
});

describe("subscribeVaultPresentationChanged (#756)", () => {
  it("forwards the full payload to the listener", () => {
    let listener:
      | ((payload: VaultPresentationChangedPayload) => void)
      | undefined;
    const index: VaultPresentationIndex = {
      subscribeVaultPresentationChanged: (onUpdate) => {
        listener = onUpdate;
        return subscriptionFrom(() => {
          listener = undefined;
        });
      },
    };
    const received: VaultPresentationChangedPayload[] = [];
    const unsubscribe = subscribeVaultPresentationChanged(index, (payload) => {
      received.push(payload);
    });
    assert.equal(typeof listener, "function");
    listener?.(baseUpsert("Inbox"));
    assert.deepEqual(received, [baseUpsert("Inbox")]);
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

  it("coalesces rapid full-wipe bumps into a single bump", () => {
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
    t = 40;
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
});

describe("trailing presentation batch (#756)", () => {
  it("flushes accumulated events once after the quiet window", () => {
    const flushes: unknown[][] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const batch = createTrailingPresentationBatch(
      (entries) => {
        flushes.push(entries);
      },
      VAULT_PRESENTATION_BATCH_MS,
      (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      () => {
        timers.pop();
      },
    );

    batch.push(baseUpsert("A"));
    batch.push(baseUpsert("B"));
    assert.equal(flushes.length, 0);
    assert.equal(timers.length, 1);
    timers[0]?.fn();
    assert.equal(flushes.length, 1);
    assert.equal(flushes[0]?.length, 2);
  });

  it("plans full wipe for folderChanged or broken payloads", () => {
    assert.deepEqual(
      planVaultPresentationBatch([
        { vaultId: "v", kind: "folderChanged", folderPath: "A" },
      ]),
      { type: "fullWipe" },
    );
    assert.deepEqual(planVaultPresentationBatch([{ vaultId: "v" }]), {
      type: "fullWipe",
    });
    const upsert = baseUpsert("Inbox");
    assert.deepEqual(planVaultPresentationBatch([upsert]), {
      type: "incremental",
      events: [upsert],
    });
  });
});

describe("dashboardLiveActionForEvent (#756)", () => {
  it("ignores unrelated folder while viewing folder A or search-driven all", () => {
    assert.equal(
      dashboardLiveActionForEvent(
        { type: "folder", folderPath: "A" },
        baseUpsert("B"),
      ),
      "ignore",
    );
  });

  it("soft-refreshes or prunes the active folder without treating cover as list refetch", () => {
    assert.equal(
      dashboardLiveActionForEvent(
        { type: "folder", folderPath: "A" },
        baseUpsert("A"),
      ),
      "softRefresh",
    );
    assert.equal(
      dashboardLiveActionForEvent(
        { type: "folder", folderPath: "A" },
        {
          vaultId: "v",
          kind: "itemDeleted",
          itemId: "A/x.md",
          folderPath: "A",
        },
      ),
      "prune",
    );
    assert.equal(
      dashboardLiveActionForEvent("all", {
        vaultId: "v",
        kind: "itemCoverChanged",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      "coverPatch",
    );
  });

  it("move out of active folder prunes; move into soft-refreshes", () => {
    assert.equal(
      dashboardLiveActionForEvent(
        { type: "folder", folderPath: "A" },
        {
          vaultId: "v",
          kind: "itemMoved",
          itemId: "B/x.md",
          fromFolderPath: "A",
          toFolderPath: "B",
        },
      ),
      "prune",
    );
    assert.equal(
      dashboardLiveActionForEvent(
        { type: "folder", folderPath: "A" },
        {
          vaultId: "v",
          kind: "itemMoved",
          itemId: "A/x.md",
          fromFolderPath: "B",
          toFolderPath: "A",
        },
      ),
      "softRefresh",
    );
  });
});

describe("sidebar / detail relevance (#756)", () => {
  it("sidebar search soft-refetches on item mutations when query is non-empty", () => {
    assert.equal(sidebarSearchAffectedByEvent("", baseUpsert("A")), false);
    assert.equal(sidebarSearchAffectedByEvent("note", baseUpsert("A")), true);
    assert.equal(
      sidebarSearchAffectedByEvent("note", {
        vaultId: "v",
        kind: "itemCoverChanged",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      false,
    );
  });

  it("open item surfaces reload only for matching itemId", () => {
    assert.equal(openItemAffectedByEvent("A/x.md", baseUpsert("A")), false);
    assert.equal(
      openItemAffectedByEvent("A/x.md", {
        vaultId: "v",
        kind: "itemUpserted",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      true,
    );
    assert.equal(
      openItemAffectedByEvent("A/x.md", {
        vaultId: "v",
        kind: "itemDerivedComplete",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      true,
    );
    assert.equal(
      openItemAffectedByEvent("A/x.md", {
        vaultId: "v",
        kind: "itemDerivedComplete",
        itemId: "B/y.md",
        folderPath: "B",
      }),
      false,
    );
  });

  it("maps itemDerivedComplete to derivedComplete live trigger (#769)", () => {
    assert.equal(
      itemLiveSignalTriggerForEvent({
        vaultId: "v",
        kind: "itemUpserted",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      "presentation",
    );
    assert.equal(
      itemLiveSignalTriggerForEvent({
        vaultId: "v",
        kind: "itemDerivedComplete",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      "derivedComplete",
    );
  });

  it("sidebar tags refetch only on count-affecting item events (#950)", () => {
    assert.equal(
      sidebarTagsAffectedByEvent({
        vaultId: "v",
        kind: "itemCreated",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      true,
    );
    assert.equal(
      sidebarTagsAffectedByEvent({
        vaultId: "v",
        kind: "itemUpserted",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      true,
    );
    assert.equal(
      sidebarTagsAffectedByEvent({
        vaultId: "v",
        kind: "itemDeleted",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      true,
    );
    assert.equal(
      sidebarTagsAffectedByEvent({
        vaultId: "v",
        kind: "itemMoved",
        itemId: "B/x.md",
        fromFolderPath: "A",
        toFolderPath: "B",
      }),
      false,
    );
    assert.equal(
      sidebarTagsAffectedByEvent({
        vaultId: "v",
        kind: "itemCoverChanged",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      false,
    );
  });

  it("rejects broken payloads", () => {
    assert.equal(isVaultPresentationPayload({ vaultId: "v" }), false);
    assert.equal(isVaultPresentationPayload(baseUpsert("A")), true);
  });
});

describe("folder tree count patch (#756)", () => {
  it("patches counts on a folder and ancestors without replacing unrelated nodes", () => {
    const child: FolderTreeNode = {
      name: "Child",
      path: "A/Child",
      item_count: 1,
      children: [],
    };
    const a: FolderTreeNode = {
      name: "A",
      path: "A",
      item_count: 2,
      children: [child],
    };
    const b: FolderTreeNode = {
      name: "B",
      path: "B",
      item_count: 5,
      children: [],
    };
    const tree = [a, b];
    const deltas = new Map<string, number>([
      ["A/Child", 1],
      ["A", 1],
      ["", 1],
    ]);
    const next = patchFolderTreeItemCounts(tree, deltas);
    assert.notEqual(next, tree);
    assert.equal(next[1], b);
    assert.equal(next[0]?.item_count, 3);
    assert.equal(next[0]?.children[0]?.item_count, 2);
    assert.equal(next[0]?.children[0]?.path, "A/Child");
  });

  it("plans create/delete/move deltas; edit upsert leaves counts alone (#759)", () => {
    const created = folderCountPatchPlanForEvent({
      vaultId: "v",
      kind: "itemCreated",
      itemId: "A/Child/x.md",
      folderPath: "A/Child",
    });
    assert.equal(created.type, "deltas");
    if (created.type === "deltas") {
      assert.equal(created.deltas.get("A/Child"), 1);
      assert.equal(created.deltas.get("A"), 1);
      assert.equal(created.deltas.get(""), 1);
    }

    const del = folderCountPatchPlanForEvent({
      vaultId: "v",
      kind: "itemDeleted",
      itemId: "A/x.md",
      folderPath: "A",
    });
    assert.equal(del.type, "deltas");
    if (del.type === "deltas") {
      assert.equal(del.deltas.get("A"), -1);
    }

    const moved = folderCountPatchPlanForEvent({
      vaultId: "v",
      kind: "itemMoved",
      itemId: "B/x.md",
      fromFolderPath: "A",
      toFolderPath: "B",
    });
    assert.equal(moved.type, "deltas");
    if (moved.type === "deltas") {
      assert.equal(moved.deltas.get("A"), -1);
      assert.equal(moved.deltas.get("B"), 1);
    }

    assert.equal(folderCountPatchPlanForEvent(baseUpsert("A")).type, "none");
    assert.equal(
      folderCountPatchPlanForEvent({
        vaultId: "v",
        kind: "folderChanged",
        folderPath: "A",
      }).type,
      "reload",
    );
  });
});
