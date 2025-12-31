# Coverage Viewer

A beautiful Vue 3 + Vite dashboard for visualizing test coverage data.

## Quick Start

```bash
cd coverage-viewer
pnpm install
pnpm dev
```

The app will open at `http://localhost:3000`

## Usage

1. Run your tests with coverage:
   ```bash
   npm test -- --coverage
   ```

2. Open the coverage viewer:
   ```bash
   cd coverage-viewer
   pnpm dev
   ```

3. Click "Upload Coverage JSON" and select either:
   - `coverage/coverage-summary.json` (overall + per-file summary)
   - `coverage/coverage-final.json` (detailed per-file data)

## Features

- 📊 Overall coverage percentage with color-coded progress bar
- 📈 Distribution histogram showing coverage buckets (0-9%, 10-19%, etc.)
- 📁 File-by-file coverage list with search and sorting
- 🎨 Beautiful, modern UI with gradient backgrounds
- 🔍 Search and filter files
- 📱 Responsive design

## Supported Formats

- Istanbul `coverage-summary.json`
- Istanbul `coverage-final.json`
- Other Istanbul-compatible formats
