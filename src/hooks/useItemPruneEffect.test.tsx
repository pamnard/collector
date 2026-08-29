/**
 * Item prune paint races (#885/#898): a prune signal must remove the item from
 * clickable UI. Assert DOM outcome — not onPrune call-counts. Updater-identity
 * churn must not re-fire prune (visible as a corrupted painted list).
 */
import {
  useCallback,
  useState,
  type ReactElement,
} from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  nextItemPruneSignal,
  useItemPruneEffect,
  type ItemPruneSignal,
} from "./useItemPruneEffect.ts";
import { filterOutItemId } from "../lib/dashboard-commit.ts";

afterEach(() => {
  cleanup();
});

type Row = { id: string; title: string };

function PaintRows(props: { rows: Row[] }): ReactElement {
  return (
    <ul data-testid="prune-list">
      {props.rows.map((row) => (
        <li key={row.id}>
          <button type="button">{row.title}</button>
        </li>
      ))}
    </ul>
  );
}

function PruneListPaint(props: {
  initialRows: Row[];
  signal: ItemPruneSignal | null;
}): ReactElement {
  const [rows, setRows] = useState(props.initialRows);

  useItemPruneEffect(props.signal, (itemId) => {
    setRows((previous) => filterOutItemId(previous, itemId));
  });

  return <PaintRows rows={rows} />;
}

/** Interactive shell: sequential prunes share one painted list state. */
function SequentialPruneShell(): ReactElement {
  const [signal, setSignal] = useState<ItemPruneSignal | null>(null);
  const [rows, setRows] = useState<Row[]>([
    { id: "a.md", title: "Alpha" },
    { id: "b.md", title: "Beta" },
  ]);

  useItemPruneEffect(signal, (itemId) => {
    setRows((previous) => filterOutItemId(previous, itemId));
  });

  return (
    <div>
      <PaintRows rows={rows} />
      <button
        type="button"
        onClick={() =>
          setSignal((previous) => nextItemPruneSignal(previous, "a.md"))
        }
      >
        Prune Alpha
      </button>
      <button
        type="button"
        onClick={() =>
          setSignal((previous) => nextItemPruneSignal(previous, "b.md"))
        }
      >
        Prune Beta
      </button>
    </div>
  );
}

describe("useItemPruneEffect paint sequencing (#885)", () => {
  it("prune signal removes the item from the clickable list", () => {
    const signal = nextItemPruneSignal(null, "gone.md");

    render(
      <PruneListPaint
        initialRows={[
          { id: "gone.md", title: "Gone Note" },
          { id: "keep.md", title: "Keep Note" },
        ]}
        signal={signal}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Gone Note" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keep Note" }),
    ).toBeInTheDocument();
  });

  it("seq bump prunes the next painted row without restoring earlier ones", () => {
    render(<SequentialPruneShell />);

    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prune Alpha" }));
    expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prune Beta" }));
    expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Beta" })).not.toBeInTheDocument();
  });

  it("null signal leaves the list painted", () => {
    render(
      <PruneListPaint
        initialRows={[{ id: "a.md", title: "Alpha" }]}
        signal={null}
      />,
    );

    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
  });

  it("changing onPrune identity without a new signal does not re-prune", () => {
    const signal = nextItemPruneSignal(null, "a.md");

    function Harness(props: { pruneKey: number }): ReactElement {
      const [rows, setRows] = useState<Row[]>([
        { id: "a.md", title: "Alpha" },
        { id: "b.md", title: "Beta" },
      ]);
      const onPrune = useCallback(
        (itemId: string) => {
          setRows((previous) => {
            // Second fire for an already-removed id paints a corruption marker.
            if (!previous.some((row) => row.id === itemId)) {
              return [
                ...previous,
                { id: "double-fire.md", title: "Double Fire" },
              ];
            }
            return filterOutItemId(previous, itemId);
          });
        },
        [props.pruneKey],
      );
      useItemPruneEffect(signal, onPrune);
      return <PaintRows rows={rows} />;
    }

    function expectStablePrunedPaint(): void {
      expect(
        screen.queryByRole("button", { name: "Alpha" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Double Fire" }),
      ).not.toBeInTheDocument();
    }

    const { rerender } = render(<Harness pruneKey={1} />);
    expectStablePrunedPaint();

    act(() => {
      rerender(<Harness pruneKey={2} />);
    });

    // Ref-held updater: identity churn must not re-fire the same signal.
    expectStablePrunedPaint();
  });
});
