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

Google’s validator is authoritative for Google extensions and processing behavior. The canonical validator remains useful for standards compliance and baseline comparison.

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
