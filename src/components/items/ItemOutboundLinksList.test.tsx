import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OutboundTextLink } from "@collector/api";
import { itemPathHref } from "@collector/core";
import { ItemOutboundLinksList } from "./ItemOutboundLinksList";

afterEach(() => {
  cleanup();
});

const resolvedInternal: OutboundTextLink = {
  scope: "internal",
  kind: "wikilink",
  rawTarget: "A",
  displayText: null,
  position: 0,
  resolvedItemId: "Inbox/a.md",
  status: "resolved",
  title: "Target title",
};

const unresolvedInternal: OutboundTextLink = {
  scope: "internal",
  kind: "wikilink",
  rawTarget: "Missing",
  displayText: null,
  position: 1,
  resolvedItemId: null,
  status: "unresolved",
  title: null,
};

const externalWithAlias: OutboundTextLink = {
  scope: "external",
  kind: "md",
  rawTarget: "https://example.com/path",
  displayText: "статья",
  position: 10,
  resolvedItemId: null,
  status: null,
  title: null,
};

describe("ItemOutboundLinksList (#794)", () => {
  it("renders resolved internal link and navigates on click", () => {
    const onNavigate = vi.fn();
    render(
      <ItemOutboundLinksList
        links={[resolvedInternal]}
        onNavigate={onNavigate}
      />,
    );

    const link = screen.getByRole("link", { name: "Target title" });
    expect(link).toHaveAttribute(
      "href",
      itemPathHref(resolvedInternal.resolvedItemId!),
    );
    expect(
      screen.getByTestId("item-outbound-internal-list"),
    ).toBeInTheDocument();

    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("Inbox/a.md");
  });

  it("renders unresolved internal as non-navigating text", () => {
    const onNavigate = vi.fn();
    render(
      <ItemOutboundLinksList
        links={[unresolvedInternal]}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Missing" })).toBeNull();
    fireEvent.click(screen.getByText("Missing"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("renders external alias with URL hint", () => {
    render(
      <ItemOutboundLinksList
        links={[externalWithAlias]}
        onNavigate={() => {}}
      />,
    );

    const link = screen.getByRole("link", { name: "статья" });
    expect(link).toHaveAttribute("href", "https://example.com/path");
    expect(
      screen.getByTestId("item-outbound-external-list"),
    ).toBeInTheDocument();
    expect(screen.getByText("https://example.com/path")).toBeInTheDocument();
  });
});
