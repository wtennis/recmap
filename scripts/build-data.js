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
// Calendar (.ics) generation — build-time subscription presets
// ---------------------------------------------------------------------------

const CAL_DIR = path.join(__dirname, '..', 'seattle', 'cal');
const DAYS_LIST = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RRULE_DAYS = { Sunday: 'SU', Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR', Saturday: 'SA' };

function expandDaysBuild(dayStr) {
  if (!dayStr) return [];
  if (dayStr.includes('-')) {
    const parts = dayStr.split('-').map(s => s.trim());
    if (parts.length === 2) {
      const start = resolveDayBuild(parts[0]);
      const end = resolveDayBuild(parts[1]);
      if (start && end) {
        const si = DAYS_LIST.indexOf(start);
        const ei = DAYS_LIST.indexOf(end);
        if (si >= 0 && ei >= 0) {
          const result = [];
          for (let i = si; i !== (ei + 1) % 7; i = (i + 1) % 7) {
            result.push(DAYS_LIST[i]);
          }
          result.push(DAYS_LIST[ei]);
          return result;
        }
      }
    }
  }
  if (dayStr.includes('/')) {
    return dayStr.split('/').map(resolveDayBuild).filter(Boolean);
  }
  const d = resolveDayBuild(dayStr);
  return d ? [d] : [];
}

function resolveDayBuild(str) {
  const map = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
    thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
  };
  return map[str.trim().toLowerCase()] || null;
}

function flattenAllEvents(locations) {
  const flat = [];
  for (const loc of locations) {
    for (const evt of (loc.events || [])) {
      for (const session of (evt.sessions || [])) {
        const days = expandDaysBuild(session.day);
        for (const day of days) {
          flat.push({
            center: loc.name,
            address: loc.address,
            program: evt.program,
            category: evt.category,
            ages: evt.ages,
            cost: evt.cost,
            day,
            time: session.time,
            date_range: evt.date_range,
            code: evt.code,
          });
        }
      }
    }
  }
  return flat;
}

function isFreeEventBuild(cost) {
  return !cost || cost === 'FREE' || cost === '$0' || cost === 0;
}

function slugifyCategory(cat) {
  return cat.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function parseDateRangeBuild(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const year = 2026;
  return {
    start: new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10)),
    end: new Date(year, parseInt(m[3], 10) - 1, parseInt(m[4], 10)),
  };
}

function parseTimeRangeBuild(str) {
  if (!str) return null;
  const s = str.toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?-(\d{1,2})(?::(\d{2}))?(am|pm|noon)?$/);
  if (!m) {
    if (s.startsWith('noon')) {
      const m2 = s.match(/^noon-(\d{1,2})(?::(\d{2}))?(pm)?$/);
      if (m2) {
        let endH = parseInt(m2[1], 10);
        const endM = m2[2] ? parseInt(m2[2], 10) : 0;
        if (m2[3] === 'pm' && endH < 12) endH += 12;
        return { startH: 12, startM: 0, endH, endM };
      }
    }
    return null;
  }
  let startH = parseInt(m[1], 10);
  const startM = m[2] ? parseInt(m[2], 10) : 0;
  let startAP = m[3];
  let endH = parseInt(m[4], 10);
  const endM = m[5] ? parseInt(m[5], 10) : 0;
  let endAP = m[6];

  if (endAP === 'noon') { endH = 12; endAP = null; }

  // Infer AM/PM: if only end has it, infer start from end
  if (!startAP && endAP) {
    if (endAP === 'pm') {
      startAP = (startH >= 7 && startH <= 11) ? 'am' : 'pm';
    } else {
      startAP = 'am';
    }
  }
  if (startAP === 'pm' && startH < 12) startH += 12;
  if (startAP === 'am' && startH === 12) startH = 0;
  if (endAP === 'pm' && endH < 12) endH += 12;
  if (endAP === 'am' && endH === 12) endH = 0;

  // If no AP at all, guess
  if (!startAP && !endAP) {
    if (startH < 7) startH += 12;
    if (endH < 7) endH += 12;
    if (endH <= startH) endH += 12;
  }

  return { startH, startM, endH, endM };
}

