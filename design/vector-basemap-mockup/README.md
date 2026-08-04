# Editable vector basemap mock-up

This is a separate design prototype. It does not replace the production platform map.

## Plan

1. **Vector foundation** — extract the original Illustrator vector artwork from the supplied source PDF rather than tracing the raster export.
2. **Editable data** — keep platform card content and positions in `platforms.js` rather than baking them into the drawing.
3. **Visual verification** — compare wide and compact layouts before integrating anything into the real app.

## Editing

- Edit map geometry and labels in `allandale-basemap.svg` using Illustrator, Inkscape, or an SVG editor.
- Edit platform names, routes, states, colours, and positions in `platforms.js`.
- Adjust responsive presentation in `styles.css`.

The basemap contains no raster image. It is the exact vector artwork from page 1 of `Platform Maps Combined - April 2026 1.pdf`.
