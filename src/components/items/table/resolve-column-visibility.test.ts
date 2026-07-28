import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveColumnVisibility,
  type ColumnVisibilitySpec,
} from "./resolve-column-visibility.ts";

const COLUMNS: ColumnVisibilitySpec[] = [
  { id: "title", defaultVisible: true, enableHiding: true },
  { id: "created_at", defaultVisible: true, enableHiding: true },
  { id: "content_type", defaultVisible: false, enableHiding: true },
  { id: "actions", defaultVisible: true, enableHiding: false },
];

describe("resolveColumnVisibility", () => {
  it("uses defaultVisible when stored is empty", () => {
    assert.deepEqual(resolveColumnVisibility(COLUMNS, {}), {
      title: true,
      created_at: true,
      content_type: false,
      actions: true,
    });
  });

  it("applies stored values for hideable columns", () => {
    assert.deepEqual(
      resolveColumnVisibility(COLUMNS, {
        title: false,
        content_type: true,
      }),
      {
        title: false,
        created_at: true,
        content_type: true,
        actions: true,
      },
    );
  });

  it("ignores unknown stored ids", () => {
    const resolved = resolveColumnVisibility(COLUMNS, {
      ghost: true,
      title: true,
    });
    assert.equal("ghost" in resolved, false);
    assert.equal(resolved.title, true);
  });

  it("forces non-hideable columns visible even if stored false", () => {
    assert.equal(
      resolveColumnVisibility(COLUMNS, { actions: false }).actions,
      true,
    );
  });
});
