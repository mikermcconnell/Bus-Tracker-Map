---
name: gtfs-expert
description: Diagnose, model, compare, validate, and safely deploy GTFS Schedule and GTFS Realtime feeds. Use for stops.txt station/platform hierarchies, transfers.txt timed connections, route or trip planning failures, schedule and realtime mismatches, Google Transit Data Sharing Portal uploads, feed-version comparisons, validation reports, or Barrie Transit feed investigations.
---

# GTFS Expert

Work from the actual feed, current pipeline, validation report, or observed trip plan. Do not infer production behavior from repository code alone.

## Core workflow

1. Identify the consumer and symptom.
   - Distinguish GTFS Schedule from GTFS Realtime.
   - Capture one reproducible query: service date, requested time, origin, destination, expected trips, and the result actually shown.
2. Acquire the exact production dataset.
   - Prefer the pipeline acquisition or published ZIP currently consumed by the trip planner.
   - Record source URL/path, acquisition time, `feed_version`, validity dates, and SHA-256.
   - Treat cached GeoJSON and realtime protobuf feeds as different evidence.
3. Audit before editing.
   - Run `scripts/audit-static-feed.cjs` for structural and referential checks.
   - Inspect `stops.txt`, `stop_times.txt`, `trips.txt`, `routes.txt`, calendars, and `transfers.txt` together.
   - Read [references/modeling.md](references/modeling.md) for station and transfer decisions.
4. Make the smallest source-level correction.
   - Preserve stable IDs and every unrelated table.
   - Scope transfer rules as generally as operations guarantee, but no more generally.
   - Never claim a timed transfer unless the departing vehicle is operationally expected to wait.
5. Validate in layers.
   - Compare the candidate ZIP with production and explain every changed file.
   - Run the canonical MobilityData validator.
   - Run the consumer-specific validator, such as Google’s validation report.
   - Reproduce the original trip-planning query in a private preview or live planner as appropriate.
6. Deploy deliberately.
   - Determine whether the pipeline is manual, scheduled fetch, or push before uploading.
   - State whether submission is validation-only, future-dated, or an active production update.
   - Read [references/google-transit.md](references/google-transit.md) for Google-specific safeguards.
7. Verify persistence.
   - For manual delivery, ensure every future ZIP retains the correction.
   - For fetched delivery, update the source generator or hosted ZIP before the next acquisition.
   - Recheck after the next normal schedule publication.

## Deterministic audit

Run from the repository root:

```powershell
node .agents/skills/gtfs-expert/scripts/audit-static-feed.cjs `
  --feed C:\path\to\candidate.zip `
  --baseline https://www.myridebarrie.ca/gtfs/google_transit.zip `
  --station "Barrie Allandale Transit Terminal" `
  --routes 8A,8B
```

After operations confirms reciprocal holds, verify the Google-compatible timed
transfer rows with repeatable flags. Keep `min_transfer_time` blank for
`transfer_type=1`; Google calculates the transfer allowance for timed holds.

```powershell
node .agents/skills/gtfs-expert/scripts/audit-static-feed.cjs `
  --feed C:\path\to\candidate.zip `
  --expect-transfer "9003,9004,1," `
  --expect-transfer "9004,9003,1," `
  --expect-transfer "9005,9012,1," `
  --expect-transfer "9012,9005,1,"
```

Do not reuse those values when the hold policy, accessible walking time, platform
IDs, or route/platform assignments differ.

Use `--json` for machine-readable output. The script is read-only and exits nonzero on structural errors or missing expected transfers.

## Barrie repository defaults

- Resolve endpoints from the active environment first; `.env.example` is only a fallback.
- The documented static feed is `https://www.myridebarrie.ca/gtfs/google_transit.zip`.
- Do not treat `cache/routes.geojson` or `cache/stops.geojson` as the GTFS source of truth.
- Recheck Allandale stop IDs and route/platform usage in every new production feed before reusing transfer rows.
- Keep GTFS Schedule corrections separate from Vehicle Positions, Trip Updates, and Service Alerts.

## Evidence and handoff

Report:

- Root cause and the exact evidence supporting it.
- Files and rows changed.
- Validation errors, new warnings, and pre-existing warnings separately.
- Whether trip-planner behavior was actually reproduced after processing.
- Production impact, rollback artifact, and how the correction survives the next feed update.

Do not equate “valid GTFS” with “the trip planner will select this itinerary.” Routing verification is a separate required check.
