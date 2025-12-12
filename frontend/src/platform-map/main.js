// Platform Map Logic (Vanilla JS)

// --- Constants ---

const CALIBRATION_DATA = [
    { "lat": 44.373837, "lon": -79.689279, "x": 54.18848167539267, "y": 55.32381997804611 }, // Platform 3
    { "lat": 44.374232, "lon": -79.689392, "x": 47.748691099476446, "y": 37.43139407244786 }, // Platform 7
    { "lat": 44.374245, "lon": -79.689674, "x": 43.97905759162304, "y": 38.090010976948406 }, // Platform 6
    { "lat": 44.374171, "lon": -79.690445, "x": 33.089005235602095, "y": 43.02963776070253 }, // Platform 12
    { "lat": 44.373515, "lon": -79.691137, "x": 23.24607329842932, "y": 82.87596048298573 }  // Platform 14
];

const ROUTE_COLORS = {
    '2A': '#006837', // Green
    '2B': '#006837',
    '7A': '#F58220', // Orange
    '7B': '#F58220',
    '8A': '#000000', // Black
    '8B': '#000000',
    '10': '#662D91', // Purple
    '11': '#8DC63F', // Lime
    '12A': '#F49AC1', // Pink
    '12B': '#F49AC1',
    '100': '#BE1E2D', // Red
    '101': '#2E3192', // Blue
    '400': '#00AEEF', // Cyan
};

const DEFAULT_COLOR = '#0055A4';

// --- Affine Transformation ---

function solveAffine(points) {
    if (points.length < 3) return null;

    const n = points.length;
    let sumLon = 0, sumLat = 0, sumX = 0, sumY = 0;
    for (const p of points) {
        sumLon += p.lon;
        sumLat += p.lat;
        sumX += p.x;
        sumY += p.y;
    }
    const meanLon = sumLon / n;
    const meanLat = sumLat / n;
    const meanX = sumX / n;
    const meanY = sumY / n;

    let sumU2 = 0, sumV2 = 0, sumUV = 0;
    let sumUX = 0, sumVX = 0, sumUY = 0, sumVY = 0;

    for (const p of points) {
        const u = p.lon - meanLon;
        const v = p.lat - meanLat;
        const dx = p.x - meanX;
        const dy = p.y - meanY;

        sumU2 += u * u;
        sumV2 += v * v;
        sumUV += u * v;

        sumUX += u * dx;
        sumVX += v * dx;
        sumUY += u * dy;
        sumVY += v * dy;
    }

    const det = sumU2 * sumV2 - sumUV * sumUV;
    if (Math.abs(det) < 1e-20) return null;

    const A = (sumV2 * sumUX - sumUV * sumVX) / det;
    const B = (sumU2 * sumVX - sumUV * sumUX) / det;
    const D = (sumV2 * sumUY - sumUV * sumVY) / det;
    const E = (sumU2 * sumVY - sumUV * sumUY) / det;

    const C = meanX - A * meanLon - B * meanLat;
    const F = meanY - D * meanLon - E * meanLat;

    return { A, B, C, D, E, F };
}

const affineMatrix = solveAffine(CALIBRATION_DATA);

function getPixelPosition(lat, lon) {
    if (!affineMatrix) return { left: '-100px', top: '-100px' };
    const { A, B, C, D, E, F } = affineMatrix;
    const x = A * lon + B * lat + C;
    const y = D * lon + E * lat + F;
    return { left: x + '%', top: y + '%' };
}

// --- Debug Console ---

const debugConsole = document.getElementById('debug-console');
function log(msg, type = 'LOG') {
    console.log(`[${type}] ${msg}`);
    if (debugConsole) {
        const line = document.createElement('div');
        line.textContent = `[${new Date().toLocaleTimeString()}] ${type}: ${msg}`;
        line.style.color = type === 'ERROR' ? '#ef4444' : '#4ade80';
        debugConsole.appendChild(line);
        debugConsole.scrollTop = debugConsole.scrollHeight;
    }
}

// --- Main Logic ---

function fetchVehicles() {
    return fetch('/api/vehicles.json')
        .then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function (data) {
            return data.vehicles || [];
        })
        .catch(function (err) {
            log(err.message, 'ERROR');
            return [];
        });
}

function updateMap(vehicles) {
    const layer = document.getElementById('bus-layer');
    if (!layer) return;

    // Simple clear and redraw for now
    layer.innerHTML = '';

    vehicles.forEach(function (v) {
        const pos = getPixelPosition(v.lat, v.lon);
        const routeId = v.route_id || '';
        const routeColor = ROUTE_COLORS[routeId] || DEFAULT_COLOR;

        let displayRouteId = routeId;
        if (routeId === '8A' || routeId === '8B') {
            if (v.direction_id !== null) {
                displayRouteId += (v.direction_id === 0 ? ' NB' : ' SB');
            } else if (v.bearing !== null) {
                displayRouteId += (v.bearing > 270 || v.bearing <= 90) ? ' NB' : ' SB';
            }
        }

        const marker = document.createElement('div');
        marker.className = 'bus-marker';
        marker.style.left = pos.left;
        marker.style.top = pos.top;

        marker.innerHTML =
            '<div class="bus-icon-wrapper" style="border-color: ' + routeColor + '">' +
            '<img src="/assets/bus_icon.jpg" class="bus-icon-image" alt="Bus">' +
            '</div>' +
            (routeId ? '<div class="bus-label" style="background-color: ' + routeColor + '">' + displayRouteId + '</div>' : '');

        layer.appendChild(marker);
    });
}

function startApp() {
    log('App started');
    log('User Agent: ' + navigator.userAgent);
    log('Stylesheets: ' + document.styleSheets.length);
    try {
        const h1 = document.createElement('h1');
        h1.textContent = 'JS Alive';
        h1.style.position = 'absolute';
        h1.style.top = '0';
        h1.style.right = '0';
        h1.style.color = 'red';
        document.body.appendChild(h1);
    } catch (e) { log('DOM Error: ' + e.message, 'ERROR'); }

    // Initial fetch
    fetchVehicles().then(updateMap);

    // Poll
    setInterval(function () {
        fetchVehicles().then(updateMap);
    }, 10000);
}

document.addEventListener('DOMContentLoaded', startApp);
window.onerror = (msg, src, line, col, err) => {
    log(`${msg} at ${line}:${col}`, 'ERROR');
};
