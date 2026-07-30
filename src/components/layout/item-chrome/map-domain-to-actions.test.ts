import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapDomainToActions,
  mapDomainToBreadcrumbs,
} from "./map-domain-to-actions.ts";
import type { ItemChromeDomain } from "./types.ts";

function domain(
  overrides: Partial<ItemChromeDomain> = {},
): ItemChromeDomain {
  return {
    status: "ready",
    item: { id: "a", title: "Title", folder_path: "inbox" },
    mode: "view",
    idCopyFeedback: null,
    isSaving: false,
    isDeleting: false,
    onCopyId: () => {},
    onView: () => {},
    onForm: () => {},
    onSource: () => {},
    onDelete: () => {},
    ...overrides,
  };
}

describe("mapDomainToBreadcrumbs", () => {
  it("returns null when domain is cleared", () => {
    assert.equal(mapDomainToBreadcrumbs(null), null);
  });

  it("maps loading status to loading breadcrumbs", () => {
    assert.deepEqual(mapDomainToBreadcrumbs(domain({ status: "loading", item: null })), {
      status: "loading",
    });
  });

  it("maps ready item to folder path and title", () => {
    assert.deepEqual(mapDomainToBreadcrumbs(domain()), {
      status: "ready",
      folderPath: "inbox",
      title: "Title",
    });
  });

  it("maps error without item to empty ready breadcrumbs", () => {
    assert.deepEqual(
      mapDomainToBreadcrumbs(domain({ status: "error", item: null })),
      { status: "ready", folderPath: "", title: "" },
    );
  });
});

describe("mapDomainToActions", () => {
  it("returns null when domain is cleared", () => {
    assert.equal(mapDomainToActions(null), null);
  });

  it("maps domain fields into actions model with ready from item", () => {
    const onCopyId = () => {};
    const onView = () => {};
    const onForm = () => {};
    const onSource = () => {};
    const onDelete = () => {};
    const actions = mapDomainToActions(
      domain({
        mode: "form",
        idCopyFeedback: "copied",
        isSaving: true,
        isDeleting: false,
        onCopyId,
        onView,
        onForm,
        onSource,
        onDelete,
      }),
    );
    assert.deepEqual(
      {
        mode: actions?.mode,
        idCopyFeedback: actions?.idCopyFeedback,
        isSaving: actions?.isSaving,
        isDeleting: actions?.isDeleting,
        ready: actions?.ready,
        onCopyId: actions?.onCopyId,
        onView: actions?.onView,
        onForm: actions?.onForm,
        onSource: actions?.onSource,
        onDelete: actions?.onDelete,
      },
      {
        mode: "form",
        idCopyFeedback: "copied",
        isSaving: true,
        isDeleting: false,
        ready: true,
        onCopyId,
        onView,
        onForm,
        onSource,
        onDelete,
      },
    );
  });

  it("sets ready false when item is missing", () => {
    const actions = mapDomainToActions(
      domain({ status: "loading", item: null }),
    );
    assert.equal(actions?.ready, false);
  });
});
