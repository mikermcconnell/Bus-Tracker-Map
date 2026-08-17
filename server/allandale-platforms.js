const BARRIE_ALLANDALE_PLATFORM_BY_STOP = Object.freeze({
  '9003': '3',
  '9004': '4',
  '9005': '5',
  '9006': '6',
  '9012': '12',
  '9013': '13',
});

function barriePlatformForStop(stopId) {
  return BARRIE_ALLANDALE_PLATFORM_BY_STOP[String(stopId || '')] || '';
}

function isBarrieAllandalePlatformStop(stopId) {
  return Boolean(barriePlatformForStop(stopId));
}

module.exports = {
  BARRIE_ALLANDALE_PLATFORM_BY_STOP,
  barriePlatformForStop,
  isBarrieAllandalePlatformStop,
};
