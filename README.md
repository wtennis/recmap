# RecMap

All Seattle community center programming on one map. Fitness, sports, aquatics, arts, dance, martial arts, and more.

## Quick Start

```bash
# Fetch center locations from ArcGIS
node scripts/fetch-centers.js

# Build the runtime data file
node scripts/build-data.js

# Serve locally
npx serve .
```

## Data Pipeline

1. `scripts/fetch-centers.js` — Fetches 28 community center locations from Seattle's ArcGIS API
2. `data/curated/schedules.json` — Manually extracted programming from seasonal brochures
3. `scripts/build-data.js` — Merges centers + schedules into `data/recmap.json`

## Project Structure

```
recmap/
  index.html              # Single-page app
  css/style.css           # Mobile-first styles (green/teal theme)
  js/app.js               # Leaflet map + popups
  scripts/fetch-centers.js
  scripts/build-data.js
  data/
    sources/centers.geojson
    curated/schedules.json
    recmap.json            # Generated runtime data
```
