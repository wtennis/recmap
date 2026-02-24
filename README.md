# RecMap

All Seattle community center programming on one map. Fitness, sports, aquatics, arts, dance, martial arts, and more.

**Live:** [wtennis.github.io/recmap/seattle/](https://wtennis.github.io/recmap/seattle/)

## Features

- **Map view** — Leaflet map with markers for 28 centers (23 with programming data, 5 coming soon)
- **Schedule view** — Day-of-week tabs with sorted event cards
- **Filters** — Multi-select dropdowns for centers and categories, applied to both views
- **Calendar export** — Download a filtered `.ics` file or subscribe to all events via URL
- 186 events across 9 categories: Aquatics, Arts & Crafts, Dance, Education, Fitness, Martial Arts, Music & Theater, Social & Games, Sports / Open Gym

## Quick Start

```bash
# Fetch center locations from ArcGIS
node scripts/fetch-centers.js

# Build runtime data + calendar files
node scripts/build-data.js

# Serve locally
cd seattle && npx serve .
```

## Data Pipeline

1. `scripts/fetch-centers.js` — Fetches 28 community center locations from Seattle's ArcGIS API
2. `seattle/data/curated/schedules.json` — Manually extracted programming from seasonal brochures
3. `scripts/build-data.js` — Merges centers + schedules into `seattle/data/recmap.json` and generates `.ics` calendar files in `seattle/cal/`

## Project Structure

```
recmap/
  index.html                        # Redirect to seattle/
  scripts/
    fetch-centers.js                # ArcGIS centers API
    build-data.js                   # Merge + classify + generate .ics
  seattle/
    index.html                      # Main app page
    css/style.css                   # Mobile-first styles (teal theme)
    js/app.js                       # Map, schedule, filters, calendar export
    cal/                            # Generated .ics subscription files
    data/
      recmap.json                   # Generated runtime data
      curated/schedules.json        # Source of truth (186 events)
      sources/centers.geojson       # Fetched center locations
```
