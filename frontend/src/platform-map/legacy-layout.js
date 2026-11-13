// Map sizing for older TV browsers.
//
// styles.css sizes the map plane with container query units (cqw/cqh, Chrome 105+)
// and aspect-ratio (Chrome 88+). Older built-in TV browsers (for example LG webOS
// before webOS 24) drop those rules, and the map then collapses to 0x0. When either
// feature is missing, this sets the same size and position in pixels instead.

// Keep these in step with .map-plane in styles.css.
const WIDE_STAGE = Object.freeze({ widthPerStageWidth: 1.447, widthPerStageHeight: 1.294 });
// @container (max-width: 600px)
const NARROW_STAGE = Object.freeze({ widthPerStageWidth: 1.55, widthPerStageHeight: 1.1 });
const NARROW_STAGE_MAX_WIDTH = 600;
const LEFT_OFFSET_PER_STAGE_WIDTH = 0.0247;
const PLANE_ASPECT_RATIO = 11659 / 9010;

function supports(property, value) {
  const css = typeof window !== 'undefined' ? window.CSS : undefined;
  return Boolean(css && typeof css.supports === 'function' && css.supports(property, value));
}

export function needsLegacyMapSizing() {
  return !supports('width', '1cqw') || !supports('aspect-ratio', '1 / 1');
}

// Returns the map plane box, in pixels relative to the stage, that the CSS would give.
export function computeMapPlaneBox(stageWidth, stageHeight) {
  if (!(stageWidth > 0) || !(stageHeight > 0)) return null;
  const fit = stageWidth <= NARROW_STAGE_MAX_WIDTH ? NARROW_STAGE : WIDE_STAGE;
  const width = Math.max(fit.widthPerStageWidth * stageWidth, fit.widthPerStageHeight * stageHeight);
  const height = width / PLANE_ASPECT_RATIO;
  const centreX = stageWidth / 2 + LEFT_OFFSET_PER_STAGE_WIDTH * stageWidth;
  return {
    left: centreX - width / 2,
    top: stageHeight / 2 - height / 2,
    width,
    height,
  };
}

// Flex-box gap needs Chrome 84+; @supports cannot tell it apart from grid gap.
export function supportsFlexGap(doc) {
  if (!doc || !doc.body) return true;
  const probe = doc.createElement('div');
  probe.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  probe.appendChild(doc.createElement('div'));
  probe.appendChild(doc.createElement('div'));
  doc.body.appendChild(probe);
  const supported = probe.scrollHeight === 1;
  doc.body.removeChild(probe);
  return supported;
}

// Adds a class that turns on margin fallbacks for flex gap in styles.css.
export function markFlexGapSupport(doc) {
  if (!supportsFlexGap(doc)) doc.documentElement.classList.add('no-flex-gap');
}

// Sizes the plane in pixels on browsers that need it. Returns true when it did.
export function applyLegacyMapSizing(stageEl, planeEl) {
  if (!stageEl || !planeEl || !needsLegacyMapSizing()) return false;
  const box = computeMapPlaneBox(stageEl.clientWidth, stageEl.clientHeight);
  if (!box) return false;
  const style = planeEl.style;
  style.left = `${box.left}px`;
  style.top = `${box.top}px`;
  style.width = `${box.width}px`;
  style.height = `${box.height}px`;
  // The box is already centred, so drop the CSS translate(-50%, -50%).
  style.transform = 'none';
  return true;
}
