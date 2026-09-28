import { PLAYLIST_ID, VIDEOS } from './videos';

const YOUTUBE_API_URL = 'https://www.youtube.com/iframe_api';
const PLAYLIST_REFRESH_MS = 30 * 60 * 1000;
const CAPTION_POLL_MS = 250;
const MAX_UP_NEXT = 5;
const videoById = new Map(VIDEOS
  .filter((video) => video.id && Array.isArray(video.cues) && video.cues.length && video.cues.every((cue) => (
    typeof cue.start === 'number' && isFinite(cue.start) &&
    typeof cue.end === 'number' && isFinite(cue.end) && cue.end > cue.start &&
    typeof cue.text === 'string' && cue.text.trim()
  )))
  .map((video) => [video.id, video]));

const stage = document.querySelector('.training-stage');
const playerWrap = document.querySelector('.training-player-wrap');
const holding = document.getElementById('training-holding');
const holdingTitle = document.getElementById('training-holding-title');
const holdingMessage = document.getElementById('training-holding-message');
const startButton = document.getElementById('training-start');
const caption = document.getElementById('training-caption');
const title = document.getElementById('training-title');
const playlistCount = document.getElementById('training-playlist-count');
const countdownValue = document.getElementById('training-countdown-value');
const countdownLabel = document.getElementById('training-countdown-label');
const nowList = document.getElementById('training-now-list');
const upNextList = document.getElementById('training-up-next-list');
const upNextMore = document.getElementById('training-up-next-more');

let player = null;
let approvedIds = [];
let currentVideoId = '';
let currentCaption = '';
let playlistPending = false;
let playlistStartedAt = Date.now();
let startPromptTimer = null;
const failedIds = new Set();

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

function setCountdown(value, label = 'SEC LEFT') {
  const displayValue = String(value);
  if (countdownValue.textContent !== displayValue) countdownValue.textContent = displayValue;
  if (countdownLabel.textContent !== label) countdownLabel.textContent = label;
}

function updateCountdown() {
  if (!player || !approvedIds.length || !currentVideoId) {
    setCountdown('--');
    return;
  }

  const duration = player.getDuration();
  const position = player.getCurrentTime();
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) {
    setCountdown('--');
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil(duration - position));
  const paused = player.getPlayerState() === window.YT.PlayerState.PAUSED;
  setCountdown(secondsLeft, paused ? 'PAUSED' : 'SEC LEFT');
}

function videoIdFromUrl(url) {
  const match = String(url || '').match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return match ? match[1] : '';
}

function playlistItem(id, state) {
  const index = approvedIds.indexOf(id);
  const item = document.createElement('li');
  item.className = `training-video-item training-video-item--${state}`;

  const number = document.createElement('span');
  number.className = 'training-video-number';
  number.textContent = String(index + 1);

  const copy = document.createElement('span');
  copy.className = 'training-video-copy';
  copy.textContent = videoById.get(id).title;

  const status = document.createElement('span');
  status.className = 'training-video-state';
  status.textContent = state === 'current' ? 'Showing' : state === 'next' ? 'Up next' : state === 'repeat' ? 'Repeats' : 'Later';

  item.appendChild(number);
  item.appendChild(copy);
  item.appendChild(status);
  return item;
}

function renderPlaylist() {
  nowList.textContent = '';
  upNextList.textContent = '';
  playlistCount.textContent = `${approvedIds.length} ${approvedIds.length === 1 ? 'video' : 'videos'} in rotation`;
  upNextMore.hidden = true;
  if (!approvedIds.length) return;

  const currentIndex = Math.max(0, approvedIds.indexOf(currentVideoId));
  const currentId = approvedIds[currentIndex];
  nowList.appendChild(playlistItem(currentId, 'current'));

  const queue = approvedIds.length === 1
    ? [currentId]
    : approvedIds.slice(currentIndex + 1).concat(approvedIds.slice(0, currentIndex));
  queue.slice(0, MAX_UP_NEXT).forEach((id, index) => {
    upNextList.appendChild(playlistItem(id, approvedIds.length === 1 ? 'repeat' : index === 0 ? 'next' : 'later'));
  });
  if (queue.length > MAX_UP_NEXT) {
    const remaining = queue.length - MAX_UP_NEXT;
    upNextMore.textContent = `And ${remaining} more ${remaining === 1 ? 'video' : 'videos'}`;
    upNextMore.hidden = false;
  }
}

function updateCurrentVideo() {
  if (!player || !approvedIds.length) return;
  const id = videoIdFromUrl(player.getVideoUrl());
  if (!id || id === currentVideoId) return;
  const video = videoById.get(id);
  if (!video || !approvedIds.includes(id)) {
    player.nextVideo();
    return;
  }
  currentVideoId = id;
  setCountdown('--');
  currentCaption = '';
  title.textContent = video.title;
  renderPlaylist();
  setCaption('Captions will appear when narration begins.', true);
}

function updateCaption() {
  if (!player || !approvedIds.length) return;
  updateCurrentVideo();
  updateCountdown();
  const video = videoById.get(currentVideoId);
  if (!video) return;
  const seconds = player.getCurrentTime();
  const cue = video.cues.find((item) => seconds >= item.start && seconds < item.end);
  setCaption(cue ? cue.text : 'Captions will appear when narration begins.', !cue);
}

