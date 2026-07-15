import { beforeEach, describe, expect, test, vi } from 'vitest';
import nodeFetch from 'node-fetch';
import noticesModule from '../server/notices.js';

const { Headers, Response } = nodeFetch;
const {
  MANIFEST_TTL_MS,
  createMemoryCache,
  createNoticeService,
  extractPdfUrls,
  makeDocumentId,
  normalizePdfUrl,
  inspectPdfFile,
  renderPdfPageToJpeg,
} = noticesModule;

function createMinimalPdf() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << >> >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(content, 'ascii'));
    content += object;
  }
  const xrefOffset = Buffer.byteLength(content, 'ascii');
  content += `xref\n0 ${objects.length + 1}\n`;
  content += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    content += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(content, 'ascii');
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(value, status = 200) {
  return new Response(value, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function pdfHeadResponse(version = '"pdf-v1"', length = 1000) {
  return new Response(null, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(length),
      etag: version,
    },
  });
}

function pdfResponse(version = '"pdf-v1"') {
  return new Response(Buffer.from('%PDF-test-fixture'), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-length': '17',
      etag: version,
    },
  });
}

describe('notice PDF link validation', () => {
  test('extracts allowed MyRide PDFs in page order and removes duplicates', () => {
    const html = [
      '<a href="https://assets.barrie.ca/assets/MyRide/First.PDF">First</a>',
      '<a href="https://assets.barrie.ca/assets/MyRide/First.PDF">Duplicate</a>',
      '<a href="https://assets.barrie.ca/assets/MyRide/Second%20Map.pdf?download=1&amp;x=2">Second</a>',
      '<a href="https://evil.example/assets/MyRide/Bad.pdf">Bad</a>',
    ].join('');

    expect(extractPdfUrls(html, 'https://myridebarrie.ca/News/1/test/')).toEqual([
      'https://assets.barrie.ca/assets/MyRide/First.PDF',
      'https://assets.barrie.ca/assets/MyRide/Second%20Map.pdf?download=1&x=2',
    ]);
  });

  test('rejects non-HTTPS, wrong-host, and wrong-folder URLs', () => {
    expect(normalizePdfUrl('http://assets.barrie.ca/assets/MyRide/test.pdf')).toBeNull();
    expect(normalizePdfUrl('https://example.com/assets/MyRide/test.pdf')).toBeNull();
    expect(normalizePdfUrl('https://assets.barrie.ca/other/test.pdf')).toBeNull();
    expect(normalizePdfUrl('https://assets.barrie.ca/assets/MyRide/test.png')).toBeNull();
  });

  test('creates stable versioned document identifiers', () => {
    const first = makeDocumentId('https://assets.barrie.ca/assets/MyRide/a.pdf', 'v1');
    expect(makeDocumentId('https://assets.barrie.ca/assets/MyRide/a.pdf', 'v1')).toBe(first);
    expect(makeDocumentId('https://assets.barrie.ca/assets/MyRide/a.pdf', 'v2')).not.toBe(first);
  });
});

describe('notice PDF rendering', () => {
  test('reads page count and produces a TV-sized JPEG', async () => {
    const pdf = createMinimalPdf();
    await expect(inspectPdfFile(pdf, 'fixture')).resolves.toBe(1);

    const jpeg = await renderPdfPageToJpeg(pdf, 1, 'fixture');
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpeg.length).toBeGreaterThan(1000);
  }, 20000);
});

