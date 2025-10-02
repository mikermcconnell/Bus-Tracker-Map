(function () {
  var map, routesGroup, vehicleLayer, highlightLayer, bannerEl, pollMs = 10000, tileUrl;
  var legendEl;
  var bannerMessages = {};
  var bannerPriority = ['routes', 'vehicles'];
  var bannerDefaultText = '';
  var routeLayers = {};
  var routeMetadata = {};
  var routeKeyIndex = {};
  var markers = {}; // id -> { marker, routeId, iconSignature, lastSeen, lastLat, lastLon }
  var highlightedStopKeys = ['1', '9005'];
  var stopHighlightOverrides = {
    '9005': {
      offsetPx: { x: 25, y: -12 },
      cssOffsets: { x: '-50%', y: '-50%' }
    }
  };

  var routeLaneOverrides = {
    '2A': -8,
    '2B': 8,
    '7A': -8,
    '7B': 8,
    '8A': -8,
    '8B': 8,
    '10': -7,
    '11': 7,
    '100': -6,
    '101': 6,
    '400': 0
  };

  var routeLabelOffsetOverrides = {
    '10': -14,
    '100': -18
  };

  var ROUTE_OFFSET_SCALE = 4;
  var ROUTE_OVERLAP_TOLERANCE = 0.00018; // ~20 meters to capture near-coincident lines
  var ROUTE_OVERLAP_DASH = 22;

  function init() {
    bannerEl = document.getElementById('banner');
    legendEl = document.getElementById('legend');
    if (bannerEl) {
      bannerDefaultText = bannerEl.textContent || 'Live data unavailable, retrying';
      bannerEl.hidden = true;
    }

    fetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        pollMs = cfg.poll_ms || 10000;
        tileUrl = cfg.tiles || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        setupMap();
        setupLegend();
        loadRoutes();
        loadStopHighlights();
        startVehiclesPoll();
      })
      .catch(function () {
        tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        setupMap();
        setupLegend();
        loadRoutes();
        loadStopHighlights();
        startVehiclesPoll();
      });
  }

  function setupMap() {
    map = L.map('map', { zoomControl: true, zoomSnap: 0.5, zoomDelta: 0.5 }).setView([44.3894, -79.6903], 13);
    map.zoomControl.setPosition('bottomright');

    map.createPane('routeOutlinePane');
    map.getPane('routeOutlinePane').style.zIndex = 420;
    map.getPane('routeOutlinePane').style.pointerEvents = 'none';

    map.createPane('routePane');
    map.getPane('routePane').style.zIndex = 430;
    map.getPane('routePane').style.pointerEvents = 'none';

    map.createPane('routeOverlapPane');
    map.getPane('routeOverlapPane').style.zIndex = 433;
    map.getPane('routeOverlapPane').style.pointerEvents = 'none';

    map.createPane('routeLabelPane');
    map.getPane('routeLabelPane').style.zIndex = 435;
    map.getPane('routeLabelPane').style.pointerEvents = 'none';

    map.createPane('vehiclePane');
    map.getPane('vehiclePane').style.zIndex = 440;

    map.createPane('stopHighlightPane');
    map.getPane('stopHighlightPane').style.zIndex = 450;
    map.getPane('stopHighlightPane').style.pointerEvents = 'none';

    L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution: ' OpenStreetMap contributors',
      opacity: 0.34,
      detectRetina: true
    }).addTo(map);
    routesGroup = L.layerGroup().addTo(map);
    vehicleLayer = L.layerGroup().addTo(map);
    highlightLayer = L.layerGroup().addTo(map);
  }

  function setupLegend() {
    if (!legendEl) return;
    legendEl.innerHTML = '';

    var routesSection = document.createElement('div');
    routesSection.className = 'legend-section';
    legendEl.appendChild(routesSection);

    var routesTitle = document.createElement('div');
    routesTitle.className = 'legend-section-title';
    routesTitle.textContent = 'Routes';
    routesSection.appendChild(routesTitle);

    var actions = document.createElement('div');
    actions.className = 'legend-actions';
    routesSection.appendChild(actions);

    var showAllBtn = document.createElement('button');
    showAllBtn.type = 'button';
    showAllBtn.id = 'btnShowAllRoutes';
    showAllBtn.textContent = 'Show All';
    actions.appendChild(showAllBtn);

    var hideAllBtn = document.createElement('button');
    hideAllBtn.type = 'button';
    hideAllBtn.id = 'btnHideAllRoutes';
    hideAllBtn.textContent = 'Hide All';
    actions.appendChild(hideAllBtn);

    var routeList = document.createElement('div');
    routeList.className = 'route-list';
    routeList.id = 'routeList';
    routesSection.appendChild(routeList);

    routeList.addEventListener('change', function (e) {
      if (e.target && e.target.matches('input[type="checkbox"][data-route]')) {
        var routeId = e.target.getAttribute('data-route');
        setRouteVisibility(routeId, e.target.checked);
        updateRouteLegendState();
      }
    });

    showAllBtn.addEventListener('click', function () {
      Object.keys(routeLayers).forEach(function (id) { setRouteVisibility(id, true); });
      updateRouteLegendState();
    });

    hideAllBtn.addEventListener('click', function () {
      Object.keys(routeLayers).forEach(function (id) { setRouteVisibility(id, false); });
      updateRouteLegendState();
    });

    var vehiclesLabel = document.createElement('label');
    vehiclesLabel.className = 'legend-check';
    var vehiclesCheckbox = document.createElement('input');
    vehiclesCheckbox.type = 'checkbox';
    vehiclesCheckbox.id = 'chkVehicles';
    vehiclesCheckbox.checked = true;
    vehiclesLabel.appendChild(vehiclesCheckbox);
    var vehiclesText = document.createElement('span');
    vehiclesText.textContent = 'Vehicles';
    vehiclesLabel.appendChild(vehiclesText);
    legendEl.appendChild(vehiclesLabel);

    vehiclesCheckbox.addEventListener('change', function (e) {
      if (e.target.checked) {
        vehicleLayer.addTo(map);
      } else {
        map.removeLayer(vehicleLayer);
      }
    });
  }

  function normalizeStopKey(value) {
    if (value === null || value === undefined) return '';
    var str = String(value).trim();
    if (!str) return '';
    return str.toUpperCase();
  }

  function findStopFeatureByKey(features, key) {
    if (!Array.isArray(features) || !features.length) return null;
    var target = normalizeStopKey(key);
    if (!target) return null;
    var fallback = null;
    for (var i = 0; i < features.length; i++) {
      var feature = features[i];
      if (!feature || !feature.properties) continue;
      var props = feature.properties;
      var codes = [];
      if (props.stop_code) codes.push(normalizeStopKey(props.stop_code));
      if (props.stop_id) codes.push(normalizeStopKey(props.stop_id));

      for (var j = 0; j < codes.length; j++) {
        if (codes[j] === target) {
          return { feature: feature, matched: codes[j] };
        }
      }

      if (!fallback) {
        for (var k = 0; k < codes.length; k++) {
          if (codes[k] && codes[k].indexOf(target) !== -1) {
            fallback = { feature: feature, matched: codes[k] };
            break;
          }
        }
      }
    }
    return fallback;
  }

  function sanitizeStopLabel(text) {
    if (!text) return 'Stop';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function createStopHighlightMarker(feature, identifier) {
    if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) return null;
    var coords = feature.geometry.coordinates;
    if (coords.length < 2) return null;
    var lat = coords[1];
    var lon = coords[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    var props = feature.properties || {};
    var rawName = props.stop_name || ('Stop ' + identifier);
    var name = rawName;
    if (identifier === '9005') {
      name = rawName.replace(/\s*Platform\s*\d+$/i, '').trim();
    }
    var safeName = sanitizeStopLabel(name);
    var safeId = sanitizeStopLabel(identifier);

    var override = stopHighlightOverrides[identifier] || null;
    var includeCallout = !(override && override.offsetPx);
    var wrapperAttrs = ' data-stop="' + safeId + '"';
    if (override && override.cssOffsets) {
      var cssParts = [];
      if (override.cssOffsets.x) cssParts.push('--stop-offset-x:' + override.cssOffsets.x);
      if (override.cssOffsets.y) cssParts.push('--stop-offset-y:' + override.cssOffsets.y);
      if (cssParts.length) {
        wrapperAttrs += ' style="' + cssParts.join(';') + ';"';
      }
    }
    var html = '' +
      '<div class="stop-highlight"' + wrapperAttrs + '>' +
      (includeCallout ? '  <div class="stop-highlight-callout"></div>' : '') +
      '  <div class="stop-highlight-label">' + safeName + '</div>' +
      '</div>';

    var markerOptions = {
      icon: L.divIcon({
        className: 'stop-highlight-icon',
        html: html,
        iconSize: [0, 0]
      }),
      pane: 'stopHighlightPane',
      interactive: false
    };

    if (override && override.offsetPx && map && map.latLngToLayerPoint && map.layerPointToLatLng) {
      try {
        var baseLatLng = L.latLng(lat, lon);
        var layerPoint = map.latLngToLayerPoint(baseLatLng);
        var offsetPoint = L.point(
          layerPoint.x + Number(override.offsetPx.x || 0),
          layerPoint.y + Number(override.offsetPx.y || 0)
        );
        var offsetLatLng = map.layerPointToLatLng(offsetPoint);
        var labelMarker = L.marker([offsetLatLng.lat, offsetLatLng.lng], markerOptions);
        var connector = L.polyline([
          [lat, lon],
          [offsetLatLng.lat, offsetLatLng.lng]
        ], {
          color: '#202124',
          weight: 2,
          opacity: 0.85,
          dashArray: '6 6',
          pane: 'stopHighlightPane'
        });
        return L.layerGroup([connector, labelMarker]);
      } catch (err) {
        console.warn('Failed to offset highlight for stop 9005:', err);
      }
    }

    return L.marker([lat, lon], markerOptions);
  }

  function loadStopHighlights() {
    if (!highlightLayer) return;
    highlightLayer.clearLayers();
    fetchJson('/api/stops.geojson')
      .then(function (gj) {
        if (!isFeatureCollection(gj)) throw new Error('Invalid stops response');
        var features = Array.isArray(gj.features) ? gj.features : [];
        highlightedStopKeys.forEach(function (key) {
          var match = findStopFeatureByKey(features, key);
          if (!match) {
            console.warn('Highlight stop not found for key:', key);
            return;
          }
          var marker = createStopHighlightMarker(match.feature, key);
          if (marker) {
            marker.addTo(highlightLayer);
          }
        });
      })
      .catch(function (err) {
        console.error('Failed to load highlighted stops:', err);
      });
  }

  function updateRouteLegendState() {
    var routeList = document.getElementById('routeList');
    if (!routeList) return;
    Array.prototype.forEach.call(routeList.querySelectorAll('label.route-item'), function (label) {
      var input = label.querySelector('input[data-route]');
      if (!input) return;
      var routeId = input.getAttribute('data-route');
      var visible = isRouteVisible(routeId);
      if (visible) {
        label.classList.remove('route-hidden');
        input.checked = true;
      } else {
        label.classList.add('route-hidden');
        input.checked = false;
      }
    });
  }

  function renderRouteLegend() {
    var routeList = document.getElementById('routeList');
    if (!routeList) return;
    routeList.innerHTML = '';

    var routeIds = Object.keys(routeLayers).sort(function (a, b) {
      var aMeta = getRouteMeta(a);
      var bMeta = getRouteMeta(b);
      var aOrder = extractRouteSortValue(aMeta);
      var bOrder = extractRouteSortValue(bMeta);
      if (aOrder.number !== null && bOrder.number !== null) {
        if (aOrder.number !== bOrder.number) return aOrder.number - bOrder.number;
        return aOrder.label.localeCompare(bOrder.label);
      }
      if (aOrder.number !== null) return -1;
      if (bOrder.number !== null) return 1;
      return aOrder.label.localeCompare(bOrder.label);
    });

    routeIds.forEach(function (routeId) {
      var entry = routeLayers[routeId];
      var meta = getRouteMeta(routeId);
      var label = document.createElement('label');
      label.className = 'route-item';
      label.title = meta.longName ? meta.displayName + ' - ' + meta.longName : meta.displayName;

      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = entry.visible !== false;
      input.setAttribute('data-route', routeId);
      label.appendChild(input);

      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = meta.color;
      label.appendChild(swatch);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'route-name';
      nameSpan.textContent = meta.displayName;
      label.appendChild(nameSpan);

      routeList.appendChild(label);
    });

    updateRouteLegendState();
  }

  function updateBanner(source, message) {
    if (!bannerEl) return;
    if (message) {
      bannerMessages[source] = message;
    } else {
      delete bannerMessages[source];
    }

    var nextMessage = null;
    for (var i = 0; i < bannerPriority.length; i++) {
      var key = bannerPriority[i];
      if (bannerMessages[key]) {
        nextMessage = bannerMessages[key];
        break;
      }
    }
    if (!nextMessage) {
      var keys = Object.keys(bannerMessages);
      if (keys.length > 0) {
        nextMessage = bannerMessages[keys[0]];
      }
    }

    if (!nextMessage) {
      bannerEl.textContent = bannerDefaultText;
      bannerEl.hidden = true;
    } else {
      bannerEl.textContent = nextMessage;
      bannerEl.hidden = false;
    }
  }

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (res.ok) return res.json();
      return res.text().then(function (txt) {
        var message = 'Request failed: ' + res.status;
        if (txt) {
          try {
            var parsed = JSON.parse(txt);
            if (parsed && parsed.error) {
              message = parsed.error;
            } else {
              message = txt;
            }
          } catch (err) {
            message = txt;
          }
        }
        var error = new Error(message);
        error.status = res.status;
        error.url = url;
        throw error;
      });
    });
  }

  function isFeatureCollection(obj) {
    return obj && obj.type === 'FeatureCollection' && Array.isArray(obj.features);
  }

  function normalizeHexColor(color) {
    if (!color) return null;
    var cleaned = String(color).trim();
    if (!cleaned) return null;
    if (cleaned[0] === '#') cleaned = cleaned.slice(1);
    if (!/^[0-9a-fA-F]{3,6}$/.test(cleaned)) return null;
    if (cleaned.length === 3) {
      cleaned = cleaned.split('').map(function (ch) { return ch + ch; }).join('');
    }
    return '#' + cleaned.toUpperCase();
  }

  function normalizeRouteKey(value) {
    if (!value) return '';
    return String(value).trim().toUpperCase();
  }

  function deriveAlphaSuffixOffset(value) {
    if (!value) return 0;
    var match = value.match(/^([0-9]+)([A-Z])$/);
    if (!match) return 0;
    var index = match[2].charCodeAt(0) - 65;
    if (index < 0) return 0;
    var magnitude = 6 + Math.floor(index / 2) * 4;
    var direction = index % 2 === 0 ? -1 : 1;
    return direction * magnitude;
  }

  function deriveDirectionalOffset(meta) {
    if (!meta) return 0;
    var candidates = [
      normalizeRouteKey(meta.displayName),
      normalizeRouteKey(meta.longName),
      normalizeRouteKey(meta.id)
    ].filter(Boolean);

    var patterns = [
      { regex: /\bINBOUND\b|\bIB\b/, offset: -6 },
      { regex: /\bOUTBOUND\b|\bOB\b/, offset: 6 },
      { regex: /\bNORTHBOUND\b|\bNB\b/, offset: -6 },
      { regex: /\bSOUTHBOUND\b|\bSB\b/, offset: 6 },
      { regex: /\bEASTBOUND\b|\bEB\b/, offset: -6 },
      { regex: /\bWESTBOUND\b|\bWB\b/, offset: 6 }
    ];

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      for (var j = 0; j < patterns.length; j++) {
        if (patterns[j].regex.test(candidate)) {
          return patterns[j].offset;
        }
      }
    }
    return 0;
  }

  function scaleOffset(value) {
    if (!Number.isFinite(value) || value === 0) return value;
    return value * ROUTE_OFFSET_SCALE;
  }

  function getRouteLaneOffset(meta) {
    if (!meta) return 0;

    var displayKey = normalizeRouteKey(meta.displayName);
    if (displayKey && Object.prototype.hasOwnProperty.call(routeLaneOverrides, displayKey)) {
      return scaleOffset(routeLaneOverrides[displayKey]);
    }

    var idKey = normalizeRouteKey(meta.id);
    if (idKey && Object.prototype.hasOwnProperty.call(routeLaneOverrides, idKey)) {
      return scaleOffset(routeLaneOverrides[idKey]);
    }

    var alphaOffset = deriveAlphaSuffixOffset(displayKey) || deriveAlphaSuffixOffset(idKey);
    if (alphaOffset) {
      return scaleOffset(alphaOffset);
    }

    var directionalOffset = deriveDirectionalOffset(meta);
    if (directionalOffset) {
      return scaleOffset(directionalOffset);
    }

    return 0;
  }
  function offsetLineString(coords, offsetMeters) {
    if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(offsetMeters) || offsetMeters === 0) {
      return coords ? coords.map(function (pt) { return pt.slice(); }) : coords;
    }
    var projected = coords.map(function (pt) {
      var latLng = L.latLng(pt[1], pt[0]);
      var point = L.Projection.SphericalMercator.project(latLng);
      return { x: point.x, y: point.y };
    });
    var result = [];
    for (var i = 0; i < projected.length; i++) {
      var current = projected[i];
      var prev = projected[i - 1] || current;
      var next = projected[i + 1] || current;
      var dx = next.x - prev.x;
      var dy = next.y - prev.y;
      var length = Math.sqrt(dx * dx + dy * dy);
      if (!length) {
        result.push(coords[i].slice());
        continue;
      }
      var nx = -dy / length;
      var ny = dx / length;
      var shiftedX = current.x + nx * offsetMeters;
      var shiftedY = current.y + ny * offsetMeters;
      var shiftedLatLng = L.Projection.SphericalMercator.unproject(L.point(shiftedX, shiftedY));
      result.push([shiftedLatLng.lng, shiftedLatLng.lat]);
    }
    return result;
  }

  function offsetGeometry(geometry, offsetMeters) {
    if (!geometry) return null;
    if (!Number.isFinite(offsetMeters) || offsetMeters === 0) return geometry;
    if (geometry.type === 'LineString') {
      return { type: 'LineString', coordinates: offsetLineString(geometry.coordinates, offsetMeters) };
    }
    if (geometry.type === 'MultiLineString') {
      return { type: 'MultiLineString', coordinates: geometry.coordinates.map(function (line) { return offsetLineString(line, offsetMeters); }) };
    }
    if (geometry.type === 'GeometryCollection') {
      var geoms = (geometry.geometries || []).map(function (geom) {
        return offsetGeometry(geom, offsetMeters) || geom;
      });
      return { type: 'GeometryCollection', geometries: geoms };
    }
    return geometry;
  }

  function cloneFeatureWithGeometry(feature, geometry) {
    return {
      type: feature.type,
      properties: feature.properties,
      geometry: geometry
    };
  }

  function hexToRgba(hex, alpha) {
    var normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    var r = parseInt(normalized.substr(1, 2), 16);
    var g = parseInt(normalized.substr(3, 2), 16);
    var b = parseInt(normalized.substr(5, 2), 16);
    var a = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
  }

  function extractLineCoordinateSets(geometry) {
    var results = [];
    if (!geometry || !geometry.type) return results;
    if (geometry.type === 'LineString') {
      if (Array.isArray(geometry.coordinates)) results.push(geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
      var lines = geometry.coordinates || [];
      for (var i = 0; i < lines.length; i++) {
        if (Array.isArray(lines[i])) results.push(lines[i]);
      }
    } else if (geometry.type === 'GeometryCollection') {
      var geoms = geometry.geometries || [];
      for (var j = 0; j < geoms.length; j++) {
        results = results.concat(extractLineCoordinateSets(geoms[j]));
      }
    }
    return results;
  }

  function convertCoordsToLatLngs(coords) {
    var latLngs = [];
    if (!Array.isArray(coords)) return latLngs;
    for (var i = 0; i < coords.length; i++) {
      var point = coords[i];
      if (!Array.isArray(point) || point.length < 2) continue;
      var lng = Number(point[0]);
      var lat = Number(point[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      latLngs.push(L.latLng(lat, lng));
    }
    return latLngs;
  }

  function computeLineLengthMeters(latLngs) {
    if (!Array.isArray(latLngs) || latLngs.length < 2) return 0;
    var total = 0;
    for (var i = 0; i < latLngs.length - 1; i++) {
      total += latLngs[i].distanceTo(latLngs[i + 1]);
    }
    return total;
  }

  function locatePointAlongLines(lines, targetMeters) {
    if (!Array.isArray(lines) || !lines.length || !Number.isFinite(targetMeters) || targetMeters < 0) return null;
    var traversed = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!Array.isArray(line) || line.length < 2) continue;
      for (var j = 0; j < line.length - 1; j++) {
        var start = line[j];
        var end = line[j + 1];
        var segmentLength = start.distanceTo(end);
        if (!segmentLength) continue;
        if (traversed + segmentLength >= targetMeters) {
          var remaining = targetMeters - traversed;
          var ratio = remaining / segmentLength;
          ratio = Math.max(0, Math.min(1, ratio));
          var lat = start.lat + (end.lat - start.lat) * ratio;
          var lng = start.lng + (end.lng - start.lng) * ratio;
          return {
            lat: lat,
            lng: lng,
            bearing: computeBearingBetween(start.lat, start.lng, end.lat, end.lng)
          };
        }
        traversed += segmentLength;
      }
    }
    return null;
  }

  function appendUnique(list, value) {
    if (!list || value === undefined || value === null) return;
    if (list.indexOf(value) === -1) list.push(value);
  }

  function roundCoord(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 1000000) / 1000000;
  }

  function hashCoordinateSequence(coords) {
    if (!Array.isArray(coords) || !coords.length) return '';
    var forward = [];
    for (var i = 0; i < coords.length; i++) {
      var point = coords[i];
      if (!Array.isArray(point) || point.length < 2) continue;
      forward.push(roundCoord(point[0]) + ',' + roundCoord(point[1]));
    }
    if (!forward.length) return '';
    var backward = forward.slice().reverse();
    var forwardKey = forward.join('|');
    var backwardKey = backward.join('|');
    return forwardKey <= backwardKey ? forwardKey : backwardKey;
  }

  function geometryHash(geometry) {
    var sets = extractLineCoordinateSets(geometry);
    if (!sets.length) return null;
    var parts = [];
    for (var i = 0; i < sets.length; i++) {
      var key = hashCoordinateSequence(sets[i]);
      if (key) parts.push(key);
    }
    if (!parts.length) return null;
    parts.sort();
    return String(geometry.type || 'LineString') + ':' + parts.join('::');
  }

  function computeOverlapSegments(candidates) {
    if (!Array.isArray(candidates) || candidates.length < 2) return [];
    var turfApi = typeof window !== 'undefined' ? window.turf : null;
    if (!turfApi || typeof turfApi.lineOverlap !== 'function') return [];

    var segmentMap = Object.create(null);
    var keys = [];

    for (var i = 0; i < candidates.length; i++) {
      var a = candidates[i];
      if (!a || !a.feature || !hasLineGeometry(a.feature.geometry)) continue;
      for (var j = i + 1; j < candidates.length; j++) {
        var b = candidates[j];
        if (!b || !b.feature || !hasLineGeometry(b.feature.geometry)) continue;
        if (a.routeId === b.routeId) continue;

        var overlap = turfApi.lineOverlap(a.feature, b.feature, { tolerance: ROUTE_OVERLAP_TOLERANCE });
        if (!overlap || !Array.isArray(overlap.features) || !overlap.features.length) continue;

        overlap.features.forEach(function (seg) {
          if (!seg || !seg.geometry) return;
          var hash = geometryHash(seg.geometry);
          if (!hash) return;
          var record = segmentMap[hash];
          if (!record) {
            record = { geometry: seg.geometry, routes: [] };
            segmentMap[hash] = record;
            keys.push(hash);
          }
          appendUnique(record.routes, a.routeId);
          appendUnique(record.routes, b.routeId);
        });
      }
    }

    var results = [];
    for (var k = 0; k < keys.length; k++) {
      var item = segmentMap[keys[k]];
      if (item && item.routes && item.routes.length > 1) {
        results.push(item);
      }
    }
    return results;
  }

  function renderRouteOverlaps(candidates) {
    var segments = computeOverlapSegments(candidates);
    if (!segments.length) return;

    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      var routes = (segment.routes || []).slice();
      if (routes.length < 2) continue;

      routes.sort(function (a, b) {
        var aStr = String(a);
        var bStr = String(b);
        var aNum = parseFloat(aStr);
        var bNum = parseFloat(bStr);
        if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) {
          return aNum - bNum;
        }
        return aStr.localeCompare(bStr, undefined, { sensitivity: 'base', numeric: true });
      });

      var feature = {
        type: 'Feature',
        properties: { routes: routes.slice() },
        geometry: segment.geometry
      };

      for (var r = 0; r < routes.length; r++) {
        var routeId = routes[r];
        var entry = routeLayers[routeId];
        if (!entry || !entry.layer) continue;
        var meta = getRouteMeta(routeId);
        var color = (meta && meta.color) || '#202124';
        var dashOffsetValue = ROUTE_OVERLAP_DASH * r;

        (function (targetEntry, strokeColor, offsetValue) {
          var layer = L.geoJSON(feature, {
            pane: 'routeOverlapPane',
            interactive: false,
            smoothFactor: 1.4,
            style: function () {
              return {
                color: strokeColor,
                weight: 7,
                opacity: 1,
                dashArray: ROUTE_OVERLAP_DASH + ' ' + ROUTE_OVERLAP_DASH,
                dashOffset: String(offsetValue),
                lineCap: 'butt',
                lineJoin: 'round'
              };
            }
          });

          targetEntry.layer.addLayer(layer);
          if (!targetEntry.overlapLayers) targetEntry.overlapLayers = [];
          targetEntry.overlapLayers.push(layer);
        })(entry, color, dashOffsetValue);
      }
    }
  }

  function computeLabelTargets(totalLength, labelCount) {
    if (!Number.isFinite(totalLength) || totalLength <= 0 || !Number.isFinite(labelCount) || labelCount <= 0) {
      return [];
    }
    var results = [];
    var spacing = totalLength / (labelCount + 1);
    for (var i = 1; i <= labelCount; i++) {
      results.push(spacing * i);
    }
    return results;
  }

  function deriveRouteLabelCode(meta) {
    if (!meta) return '';
    var candidates = [meta.displayName, meta.id, meta.longName];
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (!candidate) continue;
      var match = String(candidate).trim().match(/[0-9]+/);
      if (match && match[0]) return match[0];
    }
    var fallback = meta.displayName || meta.id || '';
    return String(fallback).trim();
  }

  function resolveRouteLabelOffset(meta, routeId) {
    var candidates = [];
    if (routeId) candidates.push(routeId);
    if (meta && meta.id) candidates.push(meta.id);
    if (meta && meta.displayName) candidates.push(meta.displayName);
    if (meta && meta.longName) candidates.push(meta.longName);
    var numericLabel = deriveRouteLabelCode(meta);
    if (numericLabel) candidates.push(numericLabel);

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (!candidate && candidate !== 0) continue;
      var normalized = String(candidate).trim();
      if (!normalized) continue;
      var digits = normalized.match(/[0-9]+/);
      var key = digits && digits[0] ? digits[0] : normalizeRouteKey(normalized);
      if (key && Object.prototype.hasOwnProperty.call(routeLabelOffsetOverrides, key)) {
        return routeLabelOffsetOverrides[key];
      }
    }
    return 0;
  }

  function movePointByBearing(lat, lng, bearingDeg, distanceMeters) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(distanceMeters) || distanceMeters === 0) {
      return { lat: lat, lng: lng };
    }
    var R = 6378137;
    var phi1 = lat * Math.PI / 180;
    var lambda1 = lng * Math.PI / 180;
    var theta = bearingDeg * Math.PI / 180;
    var delta = distanceMeters / R;

    var sinPhi1 = Math.sin(phi1);
    var cosPhi1 = Math.cos(phi1);
    var sinDelta = Math.sin(delta);
    var cosDelta = Math.cos(delta);

    var sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta);
    var phi2 = Math.asin(Math.min(Math.max(sinPhi2, -1), 1));
    var y = Math.sin(theta) * sinDelta * Math.cos(phi1);
    var x = cosDelta - sinPhi1 * sinPhi2;
    var lambda2 = lambda1 + Math.atan2(y, x);

    return { lat: phi2 * 180 / Math.PI, lng: lambda2 * 180 / Math.PI };
  }

  function applyRouteLabelOffset(meta, position, routeId) {
    if (!position) return position;
    var offset = resolveRouteLabelOffset(meta, routeId);
    if (!Number.isFinite(offset) || offset === 0) {
      return position;
    }
    var bearing = Number.isFinite(position.bearing) ? position.bearing : 0;
    var lateralBearing = offset > 0 ? bearing + 90 : bearing - 90;
    var target = movePointByBearing(position.lat, position.lng, lateralBearing, Math.abs(offset));
    return {
      lat: target.lat,
      lng: target.lng,
      bearing: position.bearing
    };
  }

  function createRouteLabelMarker(meta, position, routeId) {
    if (!meta || !position) return null;
    var label = deriveRouteLabelCode(meta);
    if (!label) {
      label = meta.displayName || meta.id || '';
    }
    if (!label) return null;

    var safeLabel = String(label)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    var rawColor = meta.color || '#1A73E8';
    var normalizedColor = normalizeHexColor(rawColor);
    var colorValue = normalizedColor || String(rawColor).trim() || '#1A73E8';
    var labelBg = normalizedColor ? hexToRgba(normalizedColor, 0.18) : 'rgba(255, 255, 255, 0.92)';

    var textSource = meta.textColor || (normalizedColor ? computeTextColor(normalizedColor) : '#202124');
    var textValue = normalizeHexColor(textSource) || String(textSource).trim() || '#202124';

    var safeColor = String(colorValue).replace(/[^#0-9a-zA-Z(),.% -]/g, '');
    var safeText = String(textValue).replace(/[^#0-9a-zA-Z(),.% -]/g, '');
    var safeBg = String(labelBg).replace(/[^#0-9a-zA-Z(),.% -]/g, '');

    var adjustedPosition = applyRouteLabelOffset(meta, position, routeId) || position;
    var bearing = Number.isFinite(adjustedPosition.bearing) ? adjustedPosition.bearing : 0;
    var bearingValue = bearing.toFixed(1) + 'deg';
    var inverseBearingValue = (-bearing).toFixed(1) + 'deg';

    var safeBearing = String(bearingValue).replace(/[^0-9a-zA-Z.-]/g, '');
    var safeInverseBearing = String(inverseBearingValue).replace(/[^0-9a-zA-Z.-]/g, '');

    var html = '<div class="route-label" style="--route-color:' + safeColor + ';--route-text-color:' + safeText + ';--route-label-bg:' + safeBg + ';--route-bearing:' + safeBearing + ';--route-bearing-inverse:' + safeInverseBearing + '"><span>' + safeLabel + '</span></div>';

    return L.marker([adjustedPosition.lat, adjustedPosition.lng], {
      icon: L.divIcon({
        className: 'route-label-icon',
        html: html,
        iconSize: null
      }),
      pane: 'routeLabelPane',
      interactive: false
    });
  }

  function computeTextColor(color) {
    var hex = normalizeHexColor(color);
    if (!hex) return '#FFFFFF';
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#222222' : '#FFFFFF';
  }

  function hasLineGeometry(geom) {
    if (!geom || !geom.type) return false;
    if (geom.type === 'LineString' || geom.type === 'MultiLineString') return true;
    if (geom.type === 'GeometryCollection') {
      var geoms = geom.geometries || [];
      for (var i = 0; i < geoms.length; i++) {
        if (hasLineGeometry(geoms[i])) return true;
      }
    }
    return false;
  }

  function getRouteDisplayName(props, fallbackId) {
    if (props.route_short_name) return props.route_short_name.trim();
    if (props.route_long_name) {
      var longName = props.route_long_name.trim();
      if (longName) {
        var longMatch = longName.match(/([0-9]+[A-Za-z]?)/);
        if (longMatch && longMatch[1]) return longMatch[1];
        return longName;
      }
    }
    if (!fallbackId) return '';
    var fallback = String(fallbackId).trim();
    if (!fallback) return '';
    if (fallback.indexOf('-') === -1 && fallback.indexOf(' ') === -1 && fallback.length <= 6) {
      return fallback.toUpperCase();
    }
    var fallbackMatch = fallback.match(/^([0-9]+[A-Za-z]?)/i);
    if (fallbackMatch && fallbackMatch[1]) return fallbackMatch[1].toUpperCase();
    return fallback;
  }

  function getRouteMeta(routeId, props) {
    var id = routeId || 'route';
    var normalizedId = normalizeRouteKey(id);
    var existing = routeMetadata[id] || (normalizedId && routeKeyIndex[normalizedId]);
    if (!props && existing) return existing;

    var colorSource = props && props.route_color ? props.route_color : existing && existing.color;
    var color = normalizeHexColor(colorSource) || colorSource || pickRouteColor(id);
    var textColorSource = props && props.route_text_color ? props.route_text_color : existing && existing.textColor;
    var textColor = normalizeHexColor(textColorSource) || computeTextColor(color);
    var displayName = (props ? getRouteDisplayName(props, id) : existing && existing.displayName) || getRouteDisplayName({}, id);
    var longName = (props && props.route_long_name) || (existing && existing.longName) || null;

    var meta = {
      id: id,
      color: color,
      textColor: textColor,
      displayName: displayName,
      longName: longName
    };
    meta.offsetMeters = getRouteLaneOffset(meta);
    routeMetadata[id] = meta;

    var aliasCandidates = [id, normalizedId, props && props.route_short_name, props && props.route_long_name, meta.displayName];
    for (var i = 0; i < aliasCandidates.length; i++) {
      var key = normalizeRouteKey(aliasCandidates[i]);
      if (key) {
        routeKeyIndex[key] = meta;
      }
    }

    return meta;
  }

  function extractRouteSortValue(meta) {
    if (!meta) {
      return { number: null, label: '' };
    }
    var label = String(meta.displayName || '').trim();
    var match = label.match(/^[0-9]+/);
    var parsed = match ? parseInt(match[0], 10) : NaN;
    return {
      number: Number.isFinite(parsed) ? parsed : null,
      label: label.toUpperCase()
    };
  }

  function createBusIcon(meta, bearing) {
    var label = meta.displayName || '';
    var background = meta.color || '#444444';
    var textColor = meta.textColor || '#FFFFFF';
    var safeLabel = String(label || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    var safeBg = String(background || '#444444').replace(/[^#0-9a-zA-Z(),.% -]/g, '');
    var safeText = String(textColor || '#FFFFFF').replace(/[^#0-9a-zA-Z(),.% -]/g, '');
    var hasBearing = Number.isFinite(bearing);
    var normalizedBearing = hasBearing ? normalizeBearing(bearing) : null;
    var bearingValue = normalizedBearing === null ? '0deg' : normalizedBearing.toFixed(1) + 'deg';
    var labelLength = String(label || '').replace(/\s+/g, '').length;
    var labelSize = labelLength >= 3 ? 20 : 26;
    var arrowColor = (meta.textColor && meta.textColor.toUpperCase() === '#FFFFFF') ? 'rgba(20, 20, 20, 0.88)' : (meta.textColor || '#222222');
    var safeArrow = String(arrowColor || '#222222').replace(/[^#0-9a-zA-Z(),.% -]/g, '');
    var attrs = 'class="vehicle-bubble" style="--route-color:' + safeBg + ';--text-color:' + safeText + ';--label-size:' + labelSize + 'px;--bearing:' + bearingValue + ';--arrow-color:' + safeArrow + ';"';
    if (!hasBearing) {
      attrs += ' data-no-bearing="true"';
    }
    return L.divIcon({
      className: 'vehicle-icon',
      html: '\n        <div ' + attrs + '>\n          <svg class="vehicle-arrow" viewBox="0 0 24 16" role="presentation" focusable="false">\n            <path d="M12 0L24 16H0Z"/>\n          </svg>\n          <span class="vehicle-label">' + safeLabel + '</span>\n        </div>\n      ',
      iconSize: [58, 58],
      iconAnchor: [29, 29],
      popupAnchor: [0, -30]
    });
  }

  function normalizeBearing(value) {
    if (!Number.isFinite(value)) return null;
    var deg = value % 360;
    if (deg < 0) deg += 360;
    return deg;
  }

  function computeBearingBetween(lat1, lon1, lat2, lon2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return null;
    if (lat1 === lat2 && lon1 === lon2) return null;
    var phi1 = lat1 * Math.PI / 180;
    var phi2 = lat2 * Math.PI / 180;
    var deltaLambda = (lon2 - lon1) * Math.PI / 180;
    var y = Math.sin(deltaLambda) * Math.cos(phi2);
    var x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
  }

  function resolveVehicleBearing(vehicle, markerData) {
    var direct = normalizeBearing(vehicle && vehicle.bearing);
    if (direct !== null) return direct;
    if (markerData && Number.isFinite(markerData.lastLat) && Number.isFinite(markerData.lastLon)) {
      var computed = computeBearingBetween(markerData.lastLat, markerData.lastLon, vehicle.lat, vehicle.lon);
      if (computed !== null) return computed;
      if (Number.isFinite(markerData.bearing)) return markerData.bearing;
    }
    return null;
  }

  function hashString(str) {
    var hash = 0;
    if (!str) return hash;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function pickRouteColor(routeId, preferredColor) {
    if (preferredColor && typeof preferredColor === 'string' && preferredColor.trim()) {
      return preferredColor.trim();
    }
    var hue = hashString(routeId) % 360;
    return 'hsl(' + hue + ', 70%, 45%)';
  }

  function clearRoutes() {
    routesGroup.clearLayers();
    routeLayers = {};
    routeMetadata = {};
    routeKeyIndex = {};
  }

  function isRouteVisible(routeId) {
    var entry = routeLayers[routeId];
    if (!entry) return true;
    return entry.visible !== false;
  }

  function applyRouteVisibilityToVehicles(routeId) {
    var visible = isRouteVisible(routeId);
    Object.keys(markers).forEach(function (id) {
      if (markers[id].routeId === routeId) {
        markers[id].marker.setOpacity(visible ? 1 : 0);
      }
    });
  }

  function setRouteVisibility(routeId, shouldShow) {
    var entry = routeLayers[routeId];
    if (!entry) return;
    if (shouldShow) {
      if (entry.visible === false) {
        routesGroup.addLayer(entry.layer);
      }
      entry.visible = true;
    } else {
      if (entry.visible !== false) {
        routesGroup.removeLayer(entry.layer);
      }
      entry.visible = false;
    }
    applyRouteVisibilityToVehicles(routeId);
  }

  function buildRouteLabels() {
    var BASE_MIN_DISTANCE = 90;

    Object.keys(routeLayers).forEach(function (routeId) {
      var entry = routeLayers[routeId];
      if (!entry || !entry.labelLayer || !entry.labelGeometries || !entry.meta) return;

      entry.labelLayer.clearLayers();

      var coordinateSets = [];
      for (var i = 0; i < entry.labelGeometries.length; i++) {
        coordinateSets = coordinateSets.concat(extractLineCoordinateSets(entry.labelGeometries[i]));
      }
      if (!coordinateSets.length) return;

      var lineLatLngs = [];
      for (var j = 0; j < coordinateSets.length; j++) {
        var latLngs = convertCoordsToLatLngs(coordinateSets[j]);
        if (latLngs.length >= 2) {
          lineLatLngs.push(latLngs);
        }
      }
      if (!lineLatLngs.length) return;

      var totalLength = 0;
      for (var k = 0; k < lineLatLngs.length; k++) {
        totalLength += computeLineLengthMeters(lineLatLngs[k]);
      }
      if (totalLength <= 0) return;

      var minDistance = Math.min(BASE_MIN_DISTANCE, Math.max(35, totalLength / 2.8));

      var targets = computeLabelTargets(totalLength, 1);
      if (!targets.length) return;

      var placed = [];
      for (var t = 0; t < targets.length; t++) {
        var position = locatePointAlongLines(lineLatLngs, targets[t]);
        if (!position) continue;

        var candidateLatLng = L.latLng(position.lat, position.lng);
        var tooClose = placed.some(function (latLng) {
          return latLng.distanceTo(candidateLatLng) < minDistance;
        });

        if (tooClose) {
          var forwardTarget = Math.min(totalLength * 0.99, Math.max(0, targets[t] + totalLength * 0.2));
          if (forwardTarget > targets[t]) {
            var forwardPos = locatePointAlongLines(lineLatLngs, forwardTarget);
            if (forwardPos) {
              var forwardLatLng = L.latLng(forwardPos.lat, forwardPos.lng);
              if (!placed.some(function (latLng) { return latLng.distanceTo(forwardLatLng) < minDistance; })) {
                position = forwardPos;
                candidateLatLng = forwardLatLng;
                tooClose = false;
              }
            }
          }
        }

        if (tooClose) {
          var backwardTarget = Math.max(0, Math.min(targets[t], targets[t] - totalLength * 0.2));
          if (backwardTarget < targets[t]) {
            var backwardPos = locatePointAlongLines(lineLatLngs, backwardTarget);
            if (backwardPos) {
              var backwardLatLng = L.latLng(backwardPos.lat, backwardPos.lng);
              if (!placed.some(function (latLng) { return latLng.distanceTo(backwardLatLng) < minDistance; })) {
                position = backwardPos;
                candidateLatLng = backwardLatLng;
                tooClose = false;
              }
            }
          }
        }

        if (tooClose && placed.length < 2) {
          tooClose = false;
        }

        if (tooClose) continue;

        var marker = createRouteLabelMarker(entry.meta, position, routeId);
        if (!marker) continue;

        entry.labelLayer.addLayer(marker);
        placed.push(marker.getLatLng());
      }

      var layers = entry.labelLayer.getLayers();
      if (!layers.length) {
        var midpoint = locatePointAlongLines(lineLatLngs, totalLength / 2);
        if (midpoint) {
          var fallbackMid = createRouteLabelMarker(entry.meta, midpoint, routeId);
          if (fallbackMid) {
            entry.labelLayer.addLayer(fallbackMid);
            layers = entry.labelLayer.getLayers();
          }
        }
      }
    });
  }


  function loadRoutes() {
    fetchJson('/api/routes.geojson')
      .then(function (gj) {
        if (!isFeatureCollection(gj)) throw new Error('Invalid routes response');

        clearRoutes();
        var features = gj.features || [];
        if (!features.length) {
          updateBanner('routes', 'No routes available. Run npm run build:data.');
          return;
        }

        var combinedBounds = null;
        var overlapCandidates = [];

        features.forEach(function (feat) {
          var props = feat.properties || {};
          var routeId = props.route_id || props.shape_id || 'route';
          var meta = getRouteMeta(routeId, props);

          var entry = routeLayers[routeId];
          if (!entry) {
            var layerGroup = L.layerGroup();
            routesGroup.addLayer(layerGroup);
            entry = routeLayers[routeId] = { layer: layerGroup, visible: true };
            entry.labelLayer = L.layerGroup();
            entry.labelGeometries = [];
            entry.overlapLayers = [];
            layerGroup.addLayer(entry.labelLayer);
          } else {
            if (!entry.labelLayer) {
              entry.labelLayer = L.layerGroup();
              entry.layer.addLayer(entry.labelLayer);
            }
            if (!entry.labelGeometries) {
              entry.labelGeometries = [];
            }
            if (!entry.overlapLayers) {
              entry.overlapLayers = [];
            } else if (entry.overlapLayers.length) {
              entry.overlapLayers.forEach(function (layer) {
                if (layer && entry.layer && typeof entry.layer.removeLayer === 'function') {
                  entry.layer.removeLayer(layer);
                }
              });
              entry.overlapLayers.length = 0;
            }
          }
          entry.meta = meta;

          if (!feat.geometry || !hasLineGeometry(feat.geometry)) {
            return;
          }

          overlapCandidates.push({ routeId: routeId, feature: feat });

          var onlyLinework = function (feature) {
            var geom = feature && feature.geometry;
            if (!geom || !geom.type) return false;
            if (geom.type === 'Point' || geom.type === 'MultiPoint') return false;
            if (geom.type === 'GeometryCollection') {
              return hasLineGeometry(geom);
            }
            return geom.type.indexOf('LineString') !== -1;
          };

          var offsetMeters = meta.offsetMeters || 0;
          var featureForDisplay = feat;
          if (Number.isFinite(offsetMeters) && offsetMeters !== 0) {
            var newGeom = offsetGeometry(feat.geometry, offsetMeters);
            if (newGeom) {
              featureForDisplay = cloneFeatureWithGeometry(feat, newGeom);
            }
          }

          if (featureForDisplay && featureForDisplay.geometry && entry.labelGeometries) {
            entry.labelGeometries.push(featureForDisplay.geometry);
          }

          var outline = L.geoJSON(featureForDisplay, {
            pane: 'routeOutlinePane',
            interactive: false,
            smoothFactor: 1.5,
            filter: onlyLinework,
            style: function () {
              return { color: '#ffffff', weight: 11, opacity: 0.85, lineJoin: 'round', lineCap: 'round' };
            }
          });

          var segment = L.geoJSON(featureForDisplay, {
            pane: 'routePane',
            interactive: false,
            smoothFactor: 1.5,
            filter: onlyLinework,
            style: function () {
              return { color: meta.color, weight: 6.4, opacity: 0.95, lineJoin: 'round', lineCap: 'round' };
            }
          });

          if (outline.getLayers().length) {
            outline.addTo(entry.layer);
          }
          if (segment.getLayers().length) {
            segment.addTo(entry.layer);
          }
          var segBounds = segment.getBounds();
          if (segBounds && segBounds.isValid()) {
            if (!combinedBounds) {
              combinedBounds = segBounds;
            } else {
              combinedBounds.extend(segBounds);
            }
          }
        });

        renderRouteOverlaps(overlapCandidates);

        buildRouteLabels();
        renderRouteLegend();
        updateBanner('routes', null);
        if (combinedBounds && combinedBounds.isValid()) {
          map.fitBounds(combinedBounds, { padding: [12, 12] });
        }

        Object.keys(routeLayers).forEach(function (routeId) {
          applyRouteVisibilityToVehicles(routeId);
        });
      })
      .catch(function (err) {
        console.error('Failed to load routes:', err);
        var msg = err && err.message ? err.message : 'Routes data unavailable. Run npm run build:data.';
        updateBanner('routes', 'Routes unavailable: ' + msg);
      });
  }

  function updateVehicles(list) {
    var now = Date.now();

    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;

      var routeId = v.route_id || 'route';
      var meta = getRouteMeta(routeId);
      var markerData = markers[v.id];
      var bearing = resolveVehicleBearing(v, markerData);
      var bearingToken = bearing === null ? 'na' : bearing.toFixed(1);
      var signature = meta.displayName + '|' + meta.color + '|' + meta.textColor + '|' + bearingToken;

      if (!markerData) {
        var icon = createBusIcon(meta, bearing);
        var mk = L.marker([v.lat, v.lon], {
          icon: icon,
          title: meta.longName ? meta.displayName + ' - ' + meta.longName : 'Route ' + meta.displayName,
          pane: 'vehiclePane',
          riseOnHover: true
        }).addTo(vehicleLayer);
        mk.bindPopup('Bus ' + (v.id || 'Unknown') + '<br/>Route ' + meta.displayName + (meta.longName ? ' - ' + meta.longName : ''));
        markerData = markers[v.id] = {
          marker: mk,
          routeId: routeId,
          iconSignature: signature,
          lastLat: v.lat,
          lastLon: v.lon,
          lastSeen: now,
          bearing: bearing
        };
      } else {
        animateMove(markerData.marker, [markerData.lastLat, markerData.lastLon], [v.lat, v.lon], pollMs * 0.95);
        markerData.routeId = routeId;
        markerData.lastLat = v.lat;
        markerData.lastLon = v.lon;
        markerData.lastSeen = now;
        markerData.bearing = bearing;
        if (markerData.iconSignature !== signature) {
          markerData.marker.setIcon(createBusIcon(meta, bearing));
          markerData.marker.setPopupContent('Bus ' + (v.id || 'Unknown') + '<br/>Route ' + meta.displayName + (meta.longName ? ' - ' + meta.longName : ''));
          markerData.iconSignature = signature;
        }
      }

      markerData.marker.setOpacity(isRouteVisible(routeId) ? 1 : 0);
    }

    Object.keys(markers).forEach(function (id) {
      if (now - markers[id].lastSeen > 60000) {
        vehicleLayer.removeLayer(markers[id].marker);
        delete markers[id];
      }
    });
  }

  function animateMove(marker, from, to, duration) {
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      var lat = from[0] + (to[0] - from[0]) * t;
      var lon = from[1] + (to[1] - from[1]) * t;
      marker.setLatLng([lat, lon]);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function startVehiclesPoll() {
    function tick() {
      fetchJson('/api/vehicles.json')
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          updateBanner('vehicles', null);
          updateVehicles(data.vehicles || []);
        })
        .catch(function (err) {
          console.error('Failed to load vehicles:', err);
          updateBanner('vehicles', bannerDefaultText || 'Live data unavailable, retrying');
        })
        .finally(function () {
          setTimeout(tick, pollMs);
        });
    }
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();







