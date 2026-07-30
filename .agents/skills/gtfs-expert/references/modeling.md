# GTFS station and transfer modeling

## Station hierarchy

- Represent a terminal or station complex with one `stops.txt` record whose `location_type` is `1`.
- Represent each boarding platform, bay, or pole with `location_type` `0` (or empty) and set `parent_station` to the station’s `stop_id`.
- Keep `parent_station` empty on the station record.
- Put platform identifiers such as `3` or `12` in `platform_code`; keep rider-recognizable location text in `stop_name`.
- Reference platform/stop IDs, not the parent station, from `stop_times.txt` when the platform is known.
- Use accurate platform coordinates. A shared parent does not erase walking time or physical barriers.

An umbrella station groups platforms but does not itself guarantee a connection.

## Transfer decisions

`transfers.txt` rules are directional. Add the reverse row only when the reverse connection is also valid.

- `transfer_type=0`: recommended transfer point.
- `transfer_type=1`: timed transfer; the departing vehicle is expected to wait for the arriving vehicle.
- `transfer_type=2`: ordinary transfer requiring at least `min_transfer_time` seconds; do not imply a hold.
- `transfer_type=3`: transfer is prohibited.
- Types `4` and `5`: in-seat transfer behavior; confirm current consumer support before use.

For Google Transit, leave `min_transfer_time` empty when `transfer_type=1`.
Google calculates the allowance for a timed hold and rejects a populated
`min_transfer_time` on type `1` in its import validator. Use
`transfer_type=2` when an explicit minimum number of seconds is the intended
rule; type `2` does not describe an operational hold.

## Scope

Choose the narrowest scope that accurately describes operations:

1. Stop-to-stop when the platform pair uniquely identifies the connection.
2. Route-to-route when several routes share platforms but the hold applies to a route pair.
3. Trip-to-trip when only specific scheduled trips connect.

Trip-scoped rules require regeneration when trip IDs rotate. Stop-scoped rules are durable only while stop IDs and operations remain stable.

## Timed-transfer audit

Verify all of the following:

1. Arrival and departure trips are active on the same service date.
2. `stop_times.txt` uses the intended child platform IDs.
3. Arrival time is not later than the connecting departure.
4. Scheduled dwell or hold permits the cross-platform movement.
5. Pickup is allowed on the departing trip and drop-off is allowed on the arriving trip.
6. The rule direction matches the rider movement.
7. Realtime delays do not systematically invalidate a connection described as guaranteed.

When both vehicles meet and mutually wait, model both directions. When only one waits, add only the row toward the waiting departure.

## Common false fixes

- Adding a parent station without adding the necessary transfer rule.
- Using the parent station in `stop_times.txt`.
- Applying a timed transfer to every route at a terminal when only one pair waits.
- Using `transfer_type=1` to compensate for an unreliable schedule.
- Adding a transfer row whose stop IDs are not present in the uploaded feed.
- Validating syntax but never testing the original trip-planning query.
