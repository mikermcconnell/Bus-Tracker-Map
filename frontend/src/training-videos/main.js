import { VIDEOS } from './videos';

const CAPTION_POLL_MS = 250;
const videoById = new Map(VIDEOS
  .filter((video) => video.id && video.file && Array.isArray(video.cues))
  .map((video) => [video.id, video]));

const screen = document.querySelector('.training-screen');
const stage = document.querySelector('.training-stage');
const playerWrap = document.querySelector('.training-player-wrap');
const holding = document.getElementById('training-holding');
const holdingTitle = document.getElementById('training-holding-title');
const holdingMessage = document.getElementById('training-holding-message');
const startButton = document.getElementById('training-start');
const caption = document.getElementById('training-caption');
const title = document.getElementById('training-title');
const upNext = document.getElementById('training-up-next');
const progressBar = document.getElementById('training-progress-bar');

let player = null;
let currentVideoIndex = 0;
let currentVideoId = '';
let currentCaption = '';
let videoIds = [];

function resizePlayer() {
  const stageStyle = window.getComputedStyle(stage);
  const availableWidth = stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
  const availableHeight = stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom);
  const width = Math.min(availableWidth, availableHeight * 16 / 9);
  const height = width * 9 / 16;
  playerWrap.style.width = `${Math.floor(width)}px`;
  playerWrap.style.height = `${Math.floor(height)}px`;
}

function showHolding(heading, message, canStart = false) {
  holdingTitle.textContent = heading;
  holdingMessage.textContent = message;
  startButton.hidden = !canStart;
  holding.hidden = false;
  if (canStart) startButton.focus();
}

function setCaption(text, placeholder = false) {
  const nextText = text || '';
  if (nextText === currentCaption && caption.classList.contains('training-caption--placeholder') === placeholder) return;
  currentCaption = nextText;
  caption.textContent = nextText;
  caption.classList.toggle('training-caption--placeholder', placeholder);
}

function setProgress(fraction) {
  const width = `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`;
  if (progressBar.style.width !== width) progressBar.style.width = width;
}

function updateProgress() {
  if (!player || !currentVideoId) {
    setProgress(0);
    return;
  }

  const duration = player.duration;
  const position = player.currentTime;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) {
    setProgress(0);
    return;
  }

  setProgress(position / duration);
}

function renderUpNext() {
  if (videoIds.length < 2) {
    upNext.hidden = true;
    return;
  }

  const nextId = videoIds[(currentVideoIndex + 1) % videoIds.length];
  upNext.textContent = `Up next: ${videoById.get(nextId).title}`;
  upNext.hidden = false;
}

function updateCurrentVideo() {
  const id = videoIds[currentVideoIndex];
  if (!id || id === currentVideoId) return;
  const video = videoById.get(id);
  if (!video) return;

  currentVideoId = id;
  setProgress(0);
  currentCaption = '';
  title.textContent = video.title;
  renderUpNext();
  screen.classList.toggle('training-screen--no-captions', !video.cues.length);
  setCaption('', true);
}

function updateCaption() {
  if (!player || !videoIds.length) return;
  updateProgress();
  const video = videoById.get(currentVideoId);
  if (!video || !video.cues.length) {
    setCaption('', true);
    return;
  }
  const seconds = player.currentTime;
  const cue = video.cues.find((item) => seconds >= item.start && seconds < item.end);
  setCaption(cue ? cue.text : '', !cue);
}

function loadVideo(index) {
  if (!player || index >= videoIds.length) return;
  currentVideoIndex = index;
  const id = videoIds[currentVideoIndex];
  const video = videoById.get(id);
  if (!video) return;

  const videoPath = `/training-videos/media/${video.file}`;
  player.src = videoPath;
  player.load();
  updateCurrentVideo();
}

function playNextVideo() {
  const nextIndex = (currentVideoIndex + 1) % videoIds.length;
  loadVideo(nextIndex);
  player.play().catch(err => console.error('Playback error:', err));
}

function startPlayback() {
  if (!player) return;
  player.play().catch(err => {
    console.error('Playback error:', err);
    showHolding('Ready to play', 'Press OK on the remote to start the videos.', true);
  });
}

function toggleFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen();
  } else if (root.requestFullscreen) {
    root.requestFullscreen();
  }
}

function init() {
  resizePlayer();
  window.addEventListener('resize', resizePlayer);
  // The caption band collapses for uncaptioned videos, which resizes the stage without a window resize.
  if (window.ResizeObserver) new ResizeObserver(resizePlayer).observe(stage);

  if (!videoById.size) {
    showHolding('No videos configured', 'Add video files and their transcripts.');
    return;
  }

  videoIds = Array.from(videoById.keys());

  // Create HTML5 video element
  const videoElement = document.createElement('video');
  videoElement.id = 'training-player';
  videoElement.muted = true;
  videoElement.playsInline = true;
  document.getElementById('training-player').replaceWith(videoElement);
  player = videoElement;

  // Event listeners
  player.addEventListener('loadedmetadata', () => {
    holding.hidden = true;
    updateCurrentVideo();
  });

  player.addEventListener('playing', () => {
    holding.hidden = true;
    updateCaption();
  });

  player.addEventListener('ended', () => {
    playNextVideo();
  });

  player.addEventListener('error', (e) => {
    console.error('Video error:', e);
    showHolding('Video temporarily unavailable', 'The screen will try again shortly.');
  });

  // Start caption updates
  window.setInterval(updateCaption, CAPTION_POLL_MS);

  // UI controls
  startButton.addEventListener('click', startPlayback);
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !startButton.hidden) {
      event.preventDefault();
      startPlayback();
    } else if (event.key === 'f' || event.key === 'F') {
      toggleFullscreen();
    }
  });

  // Load first video
  showHolding('Loading travel tips', 'Please wait while the video loads.');
  loadVideo(0);

  // Auto-play or show start button
  const playPromise = player.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      showHolding('Ready to play', 'Press OK on the remote to start the videos.', true);
    });
  }
}

init();
