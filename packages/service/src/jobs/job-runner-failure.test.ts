import { describe, expect, it } from "vitest";
import { permanentFailureSummary } from "./job-runner-failure.js";

describe("permanentFailureSummary", () => {
  it("names failed remote image localize for itemDerivedRefresh", () => {
    expect(
      permanentFailureSummary(
        "itemDerivedRefresh",
        "localizeRemoteDisplayAssets: failed to download markdown image from https://cdn.example/x.png: 404",
      ),
    ).toBe("Не удалось скачать картинку в заметке");
    expect(
      permanentFailureSummary(
        "itemDerivedRefresh",
        "ENAMETOOLONG: name too long, open '/vault/media/…'",
      ),
    ).toBe("Не удалось скачать картинку в заметке");
  });

  it("uses a human summary for other itemDerivedRefresh failures", () => {
    expect(
      permanentFailureSummary("itemDerivedRefresh", "index sync failed"),
    ).toBe("Не удалось обновить материалы заметки");
  });

  it("keeps the generic template for unknown job types", () => {
    expect(permanentFailureSummary("__test_noop", "boom")).toBe(
      "Задача «__test_noop» не выполнилась",
    );
  });
});
