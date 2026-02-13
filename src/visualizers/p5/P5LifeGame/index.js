import patternConfig from './patterns.json';

function normalizeRowText(rowText) {
  return String(rowText ?? '')
    .replace(/⬛︎/g, '0')
    .replace(/⬛/g, '0')
    .replace(/⬜︎/g, '1')
    .replace(/⬜/g, '1');
}

function sanitizeRowText(rowText) {
  return normalizeRowText(rowText).replace(/[^01]/g, '');
}

function inferBoardWidth(initialRows) {
  if (!Array.isArray(initialRows) || initialRows.length === 0) return 100;
  let maxLen = 0;
  for (const row of initialRows) {
    const len = sanitizeRowText(row).length;
    if (len > maxLen) maxLen = len;
  }
  return Math.max(1, maxLen || 100);
}

const rawBoardWidth = Number.isFinite(patternConfig.boardWidth)
  ? Math.floor(patternConfig.boardWidth)
  : 0;
const inferredBoardWidth = inferBoardWidth(patternConfig.initialPatternRows);
const BOARD_WIDTH = rawBoardWidth >= 2 ? rawBoardWidth : inferredBoardWidth;
const BOARD_HEIGHT = Number.isFinite(patternConfig.boardHeight)
  ? Math.max(1, Math.floor(patternConfig.boardHeight))
  : 26;
const STEP_INTERVAL_FRAMES = Number.isFinite(patternConfig.stepIntervalFrames)
  ? Math.max(1, Math.floor(patternConfig.stepIntervalFrames))
  : 6;
const SPAWN_EVERY_GENERATIONS = Number.isFinite(patternConfig.spawnEveryGenerations)
  ? Math.max(1, Math.floor(patternConfig.spawnEveryGenerations))
  : 10;
const INJECTION_REPEAT_COUNT = 2;

function createEmptyGrid() {
  return Array.from({ length: BOARD_HEIGHT }, () => new Uint8Array(BOARD_WIDTH));
}

function createSeedGrid(initialRows) {
  const rows = Array.isArray(initialRows) ? initialRows : [];
  const grid = createEmptyGrid();
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    const row = sanitizeRowText(rows[y] ?? '');
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      grid[y][x] = row[x] === '1' ? 1 : 0;
    }
  }
  return grid;
}

function createSourceMaskFromState(grid) {
  const mask = createEmptyGrid();
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      mask[y][x] = grid[y][x] === 1 ? 1 : 0;
    }
  }
  return mask;
}

