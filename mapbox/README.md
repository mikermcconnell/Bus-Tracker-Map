# Barrie Transit TV basemap

`barrie-transit-tv-v1.style.json` is the versioned source for the custom Classic Mapbox Studio style used by the main-map wall display.

1. Import the JSON into Mapbox Studio as a classic style. Do not base it on Mapbox Standard; the Static Tiles API used by Leaflet cannot render Standard imports.
2. Preview and publish the style at Barrie, Ontario, zoom 13.5.
3. Configure a dedicated public token with the `styles:tiles` scope and URL restrictions for localhost and the production domain.
4. Set `MAPBOX_ACCESS_TOKEN`, `MAPBOX_USERNAME`, and `MAPBOX_STYLE_ID` in the runtime environment.
5. Keep the previous style ID available for rollback. Publish future revisions under a new versioned style ID and export the matching JSON here.

The `/platform.map` display is separate: `PLATFORM_MAPBOX_STYLE_ID` is rendered by Mapbox GL JS v3 and may reference a custom style that imports Mapbox Standard. Its live platform cards and vehicle markers remain HTML overlays. When WebGL is unsupported or the style fails to load, that display falls back to OpenStreetMap.

When the main map's required Mapbox settings are missing, or when three Mapbox tile requests fail, it uses OpenStreetMap tiles without the retired custom major-road overlay.
