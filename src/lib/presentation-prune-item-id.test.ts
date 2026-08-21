import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { itemIdToPruneFromPresentationEvent } from "./presentation-prune-item-id.ts";

describe("itemIdToPruneFromPresentationEvent (#756)", () => {
  it("returns deleted item id", () => {
    assert.equal(
      itemIdToPruneFromPresentationEvent({
        vaultId: "v",
        kind: "itemDeleted",
        itemId: "A/x.md",
        folderPath: "A",
      }),
      "A/x.md",
    );
  });

  it("reconstructs pre-move id from fromFolderPath + leaf", () => {
    assert.equal(
      itemIdToPruneFromPresentationEvent({
        vaultId: "v",
        kind: "itemMoved",
        itemId: "B/x.md",
        fromFolderPath: "A",
        toFolderPath: "B",
      }),
      "A/x.md",
    );
  });
});
