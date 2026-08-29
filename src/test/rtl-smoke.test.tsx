import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ItemFile } from "@collector/shared";
import { ItemGridCard } from "../components/items/ItemGridCard";

vi.mock("../hooks/useMainScrollElement", () => ({
  useMainScrollElement: () => document.body,
}));

afterEach(() => {
  cleanup();
});

function stubItem(id: string, title: string): ItemFile {
  return {
    id,
    title,
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: "cover.webp",
  } as ItemFile;
}

describe("ItemGridCard RTL", () => {
  it("exposes the item title as an accessible button name", () => {
    const item = stubItem("rtl-card", "Teapot Notes");

    render(
      <ItemGridCard
        item={item}
        thumbnailPath={null}
        thumbnailSize={null}
        tagsById={new Map()}
        onOpen={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Teapot Notes/i }),
    ).toBeInTheDocument();
  });
});
