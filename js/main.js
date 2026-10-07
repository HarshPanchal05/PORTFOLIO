import { initCursorGrid } from './cursor-grid.js';
import { initEyes } from './eyes.js';
import { initAccordion } from './accordion.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduceMotion) {
  initCursorGrid(document.getElementById('cursor-grid'), {
    cellSize: 60,
    color: '#11110f', // the site's --text: the page is off-white, so cells are dark
    radius: 160,
    falloff: 'smooth',
    holdTime: 300,
    fadeDuration: 700,
    lineWidth: 1,
    maxOpacity: 0.6,
    fillOpacity: 0,
    gridOpacity: 0,
    cellRadius: 4,
    clickPulse: true,
    pulseSpeed: 700
  });
}

initEyes();
initAccordion(document.querySelector('[data-accordion]'));
