# Google Transit static-feed safeguards

## Before submission

1. Confirm the pipeline and account shown in the Transit Data Sharing Portal.
2. Inspect **Settings → Configuration** and record the delivery method.
3. Determine whether the candidate’s `feed_start_date` is active or future-dated.
4. Compare candidate and production ZIPs file by file.
5. Run the canonical validator before relying on Google’s report.

## Delivery method

- **Manual upload:** the accepted static feed remains until another static ZIP is manually uploaded. Every future production ZIP must retain intentional additions such as `transfers.txt`.
- **Scheduled fetch:** a manual patch can be replaced by a later acquisition. Update the source generator or hosted ZIP before deployment.
- **Push or other managed delivery:** identify the authoritative publisher and update that workflow.

Do not confuse static-feed delivery with GTFS Realtime polling. Vehicle Positions and Trip Updates may refresh every few seconds; a static schedule does not.

## Upload and validation

- Use **Start transfer / Upload → Upload file** for a manually delivered static pipeline.
- Do not use **Start new transfer** when the desired candidate exists only on the local machine; that action reacquires the configured source.
- Treat submission to a published pipeline with an active `feed_start_date` as a production change.
- After processing, expand the new transfer record and open **Validation report**.
- Separate blocking errors, new warnings, and warnings already present in production.
- For a timed hold (`transfer_type=1`), leave `min_transfer_time` blank.
  Google's importer rejects a populated minimum time unless
  `transfer_type=2`. Use type `2` only when the rule is an explicit minimum
  transfer duration rather than a guaranteed vehicle hold.
- Google documentation has used inconsistent wording about missing
  `min_transfer_time` on timed transfers. Do not respond to that wording by
  adding seconds to type `1`: the Barrie portal rejected `1,120` as a blocking
  error. Preserve type `1` with a blank value when the vehicle hold is the
  intended behavior.

Google’s validator is authoritative for Google extensions and processing behavior. The canonical validator remains useful for standards compliance and baseline comparison.

## Barrie Allandale manual augmentation

MVT's static exporter does not provide Barrie's Google-facing Allandale
station hierarchy or timed-transfer rules. Apply this augmentation to every
new MVT `google_transit.zip`; a previous patched Google ZIP must never be used
as the schedule-table source for a new version.

1. Keep the raw MVT ZIP as the source and rollback evidence.
2. Run `scripts/patch-allandale-google-feed.cjs` to create a separate upload ZIP.
3. Confirm the derived `stops.txt` contains this station model:
   - parent `stop_id`: `Barrie Allandale Transit Terminal`
   - parent `location_type`: `1`
   - parent coordinates: `44.374029,-79.690216`
   - children: 9003, 9004, 9005, 9006, 9012, and 9013
   - child `parent_station`: `Barrie Allandale Transit Terminal`
   - child `platform_code`: 3, 4, 5, 6, 12, and 13 respectively
4. Confirm the derived `transfers.txt` contains exactly one copy of each
   approved rule below, while preserving unrelated transfer rows:

```csv
from_stop_id,to_stop_id,transfer_type,min_transfer_time
9003,9004,1,
9004,9003,1,
9005,9012,1,
9012,9005,1,
```

5. Verify that every endpoint still exists and is used by current
   `stop_times.txt`. Reconfirm the operational hold before changing endpoints
   or directionality.
6. Audit the derived ZIP against the current published feed, run the canonical
   validator, and check current GTFS-Realtime linkage. Treat unmatched
   `SCHEDULED` trip IDs as blocking.
7. Upload the derived ZIP through **Start transfer / Upload -> Upload file**,
   review Google's validation report, and retain the raw MVT ZIP, uploaded ZIP,
   hashes, and prior live ZIP for rollback.

Only `stops.txt` and `transfers.txt` should differ between the raw MVT export
and its derived Google candidate. If any other table differs, stop and inspect
the build process before uploading.

## Routing verification

After a clean validation report:

1. Use the account’s testing access or the appropriate Google Maps preview.
2. Recreate the exact failing itinerary with a fixed service date and departure time.
3. Confirm the expected arriving trip, platform change, connecting departure, and transfer duration.
4. Test both directions only when both are operationally guaranteed.
5. Test an edge-of-service case so a broad transfer rule does not create a false connection.

Do not declare success from the presence of `transfers.txt` alone.

## Production handoff

Record:

- Uploaded file hash and `feed_version`.
- Processing/acquisition timestamp.
- Validation-report link or screenshot.
- Expected go-live behavior.
- Rollback ZIP.
- The owner responsible for retaining the change in the next schedule export.

For Barrie, recheck whether delivery remains manual before each deployment. If manual, the next uploaded production schedule is the overwrite boundary.
