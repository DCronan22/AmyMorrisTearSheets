# Amy Morris Tear Sheets

A web app to itemize and present interior design **tear sheets** for Amy Morris
Interiors. Build a project from manual entry or a spreadsheet, then deliver it
three ways from one source of truth:

- 🖼️ **Web gallery** — a browsable, filterable grid of specified items
- 🎞️ **Slideshow** — full-screen present mode, one item per slide
- 🧾 **Printable PDF** — print-optimized layout; use the browser's *Save as PDF*
  for clean, client-ready tear sheets grouped by room

It runs entirely in the browser — no server or database. Data auto-saves to the
browser, and projects can be exported/imported as a backup file.

## Using it

| Action | How |
| --- | --- |
| **Import a spreadsheet** | *Import* → drop an `.xlsx`/`.csv`. Columns (Item, Vendor, Category, Room, SKU, Price, Qty, Dimensions, Material, Color, Lead Time, Notes, Image URL, Product URL) are matched automatically. A blank template is available in the import dialog. |
| **Add / edit items** | *Add item*, or click *Edit* on any card. Images can be a URL or uploaded from disk. |
| **Present** | *Present* (or click any card image) for full-screen mode. Navigate with ← → arrow keys; *Esc* to exit. |
| **Print / PDF** | *Print / PDF* → in the print dialog choose *Save as PDF*. |
| **Filter** | Search box plus Room and Category filters. |
| **Projects** | Manage multiple client projects from the project dropdown. |
| **Backup** | *⋯* menu → export a `.json` backup, restore it, or export items back to `.xlsx`. |

## Develop

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # type-check + production build to dist/
npm run preview  # preview the production build
```

**Stack:** Vite + React + TypeScript, [SheetJS](https://sheetjs.com) for
spreadsheet import/export. No backend.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with the
GitHub Pages base path and publishes `dist/` to Pages. Enable it once under
**Settings → Pages → Build and deployment → Source: GitHub Actions**. The site
then serves at `https://<user>.github.io/AmyMorrisTearSheets/`.
