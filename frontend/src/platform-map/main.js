// Phase 2: Single Network Request (XHR) - No Loop
(function () {
    // --- Logging ---
    var debugConsole = document.getElementById('debug-console');
    function log(msg, type) {
        type = type || 'LOG';
        console.log('[' + type + '] ' + msg);
        if (debugConsole) {
            var line = document.createElement('div');
            line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + type + ': ' + msg;
            line.style.color = type === 'ERROR' ? '#ef4444' : '#4ade80';
            debugConsole.appendChild(line);
            debugConsole.scrollTop = debugConsole.scrollHeight;
        }
    }

    try {
        log('Starting Phase 2 (Network Test)...', 'INFO');

        // --- Constants & Math (Verified Safe) ---
        var CALIBRATION_DATA = [
            { "lat": 44.373837, "lon": -79.689279, "x": 54.18848167539267, "y": 55.32381997804611 },
            { "lat": 44.374232, "lon": -79.689392, "x": 47.748691099476446, "y": 37.43139407244786 },
            { "lat": 44.374245, "lon": -79.689674, "x": 43.97905759162304, "y": 38.090010976948406 },
            { "lat": 44.374171, "lon": -79.690445, "x": 33.089005235602095, "y": 43.02963776070253 },
            { "lat": 44.373515, "lon": -79.691137, "x": 23.24607329842932, "y": 82.87596048298573 }
        ];

        var ROUTE_COLORS = {
            '2A': '#006837', '2B': '#006837',
            '7A': '#F58220', '7B': '#F58220',
            '8A': '#000000', '8B': '#000000',
            '10': '#662D91', '11': '#8DC63F',
            '12A': '#F49AC1', '12B': '#F49AC1',
            '100': '#BE1E2D', '101': '#2E3192',
            '400': '#00AEEF'
        };
        var DEFAULT_COLOR = '#0055A4';

        function solveAffine(points) {
            if (points.length < 3) return null;
            var n = points.length;
            var sumLon = 0, sumLat = 0, sumX = 0, sumY = 0;
            for (var i = 0; i < n; i++) {
                sumLon += points[i].lon;
                sumLat += points[i].lat;
                sumX += points[i].x;
                sumY += points[i].y;
            }
            var meanLon = sumLon / n;
            var meanLat = sumLat / n;
            var meanX = sumX / n;
            var meanY = sumY / n;

            var sumU2 = 0, sumV2 = 0, sumUV = 0;
            var sumUX = 0, sumVX = 0, sumUY = 0, sumVY = 0;

            for (var i = 0; i < n; i++) {
                var p = points[i];
                var u = p.lon - meanLon;
                var v = p.lat - meanLat;
                var dx = p.x - meanX;
                var dy = p.y - meanY;
                sumU2 += u * u;
                sumV2 += v * v;
                sumUV += u * v;
                sumUX += u * dx;
                sumVX += v * dx;
                sumUY += u * dy;
                sumVY += v * dy;
            }

            var det = sumU2 * sumV2 - sumUV * sumUV;
            if (Math.abs(det) < 1e-20) return null;

            var A = (sumV2 * sumUX - sumUV * sumVX) / det;
            var B = (sumU2 * sumVX - sumUV * sumUX) / det;
            var D = (sumV2 * sumUY - sumUV * sumVY) / det;
            var E = (sumU2 * sumVY - sumUV * sumUY) / det;
            var C = meanX - A * meanLon - B * meanLat;
            var F = meanY - D * meanLon - E * meanLat;

            return { A: A, B: B, C: C, D: D, E: E, F: F };
        }

        var affineMatrix = solveAffine(CALIBRATION_DATA);

        function getPixelPosition(lat, lon) {
            if (!affineMatrix) return { left: '-100px', top: '-100px' };
            var x = affineMatrix.A * lon + affineMatrix.B * lat + affineMatrix.C;
            var y = affineMatrix.D * lon + affineMatrix.E * lat + affineMatrix.F;
            return { left: x + '%', top: y + '%' };
        }

        function updateMap(vehicles) {
            var layer = document.getElementById('bus-layer');
            if (!layer) return;
            layer.innerHTML = '';

            for (var i = 0; i < vehicles.length; i++) {
                var v = vehicles[i];
                var pos = getPixelPosition(v.lat, v.lon);
                var routeId = v.route_id || '';
                var routeColor = ROUTE_COLORS[routeId] || DEFAULT_COLOR;

                var displayRouteId = routeId;
                if (routeId === '8A' || routeId === '8B') {
                    if (v.direction_id !== null) {
                        displayRouteId += (v.direction_id === 0 ? ' NB' : ' SB');
                    } else if (v.bearing !== null) {
                        displayRouteId += (v.bearing > 270 || v.bearing <= 90) ? ' NB' : ' SB';
                    }
                }

                var marker = document.createElement('div');
                marker.className = 'bus-marker';
                marker.style.left = pos.left;
                marker.style.top = pos.top;

                var html = '<div class="bus-icon-wrapper" style="border-color: ' + routeColor + ';">' +
                    '<img src="/assets/bus_icon.jpg" class="bus-icon-image" alt="Bus">' +
                    '</div>';

                if (routeId) {
                    html += '<div class="bus-label" style="background-color: ' + routeColor + ';">' + displayRouteId + '</div>';
                }

                marker.innerHTML = html;
                layer.appendChild(marker);
            }
            log('Rendered ' + vehicles.length + ' buses', 'SUCCESS');
        }

        // --- Fetch (XHR) ---
        function fetchVehicles(callback) {
            log('Init XHR...', 'DEBUG');
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/vehicles.json', true);

            xhr.onreadystatechange = function () {
                log('State: ' + xhr.readyState + ', Status: ' + xhr.status, 'DEBUG');
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            var data = JSON.parse(xhr.responseText);
                            log('JSON Parsed. Vehicles: ' + (data.vehicles ? data.vehicles.length : 0), 'SUCCESS');
                            callback(data.vehicles || []);
                        } catch (e) {
                            log('JSON Parse Error: ' + e.message, 'ERROR');
                            callback([]);
                        }
                    } else {
                        log('XHR Error: ' + xhr.status + ' ' + xhr.statusText, 'ERROR');
                        callback([]);
                    }
                }
            };

            xhr.timeout = 10000; // 10s timeout
            xhr.ontimeout = function () {
                log('XHR Timeout', 'ERROR');
                callback([]);
            };

            xhr.onerror = function (e) {
                log('XHR Network Error', 'ERROR');
                callback([]);
            };

            log('Sending XHR...', 'DEBUG');
            xhr.send();
        }

        // --- Execute Phase 2 ---
        fetchVehicles(function (vehicles) {
            updateMap(vehicles);

            // Indicator
            var h1 = document.createElement('h1');
            h1.textContent = 'Network Test Complete';
            h1.style.position = 'absolute';
            h1.style.top = '0';
            h1.style.right = '0';
            h1.style.color = 'cyan';
            document.body.appendChild(h1);
        });

    } catch (err) {
        log('Fatal Error: ' + err.message, 'ERROR');
        document.body.style.backgroundColor = 'red';
    }
})();