const Visualizer = {
  kind: 'p5',
  id: 'p5-life-game',
  name: 'Life Game',
  version: '1.5.0',

  async init(ctx) {
    this.ctx = ctx;
    this._sk = null;
    this._off = [];
    this._generation = 0;
    this._spawnEveryGenerations = SPAWN_EVERY_GENERATIONS;
    this._initialPatternRows = Array.isArray(patternConfig.initialPatternRows)
      ? patternConfig.initialPatternRows
      : [];
    this._injectionPatterns = Array.isArray(patternConfig.injectionPatterns)
      ? patternConfig.injectionPatterns
      : [];
    this._hasInitialPatternInCycle = this._initialPatternRows.length > 0;
    this._injectionCycleLength =
      this._injectionPatterns.length + (this._hasInitialPatternInCycle ? 1 : 0);
    this._injectionCursor = 0;
    this._injectionRepeatCounter = 0;
    this._grid = createSeedGrid(this._initialPatternRows);
    this._next = createEmptyGrid();
    this._sourceMask = createSourceMaskFromState(this._grid);
    this._nextSourceMask = createEmptyGrid();

    const self = this;
    const { container, p5, width, height, eventBus } = ctx;

    const sketch = (sk) => {
      sk.setup = () => {
        sk.createCanvas(width, height);
        sk.noSmooth();
        sk.frameRate(60);
      };

      sk.draw = () => {
        sk.background(0);
        self._drawBoard(sk);

        if (sk.frameCount % STEP_INTERVAL_FRAMES === 0) {
          self._step();
        }
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
  },

  destroy() {
    for (const off of this._off.splice(0)) {
      try { off(); } catch {}
    }
    if (this._sk) {
      this._sk.remove();
      this._sk = null;
    }
    this._grid = createEmptyGrid();
    this._next = createEmptyGrid();
    this._sourceMask = createEmptyGrid();
    this._nextSourceMask = createEmptyGrid();
  },

  _drawBoard(sk) {
    const cellW = sk.width / BOARD_WIDTH;
    const cellH = sk.height / BOARD_HEIGHT;
    const boardPixelWidth = sk.width;
    const boardPixelHeight = sk.height;
    const offsetX = 0;
    const offsetY = 0;

    sk.noStroke();
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      const row = this._grid[y];
      const sourceRow = this._sourceMask[y];
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        if (row[x] === 1) {
          const isSourceCell = sourceRow[x] === 1;
          sk.fill(isSourceCell ? '#00FF00' : '#FFFFFF');
          sk.rect(offsetX + x * cellW, offsetY + y * cellH, cellW, cellH);
        }
      }
    }

    sk.noFill();
    sk.stroke('#333333');
    sk.strokeWeight(2);
    for (let x = 0; x <= BOARD_WIDTH; x += 1) {
      const px = offsetX + x * cellW;
      sk.line(px, offsetY, px, offsetY + boardPixelHeight);
    }
    for (let y = 0; y <= BOARD_HEIGHT; y += 1) {
      const py = offsetY + y * cellH;
      sk.line(offsetX, py, offsetX + boardPixelWidth, py);
    }
  },

  _step() {
    const src = this._grid;
    const dst = this._next;
    const srcSourceMask = this._sourceMask;
    const dstSourceMask = this._nextSourceMask;

    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        let neighbors = 0;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
            neighbors += src[ny][nx];
          }
        }

        const alive = src[y][x] === 1;
        let nextAlive = 0;
        if (alive) {
          nextAlive = neighbors === 2 || neighbors === 3 ? 1 : 0;
        } else {
          nextAlive = neighbors === 3 ? 1 : 0;
        }

        dst[y][x] = nextAlive;
        if (nextAlive === 1) {
          if (alive) {
            dstSourceMask[y][x] = srcSourceMask[y][x];
          } else {
            // Newly born cells are simulation result, so draw as white.
            dstSourceMask[y][x] = 0;
          }
        } else {
          dstSourceMask[y][x] = 0;
        }
      }
    }

    this._grid = dst;
    this._next = src;
    this._sourceMask = dstSourceMask;
    this._nextSourceMask = srcSourceMask;

    this._generation += 1;
    if (
      this._injectionCycleLength > 0 &&
      this._generation % this._spawnEveryGenerations === 0
    ) {
      this._injectNextPattern();
    }
  },

  _injectNextPattern() {
    if (this._injectionCycleLength <= 0) return;
    const cursor = this._injectionCursor % this._injectionCycleLength;
    const initialSlotIndex = this._injectionPatterns.length;

    if (this._hasInitialPatternInCycle && cursor === initialSlotIndex) {
      this._stampRows(this._initialPatternRows, 0, 0);
    } else {
      const pattern = this._injectionPatterns[cursor];
      if (pattern) {
        const x = Number.isFinite(pattern.x) ? Math.floor(pattern.x) : 0;
        const y = Number.isFinite(pattern.y) ? Math.floor(pattern.y) : 0;
        const rows = Array.isArray(pattern.rows) ? pattern.rows : [];
        this._stampRows(rows, x, y);
      }
    }

    this._injectionRepeatCounter += 1;
    if (this._injectionRepeatCounter >= INJECTION_REPEAT_COUNT) {
      this._injectionRepeatCounter = 0;
      this._injectionCursor = (this._injectionCursor + 1) % this._injectionCycleLength;
    }
  },

  _stampRows(rows, startX, startY) {
    for (let dy = 0; dy < rows.length; dy += 1) {
      const rowText = sanitizeRowText(rows[dy] ?? '');
      for (let dx = 0; dx < rowText.length; dx += 1) {
        if (rowText[dx] !== '1') continue;
        const x = startX + dx;
        const y = startY + dy;
        if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) continue;
        this._grid[y][x] = 1;
        this._sourceMask[y][x] = 1;
      }
    }
  }
};

export default Visualizer;
