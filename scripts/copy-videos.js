// Transcodes the raw .mov training videos into compressed, web-ready MP4s.
// Usage: node scripts/copy-videos.js <source-dir>   (requires ffmpeg on PATH)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_FILES = {
  'How to Wait for and Board a Bus.mov': 'how-to-wait-and-board',
  'How to Pay Your Fare.mov': 'how-to-pay-fare',
  'How to Read and Understand a Bus Stop Sign.mov': 'bus-stop-sign',
  'Exiting the Bus.mov': 'exiting-bus',
  'Georgian College, UPASS, and Barrie Transit.mov': 'georgian-college-upass',
  'Rider Etiquette - Exiting the bus.mov': 'etiquette-exiting',
  'Rider Etiquette- Have Your Fare Ready.mov': 'etiquette-fare-ready',
  'Rider Etiquette-Bags.mov': 'etiquette-bags',
  'Rider Etiquette-Garbage.mov': 'etiquette-garbage',
  'Rider Etiquette-Headphones.mov': 'etiquette-headphones',
  'Rider Etiquette-Priority Seating.mov': 'etiquette-priority-seating',
  'Winter transit tips.mov': 'winter-tips'
};

const sourceDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'drive-download-20261005T144047Z-1-001'));
const targetDir = path.join(__dirname, '..', 'frontend', 'src', 'training-videos', 'media');

fs.mkdirSync(targetDir, { recursive: true });

for (const [file, id] of Object.entries(SOURCE_FILES)) {
  const sourcePath = path.join(sourceDir, file);
  if (!fs.existsSync(sourcePath)) {
    console.warn(`  ! missing ${file}`);
    continue;
  }
  execFileSync('ffmpeg', [
    '-nostdin', '-y', '-v', 'error',
    '-i', sourcePath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '25',
    '-maxrate', '3500k', '-bufsize', '7000k', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    path.join(targetDir, `${id}.mp4`)
  ], { stdio: 'inherit' });
  console.log(`  ✓ ${file} -> ${id}.mp4`);
}

console.log('Done!');
