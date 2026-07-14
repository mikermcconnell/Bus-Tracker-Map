const SLIDE_DURATION_MS = 20000;
const INITIAL_RETRY_MS = 60000;
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;
const STALE_WARNING_MS = 30 * 60 * 1000;
const IMAGE_LOAD_TIMEOUT_MS = 12000;
const STORAGE_KEY = 'barrie-transit-notice-playlist-v1';

function resolveAppUrl(target) {
  const appPath = window.location.pathname.replace(/\/notices\/?$/, '/');
  const appBase = `${window.location.origin}${appPath}`;
  return new URL(target, appBase).toString();
}

function requestJson(url) {
  if (typeof fetch === 'function') {
    return fetch(url, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response.json();
    });
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(request.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`Request failed: ${request.status}`));
      }
    };
    request.onerror = function () {
      reject(new Error('Network request failed'));
    };
    request.send(null);
  });
}

function isValidManifest(value) {
  return Boolean(
    value &&
    (value.status === 'fresh' || value.status === 'stale') &&
    typeof value.checked_at === 'string' &&
    Array.isArray(value.slides)
  );
}

function readStoredManifest() {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    return isValidManifest(value) ? value : null;
  } catch (err) {
    return null;
  }
}

function storeManifest(manifest) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
  } catch (err) {
    // Storage can be disabled in some TV privacy modes. The live slideshow still works.
  }
}

