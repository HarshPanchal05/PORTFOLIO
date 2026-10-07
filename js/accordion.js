/** Horizontal accordion: hover/focus opens a panel; on touch the first tap only opens. */
export function initAccordion(root) {
  if (!root) return;
  const panels = [...root.querySelectorAll('.acc-panel')];

  function open(panel) {
    panels.forEach((p) => {
      const on = p === panel;
      p.classList.toggle('is-open', on);
      p.setAttribute('aria-expanded', on);
    });
  }

  panels.forEach((panel, i) => {
    panel.style.setProperty('--i', i);
    panel.addEventListener('mouseenter', () => open(panel));
    panel.addEventListener('focus', () => open(panel));
    panel.addEventListener('click', (e) => {
      if (!panel.classList.contains('is-open')) {
        e.preventDefault();
        open(panel);
      }
    });
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === panel) {
        window.open(panel.dataset.href, '_blank', 'noopener');
      }
    });
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('will-reveal');
  const io = new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting)) {
      root.classList.add('in-view');
      io.disconnect();
    }
  }, { threshold: 0.2 });
  io.observe(root);
}
