// Build-time feature switches for work that's finished in code but not ready to
// be put in front of a paying firm. Flipping one of these to `true` is the only
// change needed to turn the feature on — no code is deleted, so nothing has to
// be rebuilt or merged back later.

/**
 * The Inventory area (physical stock with quantities, acquisition dates, net /
 * retail pricing, inventory + PO numbers).
 *
 * OFF: it's being pitched as a later addition, so the live site must not offer
 * it. This hides every way in — the Inventory nav tab, the Home tile, and "Add
 * to inventory" in the Database — which leaves the view unreachable. The data
 * layer (`src/data/inventory.ts`), the `inventory_items` table and any rows
 * already saved in it are untouched and will be waiting when it's switched on.
 *
 * Typed as `boolean` rather than the literal `false` on purpose: it keeps
 * TypeScript from narrowing the guarded branches away as dead code, so the
 * feature keeps type-checking while it's off.
 */
export const INVENTORY_ENABLED: boolean = true;
