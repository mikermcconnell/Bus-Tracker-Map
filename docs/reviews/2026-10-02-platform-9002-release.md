# Platform 9002 production release — October 2, 2026

## Result

Deployed and verified at https://bus-tracker-map.vercel.app/departures/platform.aspx?stop=9002.

- Runtime source commit: `debbaa4dca25546286eb3c9478e3a1c7a32bf088`.
- Local release branch: `release/platform-9002-20261002`.
- Vercel project: `bus-tracker-map` / `prj_OlmGY5xATf3EpRmJgDLg2CMqbXgq`.
- Vercel team: `team_jtuyv8Zl1Ed7wWqN2Xuppw8V`.
- Deployment: `dpl_CnU6XJtRFJ3yMCdp2Z6TJ3sHZPar`.
- Deployment URL: https://bus-tracker-ckc36rtfq-mike-mcconnells-projects.vercel.app.
- Production build completed; the deployment was checked before promotion. Public-alias verification started at 2026-10-02 16:16:31 UTC (12:16:31 EDT).
- Operational risk: high, because shared departure scheduling and public LIVE claims changed. Release was isolated and checked against current public transit data.

## Scope and preservation

Released only the reviewed platform-sign fixes, related API changes, configuration, regression tests, and review evidence. No dependency or lockfile changes. Production Node 22 confirmed. Primary checkout, local builds/caches, and unrelated PDF/image work were preserved.

Deployment used an isolated release worktree and the authenticated Vercel CLI. No GitHub push, primary-branch merge, Railway monitor deployment, or Firebase changes were performed. The runtime release commit exists locally; GitHub main remains at the prior baseline. This avoids triggering an unrelated monitor release.

Production environment variables were inspected privately: no project override existed for the LINX enable flags, static URL, or either LINX trip-update URL. Checked-in HTTPS trip-update configuration applies. The downloaded private environment file was removed before deployment and was not committed.

## Completed verification

- Clean dependency installation and all **115 relevant tests across ten files** passed in the release worktree.
- Full Vercel `npm run build` succeeded, including the frontend and all transit-data build steps. LINX data was downloaded afresh; build generated 28 Route 2 trips serving Allandale.
- Public HTML and both fingerprinted platform assets returned 200; asset identities matched this build: `platformDepartures.d1f1a31eac.js`, `platformDepartures.3ca508d3f7.css`.
- Public page retained restrictive Content-Security-Policy and `Cache-Control: no-cache`.
- Actual public platform API returned Platform 02, available schedule, 72-hour horizon, LINX Route 2, Wasaga Beach 45th St, service date 20261002, and 12:30 p.m. EDT departure. LIVE evidence included a trip prediction plus bounded terminal-handoff vehicle inference; expiry remained within two minutes of the prediction timestamp.
- Invalid platform stop returned 400 / INVALID_STOP_CODE; terminal-wide API retained its one-hour horizon and returned ten departure rows at verification time.
- Actual public page rendered at **320 × 80**, with correct title, platform, route, loaded LINX logo, working clock/countdown, no overflow, and no uncaught page errors. Screenshot inspected visually.
- All **11 browser regressions passed against the deployed public frontend**. Transit-feed outages, cached expiry, missing schedules, and hanging/late requests were simulated only inside the test browser; production feeds were not altered.
- Vercel confirmed the public alias resolves to the new READY deployment. Error-level log query for this deployment returned no entries; this is a point-in-time check, not prolonged monitoring.

Evidence: [API and browser capture](2026-10-02-platform-9002-release-evidence.json); [public screenshot](../../output/playwright/platform-9002-review/deployed-9002-320x80.png).

## Rollback

Prior READY production deployment: `dpl_FsrjvUFKHaQCWAWAf3unQgoypGio`, https://bus-tracker-83w5kwn2k-mike-mcconnells-projects.vercel.app, deployed September 28, 2026.

From a checkout linked to this Vercel project, an authorized operator can run:

```text
vercel rollback dpl_FsrjvUFKHaQCWAWAf3unQgoypGio --yes
```

Then recheck the public alias. Rollback was recorded, not executed.

## Remaining boundaries

The installed physical sign was not tested. Its network/firmware, clock, and legibility require on-device confirmation. Physical Platform 2 assignment remains maintained in code rather than supplied by GTFS; terminal-handoff vehicle continuity is a bounded inference, not dispatch confirmation. The full repository test/lint suites were not rerun for this scoped release; the focused regression suite and production build passed. No sustained monitoring, Railway deployment, or GitHub publication is claimed.
