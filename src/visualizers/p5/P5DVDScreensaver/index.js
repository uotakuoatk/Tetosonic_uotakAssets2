const IMAGE_URL = '/assets/DVD/DVD.svg';
const SPRITE_PROFILES = [
  { speed: 80, trailHueDeg: 60 },
  { speed: 20, trailHueDeg: -15 }
];
const SPRITE_COUNT = SPRITE_PROFILES.length;
const BASE_WIDTH_RATIO = 0.2;
const TRAIL_COUNT = 10;
const TRAIL_DELAY_FRAMES = 1;
const BOUNCE_JITTER_DEG = 7;
const MIN_AXIS_SPEED_RATIO = 0.18;

const Visualizer = {
  kind: 'p5',
  id: 'p5-dvd-screensaver',
  name: 'DVD Screensaver',
  version: '1.0.0',

  async init(ctx) {
    this.ctx = ctx;
    this._sk = null;
    this._off = [];
    this._image = null;
    this._ready = false;
    this._drawWidth = 1;
    this._drawHeight = 1;
    this._sprites = [];

    const self = this;
    const { container, p5, width, height, eventBus } = ctx;

    const sketch = (sk) => {
      sk.preload = () => {
        self._image = sk.loadImage(
          IMAGE_URL,
          () => {
            self._ready = true;
          },
          () => {
            self._ready = false;
          }
        );
      };

      sk.setup = () => {
        sk.createCanvas(width, height);
        sk.imageMode(sk.CORNER);
        sk.noSmooth();
        self._resetState(sk, true);
      };

      sk.draw = () => {
        sk.background(0);
        if (!self._isDrawable()) return;
        self._step(sk);
        self._drawTrails(sk);
        self._drawMain(sk);
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
    this._resetState(this._sk, false);
  },

  destroy() {
    for (const off of this._off.splice(0)) {
      try {
        off();
      } catch {}
    }
    if (this._sk) {
      this._sk.remove();
      this._sk = null;
    }
    this._image = null;
    this._ready = false;
    this._sprites = [];
  },

  _isDrawable() {
    return !!(this._ready && this._image && this._image.width > 0 && this._image.height > 0);
  },

  _resetState(sk, resetPosition) {
    if (!this._isDrawable()) return;

    const aspect = this._image.width / Math.max(1, this._image.height);
    this._drawWidth = Math.max(1, sk.width * BASE_WIDTH_RATIO);
    this._drawHeight = Math.max(1, this._drawWidth / Math.max(1e-6, aspect));

    if (resetPosition || this._sprites.length !== SPRITE_COUNT) {
      this._sprites = Array.from({ length: SPRITE_COUNT }, (_, i) => this._createSprite(sk, i));
      return;
    }

    for (const sprite of this._sprites) {
      sprite.x = sk.constrain(sprite.x, 0, Math.max(0, sk.width - this._drawWidth));
      sprite.y = sk.constrain(sprite.y, 0, Math.max(0, sk.height - this._drawHeight));
      this._pushHistory(sprite);
    }
  },

  _createSprite(sk, index) {
    const profile = SPRITE_PROFILES[index % SPRITE_PROFILES.length];
    const maxX = Math.max(0, sk.width - this._drawWidth);
    const maxY = Math.max(0, sk.height - this._drawHeight);
    const x = maxX * ((index + 1) / (SPRITE_COUNT + 1));
    const y = maxY * (index % 2 === 0 ? 0.35 : 0.65);
    const { vx, vy } = this._createVelocity(sk, index, profile.speed);

    const sprite = {
      x,
      y,
      vx,
      vy,
      mainHueDeg: 0,
      trailHueDeg: profile.trailHueDeg,
      history: []
    };
    this._pushHistory(sprite);
    return sprite;
  },

  _createVelocity(sk, index, speed) {
    const angleDeg = sk.random(20, 70);
    const rad = (angleDeg * Math.PI) / 180;
    const sx = index % 2 === 0 ? 1 : -1;
    const sy = sk.random() < 0.5 ? -1 : 1;
    return {
      vx: Math.cos(rad) * speed * sx,
      vy: Math.sin(rad) * speed * sy
    };
  },

  _step(sk) {
    for (const sprite of this._sprites) {
      this._stepSprite(sk, sprite);
    }
  },

  _stepSprite(sk, sprite) {
    sprite.x += sprite.vx;
    sprite.y += sprite.vy;
    let bouncedX = false;
    let bouncedY = false;

    if (sprite.x <= 0) {
      sprite.x = 0;
      sprite.vx = Math.abs(sprite.vx);
      bouncedX = true;
    } else if (sprite.x + this._drawWidth >= sk.width) {
      sprite.x = sk.width - this._drawWidth;
      sprite.vx = -Math.abs(sprite.vx);
      bouncedX = true;
    }

    if (sprite.y <= 0) {
      sprite.y = 0;
      sprite.vy = Math.abs(sprite.vy);
      bouncedY = true;
    } else if (sprite.y + this._drawHeight >= sk.height) {
      sprite.y = sk.height - this._drawHeight;
      sprite.vy = -Math.abs(sprite.vy);
      bouncedY = true;
    }

    if (bouncedX || bouncedY) {
      sprite.mainHueDeg = (sprite.mainHueDeg + 60) % 360;
      this._applyBounceJitter(sk, sprite, bouncedX, bouncedY);
    }

    this._pushHistory(sprite);
  },

  _applyBounceJitter(sk, sprite, bouncedX, bouncedY) {
    const speed = Math.max(1e-6, Math.hypot(sprite.vx, sprite.vy));
    const jitterRad = (sk.random(-BOUNCE_JITTER_DEG, BOUNCE_JITTER_DEG) * Math.PI) / 180;
    const angle = Math.atan2(sprite.vy, sprite.vx) + jitterRad;
    let nextVx = Math.cos(angle) * speed;
    let nextVy = Math.sin(angle) * speed;

    const minAxisSpeed = speed * MIN_AXIS_SPEED_RATIO;
    if (Math.abs(nextVx) < minAxisSpeed) nextVx = Math.sign(nextVx || sprite.vx || 1) * minAxisSpeed;
    if (Math.abs(nextVy) < minAxisSpeed) nextVy = Math.sign(nextVy || sprite.vy || 1) * minAxisSpeed;

    const norm = speed / Math.max(1e-6, Math.hypot(nextVx, nextVy));
    nextVx *= norm;
    nextVy *= norm;

    if (bouncedX) {
      if (sprite.x <= 0.0001) nextVx = Math.abs(nextVx);
      if (sprite.x + this._drawWidth >= sk.width - 0.0001) nextVx = -Math.abs(nextVx);
    }
    if (bouncedY) {
      if (sprite.y <= 0.0001) nextVy = Math.abs(nextVy);
      if (sprite.y + this._drawHeight >= sk.height - 0.0001) nextVy = -Math.abs(nextVy);
    }

    sprite.vx = nextVx;
    sprite.vy = nextVy;
  },

  _pushHistory(sprite) {
    const maxLen = TRAIL_COUNT * TRAIL_DELAY_FRAMES + 1;
    sprite.history.push({ x: sprite.x, y: sprite.y });
    if (sprite.history.length > maxLen) {
      sprite.history.splice(0, sprite.history.length - maxLen);
    }
  },

  _drawMain(sk) {
    const ctx2d = sk.drawingContext;
    for (const sprite of this._sprites) {
      ctx2d.save();
      ctx2d.filter = `hue-rotate(${sprite.mainHueDeg}deg)`;
      sk.image(this._image, sprite.x, sprite.y, this._drawWidth, this._drawHeight);
      ctx2d.restore();
    }
  },

  _drawTrails(sk) {
    const ctx2d = sk.drawingContext;
    for (const sprite of this._sprites) {
      for (let i = TRAIL_COUNT; i >= 1; i -= 1) {
        const idx = sprite.history.length - 1 - i * TRAIL_DELAY_FRAMES;
        if (idx < 0) continue;
        const p = sprite.history[idx];

        // Trails do not have their own physics; they only follow past main positions.
        ctx2d.save();
        ctx2d.globalAlpha = 0.3;
        ctx2d.filter = `saturate(3.2) hue-rotate(${i * sprite.trailHueDeg}deg)`;
        sk.image(this._image, p.x, p.y, this._drawWidth, this._drawHeight);
        ctx2d.restore();
      }
    }
  }
};

export default Visualizer;