function createNoticePlayer(elements) {
  let manifest = null;
  let slides = [];
  let currentIndex = -1;
  let activeImage = elements.imageA;
  let standbyImage = elements.imageB;
  let slideTimer = null;
  let refreshTimer = null;
  let hintTimer = null;
  let paused = false;
  let transitionToken = 0;
  const failedSlideIds = new Set();

  function clearSlideTimer() {
    if (slideTimer) window.clearTimeout(slideTimer);
    slideTimer = null;
  }

  function setHolding(title, message) {
    clearSlideTimer();
    elements.stage.hidden = true;
    elements.holding.hidden = false;
    elements.holdingTitle.textContent = title;
    elements.holdingMessage.textContent = message;
    elements.title.textContent = title;
    elements.page.textContent = '';
  }

  function setStaleState() {
    if (!manifest) {
      elements.stale.hidden = true;
      return;
    }
    const checkedAt = Date.parse(manifest.checked_at);
    const oldEnough = Number.isFinite(checkedAt) && Date.now() - checkedAt >= STALE_WARNING_MS;
    elements.stale.hidden = !(manifest.status === 'stale' && oldEnough);
    if (!elements.stale.hidden) {
      elements.stale.textContent = `Updated ${formatAge(checkedAt)} ago`;
    }
  }

  function formatAge(timestamp) {
    const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `${hours} hr`;
  }

  function updateFooter(slide) {
    elements.title.textContent = slide.title || 'Service notice';
    elements.page.textContent = slide.page_count > 1
      ? `Page ${slide.page} of ${slide.page_count}`
      : 'Page 1 of 1';
    setStaleState();
  }

  function scheduleNext() {
    clearSlideTimer();
    if (paused || document.hidden || slides.length < 2) return;
    slideTimer = window.setTimeout(() => showRelative(1), SLIDE_DURATION_MS);
  }

  function preloadNext() {
    if (slides.length < 2 || currentIndex < 0) return;
    const nextSlide = slides[(currentIndex + 1) % slides.length];
    const image = new Image();
    image.src = resolveAppUrl(nextSlide.image_url);
  }

  function loadSlide(index, retryCount = 0) {
    if (!slides.length) return;
    const normalizedIndex = (index + slides.length) % slides.length;
    const slide = slides[normalizedIndex];
    const token = ++transitionToken;
    const imageUrl = resolveAppUrl(slide.image_url);
    const timeout = window.setTimeout(() => {
      if (token !== transitionToken) return;
      standbyImage.onload = null;
      standbyImage.onerror = null;
      handleImageFailure(normalizedIndex, retryCount);
    }, IMAGE_LOAD_TIMEOUT_MS);

    standbyImage.onload = function () {
      if (token !== transitionToken) return;
      window.clearTimeout(timeout);
      standbyImage.onload = null;
      standbyImage.onerror = null;
      elements.stage.hidden = false;
      elements.holding.hidden = true;
      updateFooter(slide);
      standbyImage.alt = slide.title || 'Service notice';
      standbyImage.classList.add('notice-image--visible');
      activeImage.classList.remove('notice-image--visible');
      const oldImage = activeImage;
      activeImage = standbyImage;
      standbyImage = oldImage;
      currentIndex = normalizedIndex;
      failedSlideIds.clear();
      scheduleNext();
      window.setTimeout(preloadNext, 500);
    };

    standbyImage.onerror = function () {
      if (token !== transitionToken) return;
      window.clearTimeout(timeout);
      standbyImage.onload = null;
      standbyImage.onerror = null;
      handleImageFailure(normalizedIndex, retryCount);
    };
    standbyImage.src = imageUrl;
  }

  function handleImageFailure(index, retryCount) {
    if (retryCount < 2) {
      window.setTimeout(() => loadSlide(index, retryCount + 1), 1000);
      return;
    }
    failedSlideIds.add(slides[index].id);
    if (failedSlideIds.size >= slides.length) {
      setHolding('Service notices unavailable', 'The display will keep trying to reload the notice pages.');
      scheduleRefresh(INITIAL_RETRY_MS, true);
      return;
    }
    if (slides.length > 1) {
      loadSlide(index + 1, 0);
      refreshManifest(true);
      return;
    }
    setHolding('Service notice unavailable', 'The display will keep trying to reload this notice.');
    scheduleRefresh(INITIAL_RETRY_MS, true);
  }

  function showRelative(offset) {
    if (!slides.length) return;
    clearSlideTimer();
    const start = currentIndex < 0 ? 0 : currentIndex;
    loadSlide(start + offset);
  }

  function applyManifest(nextManifest, { preserveCurrent = true } = {}) {
    if (!isValidManifest(nextManifest)) throw new Error('Invalid service notice response');
    const currentSlideId = preserveCurrent && currentIndex >= 0 && slides[currentIndex]
      ? slides[currentIndex].id
      : null;
    manifest = nextManifest;
    slides = nextManifest.slides.filter((slide) => slide && slide.id && slide.image_url);
    failedSlideIds.clear();
    setStaleState();

    if (!slides.length) {
      currentIndex = -1;
      setHolding('No active PDF service notices', 'This screen will update automatically when a new notice is published.');
      return;
    }

    if (currentSlideId) {
      let retainedIndex = -1;
      for (let index = 0; index < slides.length; index += 1) {
        if (slides[index].id === currentSlideId) {
          retainedIndex = index;
          break;
        }
      }
      if (retainedIndex >= 0) {
        currentIndex = retainedIndex;
        updateFooter(slides[currentIndex]);
        scheduleNext();
        preloadNext();
        return;
      }
    }
    loadSlide(0);
  }

  function scheduleRefresh(delay, forceSoon = false) {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    const actualDelay = forceSoon ? Math.min(delay, INITIAL_RETRY_MS) : delay;
    refreshTimer = window.setTimeout(() => refreshManifest(), actualDelay);
  }

  function refreshManifest(forceSoon = false) {
    return requestJson(resolveAppUrl('api/notices'))
      .then((nextManifest) => {
        applyManifest(nextManifest);
        storeManifest(nextManifest);
        scheduleRefresh(Number(nextManifest.refresh_after_ms) || DEFAULT_REFRESH_MS);
      })
      .catch((err) => {
        console.error('Unable to refresh service notices:', err);
        if (manifest) {
          manifest = { ...manifest, status: 'stale' };
          setStaleState();
        } else {
          const stored = readStoredManifest();
          if (stored) {
            applyManifest({ ...stored, status: 'stale' }, { preserveCurrent: false });
          } else {
            setHolding('Service notices unavailable', 'The display will retry automatically.');
          }
        }
        scheduleRefresh(forceSoon ? INITIAL_RETRY_MS : DEFAULT_REFRESH_MS, forceSoon || !manifest);
      });
  }

  function togglePause() {
    paused = !paused;
    if (paused) {
      clearSlideTimer();
      elements.page.textContent = `${elements.page.textContent} · Paused`;
    } else {
      if (currentIndex >= 0) updateFooter(slides[currentIndex]);
      scheduleNext();
    }
  }

  function requestFullscreen() {
    const root = document.documentElement;
    const method = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
    if (method) {
      try {
        const result = method.call(root);
        if (result && result.catch) result.catch(() => {});
      } catch (err) {
        // Some TV browsers expose the method but reject the request.
      }
    }
    elements.fullscreenHint.hidden = true;
  }

  function handleKey(event) {
    const keyCode = event.keyCode || event.which;
    if (event.key === 'ArrowRight' || keyCode === 39) {
      event.preventDefault();
      showRelative(1);
    } else if (event.key === 'ArrowLeft' || keyCode === 37) {
      event.preventDefault();
      showRelative(-1);
    } else if (event.key === ' ' || event.key === 'Spacebar' || keyCode === 32) {
      event.preventDefault();
      togglePause();
    } else if (event.key === 'Enter' || keyCode === 13) {
      requestFullscreen();
    }
  }

  function handleVisibility() {
    if (document.hidden) {
      clearSlideTimer();
      return;
    }
    scheduleNext();
    refreshManifest();
  }

  function start() {
    const stored = readStoredManifest();
    if (stored) applyManifest({ ...stored, status: 'stale' }, { preserveCurrent: false });
    else setHolding('Loading service notices', 'Please wait…');

    document.addEventListener('keydown', handleKey);
    document.addEventListener('visibilitychange', handleVisibility);

    const root = document.documentElement;
    if (root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen) {
      elements.fullscreenHint.hidden = false;
      hintTimer = window.setTimeout(() => {
        elements.fullscreenHint.hidden = true;
      }, 8000);
    }
    refreshManifest(true);
  }

  function stop() {
    clearSlideTimer();
    if (refreshTimer) window.clearTimeout(refreshTimer);
    if (hintTimer) window.clearTimeout(hintTimer);
    document.removeEventListener('keydown', handleKey);
    document.removeEventListener('visibilitychange', handleVisibility);
  }

  return { start, stop, applyManifest, showRelative };
}

function bootstrap() {
  const player = createNoticePlayer({
    stage: document.getElementById('notice-stage'),
    imageA: document.getElementById('notice-image-a'),
    imageB: document.getElementById('notice-image-b'),
    holding: document.getElementById('holding-screen'),
    holdingTitle: document.getElementById('holding-title'),
    holdingMessage: document.getElementById('holding-message'),
    title: document.getElementById('notice-title'),
    page: document.getElementById('notice-page'),
    stale: document.getElementById('stale-status'),
    fullscreenHint: document.getElementById('fullscreen-hint'),
  });
  player.start();
  window.noticePlayer = player;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
}

export { createNoticePlayer, isValidManifest };
