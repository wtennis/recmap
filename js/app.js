/**
 * RecMap - Main Application
 *
 * Vanilla JS. No framework. Loads data/recmap.json and renders
 * community center markers on a Leaflet map with programming popups.
 */

(function () {
  'use strict';

  // ---- Config ----
  const SEATTLE_CENTER = [47.6062, -122.3321];
  const DEFAULT_ZOOM = 12;
  const DATA_URL = 'data/recmap.json';

  // ---- State ----
  let allLocations = [];
  let markersLayer = L.featureGroup();

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

  // Centers with programming data: teal
  function activeMarker(latlng) {
    return L.circleMarker(latlng, {
      radius: 8, fillColor: '#0d9488', color: '#0f766e',
      weight: 1.5, opacity: 1, fillOpacity: 0.85,
    });
  }

  // Centers without programming data yet: gray
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

  // ---- Popup Content ----

  function buildPopupHTML(location) {
    let html = `
      <div class="popup-header">
        <h3>${esc(location.name)}</h3>
        <div class="address">${esc(location.address)}</div>
        ${location.phone ? `<div class="phone">${esc(location.phone)}</div>` : ''}
      </div>`;

    const events = location.events || [];

    if (events.length === 0) {
      html += `<div class="popup-coming-soon">Programming data coming soon</div>`;
    } else {
      // Group events by category
      const byCategory = {};
      for (const evt of events) {
        const cat = evt.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(evt);
      }

      // Sort categories alphabetically
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
      const latlng = [loc.lat, loc.lng];
      const hasEvents = loc.events && loc.events.length > 0;
      const marker = hasEvents ? activeMarker(latlng) : pendingMarker(latlng);
      marker.bindPopup(buildPopupHTML(loc), {
        maxWidth: 340, maxHeight: 450, autoPanPadding: [20, 60],
      });
      marker.addTo(markersLayer);
    }
  }

  // ---- Legend ----

  function addLegend() {
    const legend = document.createElement('div');
    legend.id = 'legend';
    legend.innerHTML = `
      <div class="legend-item"><span class="legend-dot teal"></span> Has Programming</div>
      <div class="legend-item"><span class="legend-dot gray"></span> Coming Soon</div>
    `;
    document.body.appendChild(legend);
  }

  // ---- Load Data & Render ----

  async function loadData() {
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      allLocations = data.locations || [];
      markersLayer.addTo(map);
      renderMarkers();

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
