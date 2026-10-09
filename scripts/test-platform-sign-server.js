// Focused browser fixture: compile only the sign into memory. Do not rebuild,
// delete, or replace the user's frontend/dist or downloaded schedule caches.
const fs = require('fs');
const path = require('path');
const express = require('express');
const esbuild = require('esbuild');
const { downlevelJavaScript } = require('./js-transform');

async function start() {
  const root = path.join(__dirname, '..');
  const source = path.join(root, 'frontend', 'src', 'platform-departures');
  const bundle = await esbuild.build({
    entryPoints: [path.join(source, 'main.js')], bundle: true, write: false,
    minify: true, format: 'iife', target: 'es2017', legalComments: 'none',
  });
  const js = await downlevelJavaScript(bundle.outputFiles[0].text, { filename: 'platform-sign-review.js' });
  const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
    .replace('%APP_JS%', './assets/platform-sign-review.js')
    .replace('%APP_CSS%', './assets/platform-sign-review.css')
    .replace('%BUILD_ID%', 'focused-browser-fixture');
  const app = express();
  app.get('/review-health', (_req, res) => res.json({ ready: true }));
  app.get('/departures/platform.aspx', (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'self' data:; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self';");
    res.type('html').send(html);
  });
  app.get('/departures/assets/platform-sign-review.js', (_req, res) => res.type('js').send(js));
  app.get('/departures/assets/platform-sign-review.css', (_req, res) => res.sendFile(path.join(source, 'styles.css')));
  app.use('/assets', express.static(path.join(root, 'frontend', 'src', 'assets')));
  app.use(require('../server/server'));
  app.listen(Number(process.env.PORT || 3017), '127.0.0.1');
}

start().catch((error) => { console.error(error); process.exitCode = 1; });