describe('notice manifest service', () => {
  let cache;
  let fetchImpl;
  let inspectPdf;
  let renderPdfPage;

  beforeEach(() => {
    cache = createMemoryCache();
    inspectPdf = vi.fn(async (_buffer, identifier) => identifier.includes('bad') ? 0 : 2);
    renderPdfPage = vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    fetchImpl = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/News/GetAllNews')) {
        return jsonResponse([
          {
            newsId: 20,
            friendlyUrl: 'newest-notice',
            title: 'Newest notice',
            publishDateUtc: '2026-07-14T12:00:00-04:00',
          },
          {
            newsId: 19,
            friendlyUrl: 'text-only',
            title: 'Text only',
            publishDateUtc: '2026-07-13T12:00:00-04:00',
          },
          {
            newsId: 18,
            friendlyUrl: 'older-notice',
            title: 'Older notice',
            publishDateUtc: '2026-07-12T12:00:00-04:00',
          },
        ]);
      }
      if (target.includes('/News/20/')) {
        return htmlResponse([
          '<a href="https://assets.barrie.ca/assets/MyRide/new.pdf">Map</a>',
          '<a href="https://assets.barrie.ca/assets/MyRide/shared.pdf">Shared</a>',
        ].join(''));
      }
      if (target.includes('/News/19/')) return htmlResponse('<p>No attachment</p>');
      if (target.includes('/News/18/')) {
        return htmlResponse([
          '<a href="https://assets.barrie.ca/assets/MyRide/shared.pdf">Duplicate across notices</a>',
          '<a href="https://assets.barrie.ca/assets/MyRide/old.pdf">Old</a>',
        ].join(''));
      }
      if (target.startsWith('https://assets.barrie.ca/assets/MyRide/')) {
        return options.method === 'HEAD' ? pdfHeadResponse() : pdfResponse();
      }
      return new Response('not found', { status: 404 });
    });
  });

  test('builds ordered page slides from PDF notices and excludes text-only notices', async () => {
    const service = createNoticeService({
      cache,
      fetchImpl,
      inspectPdf,
      renderPdfPage,
      now: () => new Date('2026-07-14T17:00:00Z'),
    });

    const manifest = await service.getManifest();

    expect(manifest.status).toBe('fresh');
    expect(manifest.checked_at).toBe('2026-07-14T17:00:00.000Z');
    expect(manifest.refresh_after_ms).toBe(2 * 60 * 60 * 1000);
    expect(manifest.slides).toHaveLength(6);
    expect(manifest.slides.map((slide) => slide.title)).toEqual([
      'Newest notice',
      'Newest notice',
      'Newest notice',
      'Newest notice',
      'Older notice',
      'Older notice',
    ]);
    expect(manifest.slides.map((slide) => slide.page)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(manifest.slides.every((slide) => slide.image_url.startsWith('api/notices/pages/'))).toBe(true);
    expect(inspectPdf).toHaveBeenCalledTimes(3);
  });

  test('tells displays to refresh when the shared two-hour cache expires', async () => {
    let currentTime = new Date('2026-07-14T17:00:00Z');
    const service = createNoticeService({
      cache,
      fetchImpl,
      inspectPdf,
      renderPdfPage,
      now: () => currentTime,
    });

    const first = await service.getManifest();
    expect(MANIFEST_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(first.refresh_after_ms).toBe(MANIFEST_TTL_MS);

    currentTime = new Date('2026-07-14T18:30:00Z');
    const cached = await service.getManifest();
    expect(cached.refresh_after_ms).toBe(30 * 60 * 1000);
  });

  test('replaces removed notices and includes added notices on the next refresh', async () => {
    let activeNotices = [
      { newsId: 30, friendlyUrl: 'notice-a', title: 'Notice A' },
      { newsId: 31, friendlyUrl: 'notice-b', title: 'Notice B' },
    ];
    const changingFetch = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/News/GetAllNews')) return jsonResponse(activeNotices);
      if (target.includes('/News/30/')) {
        return htmlResponse('<a href="https://assets.barrie.ca/assets/MyRide/a.pdf">A</a>');
      }
      if (target.includes('/News/31/')) {
        return htmlResponse('<a href="https://assets.barrie.ca/assets/MyRide/b.pdf">B</a>');
      }
      if (target.includes('/News/32/')) {
        return htmlResponse('<a href="https://assets.barrie.ca/assets/MyRide/c.pdf">C</a>');
      }
      if (target.startsWith('https://assets.barrie.ca/assets/MyRide/')) {
        const version = `"${target.split('/').pop()}"`;
        return options.method === 'HEAD' ? pdfHeadResponse(version) : pdfResponse(version);
      }
      return new Response('not found', { status: 404 });
    });
    const onePagePdf = vi.fn(async () => 1);
    const service = createNoticeService({
      cache,
      fetchImpl: changingFetch,
      inspectPdf: onePagePdf,
      renderPdfPage,
    });

    const first = await service.getManifest();
    expect(first.slides.map((slide) => slide.title)).toEqual(['Notice A', 'Notice B']);

    activeNotices = [
      { newsId: 31, friendlyUrl: 'notice-b', title: 'Notice B' },
      { newsId: 32, friendlyUrl: 'notice-c', title: 'Notice C' },
    ];
    const refreshed = await service.getManifest({ force: true });

    expect(refreshed.status).toBe('fresh');
    expect(refreshed.slides.map((slide) => slide.title)).toEqual(['Notice B', 'Notice C']);
    expect(refreshed.slides.some((slide) => slide.title === 'Notice A')).toBe(false);
  });

  test('serves a JPEG only for a document and page from the current manifest', async () => {
    const service = createNoticeService({ cache, fetchImpl, inspectPdf, renderPdfPage });
    const manifest = await service.getManifest();
    const imagePath = manifest.slides[0].image_url.split('/');
    const documentId = imagePath[3];

    const image = await service.getPageImage(documentId, 1);
    expect(image).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(renderPdfPage).toHaveBeenCalledOnce();
    await expect(service.getPageImage('unknown-document', 1)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_FOUND',
      statusCode: 404,
    });
    await expect(service.getPageImage(documentId, 99)).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND',
      statusCode: 404,
    });
  });

  test('rejects an old image URL when the source PDF version changes', async () => {
    let version = '"pdf-v1"';
    const versionedFetch = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.startsWith('https://assets.barrie.ca/assets/MyRide/')) {
        return options.method === 'HEAD' ? pdfHeadResponse(version) : pdfResponse(version);
      }
      return fetchImpl(url, options);
    });
    const service = createNoticeService({ cache, fetchImpl: versionedFetch, inspectPdf, renderPdfPage });
    const manifest = await service.getManifest();
    const documentId = manifest.slides[0].image_url.split('/')[3];
    version = '"pdf-v2"';

    await expect(service.getPageImage(documentId, 1)).rejects.toMatchObject({
      code: 'DOCUMENT_CHANGED',
      statusCode: 409,
    });
    expect(renderPdfPage).not.toHaveBeenCalled();
  });

  test('returns a valid empty playlist when active notices contain no PDFs', async () => {
    const textOnlyFetch = vi.fn(async (url) => {
      if (String(url).endsWith('/News/GetAllNews')) {
        return jsonResponse([{ newsId: 19, friendlyUrl: 'text-only', title: 'Text only' }]);
      }
      return htmlResponse('<p>No PDF attachment</p>');
    });
    const service = createNoticeService({
      cache: createMemoryCache(),
      fetchImpl: textOnlyFetch,
      inspectPdf,
      renderPdfPage,
    });

    const manifest = await service.getManifest();
    expect(manifest.status).toBe('fresh');
    expect(manifest.slides).toEqual([]);
  });

  test('does not publish a misleading empty playlist when every PDF fails validation', async () => {
    const service = createNoticeService({
      cache: createMemoryCache(),
      fetchImpl,
      inspectPdf: vi.fn(async () => 0),
      renderPdfPage,
    });

    await expect(service.getManifest()).rejects.toMatchObject({
      code: 'NOTICES_UNAVAILABLE',
      statusCode: 503,
    });
  });

  test('returns the last successful playlist as stale when a refresh fails', async () => {
    const successful = createNoticeService({ cache, fetchImpl, inspectPdf, renderPdfPage });
    const first = await successful.getManifest();
    expect(first.status).toBe('fresh');

    const failing = createNoticeService({
      cache,
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }),
      inspectPdf,
      renderPdfPage,
    });
    const stale = await failing.getManifest({ force: true });
    expect(stale.status).toBe('stale');
    expect(stale.slides).toEqual(first.slides);
  });

  test('reports an unavailable state when the source fails before any successful scan', async () => {
    const service = createNoticeService({
      cache: createMemoryCache(),
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }),
      inspectPdf,
      renderPdfPage,
    });
    await expect(service.getManifest()).rejects.toMatchObject({
      code: 'NOTICES_UNAVAILABLE',
      statusCode: 503,
    });
  });
});
