// Self-healing rules for the unattended terminal TV. Nobody reloads the
// screen by hand, so the page must recover from stalls and pick up deploys.

const NIGHTLY_RELOAD_START_MINUTES = 3 * 60 + 30; // 03:30 Toronto time
const NIGHTLY_RELOAD_WINDOW_MINUTES = 30;
const MIN_UPTIME_BEFORE_NIGHTLY_RELOAD_MS = 60 * 60 * 1000;
const MIN_POLL_STALL_MS = 60 * 1000;

function torontoMinutesOfDay(nowMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const value = (type) => Number((parts.find((part) => part.type === type) || {}).value);
  // Some engines format midnight as hour "24" when hour12 is false.
  return (value('hour') % 24) * 60 + value('minute');
}

export function isNightlyReloadDue(nowMs, startedAtMs) {
  const minutes = torontoMinutesOfDay(nowMs);
  return minutes >= NIGHTLY_RELOAD_START_MINUTES &&
    minutes < NIGHTLY_RELOAD_START_MINUTES + NIGHTLY_RELOAD_WINDOW_MINUTES &&
    nowMs - startedAtMs >= MIN_UPTIME_BEFORE_NIGHTLY_RELOAD_MS;
}

export function extractBuildId(html) {
  const match = /<meta\s+name=["']app-build-id["']\s+content=["']([^"']*)["']/i.exec(String(html || ''));
  return match ? match[1] : '';
}

export function isNewBuild(currentBuildId, servedHtml) {
  const servedBuildId = extractBuildId(servedHtml);
  return Boolean(currentBuildId && servedBuildId && servedBuildId !== currentBuildId);
}

export function isPollStalled(lastSettledAtMs, nowMs, pollMs) {
  return nowMs - lastSettledAtMs > Math.max(3 * pollMs, MIN_POLL_STALL_MS);
}

export function fetchText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response.text();
      })
      .then((text) => {
        clearTimeout(timer);
        resolve(text);
      }, (error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
