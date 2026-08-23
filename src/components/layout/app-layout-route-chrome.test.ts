import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAppLayoutRouteChrome } from "./app-layout-route-chrome.ts";

describe("resolveAppLayoutRouteChrome", () => {
  it("marks dashboard as list header with card chrome", () => {
    assert.deepEqual(resolveAppLayoutRouteChrome("/", null), {
      isItemRoute: false,
      isSettingsRoute: false,
      settingsSection: "general",
      showCardHeader: true,
      headerVariant: "list",
    });
  });

  it("marks settings route and parses section", () => {
    assert.deepEqual(resolveAppLayoutRouteChrome("/settings", "telegram"), {
      isItemRoute: false,
      isSettingsRoute: true,
      settingsSection: "telegram",
      showCardHeader: true,
      headerVariant: "settings",
    });
  });

  it("marks item routes for item header chrome", () => {
    assert.deepEqual(resolveAppLayoutRouteChrome("/item/abc", null), {
      isItemRoute: true,
      isSettingsRoute: false,
      settingsSection: "general",
      showCardHeader: true,
      headerVariant: "item",
    });
  });

  it("hides card header off known app surfaces", () => {
    const chrome = resolveAppLayoutRouteChrome("/other", null);
    assert.equal(chrome.showCardHeader, false);
    assert.equal(chrome.headerVariant, "item");
  });
});
