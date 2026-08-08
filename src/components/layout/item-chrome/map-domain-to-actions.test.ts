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
    onMove: () => {},
    onRename: () => {},
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

  it("maps ready item to folder path, title, and copy controls", () => {
    const onCopyId = () => {};
    const mapped = mapDomainToBreadcrumbs(
      domain({ idCopyFeedback: "copied", isSaving: true, onCopyId }),
    );
    assert.deepEqual(
      {
        status: mapped?.status,
        folderPath: mapped && mapped.status === "ready" ? mapped.folderPath : null,
        title: mapped && mapped.status === "ready" ? mapped.title : null,
        idCopyFeedback:
          mapped && mapped.status === "ready" ? mapped.idCopyFeedback : null,
        copyReady: mapped && mapped.status === "ready" ? mapped.copyReady : null,
        isSaving: mapped && mapped.status === "ready" ? mapped.isSaving : null,
        onCopyId: mapped && mapped.status === "ready" ? mapped.onCopyId : null,
      },
      {
        status: "ready",
        folderPath: "inbox",
        title: "Title",
        idCopyFeedback: "copied",
        copyReady: true,
        isSaving: true,
        onCopyId,
      },
    );
  });

  it("maps error without item to empty ready breadcrumbs with copy disabled", () => {
    const onCopyId = () => {};
    const mapped = mapDomainToBreadcrumbs(
      domain({ status: "error", item: null, onCopyId }),
    );
    assert.deepEqual(
      {
        status: mapped?.status,
        folderPath: mapped && mapped.status === "ready" ? mapped.folderPath : null,
        title: mapped && mapped.status === "ready" ? mapped.title : null,
        copyReady: mapped && mapped.status === "ready" ? mapped.copyReady : null,
        onCopyId: mapped && mapped.status === "ready" ? mapped.onCopyId : null,
      },
      {
        status: "ready",
        folderPath: "",
        title: "",
        copyReady: false,
        onCopyId,
      },
    );
  });
});

describe("mapDomainToActions", () => {
  it("returns null when domain is cleared", () => {
    assert.equal(mapDomainToActions(null), null);
  });

  it("maps domain fields into actions model without copy controls", () => {
    const onView = () => {};
    const onForm = () => {};
    const onSource = () => {};
    const onMove = () => {};
    const onRename = () => {};
    const onDelete = () => {};
    const actions = mapDomainToActions(
      domain({
        mode: "form",
        isSaving: true,
        isDeleting: false,
        onView,
        onForm,
        onSource,
        onMove,
        onRename,
        onDelete,
      }),
    );
    assert.deepEqual(
      {
        mode: actions?.mode,
        isSaving: actions?.isSaving,
        isDeleting: actions?.isDeleting,
        ready: actions?.ready,
        onView: actions?.onView,
        onForm: actions?.onForm,
        onSource: actions?.onSource,
        onMove: actions?.onMove,
        onRename: actions?.onRename,
        onDelete: actions?.onDelete,
      },
      {
        mode: "form",
        isSaving: true,
        isDeleting: false,
        ready: true,
        onView,
        onForm,
        onSource,
        onMove,
        onRename,
        onDelete,
      },
    );
    assert.equal(
      actions !== null && !("onCopyId" in actions) && !("idCopyFeedback" in actions),
      true,
    );
  });

  it("sets ready false when item is missing", () => {
    const actions = mapDomainToActions(
      domain({ status: "loading", item: null }),
    );
    assert.equal(actions?.ready, false);
  });
});
