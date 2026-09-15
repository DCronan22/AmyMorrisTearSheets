import type { PostgrestError } from "@supabase/supabase-js";

// Supabase's API returns at most "Max rows" rows per request (1,000 unless
// changed in the dashboard) and silently drops the rest — no error, the list
// just comes back short. Every "load the whole list" read goes through
// fetchAllRows so a firm's database, inventory, etc. arrive complete however
// large they grow.
//
// A list that fits in one request is read exactly as it always was: one
// query, ordered by the server. That matters beyond speed — rows imported
// together share an identical updated_at, and in practice the server hands such
// ties back in the order they were imported (Postgres doesn't promise that, but
// it's what the team sees today). No column records that order, so no
// client-side sort could reproduce it.
//
// Only a list too big for one request is paged, and those pages are walked by
// the row's own uuid (`id > last id seen`), NOT by offset on the sort column:
// ties have no stable order across separate requests, so offset pages could
// repeat some rows and skip others. The id never changes, so a teammate
// editing a row mid-load can't shift it between pages either. The paged rows
// are then sorted in JS into the list's usual order. Ties keep the order the
// first request (the top of the list, where recent imports sit) put them in;
// only ties beyond it fall back to id.

/** Rows requested per page. Never above Supabase's default cap of 1,000. */
export const PAGE_SIZE = 1000;

/** Hard stop against a runaway loop — a million rows is far beyond any firm. */
const MAX_ROWS = 1_000_000;

/** The subset of a supabase-js select builder that paging needs. */
interface PageableQuery {
  gt(column: "id", value: string): PageableQuery;
  order(column: string, options: { ascending: boolean }): PageableQuery;
  limit(count: number): PromiseLike<{
    data: unknown[] | null;
    error: PostgrestError | null;
    count?: number | null;
  }>;
}

/** Options for the select, passed straight through to `.select(cols, opts)`. */
type SelectOptions = { count?: "exact" };

/**
 * A list's order: as the server applies it, and the same order in JS.
 * `compare` must compare `column` ONLY and return 0 for ties — fetchAllRows
 * breaks ties itself.
 */
export interface ListOrder<Row> {
  column: string;
  ascending: boolean;
  compare: (a: Row, b: Row) => number;
}

type AllRows<Row> =
  | { data: Row[]; error: null }
  | { data: null; error: PostgrestError };

/**
 * Read every row a query matches. `query` must build a FRESH select (with its
 * filters) on each call, pass `opts` through as the select's second argument,
 * and include `id` in the selected columns. It must NOT add its own
 * `.order()`, `.range()` or `.limit()` — those would stack with the paging and
 * silently skip rows. Resolves to `{ data, error }` like supabase-js, so call
 * sites keep their usual error handling.
 */
export async function fetchAllRows<Row extends { id: string }>(
  query: (opts: SelectOptions) => PageableQuery,
  order: ListOrder<Row>
): Promise<AllRows<Row>> {
  // The usual single request, plus the true total (the server counts every
  // matching row in the same snapshot, ignoring the cap). If this one page
  // holds them all, it IS the list — exactly what the app always loaded.
  const first = await query({ count: "exact" })
    .order(order.column, { ascending: order.ascending })
    .limit(PAGE_SIZE);
  if (first.error) return { data: null, error: first.error };
  const firstRows = (first.data ?? []) as Row[];
  if (typeof first.count === "number" && firstRows.length >= first.count) {
    return { data: firstRows, error: null };
  }

  // Too many rows for one request: walk the whole list by id instead. Stop
  // only on an EMPTY page, never a short one — if the server's cap were ever
  // set below PAGE_SIZE, a short page wouldn't mean "no more rows".
  //
  // The first request's rows are the top of the list in the server's own
  // order, so they break ties (e.g. a batch imported together) exactly as the
  // server did. Tied rows it didn't reach sort after the ones it did — as they
  // would on the server — and among themselves by id.
  const firstPos = new Map(firstRows.map((r, i) => [r.id, i]));
  const tieRank = (r: Row) => firstPos.get(r.id) ?? firstRows.length;
  const finalOrder = (a: Row, b: Row) =>
    order.compare(a, b) || tieRank(a) - tieRank(b) || byId(a, b);
  const rows: Row[] = [];
  let after: string | null = null;
  while (rows.length <= MAX_ROWS) {
    const q = after === null ? query({}) : query({}).gt("id", after);
    const { data, error } = await q
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) return { data: null, error };
    const page = (data ?? []) as Row[];
    if (page.length === 0) return { data: rows.sort(finalOrder), error: null };
    const last = page[page.length - 1].id;
    // Each page must move strictly past the last one; anything else would
    // re-read the same rows forever.
    if (typeof last !== "string" || (after !== null && last <= after)) {
      throw new Error("The list couldn't be loaded completely. Please reload.");
    }
    rows.push(...page);
    after = last;
  }
  throw new Error("The list is too large to load. Please contact support.");
}

/** Order by id — the last-resort tiebreak, stable from load to load. */
export function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Newest-updated first — the lists' usual order. Supabase serializes
 * timestamps as UTC ISO strings ("2026-09-15T20:23:14.281931+00:00").
 * Postgres trims trailing fractional zeros, so lengths vary ("…:14+00:00",
 * "…:14.5+00:00"), but string order is still time order: after the seconds,
 * "+" sorts before "." which sorts before every digit. That holds only while
 * every value carries the same offset — true because the database runs in UTC.
 */
export const NEWEST_FIRST: ListOrder<{ id: string; updated_at?: string | null }> =
  {
    column: "updated_at",
    ascending: false,
    compare: (a, b) => {
      const ta = a.updated_at ?? "";
      const tb = b.updated_at ?? "";
      return ta === tb ? 0 : ta < tb ? 1 : -1;
    },
  };
