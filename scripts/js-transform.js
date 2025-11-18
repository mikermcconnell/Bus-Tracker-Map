#!/usr/bin/env node

/**
 * Shared helper for downlevelling frontend bundles so they run on older browsers.
 * We keep the esbuild target relatively modern for build speed, and let Babel
 * handle the final compatibility pass (defaulting to Chrome 38 / Tizen-era WebKit).
 */

let babel = null;
let babelLoadAttempted = false;

const DEFAULT_BABEL_TARGETS = process.env.BABEL_COMPAT_TARGETS || 'chrome 38';

function getBabel() {
  if (babel || babelLoadAttempted) {
    return babel;
  }
  babelLoadAttempted = true;
  try {
    // eslint-disable-next-line global-require
    babel = require('@babel/core');
  } catch (err) {
    console.warn('[build] Babel is not installed; skipping legacy downleveling.');
    babel = null;
  }
  return babel;
}

async function downlevelJavaScript(source, { filename = 'bundle.js' } = {}) {
  const babelCore = getBabel();
  if (!babelCore || typeof source !== 'string') {
    return source;
  }

  const result = await babelCore.transformAsync(source, {
    babelrc: false,
    configFile: false,
    compact: false,
    sourceMaps: false,
    filename,
    presets: [
      ['@babel/preset-env', {
        targets: DEFAULT_BABEL_TARGETS,
        bugfixes: true,
        loose: true,
        modules: false,
        shippedProposals: false
      }]
    ]
  });

  return result && result.code ? result.code : source;
}

module.exports = {
  downlevelJavaScript,
  DEFAULT_BABEL_TARGETS
};
