/**
 * WebGL fluid-ink cursor effect (stable fluids on the GPU). Self-running.
 * Include with: <script src="./js/fluid-cursor.js" defer></script>
 * Cleanup: window.destroyFluidCursor()
 */
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const CONFIG = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: window.matchMedia('(pointer: coarse)').matches ? 768 : 1440,
    DENSITY_DISSIPATION: 3.5, // how fast the colour fades
    VELOCITY_DISSIPATION: 2,
    PRESSURE: 0.1,
    PRESSURE_ITERATIONS: 20,
    CURL: 3,
    SPLAT_RADIUS: 0.2,
    SPLAT_FORCE: 6000,
    CLICK_FORCE_MULTIPLIER: 10, // click burst vs. a normal mouse move
    COLOR_INTENSITY: 0.55,
    COLOR_UPDATE_SPEED: 10,     // colour changes per second
    IDLE_STOP_MS: 3000,         // stop the render loop once the ink has faded
    MAX_DELTA: 1 / 60,          // cap so a returning background tab doesn't explode
    PALETTE: ['#FFCBE1', '#D6E5BD', '#F9E1A8', '#BCD8EC', '#DCCCEC', '#FFDAB4'],
    CANVAS_FILTER: 'contrast(1.12) brightness(1.06)'
  };

  const wrapper = document.createElement('div');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;filter:' + CONFIG.CANVAS_FILTER;
  wrapper.appendChild(canvas);

  const params = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true };
  let gl = canvas.getContext('webgl2', params);
  const isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
  if (!gl) return;
  document.body.appendChild(wrapper);

  // ---- formats ----
  let halfFloat, supportLinear;
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float');
    supportLinear = true; // RGBA16F filters linearly in core WebGL2
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float');
    supportLinear = !!gl.getExtension('OES_texture_half_float_linear');
    gl.getExtension('EXT_color_buffer_half_float');
  }
  gl.clearColor(0, 0, 0, 0);

  function pickFormat() {
    const candidates = [];
    if (isWebGL2) {
      candidates.push({ internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT });
    } else if (halfFloat) {
      candidates.push({ internal: gl.RGBA, format: gl.RGBA, type: halfFloat.HALF_FLOAT_OES });
    }
    candidates.push({ internal: isWebGL2 ? gl.RGBA8 : gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    for (const f of candidates) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, 4, 4, 0, f.format, f.type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      if (ok) return f;
    }
    return null;
  }
  const fmt = pickFormat();
  if (!fmt) { wrapper.remove(); return; }
  const filtering = supportLinear || fmt.type === gl.UNSIGNED_BYTE ? gl.LINEAR : gl.NEAREST;
  const manualFiltering = filtering === gl.NEAREST;

  // ---- shaders ----
  const HEAD = 'precision highp float; precision mediump sampler2D;\n';
  const baseVS = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv, vL, vR, vT, vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;
  const VARY = 'varying highp vec2 vUv, vL, vR, vT, vB;\n';

  const SRC = {
    splat: HEAD + VARY + `
      uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
      void main () {
        vec2 p = vUv - point; p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
      }`,
    advection: HEAD + VARY + `
      uniform sampler2D uVelocity, uSource; uniform vec2 texelSize, dyeTexelSize; uniform float dt, dissipation;
      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
      }
      void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
        gl_FragColor = result / (1.0 + dissipation * dt);
      }`,
    divergence: HEAD + VARY + `
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }`,
    curl: HEAD + VARY + `
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x;
        gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
      }`,
    vorticity: HEAD + VARY + `
      uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
      void main () {
        float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0;
        vec2 v = texture2D(uVelocity, vUv).xy + force * dt;
        gl_FragColor = vec4(min(max(v, -1000.0), 1000.0), 0.0, 1.0);
      }`,
    clear: HEAD + VARY + `
      uniform sampler2D uTexture; uniform float value;
      void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`,
    pressure: HEAD + VARY + `
      uniform sampler2D uPressure, uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
        float div = texture2D(uDivergence, vUv).x;
        gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
      }`,
    gradient: HEAD + VARY + `
      uniform sampler2D uPressure, uVelocity;
      void main () {
        float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
        vec2 v = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
        gl_FragColor = vec4(v, 0.0, 1.0);
      }`,
    // SHADING pass: fake a soft 3D highlight from the dye gradient, output premultiplied
    display: HEAD + VARY + `
      uniform sampler2D uTexture; uniform vec2 texelSize;
      void main () {
        vec3 c = min(texture2D(uTexture, vUv).rgb, 1.0);
        float dx = length(texture2D(uTexture, vR).rgb) - length(texture2D(uTexture, vL).rgb);
        float dy = length(texture2D(uTexture, vT).rgb) - length(texture2D(uTexture, vB).rgb);
        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
        c *= diffuse;
        gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
      }`
  };

  function compile(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s));
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, baseVS);
  const programs = {};
  for (const name in SRC) {
    const src = (name === 'advection' && manualFiltering ? '#define MANUAL_FILTERING\n' : '') + SRC[name];
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, src));
    gl.bindAttribLocation(p, 0, 'aPosition');
    gl.linkProgram(p);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const uName = gl.getActiveUniform(p, i).name;
      u[uName] = gl.getUniformLocation(p, uName);
    }
    programs[name] = { program: p, u };
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  const idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  function blit(target) {
    if (target) {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // ---- framebuffers ----
  function createFBO(w, h, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, width: w, height: h, texelX: 1 / w, texelY: 1 / h,
      attach(unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit; } };
  }
  function createDouble(w, h, filter) {
    const d = { read: createFBO(w, h, filter), write: createFBO(w, h, filter),
      swap() { const t = d.read; d.read = d.write; d.write = t; },
      dispose() { [d.read, d.write].forEach((f) => { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); }); } };
    return d;
  }
  function resolution(res) {
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(res), max = Math.round(res * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? { w: max, h: min } : { w: min, h: max };
  }

  let velocity, dye, divergence, curl, pressure;
  function initFramebuffers() {
    [velocity, dye, pressure].forEach((d) => d && d.dispose());
    [divergence, curl].forEach((f) => { if (f) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); } });
    const sim = resolution(CONFIG.SIM_RESOLUTION);
    const dyeRes = resolution(CONFIG.DYE_RESOLUTION);
    velocity = createDouble(sim.w, sim.h, filtering);
    dye = createDouble(dyeRes.w, dyeRes.h, filtering);
    divergence = createFBO(sim.w, sim.h, gl.NEAREST);
    curl = createFBO(sim.w, sim.h, gl.NEAREST);
    pressure = createDouble(sim.w, sim.h, gl.NEAREST);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  // ---- colour ----
  const palette = CONFIG.PALETTE.map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  });
  function randomColor() {
    const c = palette[Math.floor(Math.random() * palette.length)];
    const k = CONFIG.COLOR_INTENSITY;
    return { r: c.r * k, g: c.g * k, b: c.b * k };
  }

  // ---- pointer ----
  const pointer = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, dx: 0, dy: 0, moved: false, color: randomColor() };

  function setPos(clientX, clientY) {
    pointer.px = pointer.x;
    pointer.py = pointer.y;
    // normalise by CSS size; the canvas is DPR-scaled but texcoords are resolution independent
    pointer.x = clientX / window.innerWidth;
    pointer.y = 1 - clientY / window.innerHeight;
    const aspect = canvas.width / canvas.height;
    pointer.dx = (pointer.x - pointer.px) * (aspect < 1 ? aspect : 1);
    pointer.dy = (pointer.y - pointer.py) * (aspect > 1 ? 1 / aspect : 1);
    pointer.moved = Math.abs(pointer.dx) > 0 || Math.abs(pointer.dy) > 0;
  }

  function radiusFix(r) {
    const aspect = canvas.width / canvas.height;
    return aspect > 1 ? (r / 100) * aspect : r / 100;
  }

  function splat(x, y, dx, dy, color, radiusScale) {
    const p = programs.splat;
    gl.useProgram(p.program);
    gl.uniform1i(p.u.uTarget, velocity.read.attach(0));
    gl.uniform1f(p.u.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(p.u.point, x, y);
    gl.uniform3f(p.u.color, dx, dy, 0);
    gl.uniform1f(p.u.radius, radiusFix(CONFIG.SPLAT_RADIUS) * radiusScale);
    blit(velocity.write); velocity.swap();
    gl.uniform1i(p.u.uTarget, dye.read.attach(0));
    gl.uniform3f(p.u.color, color.r, color.g, color.b);
    blit(dye.write); dye.swap();
  }

  function click(clientX, clientY) {
    const x = clientX / window.innerWidth, y = 1 - clientY / window.innerHeight;
    const angle = Math.random() * Math.PI * 2;
    const force = CONFIG.SPLAT_FORCE * 0.01 * CONFIG.CLICK_FORCE_MULTIPLIER;
    const c = randomColor();
    const burst = { r: c.r * 2, g: c.g * 2, b: c.b * 2 };
    splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, burst, 1.6);
  }

  const onMouseMove = (e) => { setPos(e.clientX, e.clientY); wake(); };
  const onMouseDown = (e) => { setPos(e.clientX, e.clientY); pointer.px = pointer.x; pointer.py = pointer.y; click(e.clientX, e.clientY); wake(); };
  const onTouchStart = (e) => {
    for (const t of e.targetTouches) { setPos(t.clientX, t.clientY); pointer.px = pointer.x; pointer.py = pointer.y; click(t.clientX, t.clientY); }
    wake();
  };
  const onTouchMove = (e) => { for (const t of e.targetTouches) setPos(t.clientX, t.clientY); wake(); };
  const onTouchEnd = () => { pointer.moved = false; };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd);

  // ---- simulation step ----
  function step(dt) {
    gl.disable(gl.BLEND);
    let p = programs.curl;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.texelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform1i(p.u.uVelocity, velocity.read.attach(0));
    blit(curl);

    p = programs.vorticity;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.texelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform1i(p.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(p.u.uCurl, curl.attach(1));
    gl.uniform1f(p.u.curl, CONFIG.CURL);
    gl.uniform1f(p.u.dt, dt);
    blit(velocity.write); velocity.swap();

    p = programs.divergence;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.texelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform1i(p.u.uVelocity, velocity.read.attach(0));
    blit(divergence);

    p = programs.clear;
    gl.useProgram(p.program);
    gl.uniform1i(p.u.uTexture, pressure.read.attach(0));
    gl.uniform1f(p.u.value, CONFIG.PRESSURE);
    blit(pressure.write); pressure.swap();

    p = programs.pressure;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.texelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform1i(p.u.uDivergence, divergence.attach(0));
    for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(p.u.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    p = programs.gradient;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.texelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform1i(p.u.uPressure, pressure.read.attach(0));
    gl.uniform1i(p.u.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    p = programs.advection;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.texelSize, velocity.read.texelX, velocity.read.texelY);
    gl.uniform2f(p.u.dyeTexelSize, velocity.read.texelX, velocity.read.texelY);
    const vId = velocity.read.attach(0);
    gl.uniform1i(p.u.uVelocity, vId);
    gl.uniform1i(p.u.uSource, vId);
    gl.uniform1f(p.u.dt, dt);
    gl.uniform1f(p.u.dissipation, CONFIG.VELOCITY_DISSIPATION);
    blit(velocity.write); velocity.swap();

    gl.uniform2f(p.u.dyeTexelSize, dye.read.texelX, dye.read.texelY);
    gl.uniform1i(p.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(p.u.uSource, dye.read.attach(1));
    gl.uniform1f(p.u.dissipation, CONFIG.DENSITY_DISSIPATION);
    blit(dye.write); dye.swap();
  }

  function render() {
    const p = programs.display;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform1i(p.u.uTexture, dye.read.attach(0));
    blit(null);
  }

  // ---- loop ----
  let last = performance.now(), colorTimer = 0, raf = 0, dead = false, lastActive = 0;
  // the loop only runs while there is ink to simulate; input wakes it again
  function wake() {
    lastActive = performance.now();
    if (!raf && !dead) { last = lastActive; raf = requestAnimationFrame(frame); }
  }
  resize();
  initFramebuffers();

  function frame(now) {
    raf = 0;
    if (dead) return;
    const dt = Math.min((now - last) / 1000, CONFIG.MAX_DELTA);
    last = now;
    if (resize()) initFramebuffers();

    colorTimer += dt * CONFIG.COLOR_UPDATE_SPEED;
    if (colorTimer >= 1) { colorTimer %= 1; pointer.color = randomColor(); }

    if (pointer.moved) {
      pointer.moved = false;
      splat(pointer.x, pointer.y, pointer.dx * CONFIG.SPLAT_FORCE, pointer.dy * CONFIG.SPLAT_FORCE, pointer.color, 1);
    }
    step(dt);
    render();
    if (now - lastActive < CONFIG.IDLE_STOP_MS) {
      raf = requestAnimationFrame(frame);
    } else {
      // ink has fully faded: wipe leftovers and sleep until the next input
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  wake();

  window.destroyFluidCursor = function () {
    dead = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    wrapper.remove();
    delete window.destroyFluidCursor;
  };
})();
