import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ItemFile } from "@collector/shared";
import { ItemDetailMetadata } from "./ItemDetailMetadata";

const raw = `---
title: Note
tags:
  - index
---
body
`;

const getItemSource = vi.fn(async () => raw);
const dismiss = vi.fn();
const upsert = vi.fn();
const alerts = { dismiss, upsert };

vi.mock("../../services/collector-client", () => ({
  getCollectorService: () => ({
    items: {
      getItemSource,
    },
  }),
}));

vi.mock("../alerts/AlertBusProvider", () => ({
  useAlerts: () => alerts,
  useDismissAlertsOnUnmount: () => {},
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("ItemDetailMetadata tag casing (#949)", () => {
  it("renders tag values exactly as parsed from frontmatter (index stays lowercase)", async () => {
    const item = {
      id: "Inbox/note.md",
      updated_at: new Date().toISOString(),
      word_count: 0,
      character_count: 0,
    } as unknown as ItemFile;

    render(<ItemDetailMetadata item={item} />);

    // Section is collapsed by default; expand to render metadata rows.
    const toggle = screen.getByRole("button", { name: /Метаданные/i });
    toggle.click();

    // Wait for async frontmatter load.
    expect(await screen.findByText("index")).toBeInTheDocument();
    expect(screen.queryByText("Index")).toBeNull();
  });
});
