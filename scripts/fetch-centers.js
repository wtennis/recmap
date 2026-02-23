#!/usr/bin/env node

/**
 * fetch-centers.js
 *
 * Fetches community center locations from Seattle's ArcGIS API.
 * Saves raw GeoJSON to data/sources/centers.geojson.
 *
 * Usage: node scripts/fetch-centers.js
 * No dependencies beyond Node.js built-ins (uses native fetch).
 */

const fs = require('fs');
const path = require('path');

const CENTERS_URL =
  'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Community_Centers/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&outSR=4326';

const SOURCES_DIR = path.join(__dirname, '..', 'data', 'sources');

async function main() {
  console.log('RecMap: Fetching community centers from ArcGIS API\n');

  console.log('Fetching Community Centers...');
  const response = await fetch(CENTERS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch centers: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();

  const count = data.features ? data.features.length : 0;
  console.log(`  Got ${count} features`);

  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  const outPath = path.join(SOURCES_DIR, 'centers.geojson');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`  Saved to ${outPath}`);

  console.log(`\nDone! ${count} community centers fetched.`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
