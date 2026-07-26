/**
 * 테트리스 캔버스 렌더러 — Tetris99식 레이아웃.
 * - 내 보드(로컬 엔진이 실시간 시뮬레이션)를 크게 중앙/좌측에, 상대 최대 3명의 보드 스냅샷을
 *   작게 우측에 나열한다. 다른 게임들의 "원형 테이블" 톤과는 다른 화면 구성이다.
 * - 이 렌더러의 requestAnimationFrame 루프가 로컬 엔진의 tick()도 함께 구동한다(렌더와 시뮬레이션이
 *   같은 프레임에서 맞물려야 하므로). 조각이 고정되면 callbacks.onLock(event)으로 네트워킹 쪽에 알린다.
 * - 입력(키보드/터치 버튼)은 index.js가 담당하고, this.engine의 메서드를 직접 호출한다.
 */
(function () {
  'use strict';
  const core = window.TetrisCore;
  const Engine = window.TetrisEngine;
  const { COLS, ROWS, PIECE_COLOR } = core;

  const TetrisUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    anim: 0, lastAnim: 0,
    callbacks: {},
    engine: null,
    myTopOut: false,
    opponents: [], // [{id,name,alive,topOut,linesCleared,garbageSent,garbageReceived,board,holdType,nextTypes}]
    finished: false, winnerName: '',
    paused: false, // 아직 매치 시작 카운트다운 중이면 로컬 엔진을 진행시키지 않는다
    countdownStart: null, _lastCountdownLabel: null,

    init(canvas, callbacks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.callbacks = callbacks || {};
      const resize = () => {
        this._layoutViewport(canvas);
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = canvas.clientWidth;
        this.H = canvas.clientHeight;
        canvas.width = Math.round(this.W * this.dpr);
        canvas.height = Math.round(this.H * this.dpr);
      };
      this.resize = resize;
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 250));
      // 캔버스 크기 자체를 이 함수가 결정하므로(letterbox), 캔버스를 관찰하면 자기 자신이 만든
      // 변경에 다시 반응하는 순환이 생길 수 있어 부모(뷰포트 전체)를 관찰한다.
      if (window.ResizeObserver && canvas.parentElement) new ResizeObserver(resize).observe(canvas.parentElement);
      resize();

      this.lastAnim = performance.now();
      const loop = () => {
        this.anim = performance.now();
        const dt = Math.min(100, this.anim - this.lastAnim); // 탭 전환 등으로 인한 큰 점프 방지
        this.lastAnim = this.anim;
        this._updateCountdown();
        if (this.engine && !this.myTopOut && !this.finished && !this.paused) {
          const ev = this.engine.tick(dt);
          if (ev.locked) this._reportLock(ev);
        }
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    /* ---------- 뷰포트 레터박스 ----------
     * 상단(방 이름·나가기)과 하단(방향키·회전·HOLD 버튼) 영역은 #game-hud가 화면 물리적
     * 모서리에 그대로 고정해 두고, 게임 화면(캔버스)만 그 사이 안전 영역에 맞춰 줄어들게 한다.
     * 가로/세로 각각 독립적으로 상한만 둘 뿐 특정 비율로 억지로 늘리거나 찌그러뜨리지 않으므로
     * (내부적으로 셀은 항상 정사각형으로 그려짐) 화면 비율이 자연스럽게 유지된다.
     */
    _layoutViewport(canvas) {
      const parent = canvas.parentElement;
      if (!parent) return;
      const vw = parent.clientWidth, vh = parent.clientHeight;
      const topReserve = 34;                 // 상단 방 이름/나가기 바(실측 바닥 y≈29 + 여유)
      const bottomReserve = vw >= 700 ? 128 : 98; // 하단 방향키·회전·HOLD 버튼 높이(실측값 + 여유, 태블릿 확대 breakpoint와 동일)
      const w = Math.min(vw, 900);
      const h = Math.max(160, vh - topReserve - bottomReserve);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.style.left = `${Math.round((vw - w) / 2)}px`;
      canvas.style.top = `${topReserve}px`;
    },

    startLocal(seed) {
      this.engine = Engine.createEngine(seed);
      this.myTopOut = false;
      this.paused = true;
      this.countdownStart = performance.now();
      this._lastCountdownLabel = null;
    },

    // 매치 시작 3·2·1·GO! 카운트다운 — 모든 클라이언트가 (거의) 동시에 로컬 엔진을 시작하도록
    // 잠깐 대기시킨다. 카운트다운 중에는 입력도 index.js의 _canAct()에서 함께 막는다.
    _updateCountdown() {
      if (this.countdownStart == null) return;
      const elapsed = this.anim - this.countdownStart;
      const label = elapsed < 1000 ? '3' : elapsed < 2000 ? '2' : elapsed < 3000 ? '1' : elapsed < 3400 ? 'GO!' : null;
      if (label !== this._lastCountdownLabel) {
        this._lastCountdownLabel = label;
        if (window.Sound && label) window.Sound.countdownBeep(label === 'GO!');
      }
      if (label === null) { this.countdownStart = null; this.paused = false; }
    },

    setOpponents(list) { this.opponents = list || []; },
    setMeta({ finished, winnerName }) {
      this.finished = !!finished;
      this.winnerName = winnerName || '';
    },

    _reportLock(ev) {
      if (ev.topOut) this.myTopOut = true;
      if (this.callbacks.onLock) this.callbacks.onLock(ev);
    },

    /* ---------- 입력 결과 사운드 훅(선택) ---------- */
    _sound(name) { if (window.Sound && window.Sound[name]) window.Sound[name](); },

    /* ---------- 레이아웃 ----------
     * 화면 상단(방 이름·나가기 버튼)·하단(터치 조작 버튼)은 캔버스 바깥의 별도 HTML(#game-hud)이
     * 담당하고, 캔버스 자체는 _layoutViewport()가 이미 그 영역을 피해 크기·위치를 잡아 두므로,
     * 여기서는 캔버스 내부의 작은 여백만 두면 된다(위아래 버튼 회피용 큰 여백은 중복 확보하지 않음).
     */
    layout() {
      const oppCount = this.opponents.length;
      const oppPanelW = oppCount > 0 ? Math.min(150, Math.max(96, this.W * 0.16)) : 0;
      const sidePanelW = Math.min(76, Math.max(52, this.W * 0.07)); // 홀드/넥스트 패널 폭
      const margin = 10;
      const topReserve = 10;
      const bottomReserve = 8;
      const boardAreaW = this.W - oppPanelW - sidePanelW * 2 - margin * 4;
      const boardAreaH = this.H - topReserve - bottomReserve - margin * 2;
      const cell = Math.max(8, Math.floor(Math.min(boardAreaW / COLS, boardAreaH / ROWS)));
      const boardW = cell * COLS, boardH = cell * ROWS;
      const boardX = sidePanelW + margin * 2 + Math.max(0, (boardAreaW - boardW) / 2);
      const boardY = topReserve + margin + Math.max(0, (boardAreaH - boardH) / 2);
      return {
        cell,
        my: { x: boardX, y: boardY, w: boardW, h: boardH },
        hold: { x: margin, y: boardY, w: sidePanelW - margin, h: cell * 3 },
        next: { x: boardX + boardW + margin, y: boardY, w: sidePanelW - margin, h: cell * 3 * 5 },
        oppPanel: { x: this.W - oppPanelW - margin, y: topReserve + margin, w: oppPanelW, h: this.H - topReserve - margin * 2 },
        oppCount,
      };
    },

    /* ---------- 렌더링 ---------- */
    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBackground(ctx);
      const L = this.layout();
      this.drawMyBoard(ctx, L);
      this.drawHold(ctx, L);
      this.drawNext(ctx, L);
      this.drawGarbageMeter(ctx, L);
      this.drawOpponents(ctx, L);
      if (this.finished) this.drawFinishedOverlay(ctx);
      if (this.countdownStart != null) this.drawCountdown(ctx);
    },

    drawCountdown(ctx) {
      const label = this._lastCountdownLabel;
      if (!label) return;
      ctx.save();
      ctx.fillStyle = 'rgba(5,6,12,0.5)';
      ctx.fillRect(0, 0, this.W, this.H);
      const isGo = label === 'GO!';
      const pulse = 0.8 + 0.2 * Math.sin(this.anim / 90);
      ctx.textAlign = 'center';
      ctx.font = `900 ${isGo ? 56 : 84}px sans-serif`;
      ctx.fillStyle = isGo ? '#7fe08d' : '#ffd76e';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 30 * pulse;
      ctx.fillText(label, this.W / 2, this.H / 2 + (isGo ? 18 : 30));
      ctx.shadowBlur = 0;
      ctx.restore();
    },

    drawBackground(ctx) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.3, 40, this.W / 2, this.H * 0.5, this.W * 0.8);
      g.addColorStop(0, '#1c2233');
      g.addColorStop(1, '#0a0c14');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    },

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    drawPanelFrame(ctx, x, y, w, h) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.stroke();
    },

    // 한 칸을 입체감 있게(살짝 그라데이션 + 테두리) 그린다. type이 없으면(빈 칸) 살짝 격자만.
    drawCell(ctx, x, y, size, type) {
      if (!type) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
        return;
      }
      const color = type === 'G' ? '#5a5f6e' : (PIECE_COLOR[type] || '#888');
      const grad = ctx.createLinearGradient(x, y, x, y + size);
      grad.addColorStop(0, this._lighten(color, 0.25));
      grad.addColorStop(1, this._darken(color, 0.15));
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    },

    drawBoardGrid(ctx, x0, y0, cell, flatBoard, opts) {
      opts = opts || {};
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const type = flatBoard ? flatBoard[r * COLS + c] : null;
          this.drawCell(ctx, x0 + c * cell, y0 + r * cell, cell, type);
        }
      }
      if (opts.dim) {
        ctx.fillStyle = 'rgba(5,5,10,0.55)';
        ctx.fillRect(x0, y0, COLS * cell, ROWS * cell);
      }
    },

    drawMyBoard(ctx, L) {
      const b = L.my;
      this.drawPanelFrame(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      const flat = this.engine ? this._flatten(this.engine.getState().board) : null;
      this.drawBoardGrid(ctx, b.x, b.y, L.cell, flat);

      if (this.engine && !this.myTopOut && !this.finished) {
        const st = this.engine.getState();
        const c = st.cur;
        if (c) {
          // 고스트(하드드롭 예상 위치)
          const gy = this.engine.ghostY();
          ctx.save();
          ctx.globalAlpha = 0.28;
          for (const [dx, dy] of core.SHAPES[c.type][c.rot]) {
            const cx = c.x + dx, cy = gy + dy;
            if (cy >= 0) this.drawCell(ctx, b.x + cx * L.cell, b.y + cy * L.cell, L.cell, c.type);
          }
          ctx.restore();
          // 현재 낙하 중인 조각
          for (const [dx, dy] of core.SHAPES[c.type][c.rot]) {
            const cx = c.x + dx, cy = c.y + dy;
            if (cy >= 0) this.drawCell(ctx, b.x + cx * L.cell, b.y + cy * L.cell, L.cell, c.type);
          }
        }
      }
      if (this.myTopOut && !this.finished) {
        ctx.fillStyle = 'rgba(20,5,5,0.55)';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff8f8f';
        ctx.font = '800 16px sans-serif';
        ctx.fillText('탈락', b.x + b.w / 2, b.y + b.h / 2);
      }
    },

    drawHold(ctx, L) {
      const p = L.hold;
      this.drawPanelFrame(ctx, p.x, p.y, p.w, p.h);
      ctx.textAlign = 'center'; ctx.fillStyle = '#9fe8ff'; ctx.font = '700 10px sans-serif';
      ctx.fillText('HOLD', p.x + p.w / 2, p.y + 12);
      const type = this.engine ? this.engine.getState().hold : null;
      if (type) this.drawMiniPiece(ctx, type, p.x + p.w / 2, p.y + p.h / 2 + 6, Math.min(14, p.w / 5));
    },

    drawNext(ctx, L) {
      const p = L.next;
      this.drawPanelFrame(ctx, p.x, p.y, p.w, Math.min(p.h, this.H - p.y - 10));
      ctx.textAlign = 'center'; ctx.fillStyle = '#9fe8ff'; ctx.font = '700 10px sans-serif';
      ctx.fillText('NEXT', p.x + p.w / 2, p.y + 12);
      const queue = this.engine ? this.engine.getState().queue : [];
      const rowH = Math.min(46, (p.h - 16) / 5);
      for (let i = 0; i < Math.min(5, queue.length); i++) {
        this.drawMiniPiece(ctx, queue[i], p.x + p.w / 2, p.y + 24 + i * rowH, Math.min(12, p.w / 6));
      }
    },

    // 미리보기용 작은 조각 그림(중심 좌표 기준)
    drawMiniPiece(ctx, type, cx, cy, cell) {
      const cells = core.SHAPES[type][0];
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const w = (Math.max(...xs) - Math.min(...xs) + 1) * cell;
      const h = (Math.max(...ys) - Math.min(...ys) + 1) * cell;
      const x0 = cx - w / 2 - Math.min(...xs) * cell, y0 = cy - h / 2 - Math.min(...ys) * cell;
      for (const [dx, dy] of cells) this.drawCell(ctx, x0 + dx * cell, y0 + dy * cell, cell, type);
    },

    drawGarbageMeter(ctx, L) {
      if (!this.engine) return;
      const pending = this.engine.getState().incomingGarbage.reduce((s, g) => s + g.lines, 0);
      if (pending <= 0) return;
      const b = L.my;
      const barW = 10;
      const x = b.x - barW - 6;
      const h = Math.min(b.h, pending * (b.h / ROWS));
      ctx.fillStyle = 'rgba(255,90,90,0.85)';
      ctx.fillRect(x, b.y + b.h - h, barW, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.strokeRect(x, b.y, barW, b.h);
      ctx.textAlign = 'center'; ctx.font = '800 11px sans-serif'; ctx.fillStyle = '#ffb0b0';
      ctx.fillText(String(pending), x + barW / 2, b.y - 6);
    },

    drawOpponents(ctx, L) {
      if (!L.oppCount) return;
      const p = L.oppPanel;
      const gap = 8;
      const cellH = (p.h - gap * (L.oppCount - 1)) / L.oppCount;
      const cell = Math.max(4, Math.min(cellH / ROWS, p.w / COLS));
      let y = p.y;
      for (const o of this.opponents) {
        const bw = cell * COLS, bh = cell * ROWS;
        const bx = p.x + (p.w - bw) / 2;
        this.drawPanelFrame(ctx, bx - 2, y - 2, bw + 4, bh + 4 + 14);
        ctx.textAlign = 'center'; ctx.font = '700 10px sans-serif';
        ctx.fillStyle = o.alive ? '#d8d2e4' : '#9a93a8';
        ctx.fillText(`${(o.name || '').slice(0, 8)}${o.alive ? '' : '(탈락)'}`, bx + bw / 2, y + 10);
        this.drawBoardGrid(ctx, bx, y + 14, cell, o.board, { dim: !o.alive });
        y += bh + 14 + gap;
      }
    },

    drawFinishedOverlay(ctx) {
      const pulse = 0.65 + 0.35 * Math.sin(this.anim / 220);
      ctx.save();
      ctx.textAlign = 'center';
      const label = this.winnerName ? `🏆 ${this.winnerName}님 승리!` : '게임 종료';
      ctx.font = '800 24px sans-serif';
      const w = ctx.measureText(label).width + 40;
      ctx.shadowColor = '#ffd76e'; ctx.shadowBlur = 20 * pulse;
      ctx.fillStyle = 'rgba(20,16,8,0.85)';
      this.roundRect(ctx, this.W / 2 - w / 2, this.H / 2 - 26, w, 52, 14);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,231,176,${0.85 + 0.15 * pulse})`;
      ctx.fillText(label, this.W / 2, this.H / 2 + 8);
      ctx.restore();
    },

    _flatten(board2d) {
      const flat = new Array(ROWS * COLS);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) flat[r * COLS + c] = board2d[r][c];
      return flat;
    },

    _lighten(hex, f) { return this._mix(hex, '#ffffff', f); },
    _darken(hex, f) { return this._mix(hex, '#000000', f); },
    _mix(a, b, f) {
      const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
      const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
      const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
      const r = Math.round(ar + (br - ar) * f), g = Math.round(ag + (bg - ag) * f), bl = Math.round(ab + (bb - ab) * f);
      return `rgb(${r},${g},${bl})`;
    },
  };

  window.TetrisUI = TetrisUI;
})();
