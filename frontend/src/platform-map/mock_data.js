if (typeof window.updateMapFromJSONP === 'function') {
    window.updateMapFromJSONP([
        { "lat": 44.373837, "lon": -79.689279, "route_id": "8A", "direction_id": 0, "id": "STATIC_BUS" }
    ]);
} else {
    console.error("Callback not found");
}
