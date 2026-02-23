#!/usr/bin/env node

/**
 * build-data.js
 *
 * Merges centers.geojson and curated schedules.json into a single
 * data/recmap.json for the frontend.
 *
 * Usage: node scripts/build-data.js
 */

const fs = require('fs');
const path = require('path');

const SOURCES_DIR = path.join(__dirname, '..', 'seattle', 'data', 'sources');
const CURATED_DIR = path.join(__dirname, '..', 'seattle', 'data', 'curated');
const OUT_PATH = path.join(__dirname, '..', 'seattle', 'data', 'recmap.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeCenterName(name) {
  return name
    .toLowerCase()
    .replace(/community center/gi, '')
    .replace(/c\.c\./gi, '')
    .replace(/\bpark\b/gi, '')
    .replace(/[\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findCenter(centerName, centerLookup) {
  const key = normalizeCenterName(centerName);
  if (centerLookup.has(key)) return centerLookup.get(key);

  for (const [locKey, loc] of centerLookup.entries()) {
    if (locKey.includes(key) || key.includes(locKey)) {
      return loc;
    }
  }

  const keyWords = key.split(' ').filter((w) => w.length > 2);
  for (const [locKey, loc] of centerLookup.entries()) {
    const locWords = locKey.split(' ').filter((w) => w.length > 2);
    const overlap = keyWords.filter((w) => locWords.includes(w));
    if (overlap.length >= 1 && overlap.length >= Math.min(keyWords.length, locWords.length) * 0.5) {
      return loc;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Category classification — validates/infers category from activity/program
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS = {
  'Sports / Open Gym': ['basketball', 'volleyball', 'pickleball', 'badminton', 'tennis', 'soccer', 'baseball', 'softball', 'football', 'hockey', 'rugby', 'lacrosse', 'cricket', 'open gym', 'free play', 'drop-in gym'],
  'Fitness': ['yoga', 'pilates', 'zumba', 'tai chi', 'cardio', 'strength', 'hiit', 'aerobics', 'stretch', 'conditioning', 'fitness', 'boot camp', 'crossfit'],
  'Aquatics': ['swim', 'pool', 'lap swim', 'open swim', 'water aerobic', 'aqua', 'diving'],
  'Dance': ['ballet', 'hip hop', 'swing', 'ballroom', 'line danc', 'salsa', 'tango', 'jazz dance', 'tap dance', 'modern dance', 'dance'],
  'Arts & Crafts': ['pottery', 'painting', 'drawing', 'woodworking', 'ceramics', 'sculpture', 'knitting', 'sewing', 'crafts', 'watercolor', 'acrylic'],
  'Martial Arts': ['karate', 'judo', 'kung fu', 'taekwondo', 'aikido', 'kendo', 'martial art', 'self defense', 'wing chun'],
  'Music & Theater': ['guitar', 'piano', 'drum', 'violin', 'ukulele', 'music', 'drama', 'theater', 'theatre', 'choir', 'singing', 'band'],
  'Education': ['computer', 'language', 'stem', 'spanish', 'french', 'chinese', 'esl', 'literacy', 'math', 'science', 'coding', 'programming'],
  'Social & Games': ['game night', 'bingo', 'mahjong', 'chess', 'bridge', 'social', 'trivia', 'board game'],
};

function classifyCategory(activity, program) {
  const search = `${activity || ''} ${program || ''}`.toLowerCase();
  // Check Aquatics first — "water aerobics" should be Aquatics, not Fitness
  const priorityOrder = ['Aquatics', 'Martial Arts'];
  for (const cat of priorityOrder) {
    for (const kw of CATEGORY_KEYWORDS[cat]) {
      if (search.includes(kw)) return cat;
    }
  }
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (priorityOrder.includes(category)) continue;
    for (const kw of keywords) {
      if (search.includes(kw)) return category;
    }
  }
  return 'Other';
}

// ---------------------------------------------------------------------------
// Load source files
// ---------------------------------------------------------------------------

function loadJSON(filepath) {
  const raw = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Process centers
// ---------------------------------------------------------------------------

function processCenters(geojson) {
  return geojson.features.map((f) => {
    const p = f.properties;
    const coords = f.geometry.coordinates;

    const hours = {};
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const day of days) {
      const dayKey = `DAY_${day.toUpperCase()}`;
      const hoursKey = `HOURS_${day.toUpperCase()}`;
      if (p[dayKey] === 'Yes' && p[hoursKey]) {
        hours[day] = p[hoursKey];
      } else if (p[dayKey] === 'No') {
        hours[day] = 'closed';
      }
    }

    let phone = p.PHONE || '';
    if (phone && !phone.startsWith('206')) {
      phone = '206-' + phone;
    }

    return {
      id: `center-${slugify(p.NAME || '')}`,
      type: 'community_center',
      name: p.NAME || 'Unknown Center',
      address: p.ADDRESS || '',
      lat: coords[1],
      lng: coords[0],
      phone,
      center_hours: Object.keys(hours).length > 0 ? hours : null,
      website: p.WEBSITE_LINK || null,
      events: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Match schedules to locations
// ---------------------------------------------------------------------------

function matchSchedules(locations, schedules) {
  const centerLookup = new Map();
  for (const loc of locations) {
    const key = normalizeCenterName(loc.name);
    centerLookup.set(key, loc);
  }

  let matched = 0;
  let unmatched = 0;
  const unmatchedNames = new Set();
  let categoryMismatches = 0;

  for (const evt of schedules.events) {
    const centerName = evt.center || '';

    // Validate/correct category
    const inferredCategory = classifyCategory(evt.activity, evt.program);
    if (evt.category && evt.category !== inferredCategory && inferredCategory !== 'Other') {
      console.log(`  Category mismatch: "${evt.program}" — curated: "${evt.category}", inferred: "${inferredCategory}"`);
      categoryMismatches++;
    }

    const location = findCenter(centerName, centerLookup);
    if (location) {
      location.events.push({
        season: evt.season,
        program: evt.program,
        type: evt.type,
        category: evt.category || inferredCategory,
        activity: evt.activity || null,
        ages: evt.ages,
        code: evt.code,
        date_range: evt.date_range,
        cost: evt.cost,
        sessions: evt.sessions,
        notes: evt.notes || null,
        registration_required: evt.registration_required || false,
      });
      matched++;
    } else {
      unmatched++;
      unmatchedNames.add(centerName);
    }
  }

  console.log(`  Schedule matching: ${matched} matched, ${unmatched} unmatched`);
  if (categoryMismatches > 0) {
    console.log(`  Category mismatches: ${categoryMismatches}`);
  }
  if (unmatchedNames.size > 0) {
    console.log('  Unmatched centers from schedules:');
    for (const name of unmatchedNames) {
      console.log(`    - "${name}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Compute unique categories and activities across all events
// ---------------------------------------------------------------------------

function computeTaxonomy(locations) {
  const categories = new Set();
  const activities = new Set();

  for (const loc of locations) {
    for (const evt of loc.events) {
      if (evt.category) categories.add(evt.category);
      if (evt.activity) activities.add(evt.activity);
    }
  }

  return {
    categories: [...categories].sort(),
    activities: [...activities].sort(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('RecMap: Building merged data file\n');

  const centersPath = path.join(SOURCES_DIR, 'centers.geojson');
  const schedulesPath = path.join(CURATED_DIR, 'schedules.json');

  if (!fs.existsSync(centersPath)) {
    console.error('Error: Source data not found. Run `node scripts/fetch-centers.js` first.');
    process.exit(1);
  }

  const centersGeo = loadJSON(centersPath);
  const schedules = fs.existsSync(schedulesPath)
    ? loadJSON(schedulesPath)
    : { seasons: [], events: [] };

  console.log(`  Centers: ${centersGeo.features.length} features`);
  console.log(`  Schedule events: ${schedules.events.length}\n`);

  const locations = processCenters(centersGeo);

  matchSchedules(locations, schedules);

  const withEvents = locations.filter((l) => l.events.length > 0).length;
  console.log(`  Locations with scheduled events: ${withEvents}`);

  const { categories, activities } = computeTaxonomy(locations);
  console.log(`  Categories: ${categories.length} (${categories.join(', ')})`);
  console.log(`  Activities: ${activities.length}`);

  const output = {
    generated_at: new Date().toISOString(),
    seasons: schedules.seasons || [],
    categories,
    activities,
    locations,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${locations.length} locations to ${OUT_PATH}`);
}

main();
