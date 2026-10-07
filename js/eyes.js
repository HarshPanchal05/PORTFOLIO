/** Googly eyes: pupils track the cursor, eyes blink on a timer. */
export function initEyes() {
  const eyes = [...document.querySelectorAll('.eye')];
  if (!eyes.length) return () => {};

  const MAX_TRAVEL = 28;     // px: furthest a pupil can move from centre
  const FOLLOW_DIVISOR = 8;  // higher = pupils drift less when the cursor is close
  const BLINK_EVERY = 3000;  // ms between blinks
  const BLINK_LENGTH = 150;  // ms the eyes stay closed

  let mx = 0, my = 0, queued = false;

  // coalesce mouse events to one layout read + write per frame
  function onMove(e) {
    mx = e.clientX;
    my = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }

  function update() {
    queued = false;
    for (const eye of eyes) {
      const rect = eye.getBoundingClientRect();
      const dx = mx - (rect.left + rect.width / 2);
      const dy = my - (rect.top + rect.height / 2);
      const angle = Math.atan2(dy, dx);
      // the rect includes --eye-scale, so undo it to measure in the eye's own pixels
      const scale = rect.width / eye.offsetWidth || 1;
      const dist = Math.min(MAX_TRAVEL, Math.hypot(dx, dy) / scale / FOLLOW_DIVISOR);
      eye.firstElementChild.style.transform =
        `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px))`;
    }
  }

  const timer = setInterval(() => {
    if (document.hidden) return;
    eyes.forEach((eye) => eye.classList.add('blink'));
    setTimeout(() => eyes.forEach((eye) => eye.classList.remove('blink')), BLINK_LENGTH);
  }, BLINK_EVERY);

  window.addEventListener('mousemove', onMove, { passive: true });
  return () => {
    clearInterval(timer);
    window.removeEventListener('mousemove', onMove);
  };
}