function scheduleStartPrompt() {
  window.clearTimeout(startPromptTimer);
  startPromptTimer = window.setTimeout(() => {
    if (holding.hidden || !approvedIds.length) return;
    showHolding('Ready to play', 'Press OK on the remote to start the videos.', true);
  }, 10000);
}

function loadApproved(ids) {
  approvedIds = ids.filter((id) => videoById.has(id) && !failedIds.has(id));
  playlistPending = false;
  currentVideoId = '';
  setCountdown('--');
  renderPlaylist();
  if (!approvedIds.length) {
    window.clearTimeout(startPromptTimer);
    showHolding('No captioned videos available', 'Add an approved transcript for a video in the playlist.');
    setCaption('Video captions are unavailable.', true);
    return;
  }
  showHolding('Loading travel tips', 'Please wait while the video loads.');
  player.mute();
  player.setVolume(0);
  player.loadPlaylist(approvedIds, 0);
  player.setLoop(true);
  scheduleStartPrompt();
}

function readYouTubePlaylist() {
  if (!playlistPending || !player) return;
  const ids = player.getPlaylist();
  if (!Array.isArray(ids) || !ids.length) return;
  loadApproved(ids);
}

function retryLater() {
  window.setTimeout(() => window.location.reload(), 60000);
}

function handlePlayerError() {
  window.clearTimeout(startPromptTimer);
  const failedId = videoIdFromUrl(player.getVideoUrl());
  if (!failedId) {
    showHolding('Video temporarily unavailable', 'The screen will try again shortly.');
    retryLater();
    return;
  }
  failedIds.add(failedId);
  const remaining = approvedIds.filter((id) => !failedIds.has(id));
  if (remaining.length) {
    loadApproved(remaining);
    return;
  }
  showHolding('Video temporarily unavailable', 'The screen will try again shortly.');
  setCaption('Travel tips will return shortly.', true);
  retryLater();
}

function onPlayerStateChange(event) {
  if (playlistPending) {
    readYouTubePlaylist();
    return;
  }
  if (event.data === window.YT.PlayerState.PLAYING) {
    window.clearTimeout(startPromptTimer);
    player.mute();
    player.setVolume(0);
    updateCurrentVideo();
    holding.hidden = true;
    updateCaption();
  } else if (event.data === window.YT.PlayerState.ENDED) {
    if (PLAYLIST_ID && Date.now() - playlistStartedAt >= PLAYLIST_REFRESH_MS) {
      window.location.reload();
    } else if (approvedIds.length === 1) {
      player.seekTo(0);
      player.playVideo();
    }
  }
}

function onPlayerReady() {
  player.mute();
  player.setVolume(0);
  window.setInterval(updateCaption, CAPTION_POLL_MS);
  window.setInterval(() => {
    if (!player) return;
    if (!player.isMuted()) player.mute();
    if (player.getVolume() !== 0) player.setVolume(0);
  }, 5000);

  if (PLAYLIST_ID) {
    playlistPending = true;
    player.cuePlaylist({ listType: 'playlist', list: PLAYLIST_ID });
    const checkTimer = window.setInterval(() => {
      readYouTubePlaylist();
      if (!playlistPending) window.clearInterval(checkTimer);
    }, 250);
    window.setTimeout(() => {
      if (!playlistPending) return;
      window.clearInterval(checkTimer);
      playlistPending = false;
      showHolding('Playlist temporarily unavailable', 'The screen will try again shortly.');
      retryLater();
    }, 12000);
  } else {
    loadApproved(VIDEOS.map((video) => video.id));
  }
}

function createPlayer() {
  if (player || !window.YT || !window.YT.Player) return;
  player = new window.YT.Player('training-player', {
    videoId: videoById.keys().next().value,
    playerVars: {
      autoplay: 0,
      controls: 0,
      fs: 0,
      mute: 1,
      playsinline: 1,
      rel: 0,
      origin: window.location.origin
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: handlePlayerError,
      onAutoplayBlocked: () => {
        showHolding('Ready to play', 'Press OK on the remote to start the videos.', true);
      }
    }
  });
}

function startPlayback() {
  if (!player) return;
  player.mute();
  player.setVolume(0);
  player.playVideo();
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
  startButton.addEventListener('click', startPlayback);
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !startButton.hidden) {
      event.preventDefault();
      startPlayback();
    } else if (event.key === 'f' || event.key === 'F') {
      toggleFullscreen();
    }
  });

  if (!videoById.size) {
    showHolding('No videos configured', 'Add a public video and its transcript.');
    return;
  }
  window.onYouTubeIframeAPIReady = createPlayer;
  const script = document.createElement('script');
  script.src = YOUTUBE_API_URL;
  script.onerror = () => {
    showHolding('Video temporarily unavailable', 'The screen will try again shortly.');
    retryLater();
  };
  document.head.appendChild(script);
  window.setTimeout(() => {
    if (player) return;
    showHolding('Video temporarily unavailable', 'The screen will try again shortly.');
    retryLater();
  }, 15000);
}

init();
