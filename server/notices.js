const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fetch = require('node-fetch');
const sharp = require('sharp');

const DEFAULT_NEWS_URL = 'https://myridebarrie.ca/News/GetAllNews';
const MYRIDE_ORIGIN = 'https://myridebarrie.ca';
const PDF_ORIGIN = 'https://assets.barrie.ca';
const PDF_PATH_PREFIX = '/assets/MyRide/';
const MANIFEST_TTL_MS = 2 * 60 * 60 * 1000;
const LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;
const PDF_META_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PAGES_PER_DOCUMENT = 20;
const MAX_SLIDES = 50;
const FETCH_TIMEOUT_MS = 20 * 1000;
const CACHE_PREFIX = 'notice-display:v2';

function cacheKey(name) {
  return `${CACHE_PREFIX}:${name}`;
}

class NoticeError extends Error {
  constructor(message, { code = 'NOTICE_ERROR', statusCode = 500 } = {}) {
    super(message);
    this.name = 'NoticeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)));
}

function normalizePdfUrl(candidate, baseUrl = MYRIDE_ORIGIN) {
  let parsed;
  try {
    parsed = new URL(decodeHtmlEntities(candidate), baseUrl);
  } catch (err) {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.origin !== PDF_ORIGIN) return null;
  if (!parsed.pathname.startsWith(PDF_PATH_PREFIX)) return null;
  if (!/\.pdf$/i.test(parsed.pathname)) return null;
  parsed.hash = '';
  return parsed.toString();
}

function extractPdfUrls(html, baseUrl) {
  const found = [];
  const seen = new Set();
  const pattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    const pdfUrl = normalizePdfUrl(match[1], baseUrl);
    if (!pdfUrl || seen.has(pdfUrl)) continue;
    seen.add(pdfUrl);
    found.push(pdfUrl);
  }
  return found;
}

function makeDocumentId(pdfUrl, version) {
  return crypto.createHash('sha256').update(`${pdfUrl}\n${version}`).digest('hex').slice(0, 24);
}

function makeSlideId(noticeId, documentId, page) {
  return `${noticeId}-${documentId}-${page}`;
}

function headerValue(headers, name) {
  const value = headers && headers.get ? headers.get(name) : null;
  return value ? String(value).trim() : '';
}

function pdfVersionFromHeaders(headers) {
  const etag = headerValue(headers, 'etag');
  const lastModified = headerValue(headers, 'last-modified');
  const contentLength = headerValue(headers, 'content-length');
  return etag || lastModified || contentLength || '';
}

