import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderDestinationDialog } from "./FolderDestinationDialog";

afterEach(() => {
  cleanup();
});

describe("FolderDestinationDialog suggestions", () => {
  it("shows full-width suggestion rows below the list and selects on click", () => {
    const onConfirm = vi.fn();
    render(
      <FolderDestinationDialog
        open
        onOpenChange={() => {}}
        title="Переместить файл"
        description="Выберите папку"
        listAriaLabel="Папка назначения"
        destinations={[
          { path: "Inbox", label: "Inbox", disabled: true },
          { path: "Design", label: "Design" },
          { path: "Health", label: "Health" },
        ]}
        suggestions={[
          { path: "Design", label: "Design" },
          { path: "Health", label: "Health" },
        ]}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Возможно сюда")).toBeTruthy();
    const listbox = screen.getByRole("listbox", { name: "Папка назначения" });
    const suggestGroup = screen.getByRole("group", {
      name: "Предлагаемые папки",
    });
    expect(
      listbox.compareDocumentPosition(suggestGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const suggestionButtons = within(suggestGroup).getAllByRole("button");
    expect(suggestionButtons).toHaveLength(2);
    fireEvent.click(suggestionButtons[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Переместить" }));
    expect(onConfirm).toHaveBeenCalledWith("Design");
  });

  it("hides suggestions block when empty", () => {
    render(
      <FolderDestinationDialog
        open
        onOpenChange={() => {}}
        title="Переместить файл"
        description="Выберите папку"
        listAriaLabel="Папка назначения"
        destinations={[{ path: "Design", label: "Design" }]}
        suggestions={[]}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText("Возможно сюда")).toBeNull();
  });
});
