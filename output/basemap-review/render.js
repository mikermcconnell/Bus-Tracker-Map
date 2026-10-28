const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1584, height: 1224 } });
  const svg = path.resolve(__dirname, '../../frontend/src/platform-map/allandale-basemap.svg');
  await p.goto(pathToFileURL(svg).href);
  await p.screenshot({ path: path.join(__dirname, 'allandale-basemap-svg.png') });
  const png = path.resolve(__dirname, '../../frontend/src/platform-map/map.png');
  await p.goto('about:blank');
  await p.setContent(`<body style="margin:0;background:#fff"><img src="${pathToFileURL(png).href}" style="width:1584px"></body>`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(__dirname, 'map-png.png') });
  await b.close();
})();
