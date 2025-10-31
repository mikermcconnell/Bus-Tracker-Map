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

async function buildJs() {
  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, 'main.js')],
    bundle: true,
    sourcemap: false,
    minify: true,
    write: false,
    outfile: 'app.js',
    format: 'iife',
    target: ['es2017'],
    legalComments: 'none',
  });

  const output = result.outputFiles.find((file) => file.path.endsWith('.js'));
  if (!output) {
    throw new Error('esbuild produced no JavaScript output');
  }

  const hash = contentHash(output.contents);
  const fileName = `app.${hash}.js`;
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, output.contents);
  return fileName;
}

function buildCss() {
  const cssPath = path.join(srcDir, 'styles.css');
  const buffer = fs.readFileSync(cssPath);
  const hash = contentHash(buffer);
  const fileName = `styles.${hash}.css`;
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return fileName;
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
    assets: assetMap,
  }, null, 2));
}

async function main() {
  ensureDir(projectRoot);
  cleanDir(distDir);
  ensureDir(distDir);
  ensureDir(assetsDir);

  const jsFile = await buildJs();
  const cssFile = buildCss();
  copyDataDirectory();

  const assetMap = { js: jsFile, css: cssFile };
  writeIndexHtml(assetMap);
  writeManifest(assetMap);
  console.log('Frontend build complete:', assetMap);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
