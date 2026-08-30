import type { BacklinkSource } from "../links/collect-backlink-sources.js";
import { parseDocumentMarkdown } from "../vault/frontmatter.js";
import {
  SQL_INSERT_CHUNK,
  sqlInPlaceholders,
  sqlRowPlaceholders,
  type SqlIndexSelector,
} from "../index/sql-index-helpers.js";
import { textLinkCatalogIndexesFromItems } from "../links/text-links-reindex.js";
import { textEdgeRowsFromBody } from "./text-edge-rows.js";
import type { ItemEdgeInsertRow, UserEdgeNeighbor } from "./types.js";
import { canonicalUserEdgePair } from "./user-edge-canonical.js";

const EDGE_INSERT_COLUMNS = 11;

async function requireItemInVault(
  selector: SqlIndexSelector,
  vaultId: string,
  itemId: string,
  label: string,
): Promise<void> {
  const rows = await selector.select<{ id: string }>(
    "SELECT id FROM items WHERE id = ? AND vault_id = ?",
    [itemId, vaultId],
  );
  if (rows.length === 0) {
    throw new Error(`${label}: item not found in vault: ${itemId}`);
  }
}

async function insertEdgeRows(
  selector: SqlIndexSelector,
  rows: ItemEdgeInsertRow[],
  timestamp: string,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += SQL_INSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + SQL_INSERT_CHUNK);
    const binds: unknown[] = [];
    for (const row of chunk) {
      binds.push(
        crypto.randomUUID(),
        row.vaultId,
        row.fromId,
        row.toId,
        row.rawTarget,
        row.source,
        row.kind,
        row.position,
        row.resolveStatus,
        timestamp,
        timestamp,
      );
    }
    await selector.execute(
      `INSERT INTO item_edges (
        id, vault_id, from_id, to_id, raw_target, source, kind,
        position, resolve_status, created_at, updated_at
      ) VALUES ${sqlRowPlaceholders(chunk.length, EDGE_INSERT_COLUMNS)}`,
      binds,
    );
  }
}

export async function replaceTextEdgesForItem(
  selector: SqlIndexSelector,
  vaultId: string,
  fromId: string,
  markdownContent: string,
  catalog: ReadonlyArray<{ id: string; title: string }>,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const body = parseDocumentMarkdown(markdownContent).body;
  const indexes = textLinkCatalogIndexesFromItems(catalog);
  const rows = textEdgeRowsFromBody(vaultId, fromId, body, indexes);

  await selector.execute(
    "DELETE FROM item_edges WHERE from_id = ? AND source = 'text'",
    [fromId],
  );
  if (rows.length === 0) {
    return;
  }
  await insertEdgeRows(selector, rows, timestamp);
}

export async function rebuildVaultTextEdges(
  selector: SqlIndexSelector,
  vaultId: string,
  loadCatalog: () => Promise<Array<{ id: string; title: string }>>,
  loadBodies: () => Promise<Array<{ id: string; content: string }>>,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const catalog = await loadCatalog();
  const bodies = await loadBodies();
  const indexes = textLinkCatalogIndexesFromItems(catalog);

  await selector.execute(
    "DELETE FROM item_edges WHERE vault_id = ? AND source = 'text'",
    [vaultId],
  );

  const allRows: ItemEdgeInsertRow[] = [];
  for (const source of bodies) {
    const body = parseDocumentMarkdown(source.content).body;
    allRows.push(
      ...textEdgeRowsFromBody(vaultId, source.id, body, indexes),
    );
  }
  if (allRows.length === 0) {
    return;
  }
  await insertEdgeRows(selector, allRows, timestamp);
}

export async function listTextBacklinkSources(
  selector: SqlIndexSelector,
  targetItemId: string,
): Promise<BacklinkSource[]> {
  const rows = await selector.select<{ id: string; title: string }>(
    `SELECT i.id AS id, i.title AS title
     FROM item_edges e
     INNER JOIN items i ON i.id = e.from_id
     WHERE e.to_id = ?
       AND e.source = 'text'
       AND e.resolve_status = 'resolved'
     ORDER BY i.title ASC, i.id ASC`,
    [targetItemId],
  );
  return rows.map((row) => ({ id: row.id, title: row.title }));
}

