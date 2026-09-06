const TAP_SLOP = 10;
const MAX_TOUCH_TAP_MS = 600;
const SCROLL_SETTLE_MS = 160;

export function setupPhotoTapGuard(root = document) {
  const attempts = new WeakMap();
  let active = null;
  let lastPageScroll = -Infinity;
  const options = { capture: true, passive: true };

  function updateMovement(event) {
    if (!active || active.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > TAP_SLOP) {
      active.blocked = true;
    }
  }

  root.addEventListener('pointerdown', (event) => {
    if (active) active.blocked = true;
    if (!event.isPrimary) return;
    active = null;

    const target = event.target;
    const media = target.closest?.('[data-card-carousel]');
    if (!media || event.button !== 0 || target.closest('[data-action], [data-card-carousel-control], a[href]')) return;

    const touch = event.pointerType !== 'mouse';
    active = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      started: performance.now(),
      touch,
      blocked: touch && performance.now() - lastPageScroll < SCROLL_SETTLE_MS
    };
    attempts.set(media, active);
  }, options);

  root.addEventListener('pointermove', updateMovement, options);
  root.addEventListener('pointerup', (event) => {
    if (!active || active.id !== event.pointerId) return;
    updateMovement(event);
    if (active.touch && performance.now() - active.started > MAX_TOUCH_TAP_MS) active.blocked = true;
    active = null;
  }, options);

  root.addEventListener('pointercancel', (event) => {
    if (!active || active.id !== event.pointerId) return;
    active.blocked = true;
    active = null;
  }, options);

  root.addEventListener('contextmenu', () => {
    if (active) active.blocked = true;
  }, options);

  root.addEventListener('scroll', (event) => {
    if (event.target !== root && event.target !== root.scrollingElement && !event.target.matches?.('.screen')) return;
    lastPageScroll = performance.now();
    if (active) active.blocked = true;
  }, options);

  return (event, media) => {
    // Keyboard and assistive activation have no preceding pointer gesture.
    if (event.detail === 0 && !event.pointerType) return false;
    const attempt = attempts.get(media);
    return Boolean(attempt && (attempt.blocked || attempt === active));
  };
}
