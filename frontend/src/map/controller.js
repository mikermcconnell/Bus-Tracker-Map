import { clusterVehicles, DEFAULT_CLUSTER_THRESHOLD_METERS, distanceBetweenMeters } from './vehicle-groups.js';

export function createMapController({ dataClient, ui }) {
  var map, routesGroup, vehicleLayer, highlightLayer, majorRoadLineLayer, majorRoadLabelLayer;
  var pollMs = 10000;
  var tileUrl;
  var basePath = '/';
  var routeLayers = {};
  var routeMetadata = {};
  var routeKeyIndex = {};
  var markers = {}; // key -> marker metadata
  var vehicleClusterThreshold = DEFAULT_CLUSTER_THRESHOLD_METERS;
  var anonymousVehicleCounter = 0;
  var COMBINED_MARKER_Z_OFFSET = 1200;
  var SINGLE_MARKER_Z_OFFSET = 0;
  var highlightedStopKeys = ['725', '330', '333', '76', '777', '488', '9002', '1'];
  var stopHighlightOverrides = {
    '9005': {
      cssOffsets: { x: '-50%', y: '-50%' },
      label: 'Barrie Allandale Transit Terminal',
      shortLabel: 'BATT',
      note: 'You Are Here'
    },
    '725': {
      label: 'Barrie South GO',
      shortLabel: 'BSG'
    },
    '330': {
      label: 'Georgian College',
      shortLabel: 'GC',
      labelCoords: { lat: 44.4165781268583, lng: -79.6754198957161 },
      offsetPx: { x: 0, y: 0 }
    },
    '333': {
      label: 'Royal Victoria Hospital',
      shortLabel: 'RVH'
    },
    '76': {
      label: 'Georgian Mall',
      shortLabel: 'GM',
      labelCoords: { lat: 44.4118745345584, lng: -79.7211518849986 },
      offsetPx: { x: 0, y: 0 }
    },
    '777': {
      label: 'Park Place',
      shortLabel: 'PP',
      labelCoords: { lat: 44.3403906345005, lng: -79.6928865258419 },
      offsetPx: { x: 0, y: 0 }
    },
    '488': {
      label: 'Peggy Hill Community Centre',
      shortLabel: 'PHCC',
      cssOffsets: { x: '-55%', y: '-20%' },
      labelCoords: { lat: 44.34436966587496, lng: -79.71668472 },
      offsetPx: { x: 0, y: 0 }
    },
    '9002': {
      label: 'Barrie Allandale Transit Terminal',
      shortLabel: 'BATT',
      note: 'You Are Here',
      coords: { lat: 44.3740170437343, lng: -79.6899831810679 },
      labelCoords: { lat: 44.375813666084284, lng: -79.6849561868082 },
      offsetPx: { x: 0, y: 0 }
    },
    '1': {
      label: 'Downtown Barrie',
      shortLabel: 'DB',
      labelCoords: { lat: 44.387588, lng: -79.68660088028756 },
      offsetPx: { x: 0, y: 0 }
    }
  };

  var routeLaneOverrides = {};

  var routeLabelOffsetOverrides = {
    '8': 26,
    '10': -20,
    '100': 18,
    '101': 22
  };

  var hiddenRouteLabels = {
    '7B': true
  };

  var routeLabelCountOverrides = {
    '100': 2,
    '11': 2,
    '8': 3
  };

  var routeLabelTargetOverrides = {
    '100': [0.27, 0.74],
    '11': [0.24, 0.72]
  };

  var routeLabelBudgetOverrides = {
    '2': 1,
    '400': 1
  };


  var MAJOR_ROAD_LABEL_MIN_ZOOM = 12;
  var MAJOR_ROAD_LABEL_REPEAT_DISTANCE_METERS = 1400;
  var MAJOR_ROAD_LABEL_MIN_LENGTH_FOR_REPEAT = 900;
  var MAJOR_ROAD_LABEL_MAX_COUNT = 5;
  var MAJOR_ROAD_LABEL_MIN_SPACING_METERS = 600;
  var MAJOR_ROAD_LABEL_MANUAL_LIMITS = {
    'BAYFIELD STREET': 2,
    'BIG BAY POINT ROAD': 1,
    'MAPLEVIEW DRIVE EAST': 1,
    'MAPLEVIEW DRIVE WEST': 1,
    'HURONIA ROAD': 2,
    'DUNLOP STREET EAST': 1,
    'DUNLOP STREET WEST': 1,
    'ESSA ROAD': 2,
    'CUNDLES ROAD EAST': 1,
    'DUCKWORTH STREET': 0,
    'YONGE STREET': 2,
    'LAKESHORE DRIVE': 0,
    'LAKE SHORE ROAD': 0
  };
  var MAJOR_ROAD_LABEL_MANUAL_ANCHORS = {
    'YONGE STREET': [
      { lat: 44.3699307, lng: -79.668287 }
    ],
    'ESSA ROAD': [
      { lat: 44.3600686, lng: -79.6975765 }
    ]
  };
  var MAJOR_ROAD_LABEL_MANUAL_OFFSETS = {
    'DUNLOP STREET EAST': { distanceMeters: 500, bearingDegrees: 90 },
    'DUNLOP STREET WEST': { distanceMeters: 500, bearingDegrees: 90 },
    'ANNE STREET': { distanceMeters: 300, bearingDegrees: 180 },
    'YONGE STREET': { distanceMeters: 300, bearingDegrees: 135 }
  };
  var DEFAULT_VISIBLE_ROUTE_IDS = ['7A', '7B', '8A', '8B', '12A', '12B'];
  var DEFAULT_VISIBLE_ROUTE_KEYS = (function () {
    var map = Object.create(null);
    for (var i = 0; i < DEFAULT_VISIBLE_ROUTE_IDS.length; i++) {
      var key = normalizeRouteKey(DEFAULT_VISIBLE_ROUTE_IDS[i]);
      if (key) {
        map[key] = true;
      }
    }
    return map;
  })();
  var ROUTE_OFFSET_SCALE = 0;
  var ROUTE_LABELS_ENABLED = false;
  var LABEL_CLUSTER_SPACING_METERS = 45;
  var LABEL_CLUSTER_KEY_SCALE = 10000;
  var ROUTE_OVERLAP_TOLERANCE = 0.00018; // ~20 meters to capture near-coincident lines
  var ROUTE_OVERLAP_DASH = 22;
  var EARTH_RADIUS_METERS = 6371008.8;
  // Terminal focus constants keep the inset map centered on Barrie Allandale Transit Terminal.
  var TERMINAL_COORDS = { lat: 44.3740170437343, lng: -79.6899831810679 };
  var TERMINAL_RADIUS_METERS = 150;
  var MINI_MAP_MEDIA_QUERY = '(min-width: 1025px) and (min-height: 721px)';
  var MINI_MAP_ZOOM = 16.5;

  var miniMapContainer = null;
  var miniMapCanvas = null;
  var miniMapMediaQueryList = null;
  var miniMapInitialized = false;
  var miniMapActive = false;
  var miniMapVehiclesVisible = true;
  var miniMap = null;
  var miniVehicleLayer = null;
  var miniBorderLayer = null;
  var miniMarkers = Object.create(null);
  var terminalOutline = null;
  var lastMiniSnapshots = [];

  function initialize() {
    var DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    tileUrl = DEFAULT_TILE_URL;

    ui.showBanner('routes', 'Loading map…');
    ui.showBanner('vehicles', 'Loading vehicles…');

    return dataClient.fetchConfig()
      .then(function (cfg) {
        if (cfg && typeof cfg === 'object') {
          if (cfg.poll_ms) {
            var parsedPollMs = Number(cfg.poll_ms);
            if (Number.isFinite(parsedPollMs) && parsedPollMs > 0) {
              pollMs = parsedPollMs;
            }
          }
          if (cfg.tiles) {
            tileUrl = cfg.tiles;
          }
          if (cfg.base_path) {
            basePath = cfg.base_path;
            dataClient.setBasePath(basePath);
          }
        }
      })
      .catch(function (err) {
        console.warn('Using default configuration (config fetch failed):', err && err.message ? err.message : err);
      })
      .then(function () {
        setupMap();
        ui.setupLegend(createLegendContext());
        return Promise.all([
          loadMajorRoads(),
          loadRoutes(),
          loadStopHighlights()
        ]).finally(function () {
          startVehiclesPoll();
        });
      });
  }

  function setupMap() {
    map = L.map('map', { zoomControl: true, zoomSnap: 0.5, zoomDelta: 0.5 }).setView([44.3894, -79.6903], 13);
    map.zoomControl.setPosition('bottomright');

    map.createPane('majorRoadPane');
    map.getPane('majorRoadPane').style.zIndex = 410;
    map.getPane('majorRoadPane').style.pointerEvents = 'none';

    map.createPane('majorRoadLabelPane');
    map.getPane('majorRoadLabelPane').style.zIndex = 434;
    map.getPane('majorRoadLabelPane').style.pointerEvents = 'none';

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
    map.getPane('vehiclePane').style.zIndex = 460;

    map.createPane('stopHighlightPane');
    map.getPane('stopHighlightPane').style.zIndex = 500;
    map.getPane('stopHighlightPane').style.pointerEvents = 'none';

    L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution: ' OpenStreetMap contributors',
      opacity: 0.34,
      detectRetina: true
    }).addTo(map);
    majorRoadLineLayer = L.layerGroup().addTo(map);
    majorRoadLabelLayer = L.layerGroup();
    routesGroup = L.layerGroup().addTo(map);
    vehicleLayer = L.layerGroup().addTo(map);
    highlightLayer = L.layerGroup().addTo(map);
    map.on('zoomend', updateMajorRoadLabelVisibility);
    updateMajorRoadLabelVisibility();
    initializeMiniMapSupport();
  }

  // Set up responsive listeners for the inset mini-map so it only appears on roomy layouts.
  function initializeMiniMapSupport() {
    if (miniMapInitialized) return;
    miniMapContainer = document.getElementById('mini-map');
    miniMapCanvas = document.getElementById('mini-map-canvas');
    if (!miniMapContainer || !miniMapCanvas) return;

    miniMapInitialized = true;
    miniMapMediaQueryList = window.matchMedia(MINI_MAP_MEDIA_QUERY);
    if (miniMapMediaQueryList) {
      var handler = handleMiniMapMediaChange;
      if (typeof miniMapMediaQueryList.addEventListener === 'function') {
        miniMapMediaQueryList.addEventListener('change', handler);
      } else if (typeof miniMapMediaQueryList.addListener === 'function') {
        miniMapMediaQueryList.addListener(handler);
      }
      handleMiniMapMediaChange();
    } else {
      setMiniMapActive(true);
    }
  }

  function handleMiniMapMediaChange() {
    var shouldEnable = miniMapMediaQueryList ? miniMapMediaQueryList.matches : true;
    setMiniMapActive(shouldEnable);
  }

  function setMiniMapActive(shouldEnable) {
    if (!!shouldEnable === miniMapActive) return;
    miniMapActive = !!shouldEnable;
    if (miniMapActive) {
      if (miniMapContainer) miniMapContainer.classList.remove('mini-map--hidden');
      createMiniMapInstance();
      syncMiniMapMarkers(lastMiniSnapshots);
    } else {
      if (miniMapContainer) miniMapContainer.classList.add('mini-map--hidden');
      clearMiniMapMarkers();
      destroyMiniMapInstance();
    }
    updateTerminalOutlineVisibility();
  }

  function createMiniMapInstance() {
    if (miniMap || !miniMapCanvas) return;
    miniMap = L.map(miniMapCanvas, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomAnimation: false,
      touchZoom: false,
      tap: false,
      zoomSnap: 0.5,
      zoomDelta: 0.5
    }).setView([TERMINAL_COORDS.lat, TERMINAL_COORDS.lng], MINI_MAP_ZOOM);

    L.tileLayer(tileUrl, {
      maxZoom: 20,
      attribution: ' OpenStreetMap contributors',
      opacity: 1,
      detectRetina: true,
      interactive: false
    }).addTo(miniMap);

    miniVehicleLayer = L.layerGroup().addTo(miniMap);
    miniBorderLayer = L.layerGroup().addTo(miniMap);
    // Keep the layout crisp even if the container animates into view.
    requestAnimationFrame(function () {
      if (miniMap) miniMap.invalidateSize();
    });
  }

  function destroyMiniMapInstance() {
    if (miniBorderLayer) {
      miniBorderLayer.clearLayers();
      miniBorderLayer = null;
    }
    if (miniVehicleLayer) {
      miniVehicleLayer.clearLayers();
      miniVehicleLayer = null;
    }
    miniMarkers = Object.create(null);
    if (miniMap) {
      miniMap.remove();
      miniMap = null;
    }
  }

  function clearMiniMapMarkers() {
    if (miniVehicleLayer) {
      miniVehicleLayer.clearLayers();
    }
    miniMarkers = Object.create(null);
  }

  function setMiniMapVehicleVisibility(visible) {
    miniMapVehiclesVisible = !!visible;
    if (!miniMapVehiclesVisible) {
      clearMiniMapMarkers();
    } else if (miniMapActive) {
      syncMiniMapMarkers(lastMiniSnapshots);
    }
  }

  function isWithinTerminalFocus(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return distanceBetweenMeters(lat, lon, TERMINAL_COORDS.lat, TERMINAL_COORDS.lng) <= TERMINAL_RADIUS_METERS;
  }

  function addTerminalPerimeter(layer, overrides) {
    if (!layer) return null;
    var opts = {
      radius: TERMINAL_RADIUS_METERS,
      color: 'rgba(15, 116, 204, 0.9)',
      weight: 3,
      dashArray: '6 6',
      fillOpacity: 0,
      fill: false,
      interactive: false
    };
    if (overrides && typeof overrides === 'object') {
      Object.keys(overrides).forEach(function (key) {
        opts[key] = overrides[key];
      });
    }
    return L.circle([TERMINAL_COORDS.lat, TERMINAL_COORDS.lng], opts).addTo(layer);
  }



  // Keep the terminal outline in sync on the main map so it mirrors the inset state.
  function updateTerminalOutlineVisibility() {
    if (!highlightLayer) return;
    if (miniMapActive) {
      if (!terminalOutline) {
        terminalOutline = addTerminalPerimeter(highlightLayer, {
          pane: 'stopHighlightPane',
          weight: 3,
          dashArray: '8 8',
          color: 'rgba(12, 111, 198, 0.85)'
        });
      }
    } else if (terminalOutline) {
      highlightLayer.removeLayer(terminalOutline);
      terminalOutline = null;
    }
  }

  // Render only the vehicles that are close enough to the terminal for the inset map to matter.
  function syncMiniMapMarkers(snapshots) {
    lastMiniSnapshots = Array.isArray(snapshots) ? snapshots.slice() : [];
    if (!miniMapActive || !miniMapVehiclesVisible || !miniVehicleLayer) {
      clearMiniMapMarkers();
      return;
    }

    var seen = Object.create(null);
    for (var i = 0; i < lastMiniSnapshots.length; i++) {
      var entry = lastMiniSnapshots[i];
      if (!entry) continue;
      var vehicle = entry.vehicle;
      var meta = entry.meta;
      var key = entry.key;
      if (!vehicle || !meta || !key) continue;
      if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
      if (!isWithinTerminalFocus(vehicle.lat, vehicle.lon)) continue;

      seen[key] = true;
      var existing = miniMarkers[key];
      var bearing = Number.isFinite(vehicle.bearing) ? vehicle.bearing : null;
      var icon = createBusIcon(meta, bearing);
      var signature = icon && icon.options ? icon.options.html : '';

      if (!existing) {
        var marker = L.marker([vehicle.lat, vehicle.lon], {
          icon: icon,
          interactive: false
        }).addTo(miniVehicleLayer);
        miniMarkers[key] = {
          marker: marker,
          signature: signature
        };
      } else {
        existing.marker.setLatLng([vehicle.lat, vehicle.lon]);
        if (signature && existing.signature !== signature) {
          existing.marker.setIcon(icon);
          existing.signature = signature;
        }
      }
    }

    Object.keys(miniMarkers).forEach(function (key) {
      if (seen[key]) return;
      var record = miniMarkers[key];
      if (record && record.marker && miniVehicleLayer) {
        miniVehicleLayer.removeLayer(record.marker);
      }
      delete miniMarkers[key];
    });
  }

  function createLegendContext() {
    return {
      getRouteIds: getSortedRouteIds,
      getRouteLayers: function () { return routeLayers; },
      getRouteMeta: getRouteMeta,
      setRouteVisibility: setRouteVisibility,
      showVehicles: function () {
        if (map && vehicleLayer && !map.hasLayer(vehicleLayer)) {
          vehicleLayer.addTo(map);
        }
        setMiniMapVehicleVisibility(true);
      },
      hideVehicles: function () {
        if (map && vehicleLayer && map.hasLayer(vehicleLayer)) {
          map.removeLayer(vehicleLayer);
        }
        setMiniMapVehicleVisibility(false);
      },
      isVehiclesVisible: function () {
        if (!map || !vehicleLayer) return false;
        return map.hasLayer(vehicleLayer);
      },
      getStopLegendEntries: getStopLegendEntries
    };
  }

  function loadMajorRoads() {
    if (!majorRoadLineLayer || !majorRoadLabelLayer) return Promise.resolve();

    return dataClient.fetchMajorRoads()
      .then(function (geojson) {
        majorRoadLineLayer.clearLayers();
        majorRoadLabelLayer.clearLayers();
        geojson = appendManualMajorRoads(geojson);

        L.geoJSON(geojson, {
          pane: 'majorRoadPane',
          style: function () {
            return {
              color: '#4a4a4a',
              weight: 2.5,
              opacity: 0.85,
              lineCap: 'round',
              lineJoin: 'round'
            };
          },
          onEachFeature: function (feature, layer) {
            addMajorRoadLabel(feature, layer);
          }
        }).addTo(majorRoadLineLayer);

        updateMajorRoadLabelVisibility();
      })
      .catch(function (err) {
        console.warn('Major road data unavailable', err);
      });
  }

  function appendManualMajorRoads(geojson) {
    if (!geojson || typeof geojson !== 'object' || geojson === null) return geojson;
    if (!Array.isArray(geojson.features)) {
      geojson.features = [];
    }
    var features = geojson.features;
    var existing = Object.create(null);
    for (var i = 0; i < features.length; i++) {
      var feature = features[i];
      if (!feature || !feature.properties || !feature.properties.name) continue;
      var key = String(feature.properties.name).trim().toUpperCase();
      if (key) {
        existing[key] = true;
      }
    }

    var manual = [
      {
        type: 'Feature',
        properties: {
          name: 'Bradford Street',
          manual: true
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-79.6937164, 44.3813612],
            [-79.6937486, 44.3822714],
            [-79.6938303, 44.3832465],
            [-79.6938775, 44.3840292],
            [-79.6939289, 44.385048],
            [-79.6940083, 44.3860846],
            [-79.6940519, 44.3866546],
            [-79.6940682, 44.3868676]
          ]
        }
      },
      {
        type: 'Feature',
        properties: {
          name: 'Anne Street',
          manual: true
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-79.7041077, 44.3812583],
            [-79.7043268, 44.3815107],
            [-79.7045358, 44.3817515],
            [-79.7045763, 44.3817981],
            [-79.7048056, 44.3820623],
            [-79.70493, 44.3822056],
            [-79.7052025, 44.3825195],
            [-79.7052878, 44.3826178],
            [-79.7054618, 44.3828267],
            [-79.7055323, 44.3829113],
            [-79.7057212, 44.3831382],
            [-79.7060608, 44.3835459],
            [-79.7065168, 44.3840588],
            [-79.7067694, 44.3843443]
          ]
        }
      }
    ];

    for (var j = 0; j < manual.length; j++) {
      var addition = manual[j];
      if (!addition || !addition.properties || !addition.properties.name) continue;
      var manualKey = String(addition.properties.name).trim().toUpperCase();
      if (!manualKey || existing[manualKey]) continue;
      features.push(addition);
      existing[manualKey] = true;
    }

    return geojson;
  }

  function simplifyRoadName(name) {
    if (!name) return '';
    var cleaned = String(name);
    cleaned = cleaned.replace(/\b(NORTH|SOUTH|EAST|WEST|N|S|E|W)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(STREET|ST|ROAD|RD|DRIVE|DR|AVENUE|AVE|BOULEVARD|BLVD|COURT|CT|TERRACE|TER|LANE|LN|WAY|PLACE|PKWY|PARKWAY|HIGHWAY|HWY|CIRCLE|CIR|TRAIL|TRL|CRESCENT|CRES|ROW|CLOSE|BYPASS)\b/gi, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (!cleaned) return String(name).trim();
    return cleaned;
  }

  function addMajorRoadLabel(feature, layer) {
    if (!feature || !feature.properties || !feature.properties.name) return;
    var anchors = computeMajorRoadLabelAnchors(feature, layer);
    if (!anchors || !anchors.length) return;
    var rawName = feature.properties.name;
    var displayName = simplifyRoadName(rawName);
    if (!displayName) {
      displayName = rawName;
    }
    if (rawName && /^St\.?\s+Vincent\b/i.test(rawName)) {
      displayName = 'St. Vincent';
    }
    if (displayName && displayName.trim().toUpperCase() === 'FURTHER SOUTH') {
      return;
    }
    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      var label = L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'major-road-label',
        pane: 'majorRoadLabelPane',
        offset: [0, 0],
        opacity: 1
      })
        .setLatLng({ lat: anchor.lat, lng: anchor.lng })
        .setContent(displayName);
      (function (anchorRef, labelRef) {
        labelRef.on('add', function () {
          var el = labelRef.getElement();
          if (!el) return;
          var angleToken = formatMajorRoadAngle(anchorRef.bearing);
          if (angleToken) {
            el.style.setProperty('--major-road-angle', angleToken);
          } else {
            el.style.removeProperty('--major-road-angle');
          }
        });
      })(anchor, label);
      majorRoadLabelLayer.addLayer(label);
    }
  }

  function computeMajorRoadLabelAnchors(feature, layer) {
    var geometry = feature && feature.geometry;
    var lineStrings = collectGeometryLineStrings(geometry);
    var lineLatLngs = [];
    for (var i = 0; i < lineStrings.length; i++) {
      var latLngs = convertCoordsToLatLngs(lineStrings[i]);
      if (latLngs.length) {
        lineLatLngs.push(latLngs);
      }
    }

    var totalLength = 0;
    for (var j = 0; j < lineLatLngs.length; j++) {
      totalLength += computeLineLengthMeters(lineLatLngs[j]);
    }

    var roadName = feature && feature.properties && feature.properties.name;
    var roadKey = roadName ? String(roadName).trim().toUpperCase() : '';
    if (roadKey === 'LAKESHORE DRIVE' || roadKey === 'LAKE SHORE ROAD') {
      return [];
    }
    var manualAnchorDefs = MAJOR_ROAD_LABEL_MANUAL_ANCHORS[roadKey] || null;
    var manualAnchors = [];
    if (manualAnchorDefs && manualAnchorDefs.length) {
      for (var m = 0; m < manualAnchorDefs.length; m++) {
        var manual = manualAnchorDefs[m];
        if (!manual) continue;
        var manualLat = Number(manual.lat);
        var manualLng = Number(manual.lng);
        if (!Number.isFinite(manualLat) || !Number.isFinite(manualLng)) continue;
        var manualBearing = Number.isFinite(manual.bearing) ? Number(manual.bearing) : null;
        manualAnchors.push({ lat: manualLat, lng: manualLng, bearing: manualBearing });
      }
    }
    var anchors = [];
    if (roadKey === 'ESSA ROAD') {
      var essaAnchor = computeMajorRoadGeometryAnchor(geometry);
      if (essaAnchor && Number.isFinite(essaAnchor.lat) && Number.isFinite(essaAnchor.lng)) {
        var relocated = offsetLatLngByBearing(essaAnchor.lat, essaAnchor.lng, 1000, 225);
        if (relocated) {
          return [{ lat: relocated.lat, lng: relocated.lng, bearing: essaAnchor.bearing }];
        }
      }
    }
    if (roadKey === 'YONGE STREET' && totalLength > 0) {
      var customDistance = totalLength > 4000 ? 4000 : totalLength * 0.95;
      if (customDistance <= 0) {
        customDistance = totalLength * 0.5;
      }
      var customPoint = locatePointAlongLines(lineLatLngs, customDistance);
      if (customPoint) {
        anchors.push({ lat: customPoint.lat, lng: customPoint.lng, bearing: customPoint.bearing });
      }
    }
    var desiredCount = computeMajorRoadLabelCount(totalLength, roadName);
    if (desiredCount <= 0) {
      return [];
    }
    if (desiredCount > 1) {
      for (var idx = 0; idx < desiredCount; idx++) {
        var target = totalLength * (idx + 1) / (desiredCount + 1);
        var point = locatePointAlongLines(lineLatLngs, target);
        if (point) {
          anchors.push({ lat: point.lat, lng: point.lng, bearing: point.bearing });
        }
      }
    } else if (desiredCount === 1) {
      var fallback = computeMajorRoadGeometryAnchor(geometry);
      if (fallback) anchors.push(fallback);
    }

    if (!anchors.length) {
      var backup = computeMajorRoadGeometryAnchor(geometry);
      if (backup) anchors.push(backup);
    }
    if (!anchors.length && layer && layer.getBounds) {
      var bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        var center = bounds.getCenter();
        anchors.push({ lat: center.lat, lng: center.lng });
      }
    }
    var combinedAnchors = manualAnchors.length ? manualAnchors.concat(anchors) : anchors;
    var offsetConfig = MAJOR_ROAD_LABEL_MANUAL_OFFSETS[roadKey];
    if (offsetConfig && Number.isFinite(offsetConfig.distanceMeters) && Number.isFinite(offsetConfig.bearingDegrees)) {
      combinedAnchors = combinedAnchors.map(function (anchor) {
        if (!anchor) return anchor;
        var moved = offsetLatLngByBearing(anchor.lat, anchor.lng, offsetConfig.distanceMeters, offsetConfig.bearingDegrees);
        if (!moved) return anchor;
        return { lat: moved.lat, lng: moved.lng, bearing: anchor.bearing };
      });
    }
    return filterMajorRoadAnchors(combinedAnchors.length ? combinedAnchors : anchors);
  }

  function computeMajorRoadLabelCount(totalLength, roadName) {
    if (!Number.isFinite(totalLength) || totalLength <= 0) return 0;
    var manualLimit = resolveMajorRoadLabelManualLimit(roadName);
    if (manualLimit !== null) {
      return Math.max(0, Math.floor(manualLimit));
    }
    if (totalLength < MAJOR_ROAD_LABEL_MIN_LENGTH_FOR_REPEAT) return 1;
    var count = Math.floor(totalLength / MAJOR_ROAD_LABEL_REPEAT_DISTANCE_METERS) + 1;
    count = Math.max(1, count);
    count = Math.min(MAJOR_ROAD_LABEL_MAX_COUNT, count);
    return count;
  }

  function resolveMajorRoadLabelManualLimit(name) {
    if (!name && name !== 0) return null;
    var key = String(name).trim().toUpperCase();
    if (!key) return null;
    if (!Object.prototype.hasOwnProperty.call(MAJOR_ROAD_LABEL_MANUAL_LIMITS, key)) {
      return null;
    }
    var value = MAJOR_ROAD_LABEL_MANUAL_LIMITS[key];
    if (!Number.isFinite(value)) return null;
    return value;
  }

  function filterMajorRoadAnchors(anchors) {
    if (!Array.isArray(anchors) || anchors.length <= 1) return anchors || [];
    var results = [];
    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) continue;
      var latLng = L.latLng(anchor.lat, anchor.lng);
      var tooClose = false;
      for (var j = 0; j < results.length; j++) {
        var existing = results[j];
        var existingLatLng = L.latLng(existing.lat, existing.lng);
        if (latLng.distanceTo(existingLatLng) < MAJOR_ROAD_LABEL_MIN_SPACING_METERS) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        results.push(anchor);
      }
    }
    return results.length ? results : anchors.slice(0, 1);
  }

  function resolveMajorRoadLabelAnchor(feature, layer) {
    var anchors = computeMajorRoadLabelAnchors(feature, layer);
    if (anchors && anchors.length) {
      return { lat: anchors[0].lat, lng: anchors[0].lng };
    }
    return null;
  }

  function computeMajorRoadGeometryAnchor(geometry) {
    if (!geometry) return null;
    var lineStrings = collectGeometryLineStrings(geometry);
    if (!lineStrings.length) return null;
    var best = null;
    for (var i = 0; i < lineStrings.length; i++) {
      var candidate = computeLineMidpoint(lineStrings[i]);
      if (!candidate) continue;
      if (!best || candidate.length > best.length) {
        best = candidate;
      }
    }
    return best ? { lat: best.lat, lng: best.lng, bearing: best.bearing } : null;
  }

  function formatMajorRoadAngle(bearing) {
    if (!Number.isFinite(bearing)) return null;
    var normalized = normalizeMajorRoadLabelAngle(bearing);
    if (!Number.isFinite(normalized)) return null;
    return normalized.toFixed(1) + 'deg';
  }

  function normalizeMajorRoadLabelAngle(bearing) {
    if (!Number.isFinite(bearing)) return 0;
    var angle = bearing % 360;
    if (angle < 0) angle += 360;
    if (angle > 180) angle -= 180;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return angle;
  }

  function collectGeometryLineStrings(geometry) {
    var results = [];
    if (!geometry || !geometry.type) return results;
    if (geometry.type === 'LineString') {
      results.push(geometry.coordinates || []);
      return results;
    }
    if (geometry.type === 'MultiLineString') {
      var coords = geometry.coordinates || [];
      for (var i = 0; i < coords.length; i++) {
        if (Array.isArray(coords[i])) {
          results.push(coords[i]);
        }
      }
      return results;
    }
    if (geometry.type === 'GeometryCollection') {
      var geoms = geometry.geometries || [];
      for (var j = 0; j < geoms.length; j++) {
        var sub = collectGeometryLineStrings(geoms[j]);
        if (sub.length) {
          Array.prototype.push.apply(results, sub);
        }
      }
    }
    return results;
  }

  function computeLineMidpoint(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    var latlngs = [];
    for (var i = 0; i < coords.length; i++) {
      var coord = coords[i];
      if (!Array.isArray(coord) || coord.length < 2) continue;
      var lng = Number(coord[0]);
      var lat = Number(coord[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      latlngs.push(L.latLng(lat, lng));
    }
    if (latlngs.length === 0) return null;
    if (latlngs.length === 1) {
      return { lat: latlngs[0].lat, lng: latlngs[0].lng, length: 0, bearing: 0 };
    }

    var total = 0;
    var segments = [];
    for (var k = 0; k < latlngs.length - 1; k++) {
      var start = latlngs[k];
      var end = latlngs[k + 1];
      var segLen = start.distanceTo(end);
      segments.push({ start: start, end: end, length: segLen });
      total += segLen;
    }

    if (total <= 0) {
      var mid = latlngs[Math.floor(latlngs.length / 2)];
      return { lat: mid.lat, lng: mid.lng, length: 0, bearing: 0 };
    }

    var halfway = total / 2;
    var accumulated = 0;
    for (var m = 0; m < segments.length; m++) {
      var segment = segments[m];
      if (segment.length <= 0) continue;
      if (accumulated + segment.length >= halfway) {
        var remainder = halfway - accumulated;
        var t = remainder / segment.length;
        var midLat = segment.start.lat + (segment.end.lat - segment.start.lat) * t;
        var midLng = segment.start.lng + (segment.end.lng - segment.start.lng) * t;
        var bearing = computeBearingBetween(segment.start.lat, segment.start.lng, segment.end.lat, segment.end.lng);
        return { lat: midLat, lng: midLng, length: total, bearing: bearing };
      }
      accumulated += segment.length;
    }

    var lastSegment = segments[segments.length - 1];
    if (!lastSegment) return null;
    var fallbackBearing = computeBearingBetween(lastSegment.start.lat, lastSegment.start.lng, lastSegment.end.lat, lastSegment.end.lng);
    return { lat: lastSegment.end.lat, lng: lastSegment.end.lng, length: total, bearing: fallbackBearing };
  }

  function updateMajorRoadLabelVisibility() {
    if (!map || !majorRoadLabelLayer) return;
    var shouldShow = map.getZoom() >= MAJOR_ROAD_LABEL_MIN_ZOOM;
    var isShowing = map.hasLayer(majorRoadLabelLayer);
    if (shouldShow && !isShowing) {
      majorRoadLabelLayer.addTo(map);
    } else if (!shouldShow && isShowing) {
      majorRoadLabelLayer.removeFrom(map);
    }
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

  function sanitizeStopAttribute(text) {
    var safe = sanitizeStopLabel(text);
    return safe.replace(/"/g, '&quot;');
  }

  function deriveShortLabelFromName(name) {
    if (!name) return '';
    var trimmed = String(name).trim();
    if (!trimmed) return '';
    var words = trimmed.split(/\s+/);
    if (words.length === 1) {
      return words[0].slice(0, 3).toUpperCase();
    }
    var letters = [];
    for (var i = 0; i < words.length && letters.length < 4; i++) {
      if (words[i]) {
        letters.push(words[i][0].toUpperCase());
      }
    }
    if (!letters.length) return trimmed.slice(0, 3).toUpperCase();
    return letters.join('');
  }

  function getStopLegendEntries() {
    var seen = Object.create(null);
    var entries = [];
    for (var i = 0; i < highlightedStopKeys.length; i++) {
      var key = highlightedStopKeys[i];
      var override = stopHighlightOverrides[key] || {};
      var fullName = override.label || '';
      if (!fullName) {
        fullName = 'Stop ' + key;
      }
      var shortLabel = override.shortLabel || deriveShortLabelFromName(fullName);
      if (!shortLabel) continue;
      var normalizedShort = String(shortLabel).trim();
      if (!normalizedShort) continue;
      var dedupeKey = normalizedShort.toUpperCase();
      if (seen[dedupeKey]) continue;
      seen[dedupeKey] = true;
      entries.push({
        id: key,
        shortLabel: normalizedShort,
        fullLabel: fullName
      });
    }
    entries.sort(function (a, b) {
      return a.shortLabel.localeCompare(b.shortLabel);
    });
    return entries;
  }

  function createStopHighlightMarker(feature, identifier) {
    if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) return null;
    var coords = feature.geometry.coordinates;
    if (coords.length < 2) return null;
    var lat = coords[1];
    var lon = coords[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    var props = feature.properties || {};
    var override = stopHighlightOverrides[identifier] || null;
    var rawName = props.stop_name || ('Stop ' + identifier);
    var normalizedRawName = rawName;
    if (identifier === '9005') {
      normalizedRawName = rawName.replace(/\s*Platform\s*\d+$/i, '').trim();
    }
    var fullName = normalizedRawName;
    if (override && override.label) {
      fullName = override.label;
    }
    var displayName = fullName;
    if (override && override.shortLabel) {
      displayName = override.shortLabel;
    }
    var safeDisplayName = sanitizeStopLabel(displayName);
    var safeFullName = sanitizeStopLabel(fullName);
    var safeId = sanitizeStopLabel(identifier);
    var labelHtml = safeDisplayName;
    var noteText = null;
    if (override && override.note) {
      noteText = override.note;
    } else if (identifier === '9005') {
      noteText = 'You Are Here';
    }
    var safeNote = noteText ? sanitizeStopLabel(noteText) : null;
    if (safeNote) {
      labelHtml += '<span class="stop-highlight-note">' + safeNote + '</span>';
    }

    var includeCallout = false;
    var wrapperAttrs = ' data-stop="' + safeId + '"';
    var titleText = fullName;
    if (displayName && displayName !== fullName) {
      titleText = fullName + ' (' + displayName + ')';
    }
    if (noteText) {
      titleText += ' - ' + noteText;
    }
    if (titleText) {
      var safeTitle = sanitizeStopAttribute(titleText);
      wrapperAttrs += ' title="' + safeTitle + '" aria-label="' + safeTitle + '"';
    }
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
      '  <div class="stop-highlight-label">' + labelHtml + '</div>' +
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

    var pixelOffset = { x: 10, y: -5 };
    if (override && override.offsetPx) {
      pixelOffset = override.offsetPx;
    }

    var labelLat = lat;
    var labelLng = lon;
    if (override && override.labelCoords) {
      var customLat = Number(override.labelCoords.lat);
      var customLng = Number(override.labelCoords.lng);
      if (Number.isFinite(customLat) && Number.isFinite(customLng)) {
        labelLat = customLat;
        labelLng = customLng;
      }
    }

    if (map && map.latLngToLayerPoint && map.layerPointToLatLng && (pixelOffset.x || pixelOffset.y)) {
      try {
        var baseLatLng = L.latLng(labelLat, labelLng);
        var layerPoint = map.latLngToLayerPoint(baseLatLng);
        var offsetPoint = L.point(
          layerPoint.x + Number(pixelOffset.x || 0),
          layerPoint.y + Number(pixelOffset.y || 0)
        );
        var offsetLatLng = map.layerPointToLatLng(offsetPoint);
        labelLat = offsetLatLng.lat;
        labelLng = offsetLatLng.lng;
      } catch (err) {
        console.warn('Failed to offset highlight for stop ' + identifier + ':', err);
      }
    }

    var dotMarker = L.circleMarker([lat, lon], {
      radius: 6,
      color: '#202124',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
      opacity: 1,
      pane: 'stopHighlightPane',
      interactive: false
    });

    var labelMarker = L.marker([labelLat, labelLng], markerOptions);

    return L.layerGroup([dotMarker, labelMarker]);
  }

  function loadStopHighlights() {
    if (!highlightLayer) return Promise.resolve();
    highlightLayer.clearLayers();
    return dataClient.fetchStops()
      .then(function (gj) {
        if (!isFeatureCollection(gj)) throw new Error('Invalid stops response');
        var features = Array.isArray(gj.features) ? gj.features : [];
        highlightedStopKeys.forEach(function (key) {
          var match = findStopFeatureByKey(features, key);
          var feature = match ? match.feature : null;
          var override = stopHighlightOverrides[key] || null;
          if (!feature && override && override.coords) {
            var lat = Number(override.coords.lat);
            var lng = Number(override.coords.lng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              feature = {
                type: 'Feature',
                properties: {
                  stop_name: override.label || ('Stop ' + key)
                },
                geometry: {
                  type: 'Point',
                  coordinates: [lng, lat]
                }
              };
            }
          }
          if (!feature) {
            console.warn('Highlight stop not found for key:', key);
            return;
          }
          var marker = createStopHighlightMarker(feature, key);
          if (marker) {
            marker.addTo(highlightLayer);
          }
        });
      })
      .catch(function (err) {
        console.error('Failed to load highlighted stops:', err);
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

  function shouldRouteStartVisible(routeId, props, meta) {
    var candidates = [
      routeId,
      props && props.route_short_name,
      props && props.route_long_name,
      meta && meta.displayName,
      meta && meta.longName
    ];
    for (var i = 0; i < candidates.length; i++) {
      var key = normalizeRouteKey(candidates[i]);
      if (key && DEFAULT_VISIBLE_ROUTE_KEYS[key]) {
        return true;
      }
    }
    return false;
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
    Object.keys(routeLayers).forEach(function (routeId) {
      var entry = routeLayers[routeId];
      if (!entry || !entry.layer || !entry.overlapLayers || !entry.overlapLayers.length) return;

      for (var i = 0; i < entry.overlapLayers.length; i++) {
        var layer = entry.overlapLayers[i];
        if (layer && typeof entry.layer.removeLayer === 'function') {
          entry.layer.removeLayer(layer);
        }
      }
      entry.overlapLayers.length = 0;
    });
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

  function resolveRouteLabelTargets(meta, routeId, totalLength) {
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return null;
    }

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
      if (key && Object.prototype.hasOwnProperty.call(routeLabelTargetOverrides, key)) {
        return normalizeRouteLabelTargets(routeLabelTargetOverrides[key], totalLength);
      }
    }
    return null;
  }

  function normalizeRouteLabelTargets(source, totalLength) {
    if (source === null || source === undefined) return null;
    var values = Array.isArray(source) ? source : [source];
    var results = [];
    for (var i = 0; i < values.length; i++) {
      var raw = Number(values[i]);
      if (!Number.isFinite(raw)) continue;
      var distance = raw;
      if (raw > 0 && raw <= 1) {
        distance = totalLength * raw;
      }
      if (!Number.isFinite(distance)) continue;
      if (distance <= 0) continue;
      distance = Math.max(1, Math.min(distance, totalLength - 1));
      results.push(distance);
    }
    return results.length ? results : null;
  }

  function resolveRouteLabelCount(meta, routeId) {
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
      if (key && Object.prototype.hasOwnProperty.call(routeLabelCountOverrides, key)) {
        return routeLabelCountOverrides[key];
      }
    }
    return 1;
  }

  function resolveRouteLabelBudgetKey(meta) {
    var label = deriveRouteLabelCode(meta);
    if (label) return String(label).trim().toUpperCase();
    if (meta && meta.displayName) return String(meta.displayName).trim().toUpperCase();
    if (meta && meta.id) return String(meta.id).trim().toUpperCase();
    return '';
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

  function computeLabelClusterKey(position) {
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
      return '';
    }
    var latKey = Math.round(position.lat * LABEL_CLUSTER_KEY_SCALE);
    var lngKey = Math.round(position.lng * LABEL_CLUSTER_KEY_SCALE);
    return latKey + ':' + lngKey;
  }

  function computeLabelClusterOffset(index) {
    if (!Number.isInteger(index) || index <= 0) {
      return 0;
    }
    var step = LABEL_CLUSTER_SPACING_METERS;
    var band = Math.ceil(index / 2);
    var direction = (index % 2) === 1 ? 1 : -1;
    return band * step * direction;
  }

  function applyLabelClusterOffset(position, offsetMeters) {
    if (!position || !Number.isFinite(offsetMeters) || offsetMeters === 0) {
      return position;
    }
    var bearing = Number.isFinite(position.bearing) ? position.bearing : 0;
    var lateralBearing = offsetMeters > 0 ? bearing + 90 : bearing - 90;
    var target = movePointByBearing(position.lat, position.lng, lateralBearing, Math.abs(offsetMeters));
    return {
      lat: target.lat,
      lng: target.lng,
      bearing: position.bearing
    };
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

  function getSortedRouteIds() {
    return Object.keys(routeLayers).sort(function (a, b) {
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

  function sanitizeVehicleText(value, fallback) {
    var source = value === undefined || value === null ? (fallback || '') : value;
    return String(source)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeColorValue(value, fallback) {
    var color = value === undefined || value === null || value === '' ? (fallback || '#444444') : value;
    return String(color).replace(/[^#0-9a-zA-Z(),.% -]/g, '');
  }

  function shouldForceWhiteArrow(meta) {
    if (!meta) return false;
    var candidates = [meta.displayName, meta.id];
    for (var i = 0; i < candidates.length; i++) {
      var key = normalizeRouteKey(candidates[i]);
      if (key === '8' || key === '8A' || key === '8B') {
        return true;
      }
    }
    return false;
  }

  function assignVehicleKey(vehicle) {
    if (vehicle && vehicle.id !== undefined && vehicle.id !== null && vehicle.id !== '') {
      return String(vehicle.id);
    }
    anonymousVehicleCounter += 1;
    return 'anon-' + anonymousVehicleCounter;
  }

  function buildVehiclePopupContent(groupMembers) {
    if (!Array.isArray(groupMembers) || !groupMembers.length) return 'Vehicle info unavailable';
    var lines = [];
    for (var i = 0; i < groupMembers.length; i++) {
      var member = groupMembers[i];
      var vehicle = member.vehicle;
      var meta = member.meta;
      var label = sanitizeVehicleText(meta.displayName || meta.longName || meta.id || 'Route');
      var busId = vehicle && vehicle.id ? sanitizeVehicleText(vehicle.id) : 'Unknown bus';
      var parts = ['Bus ' + busId, 'Route ' + label];
      if (meta.longName) {
        parts.push(sanitizeVehicleText(meta.longName));
      }
      lines.push(parts.join(' — '));
    }
    return lines.join('<br/>');
  }

  function createCombinedBusIcon(members) {
    var MAX_COLUMNS = 2;
    var MAX_ROWS = 2;
    var MAX_VISIBLE = MAX_COLUMNS * MAX_ROWS;
    var bucketIndex = Object.create(null);
    var routeBuckets = [];

    for (var i = 0; i < members.length; i++) {
      var member = members[i];
      var key = member.routeId || (member.meta && member.meta.id) || member.key || ('route-' + i);
      if (!bucketIndex[key]) {
        bucketIndex[key] = {
          routeId: member.routeId,
          meta: member.meta,
          count: 0
        };
        routeBuckets.push(bucketIndex[key]);
      }
      bucketIndex[key].count += 1;
    }

    var totalRoutes = routeBuckets.length;
    var visibleBuckets = routeBuckets;
    var extraCount = 0;
    if (totalRoutes > MAX_VISIBLE) {
      extraCount = totalRoutes - (MAX_VISIBLE - 1);
      visibleBuckets = routeBuckets.slice(0, MAX_VISIBLE - 1);
    }

    var chips = [];
    for (var j = 0; j < visibleBuckets.length; j++) {
      var bucket = visibleBuckets[j];
      var meta = bucket.meta || {};
      var label = sanitizeVehicleText(meta.displayName || meta.id || '?');
      var chipBg = sanitizeColorValue(meta.color, '#444444');
      var chipFg = sanitizeColorValue(meta.textColor, '#ffffff');
      var badge = bucket.count > 1 ? '<span class="vehicle-mini__badge">' + sanitizeVehicleText(bucket.count) + '</span>' : '';
      chips.push('<span class="vehicle-mini" style="--chip-bg:' + chipBg + ';--chip-fg:' + chipFg + ';">' + label + badge + '</span>');
    }
    if (extraCount > 0) {
      var safeExtra = sanitizeVehicleText('+' + extraCount);
      chips.push('<span class="vehicle-mini vehicle-mini--count">' + safeExtra + '</span>');
    }

    var renderedCells = visibleBuckets.length + (extraCount > 0 ? 1 : 0);
    var columnCount = Math.min(MAX_COLUMNS, renderedCells);
    var rowCount = Math.min(MAX_ROWS, Math.ceil(renderedCells / MAX_COLUMNS));
    if (columnCount <= 0) columnCount = 1;
    if (rowCount <= 0) rowCount = 1;

    var CELL_SIZE = 28;
    var GAP_SIZE = 4;
    var paddingX = 0;
    var paddingY = 0;
    var width = columnCount * CELL_SIZE + Math.max(0, columnCount - 1) * GAP_SIZE + paddingX;
    var height = rowCount * CELL_SIZE + Math.max(0, rowCount - 1) * GAP_SIZE + paddingY;
    var anchorX = Math.round(width / 2);
    var anchorY = Math.round(height / 2);
    var popupY = -Math.round(height / 2);

    var groupStyle = 'style="--stack-columns:' + columnCount + ';--stack-rows:' + rowCount + '"';
    var html = '' +
      '<div class="vehicle-bubble vehicle-bubble--combined" data-no-bearing="true">' +
      '  <div class="vehicle-label-group vehicle-label-group--stack" ' + groupStyle + '>' + chips.join('') + '</div>' +
      '</div>';

    return L.divIcon({
      className: 'vehicle-icon vehicle-icon--combined',
      html: html,
      iconSize: [Math.round(width), Math.round(height)],
      iconAnchor: [anchorX, anchorY],
      popupAnchor: [0, popupY]
    });
  }

  function updateMarkerVisibility(markerData) {
    if (!markerData || !markerData.marker || !Array.isArray(markerData.routeIds) || !markerData.routeIds.length) {
      return;
    }
    var anyVisible = false;
    for (var i = 0; i < markerData.routeIds.length; i++) {
      if (isRouteVisible(markerData.routeIds[i])) {
        anyVisible = true;
        break;
      }
    }
    markerData.marker.setOpacity(anyVisible ? 1 : 0);
  }

  function removeMarkerEntry(key) {
    if (!key || !markers[key]) return;
    var entry = markers[key];
    if (entry && entry.marker) {
      vehicleLayer.removeLayer(entry.marker);
    }
    delete markers[key];
  }

  function createBusIcon(meta, bearing) {
    var label = meta.displayName || '';
    var background = meta.color || '#444444';
    var textColor = meta.textColor || '#FFFFFF';
    var safeLabel = sanitizeVehicleText(label);
    var safeBg = sanitizeColorValue(background, '#444444');
    var safeText = sanitizeColorValue(textColor, '#FFFFFF');
    var hasBearing = Number.isFinite(bearing);
    var normalizedBearing = hasBearing ? normalizeBearing(bearing) : null;
    var bearingValue = normalizedBearing === null ? '0deg' : normalizedBearing.toFixed(1) + 'deg';
    var labelLength = String(label || '').replace(/\s+/g, '').length;
    var labelSize = labelLength >= 3 ? 15 : 19;
    var arrowColor;
    var arrowStroke = 'rgba(255, 255, 255, 0.8)';
    if (shouldForceWhiteArrow(meta)) {
      arrowColor = '#FFFFFF'; // Route 8 uses a black base; keep its direction marker visible.
      arrowStroke = '#000000';
    } else if (meta.textColor && meta.textColor.toUpperCase() === '#FFFFFF') {
      arrowColor = 'rgba(20, 20, 20, 0.88)';
    } else {
      arrowColor = meta.textColor || '#222222';
    }
    var safeArrow = sanitizeColorValue(arrowColor, '#222222');
    var safeArrowStroke = sanitizeColorValue(arrowStroke, 'rgba(255, 255, 255, 0.8)');
    var attrs = 'class="vehicle-bubble" style="--route-color:' + safeBg + ';--text-color:' + safeText + ';--label-size:' + labelSize + 'px;--bearing:' + bearingValue + ';--arrow-color:' + safeArrow + ';--arrow-stroke:' + safeArrowStroke + ';"';
    if (!hasBearing) {
      attrs += ' data-no-bearing="true"';
    }
    return L.divIcon({
      className: 'vehicle-icon',
      html: '\n        <div ' + attrs + '>\n          <svg class="vehicle-arrow" viewBox="0 0 24 16" role="presentation" focusable="false">\n            <path d="M12 0L24 16H0Z"/>\n          </svg>\n          <span class="vehicle-label">' + safeLabel + '</span>\n        </div>\n      ',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22]
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

  function offsetLatLngByBearing(lat, lon, distanceMeters, bearingDegrees) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!Number.isFinite(distanceMeters) || distanceMeters === 0) {
      return { lat: lat, lng: lon };
    }
    if (!Number.isFinite(bearingDegrees)) {
      return { lat: lat, lng: lon };
    }
    var angularDistance = distanceMeters / EARTH_RADIUS_METERS;
    if (!Number.isFinite(angularDistance) || angularDistance === 0) {
      return { lat: lat, lng: lon };
    }
    var bearingRad = bearingDegrees * Math.PI / 180;
    var latRad = lat * Math.PI / 180;
    var lonRad = lon * Math.PI / 180;
    var sinLat = Math.sin(latRad);
    var cosLat = Math.cos(latRad);
    var sinAngular = Math.sin(angularDistance);
    var cosAngular = Math.cos(angularDistance);
    var newLatRad = Math.asin(sinLat * cosAngular + cosLat * sinAngular * Math.cos(bearingRad));
    var newLonRad = lonRad + Math.atan2(Math.sin(bearingRad) * sinAngular * cosLat, cosAngular - sinLat * Math.sin(newLatRad));
    var newLat = newLatRad * 180 / Math.PI;
    var newLon = newLonRad * 180 / Math.PI;
    if (!Number.isFinite(newLon)) {
      newLon = lon;
    } else {
      newLon = ((newLon + 540) % 360) - 180;
    }
    return { lat: newLat, lng: newLon };
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

  function resolveRouteEntry(routeId) {
    if (!routeId) return null;
    var directEntry = routeLayers[routeId];
    if (directEntry) {
      return { id: routeId, entry: directEntry };
    }
    var normalized = normalizeRouteKey(routeId);
    if (!normalized) return null;
    var meta = routeKeyIndex[normalized];
    if (!meta || !meta.id) return null;
    var canonicalEntry = routeLayers[meta.id];
    if (!canonicalEntry) return null;
    return { id: meta.id, entry: canonicalEntry };
  }

  function isRouteVisible(routeId) {
    var resolved = resolveRouteEntry(routeId);
    if (!resolved) return false;
    return resolved.entry.visible !== false;
  }

  function applyRouteVisibilityToVehicles(routeId) {
    var resolved = resolveRouteEntry(routeId);
    if (!resolved) return;
    Object.keys(markers).forEach(function (id) {
      var markerData = markers[id];
      if (!markerData || !Array.isArray(markerData.routeIds)) return;
      for (var i = 0; i < markerData.routeIds.length; i++) {
        if (markerData.routeIds[i] === resolved.id) {
          updateMarkerVisibility(markerData);
          break;
        }
      }
    });
  }

  function setRouteVisibility(routeId, shouldShow) {
    var resolved = resolveRouteEntry(routeId);
    if (!resolved) return;
    var entry = resolved.entry;
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
    applyRouteVisibilityToVehicles(resolved.id);
    ui.updateRouteLegendState(createLegendContext());
  }

  function buildRouteLabels() {
    if (!ROUTE_LABELS_ENABLED) {
      Object.keys(routeLayers).forEach(function (routeId) {
        var entry = routeLayers[routeId];
        if (entry && entry.labelLayer) {
          entry.labelLayer.clearLayers();
        }
      });
      return;
    }

    var BASE_MIN_DISTANCE = 90;

    var remainingLabelBudgets = {};
    Object.keys(routeLabelBudgetOverrides).forEach(function (key) {
      remainingLabelBudgets[key] = routeLabelBudgetOverrides[key];
    });

    var labelClusterCounts = {};

    Object.keys(routeLayers).forEach(function (routeId) {
      var entry = routeLayers[routeId];
      if (!entry || !entry.labelLayer || !entry.labelGeometries || !entry.meta) return;

      entry.labelLayer.clearLayers();

      var labelKey = entry.meta && entry.meta.displayName ? String(entry.meta.displayName).trim().toUpperCase() : '';
      if (labelKey && hiddenRouteLabels[labelKey]) {
        return;
      }

      var budgetKey = resolveRouteLabelBudgetKey(entry.meta);
      var hasBudgetLimit = budgetKey && Object.prototype.hasOwnProperty.call(remainingLabelBudgets, budgetKey);
      if (hasBudgetLimit && remainingLabelBudgets[budgetKey] <= 0) {
        return;
      }

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

      var labelCount = resolveRouteLabelCount(entry.meta, routeId);
      var overrideTargets = resolveRouteLabelTargets(entry.meta, routeId, totalLength);
      var targets = overrideTargets && overrideTargets.length ? overrideTargets : computeLabelTargets(totalLength, labelCount);
      if (!targets.length) return;

      var placed = [];
      for (var t = 0; t < targets.length; t++) {
        if (hasBudgetLimit && remainingLabelBudgets[budgetKey] <= 0) {
          break;
        }
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

        var clusterKey = computeLabelClusterKey(position);
        var clusterIndex = clusterKey ? (labelClusterCounts[clusterKey] || 0) : 0;
        var clusterOffset = computeLabelClusterOffset(clusterIndex);
        var adjustedPosition = clusterOffset ? applyLabelClusterOffset(position, clusterOffset) : position;

        var marker = createRouteLabelMarker(entry.meta, adjustedPosition, routeId);
        if (!marker) continue;

        if (clusterKey) {
          labelClusterCounts[clusterKey] = clusterIndex + 1;
        }

        entry.labelLayer.addLayer(marker);
        if (hasBudgetLimit) {
          remainingLabelBudgets[budgetKey] = Math.max(0, remainingLabelBudgets[budgetKey] - 1);
        }
        placed.push(marker.getLatLng());
      }

      var layers = entry.labelLayer.getLayers();
      if (!layers.length && (!hasBudgetLimit || remainingLabelBudgets[budgetKey] > 0)) {
        var midpoint = locatePointAlongLines(lineLatLngs, totalLength / 2);
        if (midpoint) {
          var fallbackKey = computeLabelClusterKey(midpoint);
          var fallbackIndex = fallbackKey ? (labelClusterCounts[fallbackKey] || 0) : 0;
          var fallbackOffset = computeLabelClusterOffset(fallbackIndex);
          var adjustedMidpoint = fallbackOffset ? applyLabelClusterOffset(midpoint, fallbackOffset) : midpoint;

          var fallbackMid = createRouteLabelMarker(entry.meta, adjustedMidpoint, routeId);
          if (fallbackMid) {
            if (fallbackKey) {
              labelClusterCounts[fallbackKey] = fallbackIndex + 1;
            }
            entry.labelLayer.addLayer(fallbackMid);
            if (hasBudgetLimit) {
              remainingLabelBudgets[budgetKey] = Math.max(0, remainingLabelBudgets[budgetKey] - 1);
            }
            layers = entry.labelLayer.getLayers();
          }
        }
      }
    });
  }

  function loadRoutes() {
    return dataClient.fetchRoutes()
      .then(function (gj) {
        if (!isFeatureCollection(gj)) throw new Error('Invalid routes response');

        clearRoutes();
        var features = gj.features || [];
        if (!features.length) {
          ui.showBanner('routes', 'No routes available. Run npm run build:data.');
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
            var startVisible = shouldRouteStartVisible(routeId, props, meta);
            if (startVisible) {
              routesGroup.addLayer(layerGroup);
            }
            entry = routeLayers[routeId] = { layer: layerGroup, visible: startVisible };
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
        var legendContext = createLegendContext();
        ui.renderRouteLegend(legendContext);
        if (typeof ui.renderStopLegend === 'function') {
          ui.renderStopLegend(legendContext);
        }
        ui.clearBanner('routes');
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
        ui.showBanner('routes', 'Routes unavailable: ' + msg);
      });
  }

  function updateVehicles(list) {
    var now = Date.now();
    var unresolvedRoutes = Object.create(null);
    var clusters = clusterVehicles(Array.isArray(list) ? list : [], vehicleClusterThreshold);
    var seenMarkerKeys = Object.create(null);
    var miniSnapshots = [];

    for (var c = 0; c < clusters.length; c++) {
      var cluster = clusters[c];
      if (!cluster || !Array.isArray(cluster.vehicles) || !cluster.vehicles.length) continue;

      var members = [];
      var clusterLat = Number(cluster.lat);
      var clusterLon = Number(cluster.lon);
      var visibleLatSum = 0;
      var visibleLonSum = 0;
      var visibleCount = 0;

      for (var vIndex = 0; vIndex < cluster.vehicles.length; vIndex++) {
        var vehicle = cluster.vehicles[vIndex];
        if (!vehicle || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;

        var vehicleKey = assignVehicleKey(vehicle);
        var rawRouteId = vehicle.route_id;
        var resolved = rawRouteId ? resolveRouteEntry(rawRouteId) : null;
        if (!resolved) {
          var warnKey = rawRouteId || '(missing)';
          if (!unresolvedRoutes[warnKey]) {
            unresolvedRoutes[warnKey] = true;
            console.warn('Skipping vehicle update for unresolved route:', warnKey);
          }
          continue;
        }

        var routeMeta = getRouteMeta(resolved.id);
        if (!routeMeta) continue;
        if (!isRouteVisible(resolved.id)) continue;

        visibleLatSum += vehicle.lat;
        visibleLonSum += vehicle.lon;
        visibleCount += 1;
        members.push({
          key: vehicleKey,
          vehicle: vehicle,
          routeId: resolved.id,
          meta: routeMeta
        });
        miniSnapshots.push({
          key: vehicleKey,
          vehicle: vehicle,
          meta: routeMeta
        });
      }

      if (!members.length) continue;
      if (visibleCount > 0) {
        clusterLat = visibleLatSum / visibleCount;
        clusterLon = visibleLonSum / visibleCount;
      }

      var isCombined = members.length > 1;
      var markerKey;
      if (isCombined) {
        var aggregatedKeys = members.map(function (m) { return m.key; }).sort();
        markerKey = aggregatedKeys.join('|');
      } else {
        markerKey = members[0].key;
      }

      seenMarkerKeys[markerKey] = true;

      var markerData = markers[markerKey];
      var bearing = null;
      if (!isCombined) {
        bearing = resolveVehicleBearing(members[0].vehicle, markerData);
      }

      var routeIds = [];
      var routeDescriptors = [];
      var vehicleIdsForSignature = [];
      for (var mIndex = 0; mIndex < members.length; mIndex++) {
        var member = members[mIndex];
        routeIds.push(member.routeId);
        routeDescriptors.push(member.routeId + ':' + (member.meta.displayName || ''));
        vehicleIdsForSignature.push(member.key);
      }

      var uniqueRouteIds = Array.from(new Set(routeIds));

      var signature;
      var icon;
      if (isCombined) {
        for (var rm = 0; rm < members.length; rm++) {
          var memberKey = members[rm].key;
          if (memberKey && memberKey !== markerKey) {
            removeMarkerEntry(memberKey);
          }
        }
        signature = 'combined|' + routeDescriptors.sort().join(',') + '|' + vehicleIdsForSignature.sort().join(',');
        icon = createCombinedBusIcon(members);
      } else {
        signature = 'single|' + routeIds[0] + '|' + (members[0].meta.displayName || '') + '|' + (members[0].meta.color || '') + '|' + (members[0].meta.textColor || '') + '|' + (bearing === null ? 'na' : bearing.toFixed(1)) + '|' + vehicleIdsForSignature[0];
        icon = createBusIcon(members[0].meta, bearing);
      }

      var popupContent = buildVehiclePopupContent(members);
      var title;
      if (isCombined) {
        title = 'Routes ' + members.map(function (member) { return member.meta.displayName || member.routeId; }).join(', ');
      } else {
        var singleMeta = members[0].meta;
        title = singleMeta.longName ? (singleMeta.displayName + ' - ' + singleMeta.longName) : ('Route ' + singleMeta.displayName);
      }

      if (!markerData) {
        var zIndexOffset = isCombined ? COMBINED_MARKER_Z_OFFSET : SINGLE_MARKER_Z_OFFSET;
        var mk = L.marker([clusterLat, clusterLon], {
          icon: icon,
          title: title,
          pane: 'vehiclePane',
          riseOnHover: true,
          zIndexOffset: zIndexOffset
        }).addTo(vehicleLayer);
        mk.bindPopup(popupContent);
        markerData = markers[markerKey] = {
          marker: mk,
          iconSignature: signature,
          lastLat: clusterLat,
          lastLon: clusterLon,
          lastSeen: now,
          bearing: bearing,
          routeIds: uniqueRouteIds,
          vehicleIds: vehicleIdsForSignature.slice(),
          isCombined: isCombined
        };
      } else {
        var updatedZIndexOffset = isCombined ? COMBINED_MARKER_Z_OFFSET : SINGLE_MARKER_Z_OFFSET;
        if (Number.isFinite(markerData.lastLat) && Number.isFinite(markerData.lastLon)) {
          animateMove(markerData.marker, [markerData.lastLat, markerData.lastLon], [clusterLat, clusterLon], pollMs * 0.95);
        } else {
          markerData.marker.setLatLng([clusterLat, clusterLon]);
        }
        if (markerData.iconSignature !== signature) {
          markerData.marker.setIcon(icon);
          markerData.iconSignature = signature;
        }
        markerData.marker.setPopupContent(popupContent);
        markerData.marker.options.title = title;
        markerData.lastLat = clusterLat;
        markerData.lastLon = clusterLon;
        markerData.lastSeen = now;
        markerData.bearing = bearing;
        markerData.routeIds = uniqueRouteIds;
        markerData.vehicleIds = vehicleIdsForSignature.slice();
        markerData.isCombined = isCombined;
        markerData.marker.setZIndexOffset(updatedZIndexOffset);
      }

      updateMarkerVisibility(markerData);
    }

    Object.keys(markers).forEach(function (id) {
      var markerData = markers[id];
      if (!markerData) return;
      var age = now - markerData.lastSeen;
      if (!seenMarkerKeys[id]) {
        vehicleLayer.removeLayer(markerData.marker);
        delete markers[id];
        return;
      }
      if (age > 60000) {
        vehicleLayer.removeLayer(markerData.marker);
        delete markers[id];
      }
    });

    syncMiniMapMarkers(miniSnapshots);
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
      dataClient.fetchVehicles()
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          ui.clearBanner('vehicles');
          updateVehicles(data.vehicles || []);
        })
        .catch(function (err) {
          console.error('Failed to load vehicles:', err);
          ui.showBanner('vehicles', 'Vehicles unavailable: ' + (err && err.message ? err.message : 'live data retrying'));
        })
        .finally(function () {
          setTimeout(tick, pollMs);
        });
    }
    tick();
  }

  return {
    initialize: initialize
  };
}
