/** Coverflow carousel: centre card upright and sharp, neighbours fan out tilted, smaller and blurred. Autoplays. */
export function initCarousel(root) {
  if (!root) return;
  const stage = root.querySelector('.cf-stage');
  const cards = [...root.querySelectorAll('.cf-card')];
  const n = cards.length;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const INTERVAL = 1300;
  let active = 0;
  let timer = null;
  let hovered = false;

  cards.forEach((card, i) => {
    card.style.setProperty('--bg', `url("${card.querySelector('img').getAttribute('src')}")`);
    card.addEventListener('click', () => {
      if (!card.dataset.dragged) go(i);
    });
    // pause only while the pointer rests on the centre card
    card.addEventListener('mouseenter', () => {
      if (i === active) { hovered = true; clearInterval(timer); }
    });
    card.addEventListener('mouseleave', () => {
      if (hovered) { hovered = false; restart(); }
    });
  });

  function layout() {
    const w = cards[0].offsetWidth;
    cards.forEach((card, i) => {
      // signed shortest distance from the active card, wrapped to [-n/2, n/2)
      const off = ((i - active + n + n / 2) % n) - n / 2;
      const abs = Math.abs(off);
      const hidden = abs > 2.5;
      const x = Math.sign(off) * Math.min(abs, 3) * w * 0.62;
      // outermost cards flip their tilt against the card beside them
      const tilt = abs < 2 ? off * 12 : -Math.sign(off) * 14;
      const y = -off * 16; // fan rises toward the right, droops toward the left
      card.style.transform =
        `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${-abs * 90}px) ` +
        `rotateY(${-off * 22}deg) rotateZ(${tilt}deg) scale(${1 - abs * 0.1})`;
      card.style.filter = abs ? `blur(${abs * 2.4}px) grayscale(${Math.min(abs * 0.6, 1)}) brightness(${1 - abs * 0.12})` : 'none';
      card.style.opacity = hidden ? 0 : 1;
      card.style.zIndex = 10 - Math.round(abs);
      card.style.pointerEvents = hidden ? 'none' : 'auto';
      card.setAttribute('aria-hidden', abs ? 'true' : 'false');
    });
  }

  function go(i) {
    active = (i + n) % n;
    layout();
    hovered = cards[active].matches(':hover');
    restart();
  }

  function restart() {
    clearInterval(timer);
    if (!reduceMotion && !hovered) timer = setInterval(() => { active = (active + 1) % n; layout(); }, INTERVAL);
  }

  root.querySelectorAll('.carousel-btn').forEach((btn) => {
    btn.addEventListener('click', () => go(active + Number(btn.dataset.dir)));
  });

  // swipe / drag
  let startX = null;
  stage.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    clearInterval(timer);
    cards.forEach((c) => delete c.dataset.dragged);
  });
  stage.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) {
      cards.forEach((c) => { c.dataset.dragged = '1'; });
      go(active + (dx < 0 ? 1 : -1));
    } else {
      restart();
    }
  });
  stage.addEventListener('pointercancel', () => { startX = null; restart(); });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(active + 1);
    if (e.key === 'ArrowLeft') go(active - 1);
  });
  window.addEventListener('resize', layout);

  layout();
  // start autoplay only while on screen
  new IntersectionObserver(([en]) => (en.isIntersecting ? restart() : clearInterval(timer)), { threshold: 0.3 }).observe(root);
}
