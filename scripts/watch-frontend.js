#!/usr/bin/env node

/**
 * Development-time frontend watcher.
 * Bundles JavaScript via esbuild, copies CSS/data, and rewrites index.html.
 * Rebuilds on changes and assumes the dev server serves from frontend/dist.
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const chokidar = require('chokidar');

const projectRoot = path.join(__dirname, '..');
const srcDir = path.join(projectRoot, 'frontend', 'src');
const dataDir = path.join(projectRoot, 'frontend', 'data');
const distDir = path.join(projectRoot, 'frontend', 'dist');
const assetsDir = path.join(distDir, 'assets');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDataDirectory() {
  if (!fs.existsSync(dataDir)) return;
  const outDir = path.join(distDir, 'data');
  ensureDir(outDir);
  for (const entry of fs.readdirSync(dataDir)) {
    const srcPath = path.join(dataDir, entry);
    const destPath = path.join(outDir, entry);
    const stats = fs.statSync(srcPath);
    if (stats.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else if (stats.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function buildJs() {
  await esbuild.build({
    entryPoints: [path.join(srcDir, 'main.js')],
    bundle: true,
    sourcemap: true,
    minify: false,
    write: true,
    outfile: path.join(assetsDir, 'app.js'),
    format: 'iife',
    target: ['es2017'],
    legalComments: 'none'
  });
  return 'app.js';
}

function buildCss() {
  const cssPath = path.join(srcDir, 'styles.css');
  const outPath = path.join(assetsDir, 'styles.css');
  fs.copyFileSync(cssPath, outPath);
  return 'styles.css';
}

function writeIndexHtml(assetMap) {
  const templatePath = path.join(srcDir, 'index.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  const html = template
    .replace(/%APP_JS%/g, `./assets/${assetMap.js}`)
    .replace(/%APP_CSS%/g, `./assets/${assetMap.css}`)
    .replace(/%BUILD_ID%/g, new Date().toISOString());
  fs.writeFileSync(path.join(distDir, 'index.html'), html);
}

function writeManifest(assetMap) {
  const manifestPath = path.join(distDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: 'watch',
    assets: assetMap
  }, null, 2));
}

async function buildFrontend({ clean } = { clean: false }) {
  if (clean) {
    cleanDir(distDir);
  }
  ensureDir(distDir);
  ensureDir(assetsDir);

  const jsFile = await buildJs();
  const cssFile = buildCss();
  copyDataDirectory();

  const assetMap = { js: jsFile, css: cssFile };
  writeIndexHtml(assetMap);
  writeManifest(assetMap);
  return assetMap;
}

async function main() {
  console.log('[watch] Performing initial frontend build…');
  await buildFrontend({ clean: true });
  console.log('[watch] Frontend build ready. Watching for changes.');

  let building = false;
  let rebuildQueued = false;

  const watcherPaths = [path.join(srcDir, '**/*')];
  if (fs.existsSync(dataDir)) {
    watcherPaths.push(path.join(dataDir, '**/*'));
  }

  const watcher = chokidar.watch(watcherPaths, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50
    }
  });

  async function rebuild(reason) {
    if (building) {
      rebuildQueued = true;
      return;
    }
    building = true;
    try {
      await buildFrontend();
      if (reason) {
        console.log(`[watch] Rebuilt frontend (${reason}).`);
      } else {
        console.log('[watch] Rebuilt frontend.');
      }
    } catch (err) {
      console.error('[watch] Frontend rebuild failed:', err);
    } finally {
      building = false;
      if (rebuildQueued) {
        rebuildQueued = false;
        rebuild('queued change');
      }
    }
  }

  watcher.on('all', (event, filePath) => {
    const rel = path.relative(projectRoot, filePath);
    rebuild(`${event} ${rel}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
