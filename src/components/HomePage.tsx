interface Props {
  firmName: string;
  /** Project count — always loaded with the workspace. */
  projectCount: number;
  /** Database size, or null if the database hasn't been loaded yet. */
  databaseCount: number | null;
  /** Inventory size, or null if the inventory hasn't been loaded yet. */
  inventoryCount: number | null;
  onOpenClients: () => void;
  onOpenDatabase: () => void;
  onOpenInventory: () => void;
}

/**
 * The landing page after sign-in: one large tile per area of the app. Counts
 * are shown only when the data is already in memory — the home page never
 * triggers a fetch of its own.
 */
export default function HomePage({
  firmName,
  projectCount,
  databaseCount,
  inventoryCount,
  onOpenClients,
  onOpenDatabase,
  onOpenInventory,
}: Props) {
  return (
    <section className="home">
      <div className="home-welcome">
        <h1>Welcome, {firmName}</h1>
        <p className="muted">Choose where you'd like to work.</p>
      </div>
      <div className="home-tiles">
        <button className="home-tile" onClick={onOpenClients}>
          <span className="home-tile-kicker">Projects</span>
          <span className="home-tile-title">Clients</span>
          <span className="home-tile-desc">
            Build and present tear sheets for each client project.
          </span>
          <span className="home-tile-foot">
            <span className="home-tile-count">
              {projectCount} project{projectCount === 1 ? "" : "s"}
            </span>
            <span className="home-tile-go">Open →</span>
          </span>
        </button>
        <button className="home-tile" onClick={onOpenDatabase}>
          <span className="home-tile-kicker">Catalog</span>
          <span className="home-tile-title">Database</span>
          <span className="home-tile-desc">
            Your master collection of pieces, reusable across any client.
          </span>
          <span className="home-tile-foot">
            <span className="home-tile-count">
              {databaseCount !== null &&
                `${databaseCount} piece${databaseCount === 1 ? "" : "s"}`}
            </span>
            <span className="home-tile-go">Open →</span>
          </span>
        </button>
        <button className="home-tile" onClick={onOpenInventory}>
          <span className="home-tile-kicker">Stock</span>
          <span className="home-tile-title">Inventory</span>
          <span className="home-tile-desc">
            What you have on hand right now, with quantities.
          </span>
          <span className="home-tile-foot">
            <span className="home-tile-count">
              {inventoryCount !== null &&
                `${inventoryCount} item${inventoryCount === 1 ? "" : "s"}`}
            </span>
            <span className="home-tile-go">Open →</span>
          </span>
        </button>
      </div>
    </section>
  );
}