function parseContentLength(headers) {
  const raw = headerValue(headers, 'content-length');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = [];
  for (let index = 0; index < Math.min(limit, items.length); index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function createMemoryCache() {
  const values = new Map();
  return {
    async get(key) {
      const item = values.get(key);
      if (!item) return undefined;
      if (item.expiresAt <= Date.now()) {
        values.delete(key);
        return undefined;
      }
      return item.value;
    },
    async set(key, value, options = {}) {
      const ttlSeconds = Math.max(1, Number(options.ttl) || 60);
      values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    clear() {
      values.clear();
    },
  };
}

function createCacheAdapter({ memoryCache = createMemoryCache() } = {}) {
  let remoteCachePromise;

  async function getRemoteCache() {
    if (!process.env.VERCEL) return null;
    if (!remoteCachePromise) {
      remoteCachePromise = import('@vercel/functions')
        .then(({ getCache }) => getCache({ namespace: 'service-notices' }))
        .catch((err) => {
          console.warn('[notices] Vercel Runtime Cache unavailable:', err.message);
          return null;
        });
    }
    return remoteCachePromise;
  }

  return {
    async get(key) {
      const local = await memoryCache.get(key);
      if (local !== undefined) return local;
      const remote = await getRemoteCache();
      if (!remote) return undefined;
      try {
        const value = await remote.get(key);
        if (value !== undefined) {
          await memoryCache.set(key, value, { ttl: 60 });
        }
        return value;
      } catch (err) {
        console.warn('[notices] Runtime cache read failed:', err.message);
        return undefined;
      }
    },
    async set(key, value, options) {
      await memoryCache.set(key, value, options);
      const remote = await getRemoteCache();
      if (!remote) return;
      try {
        await remote.set(key, value, options);
      } catch (err) {
        console.warn('[notices] Runtime cache write failed:', err.message);
      }
    },
  };
}

function publicManifest(record, status, currentTime = Date.now()) {
  const checkedAt = Date.parse(record.checkedAt);
  const ageMs = Number.isFinite(checkedAt) ? Math.max(0, currentTime - checkedAt) : 0;
  const refreshAfterMs = status === 'fresh'
    ? Math.max(1000, MANIFEST_TTL_MS - ageMs)
    : MANIFEST_TTL_MS;
  return {
    status,
    checked_at: record.checkedAt,
    refresh_after_ms: refreshAfterMs,
    slides: record.slides.map((slide) => ({ ...slide })),
  };
}

function createNoticeService(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const cache = options.cache || createCacheAdapter();
  const now = options.now || (() => new Date());
  const newsUrl = options.newsUrl || process.env.MYRIDE_NEWS_URL || DEFAULT_NEWS_URL;
  const renderPdfPage = options.renderPdfPage || renderPdfPageToJpeg;
  const inspectPdf = options.inspectPdf || inspectPdfFile;
  let refreshPromise = null;

  async function request(url, requestOptions = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestOptions.timeoutMs || FETCH_TIMEOUT_MS);
    try {
      return await fetchImpl(url, {
        ...requestOptions,
        timeoutMs: undefined,
        signal: controller.signal,
        headers: {
          'User-Agent': 'BarrieTransitNoticeDisplay/1.0',
          ...(requestOptions.headers || {}),
        },
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new NoticeError(`Timed out requesting ${url}`, { code: 'UPSTREAM_TIMEOUT', statusCode: 504 });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchJson(url) {
    const response = await request(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new NoticeError(`MyRide returned HTTP ${response.status}`, { code: 'UPSTREAM_HTTP', statusCode: 502 });
    }
    return response.json();
  }

  async function fetchText(url) {
    const response = await request(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new NoticeError(`MyRide returned HTTP ${response.status}`, { code: 'UPSTREAM_HTTP', statusCode: 502 });
    }
    return response.text();
  }

  async function getPdfHead(pdfUrl) {
    const response = await request(pdfUrl, { method: 'HEAD', redirect: 'manual' });
    if (!response.ok) {
      throw new NoticeError(`PDF returned HTTP ${response.status}`, { code: 'PDF_HTTP', statusCode: 502 });
    }
    const contentType = headerValue(response.headers, 'content-type').toLowerCase();
    if (contentType && !contentType.includes('application/pdf')) {
      throw new NoticeError('Notice attachment is not a PDF', { code: 'INVALID_PDF_TYPE', statusCode: 415 });
    }
    const contentLength = parseContentLength(response.headers);
    if (contentLength !== null && contentLength > MAX_PDF_BYTES) {
      throw new NoticeError('Notice PDF exceeds the size limit', { code: 'PDF_TOO_LARGE', statusCode: 413 });
    }
    const version = pdfVersionFromHeaders(response.headers);
    if (!version) {
      throw new NoticeError('Notice PDF has no usable version metadata', { code: 'PDF_VERSION_MISSING', statusCode: 502 });
    }
    return { version, contentLength };
  }

  async function downloadPdf(pdfUrl) {
    const response = await request(pdfUrl, { redirect: 'manual' });
    if (!response.ok) {
      throw new NoticeError(`PDF returned HTTP ${response.status}`, { code: 'PDF_HTTP', statusCode: 502 });
    }
    const contentType = headerValue(response.headers, 'content-type').toLowerCase();
    if (contentType && !contentType.includes('application/pdf')) {
      throw new NoticeError('Notice attachment is not a PDF', { code: 'INVALID_PDF_TYPE', statusCode: 415 });
    }
    const announcedLength = parseContentLength(response.headers);
    if (announcedLength !== null && announcedLength > MAX_PDF_BYTES) {
      throw new NoticeError('Notice PDF exceeds the size limit', { code: 'PDF_TOO_LARGE', statusCode: 413 });
    }
    const buffer = await response.buffer();
    if (buffer.length > MAX_PDF_BYTES) {
      throw new NoticeError('Notice PDF exceeds the size limit', { code: 'PDF_TOO_LARGE', statusCode: 413 });
    }
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new NoticeError('Notice attachment is not a readable PDF', { code: 'INVALID_PDF', statusCode: 415 });
    }
    return buffer;
  }

  async function getPageCount(pdfUrl, documentId) {
    const metadataKey = cacheKey(`pdf-meta:${documentId}`);
    const cached = await cache.get(metadataKey);
    if (cached && Number.isInteger(cached.pageCount)) return cached.pageCount;

    const pdfBuffer = await downloadPdf(pdfUrl);
    const pageCount = await inspectPdf(pdfBuffer, documentId);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES_PER_DOCUMENT) {
      throw new NoticeError('Notice PDF has an unsupported page count', { code: 'PDF_PAGE_LIMIT', statusCode: 422 });
    }
    await cache.set(metadataKey, { pageCount }, { ttl: PDF_META_TTL_SECONDS, tags: ['service-notices'] });
    return pageCount;
  }

  async function buildManifestRecord() {
    const rawNews = await fetchJson(newsUrl);
    if (!Array.isArray(rawNews)) {
      throw new NoticeError('MyRide returned an invalid notice list', { code: 'INVALID_NEWS_RESPONSE', statusCode: 502 });
    }
    const newsItems = rawNews.slice(0, 50).filter((item) => item && item.newsId && item.friendlyUrl);
    const itemDocuments = await mapLimit(newsItems, 4, async (item) => {
      const detailUrl = new URL(
        `/News/${encodeURIComponent(String(item.newsId))}/${encodeURIComponent(String(item.friendlyUrl))}/`,
        MYRIDE_ORIGIN
      ).toString();
      const html = await fetchText(detailUrl);
      return {
        item,
        detailUrl,
        pdfUrls: extractPdfUrls(html, detailUrl),
      };
    });

    const uniqueDocuments = [];
    const seenPdfUrls = new Set();
    for (const entry of itemDocuments) {
      for (const pdfUrl of entry.pdfUrls) {
        if (seenPdfUrls.has(pdfUrl)) continue;
        seenPdfUrls.add(pdfUrl);
        uniqueDocuments.push({
          noticeId: entry.item.newsId,
          title: String(entry.item.title || 'Service notice').trim() || 'Service notice',
          publishedAt: entry.item.publishDateUtc || null,
          pdfUrl,
        });
      }
    }

    const inspected = await mapLimit(uniqueDocuments, 2, async (document) => {
      try {
        const head = await getPdfHead(document.pdfUrl);
        const documentId = makeDocumentId(document.pdfUrl, head.version);
        const pageCount = await getPageCount(document.pdfUrl, documentId);
        return { ...document, ...head, documentId, pageCount };
      } catch (err) {
        console.error(`[notices] Skipping ${document.pdfUrl}: ${err.message}`);
        return null;
      }
    });

    const documents = inspected.filter(Boolean);
    if (uniqueDocuments.length && !documents.length) {
      throw new NoticeError('No published notice PDFs could be processed', {
        code: 'NOTICE_PDF_PROCESSING_FAILED',
        statusCode: 502,
      });
    }
    const slides = [];
    for (const document of documents) {
      for (let page = 1; page <= document.pageCount && slides.length < MAX_SLIDES; page += 1) {
        slides.push({
          id: makeSlideId(document.noticeId, document.documentId, page),
          notice_id: document.noticeId,
          title: document.title,
          published_at: document.publishedAt,
          page,
          page_count: document.pageCount,
          image_url: `api/notices/pages/${document.documentId}/${page}.jpg`,
        });
      }
      if (slides.length >= MAX_SLIDES) break;
    }

    return {
      checkedAt: now().toISOString(),
      documents,
      slides,
    };
  }

  async function refreshManifest() {
    const record = await buildManifestRecord();
    await cache.set(cacheKey('manifest:fresh'), record, {
      ttl: Math.ceil(MANIFEST_TTL_MS / 1000),
      tags: ['service-notices'],
    });
    await cache.set(cacheKey('manifest:last-good'), record, {
      ttl: LAST_GOOD_TTL_SECONDS,
      tags: ['service-notices'],
    });
    return record;
  }

  async function getManifest({ force = false } = {}) {
    if (!force) {
      const fresh = await cache.get(cacheKey('manifest:fresh'));
      if (fresh) return publicManifest(fresh, 'fresh', now().getTime());
    }

    if (!refreshPromise) {
      refreshPromise = refreshManifest().finally(() => {
        refreshPromise = null;
      });
    }

    try {
      const record = await refreshPromise;
      return publicManifest(record, 'fresh', now().getTime());
    } catch (err) {
      console.error('[notices] Failed to refresh notice manifest:', err.message);
      const lastGood = await cache.get(cacheKey('manifest:last-good'));
      if (lastGood) return publicManifest(lastGood, 'stale', now().getTime());
      throw new NoticeError('Service notices are temporarily unavailable', {
        code: 'NOTICES_UNAVAILABLE',
        statusCode: 503,
      });
    }
  }

  async function getKnownDocument(documentId) {
    let record = await cache.get(cacheKey('manifest:fresh'));
    if (!record) record = await cache.get(cacheKey('manifest:last-good'));
    if (!record) {
      await getManifest();
      record = await cache.get(cacheKey('manifest:fresh')) || await cache.get(cacheKey('manifest:last-good'));
    }
    return record && record.documents.find((document) => document.documentId === documentId);
  }

  async function getPageImage(documentId, pageInput) {
    const page = Number(pageInput);
    const document = await getKnownDocument(documentId);
    if (!document) {
      throw new NoticeError('Notice document not found', { code: 'DOCUMENT_NOT_FOUND', statusCode: 404 });
    }
    if (!Number.isInteger(page) || page < 1 || page > document.pageCount) {
      throw new NoticeError('Notice page not found', { code: 'PAGE_NOT_FOUND', statusCode: 404 });
    }

    const currentHead = await getPdfHead(document.pdfUrl);
    if (currentHead.version !== document.version) {
      await cache.set(cacheKey('manifest:fresh'), null, { ttl: 1, tags: ['service-notices'] });
      throw new NoticeError('Notice document changed; refresh the playlist', {
        code: 'DOCUMENT_CHANGED',
        statusCode: 409,
      });
    }

    const pdfBuffer = await downloadPdf(document.pdfUrl);
    return renderPdfPage(pdfBuffer, page, documentId);
  }

  return {
    getManifest,
    getPageImage,
    _buildManifestRecord: buildManifestRecord,
  };
}

async function withTemporaryPdf(buffer, identifier, callback) {
  const safeId = String(identifier || 'notice').replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'notice';
  const temporaryPath = path.join(
    os.tmpdir(),
    `barrie-notice-${safeId}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.pdf`
  );
  await fs.promises.writeFile(temporaryPath, buffer, { flag: 'wx' });
  try {
    return await callback(temporaryPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function inspectPdfFile(buffer, identifier) {
  return withTemporaryPdf(buffer, identifier, async (temporaryPath) => {
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(temporaryPath, { scale: 2 });
    try {
      return document.length;
    } finally {
      await document.destroy();
    }
  });
}

async function renderPdfPageToJpeg(buffer, page, identifier) {
  return withTemporaryPdf(buffer, identifier, async (temporaryPath) => {
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(temporaryPath, { scale: 2 });
    try {
      const png = await document.getPage(page);
      return sharp(png)
        .flatten({ background: '#ffffff' })
        .resize({
          width: 1920,
          height: 1080,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
        .toBuffer();
    } finally {
      await document.destroy();
    }
  });
}

const noticeService = createNoticeService();

module.exports = {
  MANIFEST_TTL_MS,
  NoticeError,
  createMemoryCache,
  createNoticeService,
  decodeHtmlEntities,
  extractPdfUrls,
  makeDocumentId,
  normalizePdfUrl,
  noticeService,
  pdfVersionFromHeaders,
  inspectPdfFile,
  renderPdfPageToJpeg,
};
