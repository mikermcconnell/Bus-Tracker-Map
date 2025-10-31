#!/usr/bin/env node

/**
 * Development orchestrator.
 * Runs the frontend watcher and starts the Express server with live reload enabled.
 */

const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const nodeCmd = process.execPath;
const children = [];

function removeChild(child) {
  const idx = children.indexOf(child);
  if (idx !== -1) {
    children.splice(idx, 1);
  }
}

function spawnTracked(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    ...options
  });

  children.push(child);
  child.on('exit', () => removeChild(child));
  return child;
}

function runOnce(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}

async function main() {
  await runOnce(nodeCmd, [path.join(__dirname, 'build-geojson.js'), '--skip-if-cache'], {
    cwd: projectRoot
  });

  const watcher = spawnTracked(nodeCmd, [path.join(__dirname, 'watch-frontend.js')], {
    cwd: projectRoot,
    env: { ...process.env }
  });

  watcher.on('close', (code) => {
    console.error('[dev] Frontend watcher exited.', code === 0 ? '' : `Code: ${code}`);
    cleanup();
    process.exit(code === 0 ? 0 : code || 1);
  });

  const serverEnv = {
    ...process.env,
    ENABLE_LIVERELOAD: process.env.ENABLE_LIVERELOAD || '1'
  };

  const server = spawnTracked(nodeCmd, [path.join(projectRoot, 'server', 'server.js')], {
    cwd: projectRoot,
    env: serverEnv
  });

  server.on('close', (code) => {
    console.log('[dev] Server exited.', code === 0 ? '' : `Code: ${code}`);
    cleanup();
    process.exit(code === 0 ? 0 : code || 1);
  });
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

main().catch((err) => {
  console.error('[dev] Failed to start development environment:', err);
  cleanup();
  process.exit(1);
});