export async function addUserEdge(
  selector: SqlIndexSelector,
  vaultId: string,
  itemA: string,
  itemB: string,
): Promise<void> {
  await requireItemInVault(selector, vaultId, itemA, "addUserEdge");
  await requireItemInVault(selector, vaultId, itemB, "addUserEdge");
  const pair = canonicalUserEdgePair(itemA, itemB);
  const timestamp = new Date().toISOString();
  await selector.execute(
    `INSERT OR IGNORE INTO item_edges (
      id, vault_id, from_id, to_id, raw_target, source, kind,
      position, resolve_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'user', 'user', 0, NULL, ?, ?)`,
    [
      crypto.randomUUID(),
      vaultId,
      pair.fromId,
      pair.toId,
      pair.toId,
      timestamp,
      timestamp,
    ],
  );
}

export async function removeUserEdge(
  selector: SqlIndexSelector,
  vaultId: string,
  itemA: string,
  itemB: string,
): Promise<void> {
  const pair = canonicalUserEdgePair(itemA, itemB);
  await selector.execute(
    `DELETE FROM item_edges
     WHERE vault_id = ?
       AND source = 'user'
       AND from_id = ?
       AND to_id = ?`,
    [vaultId, pair.fromId, pair.toId],
  );
}

export async function listUserEdges(
  selector: SqlIndexSelector,
  vaultId: string,
  itemId: string,
): Promise<UserEdgeNeighbor[]> {
  const rows = await selector.select<{ id: string; title: string }>(
    `SELECT i.id AS id, i.title AS title
     FROM item_edges e
     INNER JOIN items i ON i.id = CASE
       WHEN e.from_id = ? THEN e.to_id
       ELSE e.from_id
     END
     WHERE e.vault_id = ?
       AND e.source = 'user'
       AND (e.from_id = ? OR e.to_id = ?)
     ORDER BY i.title ASC, i.id ASC`,
    [itemId, vaultId, itemId, itemId],
  );
  return rows.map((row) => ({ id: row.id, title: row.title }));
}

export async function rewriteItemEdgeIds(
  selector: SqlIndexSelector,
  oldToNew: Map<string, string>,
): Promise<void> {
  if (oldToNew.size === 0) {
    return;
  }

  const oldIds = [...oldToNew.keys()];
  const edgeRows = await selector.select<{
    id: string;
    vault_id: string;
    from_id: string;
    to_id: string | null;
    raw_target: string;
    source: string;
    kind: string;
    position: number;
    resolve_status: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, vault_id, from_id, to_id, raw_target, source, kind,
            position, resolve_status, created_at, updated_at
     FROM item_edges
     WHERE from_id IN (${sqlInPlaceholders(oldIds.length)})
        OR to_id IN (${sqlInPlaceholders(oldIds.length)})`,
    [...oldIds, ...oldIds],
  );
  if (edgeRows.length === 0) {
    return;
  }

  const edgeIds = edgeRows.map((row) => row.id);
  await selector.execute(
    `DELETE FROM item_edges WHERE id IN (${sqlInPlaceholders(edgeIds.length)})`,
    edgeIds,
  );

  const timestamp = new Date().toISOString();
  const userPairs = new Set<string>();
  const insertRows: ItemEdgeInsertRow[] = [];

  for (const row of edgeRows) {
    const mappedFrom = oldToNew.get(row.from_id) ?? row.from_id;
    const mappedTo =
      row.to_id === null ? null : (oldToNew.get(row.to_id) ?? row.to_id);

    if (row.source === "user") {
      if (mappedTo === null) {
        continue;
      }
      const pair = canonicalUserEdgePair(mappedFrom, mappedTo);
      const pairKey = `${row.vault_id}\0${pair.fromId}\0${pair.toId}`;
      if (userPairs.has(pairKey)) {
        continue;
      }
      userPairs.add(pairKey);
      insertRows.push({
        vaultId: row.vault_id,
        fromId: pair.fromId,
        toId: pair.toId,
        rawTarget: pair.toId,
        source: "user",
        kind: "user",
        position: 0,
        resolveStatus: null,
      });
      continue;
    }

    insertRows.push({
      vaultId: row.vault_id,
      fromId: mappedFrom,
      toId: mappedTo,
      rawTarget: row.raw_target,
      source: "text",
      kind: row.kind as ItemEdgeInsertRow["kind"],
      position: row.position,
      resolveStatus: row.resolve_status as ItemEdgeInsertRow["resolveStatus"],
    });
  }

  if (insertRows.length > 0) {
    await insertEdgeRows(selector, insertRows, timestamp);
  }
}
