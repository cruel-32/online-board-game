/**
 * 테트리스(서버권위) 캔버스 렌더러 — public/js/games/tetris/ui.js의 쌍둥이.
 * - 로컬 엔진이 없다. 서버가 보내주는 상태(board/cur/ghostY/hold/next 등)를 그대로 그릴 뿐이다.
 * - requestAnimationFrame 루프는 오직 "연출(카운트다운·공격 배너·화면 흔들림)의 시간 경과"만 진행한다.
 *   보드/조각 위치는 서버로부터 새 상태가 도착했을 때만 바뀐다(클라이언트 예측 없음) —
 *   두 아키텍처의 체감 차이를 있는 그대로 보여주기 위한 의도적 설계다.
 * - 입력(키보드/터치 버튼)은 index.js가 담당하며, 로컬 상태를 바꾸는 대신 서버로 game_action을 보낸다.
 */
(function () {
  'use strict';
  const core = window.TetrisCore;
  const { COLS, ROWS, PIECE_COLOR } = core;

  const TetrisServerUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    anim: 0, lastAnim: 0,
    callbacks: {},
    myState: null, // 서버가 보내준 "나" 항목 그대로: {board,cur,ghostY,holdType,nextTypes,incomingGarbageCount,alive,...}
    started: false,
    opponents: [],
    finished: false, winnerName: '',
    paused: false, // 카운트다운 중에는 입력을 막는다(연출 전용 — 서버는 이미 진행 중일 수 있음)
    countdownStart: null, _lastCountdownLabel: null,
    attackBanner: null,
    shakeUntil: 0,

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
      if (window.ResizeObserver && canvas.parentElement) new ResizeObserver(resize).observe(canvas.parentElement);
      resize();

      this.lastAnim = performance.now();
      const loop = () => {
        this.anim = performance.now();
        this.lastAnim = this.anim;
        this._updateCountdown();
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    /* ---------- 뷰포트 레터박스(클라이언트 권위 버전과 동일한 계산) ---------- */
    _layoutViewport(canvas) {
      const parent = canvas.parentElement;
      if (!parent) return;
      const vw = parent.clientWidth, vh = parent.clientHeight;
      const topReserve = 34;
      const bottomReserve = vw >= 700 ? 128 : 98;
      const w = Math.min(vw, 900);
      const h = Math.max(160, vh - topReserve - bottomReserve);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.style.left = `${Math.round((vw - w) / 2)}px`;
      canvas.style.top = `${topReserve}px`;
    },

    // 서버는 이미 매치를 진행 중이므로 시드를 받을 필요가 없다 — 그저 화면에 3·2·1·GO를
    // 보여주고 그동안 내 입력 전송만 막는 연출용 카운트다운이다.
    startCountdown() {
      this.started = true;
      this.paused = true;
      this.countdownStart = performance.now();
      this._lastCountdownLabel = null;
    },

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

    setMyState(state) { this.myState = state; },
    setOpponents(list) { this.opponents = list || []; },
    setMeta({ finished, winnerName }) {
      this.finished = !!finished;
      this.winnerName = winnerName || '';
    },

    // 서버가 보내온 연출용 알림을 드레인해 배너/사운드로 반영한다(index.js의 setState가 호출).
    reportSelfEvent(ev) {
      if (ev.garbageSent > 0) {
        const label = ev.b2b ? `백투백 테트리스! -${ev.garbageSent}`
          : ev.combo > 0 ? `COMBO x${ev.combo + 1}! -${ev.garbageSent}`
          : `공격! -${ev.garbageSent}`;
        this.showAttackBanner(`⚔ ${label}`, 'sent');
        if (window.Sound) window.Sound.attackSent(ev.garbageSent);
      }
      if (window.Sound) {
        if (ev.topOut) window.Sound.eliminated();
        else if (ev.linesCleared >= 4) window.Sound.slam();
        else if (ev.linesCleared > 0) window.Sound.play();
      }
    },

    notifyAttackReceived(lines, fromName) {
      this.showAttackBanner(`⚠ ${fromName}님의 공격! -${lines}`, 'received');
      this.shakeUntil = performance.now() + 420;
      if (window.Sound) window.Sound.attackReceived(lines);
    },

    showAttackBanner(text, kind) {
      const now = performance.now();
      const dur = kind === 'received' ? 1500 : 1200;
      this.attackBanner = { text, kind, start: now, until: now + dur };
    },

    /* ---------- 레이아웃(클라이언트 권위 버전과 동일) ---------- */
    layout() {
      const oppCount = this.opponents.length;
      const oppPanelW = oppCount > 0 ? Math.min(150, Math.max(96, this.W * 0.16)) : 0;
      const sidePanelW = Math.min(76, Math.max(52, this.W * 0.07));
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
      let shakeX = 0, shakeY = 0;
      if (this.anim < this.shakeUntil) {
        const power = Math.min(1, (this.shakeUntil - this.anim) / 420) * 7;
        shakeX = (Math.random() - 0.5) * power;
        shakeY = (Math.random() - 0.5) * power;
        ctx.translate(shakeX, shakeY);
      }
      ctx.clearRect(-20, -20, this.W + 40, this.H + 40);
      this.drawBackground(ctx);
      const L = this.layout();
      this.drawMyBoard(ctx, L);
      this.drawHold(ctx, L);
      this.drawNext(ctx, L);
      this.drawGarbageMeter(ctx, L);
      this.drawOpponents(ctx, L);
      if (this.finished) this.drawFinishedOverlay(ctx);
      if (this.countdownStart != null) this.drawCountdown(ctx);
      this.drawAttackBanner(ctx);
    },

    drawAttackBanner(ctx) {
      const b = this.attackBanner;
      if (!b) return;
      if (this.anim >= b.until) { this.attackBanner = null; return; }
      const total = b.until - b.start;
      const t = Math.min(1, (this.anim - b.start) / total);
      const fadeIn = Math.min(1, t / 0.12);
      const fadeOut = t > 0.65 ? Math.max(0, (1 - t) / 0.35) : 1;
      const alpha = Math.min(fadeIn, fadeOut);
      const scale = 1 + 0.18 * Math.sin(Math.min(t, 1) * Math.PI);
      const color = b.kind === 'received' ? '#ff5a5a' : '#ffd76e';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.W / 2, this.H * 0.24);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.font = '900 26px sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(15, 8, 8, 0.9)';
      ctx.shadowColor = color;
      ctx.shadowBlur = 26;
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = color;
      ctx.fillText(b.text, 0, 0);
      ctx.restore();
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
      const s = this.myState;
      this.drawBoardGrid(ctx, b.x, b.y, L.cell, s ? s.board : null);

      const alive = !s || s.alive !== false;
      if (s && alive && !this.finished) {
        const c = s.cur;
        if (c) {
          const gy = s.ghostY != null ? s.ghostY : c.y;
          ctx.save();
          ctx.globalAlpha = 0.28;
          for (const [dx, dy] of core.SHAPES[c.type][c.rot]) {
            const cx = c.x + dx, cy = gy + dy;
            if (cy >= 0) this.drawCell(ctx, b.x + cx * L.cell, b.y + cy * L.cell, L.cell, c.type);
          }
          ctx.restore();
          for (const [dx, dy] of core.SHAPES[c.type][c.rot]) {
            const cx = c.x + dx, cy = c.y + dy;
            if (cy >= 0) this.drawCell(ctx, b.x + cx * L.cell, b.y + cy * L.cell, L.cell, c.type);
          }
        }
      }
      if (s && !alive && !this.finished) {
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
      const type = this.myState ? this.myState.holdType : null;
      if (type) this.drawMiniPiece(ctx, type, p.x + p.w / 2, p.y + p.h / 2 + 6, Math.min(14, p.w / 5));
    },

    drawNext(ctx, L) {
      const p = L.next;
      this.drawPanelFrame(ctx, p.x, p.y, p.w, Math.min(p.h, this.H - p.y - 10));
      ctx.textAlign = 'center'; ctx.fillStyle = '#9fe8ff'; ctx.font = '700 10px sans-serif';
      ctx.fillText('NEXT', p.x + p.w / 2, p.y + 12);
      const queue = this.myState ? (this.myState.nextTypes || []) : [];
      const rowH = Math.min(46, (p.h - 16) / 5);
      for (let i = 0; i < Math.min(5, queue.length); i++) {
        this.drawMiniPiece(ctx, queue[i], p.x + p.w / 2, p.y + 24 + i * rowH, Math.min(12, p.w / 6));
      }
    },

    drawMiniPiece(ctx, type, cx, cy, cell) {
      const cells = core.SHAPES[type][0];
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const w = (Math.max(...xs) - Math.min(...xs) + 1) * cell;
      const h = (Math.max(...ys) - Math.min(...ys) + 1) * cell;
      const x0 = cx - w / 2 - Math.min(...xs) * cell, y0 = cy - h / 2 - Math.min(...ys) * cell;
      for (const [dx, dy] of cells) this.drawCell(ctx, x0 + dx * cell, y0 + dy * cell, cell, type);
    },

    drawGarbageMeter(ctx, L) {
      const pending = this.myState ? (this.myState.incomingGarbageCount || 0) : 0;
      if (pending <= 0) return;
      const big = pending >= 4;
      const b = L.my;
      const barW = big ? 15 : 10;
      const x = b.x - barW - 6;
      const h = Math.min(b.h, pending * (b.h / ROWS));
      const pulse = big ? 0.75 + 0.25 * Math.sin(this.anim / 110) : 1;
      ctx.save();
      if (big) {
        ctx.shadowColor = '#ff5a5a';
        ctx.shadowBlur = 16 * pulse;
      }
      ctx.fillStyle = big ? `rgba(255,60,60,${0.75 + 0.25 * pulse})` : 'rgba(255,90,90,0.85)';
      ctx.fillRect(x, b.y + b.h - h, barW, h);
      ctx.strokeStyle = big ? 'rgba(255,200,200,0.7)' : 'rgba(255,255,255,0.3)';
      ctx.strokeRect(x, b.y, barW, b.h);
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.font = big ? '900 15px sans-serif' : '800 11px sans-serif';
      ctx.fillStyle = big ? '#ff8080' : '#ffb0b0';
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

  window.TetrisServerUI = TetrisServerUI;
})();