function firstOccurrenceBuild(rangeStart, dayName) {
  const targetDow = DAYS_LIST.indexOf(dayName);
  if (targetDow < 0) return rangeStart;
  const d = new Date(rangeStart);
  const diff = (targetDow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function fmtDT(d, h, m) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
}

function fmtDate(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function icsEscapeBuild(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildICS(events, calName) {
  let cal = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RecMap//Seattle Community Centers//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscapeBuild(calName)}`,
    'X-WR-TIMEZONE:America/Los_Angeles',
  ];

  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;

  let n = 0;
  for (const evt of events) {
    const dateRange = parseDateRangeBuild(evt.date_range);
    const timeRange = parseTimeRangeBuild(evt.time);
    if (!dateRange || !timeRange) continue;

    const firstDay = firstOccurrenceBuild(dateRange.start, evt.day);
    if (firstDay > dateRange.end) continue;

    n++;
    const uid = `${evt.code || 'evt'}-${evt.day.toLowerCase().slice(0, 3)}-${n}@recmap`;
    const rruleDay = RRULE_DAYS[evt.day];
    const untilDate = fmtDate(dateRange.end);
    const costLabel = isFreeEventBuild(evt.cost) ? 'Free' : evt.cost;
    const desc = [evt.ages ? `Ages: ${evt.ages}` : '', `Cost: ${costLabel}`, evt.center].filter(Boolean).join('\\n');

    cal.push('BEGIN:VEVENT');
    cal.push(`UID:${uid}`);
    cal.push(`DTSTAMP:${stamp}`);
    cal.push(`DTSTART;TZID=America/Los_Angeles:${fmtDT(firstDay, timeRange.startH, timeRange.startM)}`);
    cal.push(`DTEND;TZID=America/Los_Angeles:${fmtDT(firstDay, timeRange.endH, timeRange.endM)}`);
    cal.push(`RRULE:FREQ=WEEKLY;BYDAY=${rruleDay};UNTIL=${untilDate}T235959Z`);
    cal.push(`SUMMARY:${icsEscapeBuild(evt.program)}`);
    cal.push(`LOCATION:${icsEscapeBuild(evt.center + ', ' + evt.address + ', Seattle, WA')}`);
    cal.push(`DESCRIPTION:${desc}`);
    cal.push(`CATEGORIES:${icsEscapeBuild(evt.category)}`);
    cal.push('END:VEVENT');
  }

  cal.push('END:VCALENDAR');
  return { ics: cal.join('\r\n') + '\r\n', count: n };
}

function generateCalendarFiles(locations, categories) {
  if (!fs.existsSync(CAL_DIR)) {
    fs.mkdirSync(CAL_DIR, { recursive: true });
  }

  const allEvents = flattenAllEvents(locations);
  console.log(`\n  Calendar: ${allEvents.length} day-session events flattened`);

  const presets = [
    { slug: 'all', label: 'RecMap — All Events', filter: () => true },
    { slug: 'free', label: 'RecMap — Free Events', filter: (e) => isFreeEventBuild(e.cost) },
  ];
  for (const cat of categories) {
    presets.push({
      slug: slugifyCategory(cat),
      label: `RecMap — ${cat}`,
      filter: (e) => e.category === cat,
    });
  }

  for (const preset of presets) {
    const filtered = allEvents.filter(preset.filter);
    const { ics, count } = buildICS(filtered, preset.label);
    const outPath = path.join(CAL_DIR, `${preset.slug}.ics`);
    fs.writeFileSync(outPath, ics);
    console.log(`  ${preset.slug}.ics — ${count} events`);
  }
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

  generateCalendarFiles(locations, categories);
}

main();
