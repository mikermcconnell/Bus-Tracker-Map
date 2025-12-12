#!/usr/bin/env node

/**
 * Build the frontend bundle with hashed asset names suitable for long-lived caching.
 * The script bundles JavaScript via esbuild, fingerprints CSS, rewrites index.html,
 * and copies static data files into the distributable directory.
 *
 * Usage: node scripts/build-frontend.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');
const { downlevelJavaScript, DEFAULT_BABEL_TARGETS } = require('./js-transform');

const projectRoot = path.join(__dirname, '..');
const srcDir = path.join(projectRoot, 'frontend', 'src');
const dataDir = path.join(projectRoot, 'frontend', 'data');
const distDir = path.join(projectRoot, 'frontend', 'dist');
const assetsDir = path.join(distDir, 'assets');

// Bundle at a modern target for speed, then downlevel with Babel for legacy screens.
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
  },
  {
    key: 'platformMap',
    entryPath: path.join(srcDir, 'platform-map', 'main.js'),
    cssPath: path.join(srcDir, 'platform-map', 'styles.css'),
    templatePath: path.join(srcDir, 'platform-map', 'index.html'),
    outputHtml: 'platform.map.html'
  }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function contentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 10);
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

function copyPlatformMapAssets() {
  const mapSource = path.join(srcDir, 'platform-map', 'map.png');
  if (fs.existsSync(mapSource)) {
    fs.copyFileSync(mapSource, path.join(assetsDir, 'map.png'));
  }
  const busSource = path.join(srcDir, 'platform-map', 'bus_icon.jpg');
  if (fs.existsSync(busSource)) {
    fs.copyFileSync(busSource, path.join(assetsDir, 'bus_icon.jpg'));
  }
  const mockSource = path.join(srcDir, 'platform-map', 'mock_data.js');
  if (fs.existsSync(mockSource)) {
    fs.copyFileSync(mockSource, path.join(assetsDir, 'mock_data.js'));
  }
}

function copyWeatherAssets() {
  const source = path.join(srcDir, 'assets', 'town-winter.png');
  if (!fs.existsSync(source)) return;
  const dest = path.join(assetsDir, 'town-winter.png');
  fs.copyFileSync(source, dest);
}

async function buildJs(entry) {
  const result = await esbuild.build({
    entryPoints: [entry.entryPath],
    bundle: true,
    sourcemap: false,
    minify: true,
    write: false,
    outfile: `${entry.key}.js`,
    format: 'iife',
    target: DEFAULT_ESBUILD_TARGET.length ? DEFAULT_ESBUILD_TARGET : ['es5'],
    legalComments: 'none',
  });

  const output = result.outputFiles.find((file) => file.path.endsWith('.js'));
  if (!output) {
    throw new Error(`esbuild produced no JavaScript output for ${entry.key}`);
  }

  const rawCode = Buffer.from(output.contents).toString('utf8');
  const transformed = await downlevelJavaScript(rawCode, { filename: path.basename(entry.entryPath) });
  const buffer = Buffer.from(transformed, 'utf8');
  const hash = contentHash(buffer);
  const fileName = `${entry.key}.${hash}.js`;
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return fileName;
}

function buildCss(entry) {
  const buffer = fs.readFileSync(entry.cssPath);
  const hash = contentHash(buffer);
  const fileName = `${entry.key}.${hash}.css`;
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return fileName;
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
    entries: entryAssets,
  }, null, 2));
}

async function main() {
  ensureDir(projectRoot);
  cleanDir(distDir);
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
  copyPlatformMapAssets();
  copyWeatherAssets();

  writeManifest(entryAssets);
  console.log('Frontend build complete:', entryAssets);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
