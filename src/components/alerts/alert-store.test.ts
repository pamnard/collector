import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAlertStore } from "./alert-store.ts";

describe("createAlertStore", () => {
  it("push appends and returns id", () => {
    const store = createAlertStore();
    const id = store.push({ tone: "danger", message: "a" });
    assert.equal(typeof id, "string");
    assert.equal(store.getSnapshot().length, 1);
    assert.equal(store.getSnapshot()[0]?.message, "a");
  });

  it("push with same id replaces in place", () => {
    const store = createAlertStore();
    store.push({ id: "x", tone: "info", message: "one" });
    store.push({ id: "y", tone: "info", message: "two" });
    store.push({ id: "x", tone: "danger", message: "one-updated" });
    const snap = store.getSnapshot();
    assert.equal(snap.length, 2);
    assert.equal(snap[0]?.id, "x");
    assert.equal(snap[0]?.message, "one-updated");
    assert.equal(snap[0]?.tone, "danger");
    assert.equal(snap[1]?.id, "y");
  });

  it("upsert is push with required id", () => {
    const store = createAlertStore();
    store.upsert("k", { tone: "warning", message: "w" });
    store.upsert("k", { tone: "warning", message: "w2" });
    assert.equal(store.getSnapshot().length, 1);
    assert.equal(store.getSnapshot()[0]?.message, "w2");
  });

  it("dismiss removes by id", () => {
    const store = createAlertStore();
    store.push({ id: "a", tone: "info", message: "a" });
    store.push({ id: "b", tone: "info", message: "b" });
    store.dismiss("a");
    assert.deepEqual(
      store.getSnapshot().map((e) => e.id),
      ["b"],
    );
  });

  it("clear empties the stack", () => {
    const store = createAlertStore();
    store.push({ tone: "info", message: "a" });
    store.push({ tone: "info", message: "b" });
    store.clear();
    assert.equal(store.getSnapshot().length, 0);
  });

  it("subscribe notifies on change", () => {
    const store = createAlertStore();
    let n = 0;
    const unsub = store.subscribe(() => {
      n += 1;
    });
    store.push({ tone: "info", message: "a" });
    store.dismiss(store.getSnapshot()[0]!.id);
    unsub();
    store.push({ tone: "info", message: "b" });
    assert.equal(n, 2);
  });

  it("dismissible defaults to true", () => {
    const store = createAlertStore();
    store.push({ tone: "danger", message: "x" });
    assert.equal(store.getSnapshot()[0]?.dismissible, true);
    store.upsert("nd", {
      tone: "warning",
      message: "y",
      dismissible: false,
    });
    assert.equal(
      store.getSnapshot().find((e) => e.id === "nd")?.dismissible,
      false,
    );
  });

  it("preserves optional detail", () => {
    const store = createAlertStore();
    store.push({
      id: "d",
      tone: "danger",
      message: "short",
      detail: "tech dump",
    });
    assert.equal(store.getSnapshot()[0]?.detail, "tech dump");
  });
});
