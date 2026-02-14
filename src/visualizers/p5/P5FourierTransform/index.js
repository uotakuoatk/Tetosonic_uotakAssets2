const SVG_URL = '/assets/Fourier%20Transform/Fourier%20Transform02.svg';
const SAMPLE_POINT_COUNT =100;
const TARGET_SAMPLE_POINT_COUNT = 720;
const LOOP_FRAMES = 300;
const MAX_COEFFICIENTS = 120;
const TRACE_COLOR = '#fff';
const CIRCLE_STROKE = [255, 255, 255, 255];
const VECTOR_STROKE = [255, 255, 255, 255];
const TARGET_WIDTH_RATIO =1;
const DRIFT_START_DELAY_FRAMES = 20;
const TRACE_MORPH_LERP = 0.005;
const TRACE_LIFETIME_FRAMES = 100;
const TRACE_COUNT = 1;
const TRACE_FILL_COLOR = [255, 255, 255, 255];
const TRACE_FILL_ZERO_POS = 0.5;
const REVERSE_ONE_PROBABILITY = 0.5;
const TRACE_FADE_WINDOW_RATIO = 0.8;
const TRACE_POINTS_PER_FRAME = 4;

const Visualizer = {
  kind: 'p5',
  id: 'p5-fourier-transform',
  name: 'Fourier Transform',
  version: '1.0.0',

  async init(ctx) {
    this.ctx = ctx;
    this._sk = null;
    this._off = [];
    this._coeffs = [];
    this._coeffsTarget300 = [];
    this._traces = Array.from({ length: TRACE_COUNT }, () => []);
    this._phase = 0;
    this._phaseStep = 1 / LOOP_FRAMES;
    this._reverseEpicycleIndex = -1;
    this._shapeNormWidth = 1;
    this._shapeNormHeight = 1;
    this._drawFramesSinceReady = 0;
    this._loading = false;
    this._ready = false;
    this._errorMessage = '';
    this._destroyed = false;

    const self = this;
    const { container, p5, width, height, eventBus } = ctx;

    const sketch = (sk) => {
      sk.setup = () => {
        sk.createCanvas(width, height);
        sk.noFill();
        self._startPreparation();
      };

      sk.draw = () => {
        sk.clear();
        if (!self._ready) {
          self._drawStatus(sk);
          return;
        }
        self._drawFrame(sk);
      };
    };

    this._sk = new p5(sketch, container);
    const off = eventBus.on('resize', (s) => this.resize(s));
    this._off.push(off);
  },

  start() {
    if (this._sk) this._sk.loop();
  },

  stop() {
    if (this._sk) this._sk.noLoop();
  },

  resize({ width, height }) {
    if (!this._sk) return;
    this._sk.resizeCanvas(width, height, false);
    this._traces = Array.from({ length: TRACE_COUNT }, () => []);
    this._phase = 0;
    this._reverseEpicycleIndex = -1;
    this._drawFramesSinceReady = 0;
  },

  destroy() {
    this._destroyed = true;
    for (const off of this._off.splice(0)) {
      try {
        off();
      } catch {}
    }
    if (this._sk) {
      this._sk.remove();
      this._sk = null;
    }
    this._coeffs = [];
    this._coeffsTarget300 = [];
    this._traces = Array.from({ length: TRACE_COUNT }, () => []);
    this._phase = 0;
    this._reverseEpicycleIndex = -1;
    this._shapeNormWidth = 1;
    this._shapeNormHeight = 1;
    this._drawFramesSinceReady = 0;
    this._ready = false;
  },

  async _startPreparation() {
    if (this._loading || this._ready) return;
    this._loading = true;
    this._errorMessage = '';

    try {
      const sampledPoints = await this._sampleSvgPathPoints(SVG_URL, SAMPLE_POINT_COUNT);
      const sampledPointsTarget = await this._sampleSvgPathPoints(SVG_URL, TARGET_SAMPLE_POINT_COUNT);
      const normalized = this._normalizePoints(sampledPoints);
      const normalizedTarget = this._normalizePoints(sampledPointsTarget);
      const coeffs = this._computeDft(normalized.points);
      const coeffsTarget = this._computeDft(normalizedTarget.points);
      coeffs.sort((a, b) => b.amp - a.amp);
      coeffsTarget.sort((a, b) => b.amp - a.amp);
      this._coeffs = coeffs.slice(0, Math.min(MAX_COEFFICIENTS, coeffs.length));
      this._coeffsTarget300 = coeffsTarget.slice(0, Math.min(MAX_COEFFICIENTS, coeffsTarget.length));
      this._shapeNormWidth = Math.max(1e-6, normalized.width);
      this._shapeNormHeight = Math.max(1e-6, normalized.height);
      this._traces = Array.from({ length: TRACE_COUNT }, () => []);
      this._phase = 0;
      this._reverseEpicycleIndex = this._pickReverseEpicycleIndex(this._coeffs);
      this._drawFramesSinceReady = 0;
      this._ready = this._coeffs.length > 0;
      if (!this._ready) this._errorMessage = 'No coefficient generated.';
    } catch (error) {
      this._errorMessage = `Load failed: ${error?.message || String(error)}`;
      this._ready = false;
    } finally {
      this._loading = false;
      if (this._destroyed) {
        this._coeffs = [];
        this._coeffsTarget300 = [];
        this._traces = Array.from({ length: TRACE_COUNT }, () => []);
        this._reverseEpicycleIndex = -1;
        this._shapeNormWidth = 1;
        this._shapeNormHeight = 1;
        this._drawFramesSinceReady = 0;
        this._ready = false;
      }
    }
  },

  async _sampleSvgPathPoints(url, targetSamples) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SVG request failed (${res.status})`);
    }

    const text = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'image/svg+xml');
    const rawPaths = Array.from(xml.querySelectorAll('path'))
      .map((node) => node.getAttribute('d'))
      .filter((d) => typeof d === 'string' && d.trim().length > 0);

    if (rawPaths.length === 0) {
      throw new Error('No <path> element found in SVG.');
    }

    const svgNS = 'http://www.w3.org/2000/svg';
    const measureSvg = document.createElementNS(svgNS, 'svg');
    measureSvg.setAttribute('width', '0');
    measureSvg.setAttribute('height', '0');
    measureSvg.style.position = 'absolute';
    measureSvg.style.left = '-99999px';
    measureSvg.style.top = '-99999px';
    measureSvg.style.opacity = '0';
    document.body.appendChild(measureSvg);

    try {
      const pathEls = rawPaths.map((d) => {
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', d);
        measureSvg.appendChild(p);
        return p;
      });

      const lengths = pathEls.map((p) => p.getTotalLength());
      const totalLength = lengths.reduce((sum, v) => sum + v, 0);
      if (!(totalLength > 0)) {
        throw new Error('Path length is zero.');
      }

      const points = [];
      for (let i = 0; i < pathEls.length; i += 1) {
        const pathEl = pathEls[i];
        const pathLength = lengths[i];
        const sampleCount = Math.max(8, Math.round((targetSamples * pathLength) / totalLength));
        for (let s = 0; s < sampleCount; s += 1) {
          const t = s / sampleCount;
          const pt = pathEl.getPointAtLength(t * pathLength);
          points.push({ x: pt.x, y: pt.y });
        }
      }

      if (points.length < 2) {
        throw new Error('Insufficient sampled points.');
      }
      return points;
    } finally {
      measureSvg.remove();
    }
  },

  _normalizePoints(points) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const size = Math.max(1e-6, maxX - minX, maxY - minY);

    return {
      points: points.map((p) => ({
        x: (p.x - cx) / size,
        y: (p.y - cy) / size
      })),
      width: (maxX - minX) / size,
      height: (maxY - minY) / size
    };
  },

  _computeDft(points) {
    const n = points.length;
    const coeffs = [];

    for (let k = 0; k < n; k += 1) {
      let re = 0;
      let im = 0;

      for (let t = 0; t < n; t += 1) {
        const phi = (2 * Math.PI * k * t) / n;
        const x = points[t].x;
        const y = points[t].y;
        re += x * Math.cos(phi) + y * Math.sin(phi);
        im += y * Math.cos(phi) - x * Math.sin(phi);
      }

      re /= n;
      im /= n;
      const freq = k <= n / 2 ? k : k - n;
      coeffs.push({
        freq,
        re,
        im,
        amp: Math.hypot(re, im),
        phase: Math.atan2(im, re)
      });
    }

    return coeffs;
  },

  _drawStatus(sk) {
    sk.noStroke();
    sk.fill('#ffffff');
    sk.textAlign(sk.CENTER, sk.CENTER);
    sk.textSize(Math.max(14, Math.min(sk.width, sk.height) * 0.025));

    if (this._errorMessage) {
      sk.text(this._errorMessage, sk.width * 0.5, sk.height * 0.5);
      return;
    }
    sk.text('Loading Fourier coefficients...', sk.width * 0.5, sk.height * 0.5);
  },

  _drawFrame(sk) {
    this._drawFramesSinceReady += 1;
    if (this._drawFramesSinceReady > DRIFT_START_DELAY_FRAMES) {
      this._deformTracePoints();
    }

    const centerX = sk.width * 0.5;
    const centerY = sk.height * 0.5;
    const targetWidth = sk.width * TARGET_WIDTH_RATIO;
    const drawScale = targetWidth / Math.max(1e-6, this._shapeNormWidth);
    const basePhase = this._phase;
    const subStepCount = Math.max(1, TRACE_POINTS_PER_FRAME);
    const maxTracePoints = Math.max(2, TRACE_LIFETIME_FRAMES * subStepCount);

    const phases = [this._wrap01(basePhase + this._phaseStep)];
    const targetCoeffs = this._coeffsTarget300.length > 0 ? this._coeffsTarget300 : this._coeffs;
    for (let i = 0; i < TRACE_COUNT; i += 1) {
      const trace = this._traces[i];
      for (let s = 1; s <= subStepCount; s += 1) {
        const samplePhase = this._wrap01(basePhase + (this._phaseStep * s) / subStepCount);
        const endpoint = this._getEndpointForCoeffs(
          centerX,
          centerY,
          drawScale,
          samplePhase,
          this._coeffs,
          this._reverseEpicycleIndex
        );
        const targetEndpoint = this._getEndpointForCoeffs(
          centerX,
          centerY,
          drawScale,
          samplePhase,
          targetCoeffs,
          this._reverseEpicycleIndex
        );
        trace.push({
          x: endpoint.x,
          y: endpoint.y,
          targetX: targetEndpoint.x,
          targetY: targetEndpoint.y
        });
      }
      if (trace.length > maxTracePoints) {
        trace.splice(0, trace.length - maxTracePoints);
      }
    }

    this._drawEpicycles(
      sk,
      centerX,
      centerY,
      drawScale,
      phases[0],
      this._reverseEpicycleIndex
    );

    sk.push();
    sk.strokeJoin(sk.ROUND);
    sk.strokeCap(sk.ROUND);
    for (let i = 0; i < TRACE_COUNT; i += 1) {
      const trace = this._traces[i];
      if (trace.length === 0) continue;

      // 始点と終点をつないだ内側を塗る。
      if (trace.length >= 3) {
        this._fillTraceWithPerpendicularGradient(sk, trace);
      }

      this._drawTraceStrokeWithFade(sk, trace);
    }
    sk.pop();
    this._phase += this._phaseStep;
    if (this._phase >= 1) {
      this._phase -= 1;
      this._reverseEpicycleIndex = this._pickReverseEpicycleIndex(this._coeffs);
    }
  },

  _fillTraceWithPerpendicularGradient(sk, trace) {
    const tip = trace[trace.length - 1];
    const prev = trace.length >= 2 ? trace[trace.length - 2] : trace[0];
    const moveDx = tip.x - prev.x;
    const moveDy = tip.y - prev.y;
    const moveLen = Math.max(1e-6, Math.hypot(moveDx, moveDy));

    // 先端の移動方向に垂直な単位ベクトル
    const perpX = -moveDy / moveLen;
    const perpY = moveDx / moveLen;

    let maxDistFromTip = 0;
    for (const p of trace) {
      const d = (p.x - tip.x) * perpX + (p.y - tip.y) * perpY;
      const ad = Math.abs(d);
      if (ad > maxDistFromTip) maxDistFromTip = ad;
    }
    const span = Math.max(1, maxDistFromTip);

    // グラデの開始点を描画先端に固定
    const g0x = tip.x;
    const g0y = tip.y;
    const g1x = tip.x + perpX * span;
    const g1y = tip.y + perpY * span;

    const [r, g, b, aRaw] = TRACE_FILL_COLOR;
    const alpha = Math.max(0, Math.min(1, (aRaw ?? 255) / 255));
    const zeroPos = Math.max(0, Math.min(1, TRACE_FILL_ZERO_POS));

    const ctx2d = sk.drawingContext;
    ctx2d.save();
    const gradient = ctx2d.createLinearGradient(g0x, g0y, g1x, g1y);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    gradient.addColorStop(zeroPos, `rgba(${r}, ${g}, ${b}, 0)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx2d.fillStyle = gradient;

    ctx2d.beginPath();
    ctx2d.moveTo(trace[0].x, trace[0].y);
    for (let i = 1; i < trace.length; i += 1) {
      ctx2d.lineTo(trace[i].x, trace[i].y);
    }
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.restore();
  },

  _wrap01(v) {
    return ((v % 1) + 1) % 1;
  },

  _drawTraceStrokeWithFade(sk, trace) {
    if (!Array.isArray(trace) || trace.length < 2) return;

    const fadeWindow = Math.max(2, Math.floor(trace.length * TRACE_FADE_WINDOW_RATIO));
    sk.noFill();
    sk.strokeWeight(90);

    for (let i = 1; i < trace.length; i += 1) {
      // 古い線分ほど透明にして、消える直前に減衰させる。
      let alphaScale = 1;
      if (i <= fadeWindow) {
        alphaScale = i / fadeWindow;
      }

      const c = sk.color(TRACE_COLOR);
      c.setAlpha(255 * alphaScale);
      sk.stroke(c);
      sk.line(trace[i - 1].x, trace[i - 1].y, trace[i].x, trace[i].y);
    }
  },

  _getEndpointForCoeffs(originX, originY, drawScale, phase01, coeffs, reverseIndex = -1) {
    let x = originX;
    let y = originY;
    const t = 2 * Math.PI * phase01;
    for (let i = 0; i < coeffs.length; i += 1) {
      const c = coeffs[i];
      if (c.freq === 0) continue; // 平行移動成分を除外して中央基準に固定
      const angle = i === reverseIndex
        ? c.phase - t * c.freq
        : t * c.freq + c.phase;
      const radius = c.amp * drawScale;
      x += radius * Math.cos(angle);
      y += radius * Math.sin(angle);
    }
    return { x, y };
  },

  _drawEpicycles(sk, originX, originY, drawScale, phase01, reverseIndex = -1) {
    let x = originX;
    let y = originY;
    const t = 2 * Math.PI * phase01;

    sk.noFill();
    for (let i = 0; i < this._coeffs.length; i += 1) {
      const c = this._coeffs[i];
      if (c.freq === 0) continue; // 平行移動成分を除外して中央基準に固定
      const prevX = x;
      const prevY = y;
      const angle = i === reverseIndex
        ? c.phase - t * c.freq
        : t * c.freq + c.phase;
      const radius = c.amp * drawScale;
      x += radius * Math.cos(angle);
      y += radius * Math.sin(angle);

      if (radius > 0.5) {
        sk.stroke(...CIRCLE_STROKE);
        sk.strokeWeight(2);
        sk.circle(prevX, prevY, radius * 2);
      }
      sk.stroke(...VECTOR_STROKE);
      sk.strokeWeight(1.2);
      sk.line(prevX, prevY, x, y);
    }
    sk.noStroke();
    sk.fill('#ffffff');
    sk.circle(x, y, 4);
    return { x, y };
  },

  _pickReverseEpicycleIndex(coeffs) {
    if (!Array.isArray(coeffs) || coeffs.length === 0) return -1;
    if (Math.random() >= REVERSE_ONE_PROBABILITY) return -1;

    const candidates = [];
    const weights = [];
    let totalWeight = 0;
    for (let i = 0; i < coeffs.length; i += 1) {
      const c = coeffs[i];
      if (!c) continue;
      if (!Number.isFinite(c.freq) || Math.abs(c.freq) < 1e-9) continue;
      if (!Number.isFinite(c.amp) || c.amp <= 1e-9) continue;
      candidates.push(i);
      const w = c.amp;
      weights.push(w);
      totalWeight += w;
    }
    if (candidates.length === 0) return -1;
    if (!(totalWeight > 0)) {
      const picked = Math.floor(Math.random() * candidates.length);
      return candidates[picked];
    }

    // 振幅(=円の大きさ)を重みとしてルーレット抽選。
    let r = Math.random() * totalWeight;
    for (let i = 0; i < candidates.length; i += 1) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  },

  _deformTracePoints() {
    if (!this._traces || this._traces.length === 0) return;
    for (let ti = 0; ti < this._traces.length; ti += 1) {
      const trace = this._traces[ti];
      for (let i = 0; i < trace.length; i += 1) {
        const p = trace[i];
        p.x += (p.targetX - p.x) * TRACE_MORPH_LERP;
        p.y += (p.targetY - p.y) * TRACE_MORPH_LERP;
      }
    }
  }
};

export default Visualizer;
