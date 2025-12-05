# Results Viewer

View and analyze scored token results from the unified calls scoring system.

## CLI Viewer

Display results in a formatted table:

```bash
# View latest results (top 50)
npm run view:results

# View top 100 results
npm run view:results --limit=100

# Filter by minimum score
npm run view:results --min-score=70

# Filter by minimum return
npm run view:results --min-return=50

# Filter by chain
npm run view:results --chain=solana

# Filter by caller
npm run view:results --caller=brook

# Combine filters
npm run view:results --min-score=80 --min-return=100 --chain=solana

# Export filtered results
npm run view:results --min-score=70 --export
```

## HTML Viewer

Generate an interactive HTML viewer:

```bash
# Generate HTML viewer from latest results
npm run view:results:html

# Generate from specific file
npm run view:results:html path/to/results.json

# Specify output path
npm run view:results:html -- --output=./my-viewer.html
```

The HTML viewer includes:
- Interactive filtering and search
- Sortable columns
- Color-coded scores and returns
- Statistics dashboard
- Responsive design

## Cache Management

API responses are automatically cached to save credits:
- Cache location: `data/cache/api-responses/`
- Cache TTL: 7 days
- Cached responses are reused automatically

Check cache stats:
```bash
node -e "const {getCacheStats} = require('./scripts/analysis/cache-manager.ts'); console.log(getCacheStats())"
```
