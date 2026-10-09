# Platform 9002 — local fixes and verification

## Status

The seven issues in the [October 2 review](2026-10-02-platform-9002.md) are fixed and **deployed to the public Vercel URL**. See the [production release record](2026-10-02-platform-9002-release.md) for deployment identity, public verification, rollback, and remaining boundaries. The installed physical sign has not been tested.

## Changes

1. **Outage truthfulness:** cached responses start provisionally, without LIVE. Failed requests immediately downgrade predictions to scheduled times where known. Evidence expires within two minutes; retained data expires after 30 minutes even while the page stays open. Expired rows are removed. A short warning is visible in the 320 × 80 header. Unavailable empty data cannot masquerade as confirmed absence of service.
2. **Delayed buses:** aggregation retains a bounded six-hour schedule lookback, applies realtime updates, and then removes past effective departures. Per-platform selection chooses the earliest effective departure when a delayed bus is overtaken.
3. **Cancellations:** trip-level cancellations no longer depend on the presence of stop rows. Explicit service dates isolate recurring trips. Undated cancellations are confined to the feed's current Toronto service date rather than cancelling future days in the search window.
4. **Missing predictions:** NO_DATA and absent event fields stay scheduled. Explicit zero delay remains a valid prediction. Protobuf's inherited zero defaults are not mistaken for fields actually supplied by the publisher.
5. **Request recovery:** fetch and response-body loading have a 15-second deadline, with cancellation where available. Late results are ignored; the next poll can recover. XHR retains its native timeout.
6. **Schedule availability:** platform requests require current date coverage from their assigned agency. Missing, expired, or future-only required schedule metadata returns unavailable data. Platform payloads include source health, prediction timestamps, trip identity, and LIVE expiry. Corrupt saved rows and wrong-platform responses are rejected safely.
7. **Search window:** platform signs search 72 hours ahead, including weekend-to-weekday service. Filtering occurs before row limiting. Empty states explicitly identify the searched 72-hour window. The terminal-wide and Downtown boards retain their one-hour window.

Additional localized safeguards: stop-filtered realtime caches cannot leak one board's stop selection into another; platform 2 starts only its required agency's departure-feed request; LIVE expiry incorporates prediction and vehicle evidence; tomorrow wording uses Toronto calendar-day arithmetic across daylight-saving changes; the LINX trip-update defaults and checked-in Vercel/sample configuration use HTTPS. Private `.env` files were not modified; existing environment overrides must be checked during a future release.

## Files

- Frontend: `frontend/src/platform-departures/{main.js,index.html,styles.css}`.
- Backend: `server/{departures.js,gtfs-trip-updates.js,platform-departures.js,server.js,simcoe-linx.js}`.
- Configuration/documentation: `.env.example`, `vercel.json`, `README.md`, this note.
- Tests: `tests/{platform-sign-reliability.test.js,gtfs-trip-updates.test.js,api.test.js}`, `e2e/platform-departures.e2e.js`.
- Isolated browser fixture: `scripts/test-platform-sign-server.js`, `e2e/platform-sign.config.js`.

## Completed verification

- **115 automated tests passed across ten files**, including the new regressions plus shared departure, API, LINX, GO, shelter, and terminal checks.
- **All 11 platform browser tests passed** against the updated local sign, including 320 × 80 geometry, visible outage warning, cached-state expiry, stalled-request timeout/recovery, discarded late responses, missing schedule, explicit empty window, and expired evidence.
- The fixture uses the normal esbuild/Babel legacy transformation in memory. It does not delete or replace `frontend/dist` or download/overwrite schedule caches.
- Focused lint passed for changed JavaScript files. Normal repository `git diff --check` passed.
- At **12:05 p.m. EDT on October 2**, the updated local backend was exercised against real public LINX predictions and the public vehicle endpoint, using the current LINX metadata captured during the review. It returned Platform 02 / Route 2 / Wasaga Beach 45th St / **12:30 p.m. EDT**, with available schedule status, a 72-hour horizon, and a bounded LIVE expiry of approximately **12:07:31 p.m.** This was a read-only local integration check, not a deployment.

One concurrent verification run hit the existing five-second timeout on the API suite's initial module load while the browser fixture was compiling. The final serial run passed all 115 tests at the original timeout; no timeout limit was increased. The initial fixture startup also needed its working directory made explicit; the final browser run passed all 11 tests.

Reproduce:

```powershell
npx vitest run tests/platform-sign-reliability.test.js tests/gtfs-trip-updates.test.js tests/departures.test.js tests/platform-departures.test.js tests/api.test.js tests/terminal-progress.test.js tests/terminal-layout.test.js tests/simcoe-linx.test.js tests/go-transit.test.js tests/shelter-departures.test.js --maxWorkers=1
npx playwright test --config e2e/platform-sign.config.js
```

## Boundaries at the local verification stage

At this local verification stage, no full-project build, full-repository suite, dependency changes, production deployment, or installed-sign test had been performed. The subsequent full production build and deployment are recorded in the linked release note. No Firebase-backed reads or writes were changed; Firestore rules, indexes, and Storage rules are not applicable here. The physical Platform 2 assignment and inferred inbound/outbound vehicle continuity still need operational confirmation. Prior review artifacts and unrelated local PDF/image work were preserved.

Deployment approval, production environment checks, full build, public-alias checks, and deployed-browser regression tests are now complete; see the release record. Recovery, clock/timezone, and legibility on the installed sign remain unverified.
