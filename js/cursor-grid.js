/**
 * Cursor-reactive grid background drawn on a single <canvas>.
 * initCursorGrid(container, options) -> destroy()
 */
const DEFAULTS = {
  cellSize: 60,
  color: '#ffffff',
  radius: 160,
  falloff: 'smooth', // 'smooth' | 'linear' | 'sharp'
  holdTime: 300,     // ms a cell stays fully lit after last touch
  fadeDuration: 700, // ms to fade to zero after the hold
  lineWidth: 1,
  maxOpacity: 0.6,
  fillOpacity: 0,
  gridOpacity: 0,
  cellRadius: 4,
  clickPulse: true,
  pulseSpeed: 700    // px per second
};

const FALLOFFS = {
  smooth: (t) => t * t * (3 - 2 * t),
  linear: (t) => t,
  sharp: (t) => t * t * t
};

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function initCursorGrid(container, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const [r, g, b] = hexToRgb(o.color);
  const rgba = (a) => `rgba(${r},${g},${b},${a})`;
  const falloff = FALLOFFS[o.falloff] || FALLOFFS.smooth;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let w = 0, h = 0, dpr = 1;
  let cols = 0, rows = 0, offX = 0, offY = 0;
  let level = new Float32Array(0);   // brightness at last touch
  let touched = new Float64Array(0); // timestamp of last touch
  let pulses = [];
  let raf = 0;

  function build() {
    const rect = container.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    cols = Math.ceil(w / o.cellSize) + 1;
    rows = Math.ceil(h / o.cellSize) + 1;
    // centre the grid; the extra row/column bleeds past the edges
    offX = (w - cols * o.cellSize) / 2;
    offY = (h - rows * o.cellSize) / 2;
    level = new Float32Array(cols * rows);
    touched = new Float64Array(cols * rows);
    pulses = [];
    wake();
  }

  // Current displayed brightness of a cell at time `now`
  function current(i, now) {
    const v = level[i];
    if (v <= 0) return 0;
    const age = now - touched[i] - o.holdTime;
    if (age <= 0) return v;
    if (age >= o.fadeDuration) return 0;
    return v * (1 - age / o.fadeDuration);
  }

  // A cell can only get brighter while it is being touched
  function light(i, v, now) {
    level[i] = Math.max(current(i, now), v);
    touched[i] = now;
  }

  function roundedRect(x, y, s, rad) {
    rad = Math.min(rad, s / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + s, y, x + s, y + s, rad);
    ctx.arcTo(x + s, y + s, x, y + s, rad);
    ctx.arcTo(x, y + s, x, y, rad);
    ctx.arcTo(x, y, x + s, y, rad);
    ctx.closePath();
  }

  function onMove(e) {
    const rect = container.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const s = o.cellSize;
    const now = performance.now();
    // only visit cells inside the cursor's bounding box
    const c0 = Math.max(0, Math.floor((px - o.radius - offX) / s));
    const c1 = Math.min(cols - 1, Math.floor((px + o.radius - offX) / s));
    const r0 = Math.max(0, Math.floor((py - o.radius - offY) / s));
    const r1 = Math.min(rows - 1, Math.floor((py + o.radius - offY) / s));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const dx = offX + (col + 0.5) * s - px;
        const dy = offY + (row + 0.5) * s - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= o.radius) continue;
        light(row * cols + col, falloff(1 - d / o.radius), now);
      }
    }
    wake();
  }

  function onDown(e) {
    if (!o.clickPulse) return;
    const rect = container.getBoundingClientRect();
    pulses.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, start: performance.now() });
    wake();
  }

  function stepPulses(now) {
    const s = o.cellSize;
    const band = s * 0.75;
    pulses = pulses.filter((p) => {
      const ring = ((now - p.start) / 1000) * o.pulseSpeed;
      const far = Math.hypot(Math.max(p.x, w - p.x), Math.max(p.y, h - p.y)) + s;
      if (ring - band > far) return false;
      const c0 = Math.max(0, Math.floor((p.x - ring - band - offX) / s));
      const c1 = Math.min(cols - 1, Math.floor((p.x + ring + band - offX) / s));
      const r0 = Math.max(0, Math.floor((p.y - ring - band - offY) / s));
      const r1 = Math.min(rows - 1, Math.floor((p.y + ring + band - offY) / s));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const d = Math.hypot(offX + (col + 0.5) * s - p.x, offY + (row + 0.5) * s - p.y);
          if (Math.abs(d - ring) < band) light(row * cols + col, 1, now);
        }
      }
      return true;
    });
  }

  function frame(now) {
    raf = 0;
    stepPulses(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = o.cellSize;
    const inset = o.lineWidth / 2;
    const reach = s * Math.SQRT1_2;
    let visible = pulses.length > 0;
    ctx.lineWidth = o.lineWidth;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const v = current(row * cols + col, now);
        const x = offX + col * s + inset;
        const y = offY + row * s + inset;
        const size = s - o.lineWidth;
        if (o.gridOpacity > 0) {
          roundedRect(x, y, size, o.cellRadius);
          ctx.strokeStyle = rgba(o.gridOpacity);
          ctx.stroke();
        }
        if (v < 0.004) continue;
        visible = true;
        const a = v * o.maxOpacity;
        const cx = x + size / 2;
        const cy = y + size / 2;
        // bright at the middle of each edge, fading toward the corners
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
        grad.addColorStop(0, rgba(a));
        grad.addColorStop(0.7, rgba(a));
        grad.addColorStop(1, rgba(0));
        roundedRect(x, y, size, o.cellRadius);
        if (o.fillOpacity > 0) {
          ctx.fillStyle = rgba(v * o.fillOpacity);
          ctx.fill();
        }
        ctx.strokeStyle = grad;
        ctx.stroke();
      }
    }
    if (visible) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(build);
  ro.observe(container);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  build();

  return function destroy() {
    ro.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    canvas.remove();
  };
}
