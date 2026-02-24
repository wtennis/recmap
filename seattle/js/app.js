/**
 * RecMap - Main Application
 *
 * Vanilla JS. No framework. Loads data/recmap.json and renders
 * community center markers on a Leaflet map with programming popups.
 * Supports filter bar (centers + categories) and schedule view.
 */

(function () {
  'use strict';

  // ---- Config ----
  const SEATTLE_CENTER = [47.6062, -122.3321];
  const DEFAULT_ZOOM = 12;
  const DATA_URL = 'data/recmap.json';

  const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const DAY_ABBR = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

  // ---- State ----
  let allLocations = [];
  let markersLayer = L.featureGroup();

  const filters = {
    centers: new Set(),     // contains checked items; populated on data load
    categories: new Set(),  // contains checked items; populated on data load
  };
  let activeTab = 'map';    // 'map' or 'schedule'
  let activeDay = 'Monday';
  let filterBarOpen = false;

  // ---- DOM refs ----
  const $filterToggle = document.getElementById('filter-toggle');
  const $filterBar = document.getElementById('filter-bar');
  const $tabMap = document.getElementById('tab-map');
  const $tabSchedule = document.getElementById('tab-schedule');
  const $schedulePanel = document.getElementById('schedule-panel');
  const $mapDiv = document.getElementById('map');
  const $dayTabs = document.getElementById('day-tabs');
  const $scheduleList = document.getElementById('schedule-list');
  const $legend = null; // created dynamically

  // ---- Map Setup ----
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
  }).setView(SEATTLE_CENTER, DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  if (window.innerWidth < 768) {
    map.zoomControl.setPosition('bottomright');
  }

  // ---- Marker Styles ----

  function activeMarker(latlng) {
    return L.circleMarker(latlng, {
      radius: 8, fillColor: '#0d9488', color: '#0f766e',
      weight: 1.5, opacity: 1, fillOpacity: 0.85,
    });
  }

  function pendingMarker(latlng) {
    return L.circleMarker(latlng, {
      radius: 7, fillColor: '#94a3b8', color: '#64748b',
      weight: 1.5, opacity: 1, fillOpacity: 0.6,
    });
  }

  // ---- Helpers ----

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function formatCost(cost) {
    if (!cost || cost === 'FREE' || cost === '$0' || cost === 0) return 'Free';
    return String(cost);
  }

  function isFreeEvent(cost) {
    return !cost || cost === 'FREE' || cost === '$0' || cost === 0;
  }

  // ---- Day Expansion ----

  const DAY_MAP = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
    thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
  };

  function resolveDay(str) {
    return DAY_MAP[str.trim().toLowerCase()] || null;
  }

  function expandDays(dayStr) {
    if (!dayStr) return [];
    // Handle range: "Mon-Fri"
    if (dayStr.includes('-')) {
      const parts = dayStr.split('-').map(s => s.trim());
      if (parts.length === 2) {
        const start = resolveDay(parts[0]);
        const end = resolveDay(parts[1]);
        if (start && end) {
          const si = DAY_ORDER.indexOf(start);
          const ei = DAY_ORDER.indexOf(end);
          if (si >= 0 && ei >= 0 && ei >= si) {
            return DAY_ORDER.slice(si, ei + 1);
          }
        }
      }
    }
    // Handle slash-separated: "Mon/Wed/Fri"
    if (dayStr.includes('/')) {
      return dayStr.split('/').map(resolveDay).filter(Boolean);
    }
    // Single day
    const d = resolveDay(dayStr);
    return d ? [d] : [];
  }

  // ---- Filter Logic ----

  function locationPassesFilter(loc) {
    const events = loc.events || [];
    if (events.length === 0) return true; // always show "coming soon" on map

    // Center filter
    if (!filters.centers.has(loc.name)) return false;

    // Category filter — location passes if ANY of its events match
    const hasMatch = events.some(e => filters.categories.has(e.category));
    if (!hasMatch) return false;

    return true;
  }

  function eventPassesCategoryFilter(evt) {
    return filters.categories.has(evt.category);
  }

  // ---- Popup Content ----

  function buildPopupHTML(location) {
    let html = `
      <div class="popup-header">
        <h3>${esc(location.name)}</h3>
        <div class="address">${esc(location.address)}</div>
        ${location.phone ? `<div class="phone">${esc(location.phone)}</div>` : ''}
      </div>`;

    const events = (location.events || []).filter(eventPassesCategoryFilter);

    if (events.length === 0 && (!location.events || location.events.length === 0)) {
      html += `<div class="popup-coming-soon">Programming data coming soon</div>`;
    } else if (events.length === 0) {
      html += `<div class="popup-coming-soon">No events match current filters</div>`;
    } else {
      const byCategory = {};
      for (const evt of events) {
        const cat = evt.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(evt);
      }

      const sortedCats = Object.keys(byCategory).sort();

      for (const cat of sortedCats) {
        html += `<div class="popup-category"><h4>${esc(cat)}</h4>`;
        for (const evt of byCategory[cat]) {
          const costLabel = formatCost(evt.cost);
          const costClass = isFreeEvent(evt.cost) ? 'free' : 'paid';

          html += `<div class="popup-event">`;
          html += `<div class="event-name">${esc(evt.program)}</div>`;
          if (evt.ages) html += `<div class="event-detail">Ages: ${esc(evt.ages)}</div>`;
          if (evt.sessions && evt.sessions.length > 0) {
            for (const s of evt.sessions) {
              html += `<div class="event-detail">${esc(s.day)}: ${esc(s.time)}</div>`;
            }
          }
          if (evt.date_range) html += `<div class="event-detail">Dates: ${esc(evt.date_range)}</div>`;

          html += `<div class="event-tags">`;
          html += `<span class="event-tag ${costClass}">${esc(costLabel)}</span>`;
          if (evt.registration_required) {
            html += `<span class="event-tag reg">Registration</span>`;
          }
          html += `</div>`;

          if (evt.notes) html += `<div class="event-detail" style="font-style:italic; margin-top:4px;">${esc(evt.notes)}</div>`;
          html += `</div>`;
        }
        html += `</div>`;
      }
    }

    const addr = encodeURIComponent(location.address + ', Seattle, WA');
    html += `<a class="popup-directions" href="https://www.google.com/maps/dir/?api=1&destination=${addr}" target="_blank" rel="noopener">Get Directions</a>`;
    return html;
  }

  // ---- Render Markers ----

  function renderMarkers() {
    markersLayer.clearLayers();
    for (const loc of allLocations) {
      const hasEvents = loc.events && loc.events.length > 0;

      // Skip centers that don't pass filter (but always show "coming soon")
      if (!locationPassesFilter(loc)) continue;

      const latlng = [loc.lat, loc.lng];
      const marker = hasEvents ? activeMarker(latlng) : pendingMarker(latlng);
      marker.bindPopup(buildPopupHTML(loc), {
        maxWidth: 340, maxHeight: 450, autoPanPadding: [20, 60],
      });
      marker.addTo(markersLayer);
    }
  }

  // ---- Legend ----

  let legendEl = null;

  function addLegend() {
    legendEl = document.createElement('div');
    legendEl.id = 'legend';
    legendEl.innerHTML = `
      <div class="legend-item"><span class="legend-dot teal"></span> Has Programming</div>
      <div class="legend-item"><span class="legend-dot gray"></span> Coming Soon</div>
    `;
    document.body.appendChild(legendEl);
  }

  function showLegend(show) {
    if (legendEl) legendEl.style.display = show ? '' : 'none';
  }

  // ---- Filter Bar Toggle ----

  function toggleFilterBar() {
    filterBarOpen = !filterBarOpen;
    $filterBar.classList.toggle('hidden', !filterBarOpen);
    $filterToggle.classList.toggle('active', filterBarOpen);
    document.body.classList.toggle('filter-open', filterBarOpen);

    // Close any open dropdown panels
    if (!filterBarOpen) {
      document.querySelectorAll('.dropdown-panel').forEach(p => p.classList.add('hidden'));
    }

    map.invalidateSize();
  }

  $filterToggle.addEventListener('click', toggleFilterBar);

  // ---- Dropdown Component ----

  function populateDropdown(containerId, items, filterSet) {
    const optionsEl = document.getElementById(containerId + '-options');
    const dropdown = document.getElementById(containerId);
    const toggleBtn = dropdown.querySelector('.dropdown-toggle');
    const panel = dropdown.querySelector('.dropdown-panel');
    const countEl = toggleBtn.querySelector('.dd-count');
    const selectAllBtn = dropdown.querySelector('.dd-select-all');
    const clearBtn = dropdown.querySelector('.dd-clear');

    // Initialize: all items selected
    for (const item of items) filterSet.add(item);

    optionsEl.innerHTML = '';
    for (const item of items) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = item;
      cb.checked = true;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(item));
      optionsEl.appendChild(label);

      cb.addEventListener('change', function () {
        if (this.checked) {
          filterSet.add(item);
        } else {
          filterSet.delete(item);
        }
        updateCount();
        applyFilters();
      });
    }

    function updateCount() {
      if (filterSet.size === items.length) {
        countEl.textContent = 'All';
      } else {
        countEl.textContent = filterSet.size + ' selected';
      }
    }

    // Toggle panel
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      // Close other dropdowns
      document.querySelectorAll('.dropdown-panel').forEach(p => {
        if (p !== panel) p.classList.add('hidden');
      });
      panel.classList.toggle('hidden');
    });

    // Select All
    selectAllBtn.addEventListener('click', function () {
      for (const item of items) filterSet.add(item);
      optionsEl.querySelectorAll('input').forEach(c => { c.checked = true; });
      updateCount();
      applyFilters();
    });

    // Clear
    clearBtn.addEventListener('click', function () {
      filterSet.clear();
      optionsEl.querySelectorAll('input').forEach(c => { c.checked = false; });
      updateCount();
      applyFilters();
    });

    updateCount();
  }

  // Close dropdowns on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-panel').forEach(p => p.classList.add('hidden'));
    }
  });

  // ---- Apply Filters ----

  function applyFilters() {
    if (activeTab === 'map') {
      renderMarkers();
    } else {
      renderSchedule();
    }
  }

  // ---- Tab Switching ----

  function switchTab(tab) {
    activeTab = tab;
    $tabMap.classList.toggle('active', tab === 'map');
    $tabSchedule.classList.toggle('active', tab === 'schedule');

    if (tab === 'map') {
      $mapDiv.classList.remove('hidden');
      $schedulePanel.classList.add('hidden');
      showLegend(true);
      map.invalidateSize();
      renderMarkers();
    } else {
      $mapDiv.classList.add('hidden');
      $schedulePanel.classList.remove('hidden');
      showLegend(false);
      renderSchedule();
    }
  }

  $tabMap.addEventListener('click', function () { switchTab('map'); });
  $tabSchedule.addEventListener('click', function () { switchTab('schedule'); });

  // ---- Schedule View ----

  function parseTime(timeStr) {
    // Parse "9:00am", "12:30pm", "Noon", "6-8pm" — extract first time
    if (!timeStr) return 9999;
    const s = timeStr.toLowerCase().trim();
    // Handle "noon"
    if (s.startsWith('noon')) return 720;
    // Extract first time token: "9:00am" or "9am" or "12:30-2pm"
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!m) return 9999;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ampm = m[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    // If no am/pm, try to infer from context (assume times < 7 are pm)
    if (!ampm && h < 7) h += 12;
    return h * 60 + min;
  }

  // ---- Calendar Export Helpers ----

  const DAYS_SUNDAY_FIRST = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const RRULE_DAYS = { Sunday: 'SU', Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR', Saturday: 'SA' };

  function parseDateRange(str) {
    if (!str) return null;
    const m = str.match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    const year = 2026;
    return {
      start: new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10)),
      end: new Date(year, parseInt(m[3], 10) - 1, parseInt(m[4], 10)),
    };
  }

  function parseTimeRange(str) {
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

    if (!startAP && !endAP) {
      if (startH < 7) startH += 12;
      if (endH < 7) endH += 12;
      if (endH <= startH) endH += 12;
    }

    return { startH, startM, endH, endM };
  }

  function firstOccurrence(rangeStart, dayName) {
    const targetDow = DAYS_SUNDAY_FIRST.indexOf(dayName);
    if (targetDow < 0) return rangeStart;
    const d = new Date(rangeStart);
    const diff = (targetDow - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function formatICSDateTime(d, h, m) {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
  }

  function formatICSDate(d) {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  function icsEscape(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function getFilteredEvents() {
    const results = [];
    for (const loc of allLocations) {
      const events = loc.events || [];
      if (events.length === 0) continue;
      if (!filters.centers.has(loc.name)) continue;

      for (const evt of events) {
        if (!eventPassesCategoryFilter(evt)) continue;

        for (const session of (evt.sessions || [])) {
          const days = expandDays(session.day);
          for (const day of days) {
            results.push({
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
    return results;
  }

  function generateICS(events) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RecMap//Seattle Community Centers//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:RecMap — Filtered Events',
      'X-WR-TIMEZONE:America/Los_Angeles',
    ];

    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;

    let n = 0;
    for (const evt of events) {
      const dateRange = parseDateRange(evt.date_range);
      const timeRange = parseTimeRange(evt.time);
      if (!dateRange || !timeRange) continue;

      const firstDay = firstOccurrence(dateRange.start, evt.day);
      if (firstDay > dateRange.end) continue;

      n++;
      const uid = `${evt.code || 'evt'}-${evt.day.toLowerCase().slice(0, 3)}-${n}@recmap`;
      const rruleDay = RRULE_DAYS[evt.day];
      const untilDate = formatICSDate(dateRange.end);
      const costLabel = isFreeEvent(evt.cost) ? 'Free' : evt.cost;
      const desc = [evt.ages ? `Ages: ${evt.ages}` : '', `Cost: ${costLabel}`, evt.center].filter(Boolean).join('\\n');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;TZID=America/Los_Angeles:${formatICSDateTime(firstDay, timeRange.startH, timeRange.startM)}`);
      lines.push(`DTEND;TZID=America/Los_Angeles:${formatICSDateTime(firstDay, timeRange.endH, timeRange.endM)}`);
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${rruleDay};UNTIL=${untilDate}T235959Z`);
      lines.push(`SUMMARY:${icsEscape(evt.program)}`);
      lines.push(`LOCATION:${icsEscape(evt.center + ', ' + evt.address + ', Seattle, WA')}`);
      lines.push(`DESCRIPTION:${desc}`);
      lines.push(`CATEGORIES:${icsEscape(evt.category)}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function downloadICS() {
    const events = getFilteredEvents();
    const ics = generateICS(events);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recmap-spring-2026.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getBaseUrl() {
    const loc = window.location;
    const pathParts = loc.pathname.split('/');
    // Remove trailing filename if present (e.g., index.html)
    if (pathParts[pathParts.length - 1].includes('.')) pathParts.pop();
    const basePath = pathParts.join('/').replace(/\/$/, '');
    return `${loc.protocol}//${loc.host}${basePath}`;
  }

  function showExportModal() {
    const url = `${getBaseUrl()}/cal/all.ics`;
    const $modal = document.getElementById('export-modal');
    const $urlInput = document.getElementById('subscribe-url');
    const $copyBtn = document.getElementById('copy-url');
    $urlInput.value = url;
    $copyBtn.textContent = 'Copy';
    $modal.classList.remove('hidden');
  }

  function getFilteredEventsForDay(day) {
    const results = [];
    for (const loc of allLocations) {
      const events = loc.events || [];
      if (events.length === 0) continue;

      // Center filter
      if (!filters.centers.has(loc.name)) continue;

      for (const evt of events) {
        // Category filter
        if (!eventPassesCategoryFilter(evt)) continue;

        for (const session of (evt.sessions || [])) {
          const days = expandDays(session.day);
          if (days.includes(day)) {
            results.push({
              program: evt.program,
              category: evt.category,
              activity: evt.activity,
              center: loc.name,
              address: loc.address,
              time: session.time,
              ages: evt.ages,
              cost: evt.cost,
              date_range: evt.date_range,
              registration_required: evt.registration_required,
            });
          }
        }
      }
    }
    // Sort by start time
    results.sort((a, b) => parseTime(a.time) - parseTime(b.time));
    return results;
  }

  function renderDayTabs() {
    $dayTabs.innerHTML = '';
    for (const day of DAY_ORDER) {
      const count = getFilteredEventsForDay(day).length;
      const btn = document.createElement('button');
      btn.className = 'day-tab' + (day === activeDay ? ' active' : '');
      btn.innerHTML = DAY_ABBR[day] + `<span class="day-count">${count}</span>`;
      btn.addEventListener('click', function () {
        activeDay = day;
        renderSchedule();
      });
      $dayTabs.appendChild(btn);
    }
  }

  function renderScheduleList() {
    const events = getFilteredEventsForDay(activeDay);
    if (events.length === 0) {
      $scheduleList.innerHTML = '<div class="schedule-empty">No events on ' + DAY_ABBR[activeDay] + ' matching current filters</div>';
      return;
    }

    let html = '';
    for (const evt of events) {
      const costLabel = formatCost(evt.cost);
      const costClass = isFreeEvent(evt.cost) ? 'free' : 'paid';

      html += '<div class="schedule-card">';
      html += `<div class="sc-program">${esc(evt.program)}</div>`;
      html += `<div class="sc-center">${esc(evt.center)}</div>`;
      html += `<div class="sc-time">${esc(evt.time)}`;
      if (evt.ages) html += ` · ${esc(evt.ages)}`;
      html += '</div>';
      html += '<div class="sc-tags">';
      html += `<span class="sc-tag cat">${esc(evt.category)}</span>`;
      html += `<span class="sc-tag ${costClass}">${esc(costLabel)}</span>`;
      if (evt.registration_required) {
        html += '<span class="sc-tag reg">Registration</span>';
      }
      html += '</div>';
      html += '</div>';
    }
    $scheduleList.innerHTML = html;
  }

  function renderSchedule() {
    renderDayTabs();
    renderScheduleList();
  }

  // ---- Load Data & Render ----

  async function loadData() {
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      allLocations = data.locations || [];

      // Populate filter dropdowns (fills filter sets) before first render
      const centersWithEvents = allLocations
        .filter(l => l.events && l.events.length > 0)
        .map(l => l.name)
        .sort();
      const categories = (data.categories || []).slice().sort();

      populateDropdown('dd-centers', centersWithEvents, filters.centers);
      populateDropdown('dd-categories', categories, filters.categories);

      // Calendar export modal
      document.getElementById('export-cal').addEventListener('click', showExportModal);
      document.getElementById('export-ics').addEventListener('click', downloadICS);

      document.getElementById('close-modal').addEventListener('click', function () {
        document.getElementById('export-modal').classList.add('hidden');
      });

      document.getElementById('export-modal').addEventListener('click', function (e) {
        if (e.target === this) this.classList.add('hidden');
      });

      document.getElementById('copy-url').addEventListener('click', function () {
        const $url = document.getElementById('subscribe-url');
        navigator.clipboard.writeText($url.value).then(function () {
          document.getElementById('copy-url').textContent = 'Copied!';
        });
      });

      markersLayer.addTo(map);
      renderMarkers();

      // Set initial active day to today (if a weekday name)
      const todayName = DAY_ORDER[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
      activeDay = todayName;

      // Log stats
      const withEvents = allLocations.filter(l => l.events && l.events.length > 0).length;
      const totalEvents = allLocations.reduce((sum, l) => sum + (l.events ? l.events.length : 0), 0);
      console.log(`RecMap: ${allLocations.length} centers loaded, ${withEvents} with programming (${totalEvents} events)`);
    } catch (err) {
      console.error('Failed to load RecMap data:', err);
      L.popup()
        .setLatLng(SEATTLE_CENTER)
        .setContent(
          '<div style="padding:12px;text-align:center;">' +
            '<strong>Could not load data.</strong><br>' +
            '<small>Make sure to serve this site via HTTP<br>(not file://). Try: npx serve .</small>' +
            '</div>'
        )
        .openOn(map);
    }
  }

  // ---- Init ----
  addLegend();
  loadData();
})();
