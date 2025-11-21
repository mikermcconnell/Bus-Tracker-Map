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
const { downlevelJavaScript } = require('./js-transform');

const projectRoot = path.join(__dirname, '..');
const srcDir = path.join(projectRoot, 'frontend', 'src');
const dataDir = path.join(projectRoot, 'frontend', 'data');
const distDir = path.join(projectRoot, 'frontend', 'dist');
const assetsDir = path.join(distDir, 'assets');

// Match the production bundle default so dev builds surface compatibility issues early.
const DEFAULT_ESBUILD_TARGET = (process.env.ESBUILD_TARGET || 'es2017')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const entryPoints = [
  {
    key: 'main',
    entryPath: path.join(srcDir, 'main.js'),
    cssPath: path.join(srcDir, 'styles.css'),
    templatePath: path.join(srcDir, 'index.html'),
    outputHtml: 'index.html'
  },
  {
    key: 'battMap',
    entryPath: path.join(srcDir, 'batt-map', 'main.js'),
    cssPath: path.join(srcDir, 'batt-map', 'styles.css'),
    templatePath: path.join(srcDir, 'batt-map', 'index.html'),
    outputHtml: 'batt.map.html'
  }
];

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

function copyBattMapAssets() {
  const source = path.join(srcDir, 'batt-map', 'platform-map.jpg');
  if (!fs.existsSync(source)) return;
  const dest = path.join(assetsDir, 'batt-platform-map.jpg');
  fs.copyFileSync(source, dest);
  const busSource = path.join(srcDir, 'batt-map', 'batt-bus.png');
  if (fs.existsSync(busSource)) {
    const busDest = path.join(assetsDir, 'batt-bus.png');
    fs.copyFileSync(busSource, busDest);
  }
}

async function buildJs(entry) {
  const result = await esbuild.build({
    entryPoints: [entry.entryPath],
    bundle: true,
    sourcemap: true,
    minify: false,
    write: false,
    outfile: path.join(assetsDir, `${entry.key}.js`),
    format: 'iife',
    target: DEFAULT_ESBUILD_TARGET.length ? DEFAULT_ESBUILD_TARGET : ['es5'],
    legalComments: 'none'
  });

  const output = result.outputFiles.find((file) => file.path.endsWith('.js'));
  if (!output) {
    throw new Error(`esbuild produced no JavaScript output for ${entry.key}`);
  }

  const rawCode = Buffer.from(output.contents).toString('utf8');
  const transformed = await downlevelJavaScript(rawCode, { filename: path.basename(entry.entryPath) });
  const outPath = path.join(assetsDir, `${entry.key}.js`);
  fs.writeFileSync(outPath, transformed);

  return `${entry.key}.js`;
}

function buildCss(entry) {
  const outPath = path.join(assetsDir, `${entry.key}.css`);
  fs.copyFileSync(entry.cssPath, outPath);
  return `${entry.key}.css`;
}

function writeHtml(entry, assetMap) {
  const template = fs.readFileSync(entry.templatePath, 'utf8');
  const html = template
    .replace(/%APP_JS%/g, `./assets/${assetMap.js}`)
    .replace(/%APP_CSS%/g, `./assets/${assetMap.css}`)
    .replace(/%BUILD_ID%/g, new Date().toISOString());
  fs.writeFileSync(path.join(distDir, entry.outputHtml), html);
}

function writeManifest(entryAssets) {
  const manifestPath = path.join(distDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: 'watch',
    entries: entryAssets
  }, null, 2));
}

async function buildFrontend({ clean } = { clean: false }) {
  if (clean) {
    cleanDir(distDir);
  }
  ensureDir(distDir);
  ensureDir(assetsDir);

  const entryAssets = {};

  for (const entry of entryPoints) {
    if (!fs.existsSync(entry.entryPath)) continue;
    const jsFile = await buildJs(entry);
    const cssFile = buildCss(entry);
    writeHtml(entry, { js: jsFile, css: cssFile });
    entryAssets[entry.key] = {
      html: entry.outputHtml,
      js: jsFile,
      css: cssFile
    };
  }

  copyDataDirectory();
  copyBattMapAssets();

  writeManifest(entryAssets);
  return entryAssets;
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
