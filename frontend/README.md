# Cortex website

React site explaining cortex and visualizing bootstrap evaluation metrics.
Built with Vite, React 19, TypeScript, Tailwind CSS, shadcn-style Radix
components and Recharts. Deployed to GitHub Pages automatically on every push
to `main` (see `.github/workflows/pages.yml`).

## Pages

- `#/` — what cortex is: value proposition, bootstrap pipeline, MCP tools,
  language coverage.
- `#/bootstrap` — aggregate bootstrap eval metrics across all repos, with a
  cortex-version dropdown (results are published per version): chunk
  size distributions vs embedding models, graph relation breakdowns,
  chunk-connectivity scatter plots, per-language rollups, repo table.
- `#/bootstrap/v/<version>/repos/<key>` — per-repository detail: phase timings, chunk
  histograms, relations by type, degree distribution, most-connected chunks,
  embedding and workspace stats.

## Data

Metrics are static JSON files in `../site-data/bootstrap/`, produced by the
eval harness (`benchmark/bootstrapbench/`, see its README) and served via
Vite's `publicDir`. The site renders a friendly empty state when no eval has
been published yet.

## Development

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
```

`VITE_BASE_PATH` controls the deploy base path; the Pages workflow sets it to
`/<repo-name>/`. Routing is hash-based, so deep links work on GitHub Pages
without rewrite rules.
