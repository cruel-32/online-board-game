/**
 * 러너 캔버스 렌더러 — 테트리스(public/js/games/tetris/ui.js)와 같은 구조.
 * - 내 캐릭터(로컬 엔진이 실시간 시뮬레이션)를 화면 가득 옆으로 스크롤되는 레인에 그린다.
 * - 이 렌더러의 requestAnimationFrame 루프가 로컬 엔진의 tick()도 함께 구동한다. 충돌로
 *   죽으면 callbacks.onDead(elapsedMs)로 네트워킹 쪽에 "버틴 시간"을 1회 보고한다.
 * - 상대는 보드가 없으므로(옆으로 스크롤되는 1차선 게임) 작은 생존시간 랭킹 패널로만 보여준다.
 *   살아있는 상대의 "버틴 시간"은 네트워킹하지 않고 내 로컬 타이머로 근사한다 — 매치 시작이
 *   전원 거의 동시이므로(카운트다운 동기화) 충분히 정확하고, 어차피 서버에 저장되지 않는
 *   연출용 표시일 뿐이다.
 */
(function () {
  'use strict';
  const core = window.RunnerCore;
  const Engine = window.RunnerEngine;
  const { WORLD_W, WORLD_H, GROUND_Y, PLAYER_X, PLAYER_W, PLAYER_H } = core;

  function fmtTime(ms) {
    const s = Math.max(0, ms) / 1000;
    return `${s.toFixed(1)}s`;
  }

  const RunnerUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    anim: 0, lastAnim: 0,
    callbacks: {},
    engine: null,
    myDead: false,
    opponents: [], // [{id,name,alive,connected,survivedMs}]
    finished: false, winnerName: '',
    paused: false, // 카운트다운 중에는 로컬 엔진을 진행시키지 않는다
    countdownStart: null, _lastCountdownLabel: null,
    groundScroll: 0,
    dustParticles: [],

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
        const dt = Math.min(100, this.anim - this.lastAnim);
        this.lastAnim = this.anim;
        this._updateCountdown();
        if (this.engine && !this.myDead && !this.finished && !this.paused) {
          const ev = this.engine.tick(dt);
          const st = this.engine.getState();
          this.groundScroll = (this.groundScroll + st.speed * (dt / core.FRAME_MS)) % 40;
          if (ev.dead) this._reportDead(ev.elapsedMs);
        }
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    /* ---------- 뷰포트 레터박스(캔버스 CSS 크기) ---------- */
    _layoutViewport(canvas) {
      const parent = canvas.parentElement;
      if (!parent) return;
      const vw = parent.clientWidth, vh = parent.clientHeight;
      const topReserve = 34;
      const bottomReserve = vw >= 700 ? 118 : 92;
      const w = Math.min(vw, 900);
      const h = Math.max(140, vh - topReserve - bottomReserve);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.style.left = `${Math.round((vw - w) / 2)}px`;
      canvas.style.top = `${topReserve}px`;
    },

    startLocal(seed) {
      this.engine = Engine.createEngine(seed);
      this.myDead = false;
      this.paused = true;
      this.countdownStart = performance.now();
      this._lastCountdownLabel = null;
      this.dustParticles = [];
      this.localStartAnim = null; // paused가 풀리는 순간(카운트다운 종료) 기록 — 내가 죽어도 계속 흐르는 독립 시계
    },

    _updateCountdown() {
      if (this.countdownStart == null) return;
      const elapsed = this.anim - this.countdownStart;
      const label = elapsed < 1000 ? '3' : elapsed < 2000 ? '2' : elapsed < 3000 ? '1' : elapsed < 3400 ? 'GO!' : null;
      if (label !== this._lastCountdownLabel) {
        this._lastCountdownLabel = label;
        if (window.Sound && label) window.Sound.countdownBeep(label === 'GO!');
      }
      if (label === null) {
        this.countdownStart = null;
        this.paused = false;
        this.localStartAnim = this.anim;
      }
    },

    // 내가 죽은 뒤에도 계속 흐르는 "매치 경과 시간"(상대 생존 타이머 표시용 — 내 로컬 엔진의
    // elapsedMs는 내가 죽으면 tick이 멈춰 함께 멈춰버리므로, 독립된 벽시계 기준으로 따로 둔다).
    liveElapsedMs() {
      return this.localStartAnim == null ? 0 : this.anim - this.localStartAnim;
    },

    setOpponents(list) { this.opponents = list || []; },
    setMeta({ finished, winnerName }) {
      this.finished = !!finished;
      this.winnerName = winnerName || '';
    },

    _reportDead(elapsedMs) {
      this.myDead = true;
      if (window.Sound) window.Sound.hit();
      if (this.callbacks.onDead) this.callbacks.onDead(elapsedMs);
    },

    jump() {
      if (!this.engine || this.myDead || this.finished || this.paused) return;
      const st = this.engine.getState();
      if (this.engine.jump() && window.Sound) {
        if (st.jumpsUsed === 0) window.Sound.jump();
        else window.Sound.doubleJump();
        this._spawnDust();
      }
    },

    _spawnDust() {
      const now = performance.now();
      this.dustParticles.push({ start: now, until: now + 260 });
      if (this.dustParticles.length > 12) this.dustParticles.shift();
    },

    /* ---------- 레이아웃: 논리 WORLD_W x WORLD_H를 화면에 레터박스로 맞춤 ---------- */
    layout() {
      const scale = Math.min(this.W / WORLD_W, this.H / WORLD_H);
      const w = WORLD_W * scale, h = WORLD_H * scale;
      const x = (this.W - w) / 2, y = (this.H - h) / 2;
      return { scale, x, y, w, h };
    },

    /* ---------- 렌더링 ---------- */
    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBackground(ctx);
      const L = this.layout();
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.scale(L.scale, L.scale);
      this.drawScene(ctx);
      ctx.restore();
      this.drawRanking(ctx, L);
      this.drawTimer(ctx);
      if (this.myDead && !this.finished) this.drawDeadBanner(ctx);
      if (this.finished) this.drawFinishedOverlay(ctx);
      if (this.countdownStart != null) this.drawCountdown(ctx);
    },

    drawBackground(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, '#2b3a55');
      g.addColorStop(1, '#0d1320');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    },

    drawScene(ctx) {
      const st = this.engine ? this.engine.getState() : null;

      // 바닥선 + 스크롤 점선(속도감)
      ctx.strokeStyle = 'rgba(200,220,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.lineTo(WORLD_W, GROUND_Y);
      ctx.stroke();
      ctx.save();
      ctx.strokeStyle = 'rgba(200,220,255,0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 20]);
      ctx.lineDashOffset = -this.groundScroll;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y + 8);
      ctx.lineTo(WORLD_W, GROUND_Y + 8);
      ctx.stroke();
      ctx.restore();

      if (st) {
        for (const o of st.obstacles) this.drawObstacle(ctx, o);
        this.drawPlayer(ctx, st);
      }
      this.drawDust(ctx);
    },

    drawObstacle(ctx, o) {
      const x = o.x, h = o.h, y = GROUND_Y - h;
      ctx.fillStyle = o.tall ? '#8a4de0' : '#39404f';
      ctx.strokeStyle = o.tall ? '#c9a6ff' : '#161b24';
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, o.w, h);
      ctx.strokeRect(x, y, o.w, h);
      if (o.tall) {
        // 2단 점프가 필요함을 암시하는 줄무늬
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        for (let i = 0; i < 3; i++) ctx.fillRect(x + 2, y + 6 + i * (h / 3.4), o.w - 4, 4);
      }
    },

    drawPlayer(ctx, st) {
      const y = GROUND_Y - PLAYER_H - st.airHeight;
      const squash = st.grounded ? 1 : Math.max(0.82, 1 - Math.abs(st.vy) / 60);
      const w = PLAYER_W, h = PLAYER_H * squash;
      const yy = y + (PLAYER_H - h);
      const dead = !!this.myDead;

      ctx.save();
      ctx.translate(PLAYER_X + w / 2, yy + h / 2);
      // 몸통(충돌 시 붉게)
      ctx.fillStyle = dead ? '#ff6b57' : '#5ad1ff';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, 8) : ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,22,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // 눈
      ctx.fillStyle = '#0d1320';
      ctx.beginPath();
      ctx.arc(w * 0.14, -h * 0.18, Math.max(2, w * 0.07), 0, Math.PI * 2);
      ctx.fill();
      // 2단 점프 중일 때 잔상 느낌의 궤적 점
      if (!st.grounded && st.jumpsUsed >= 2) {
        ctx.strokeStyle = 'rgba(90,209,255,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, h * 0.7, w * 0.6, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }
      ctx.restore();

      // 다리(달리는 애니메이션) — 바닥에 있을 때만
      if (st.grounded) {
        const t = this.anim / 70;
        ctx.strokeStyle = dead ? '#ff6b57' : '#5ad1ff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(PLAYER_X + w * 0.3, y + h);
        ctx.lineTo(PLAYER_X + w * 0.3 + Math.sin(t) * 6, GROUND_Y);
        ctx.moveTo(PLAYER_X + w * 0.7, y + h);
        ctx.lineTo(PLAYER_X + w * 0.7 + Math.sin(t + Math.PI) * 6, GROUND_Y);
        ctx.stroke();
      }
    },

    drawDust(ctx) {
      for (const d of this.dustParticles) {
        if (this.anim >= d.until) continue;
        const t = (this.anim - d.start) / (d.until - d.start);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = '#cfe9ff';
        ctx.beginPath();
        ctx.arc(PLAYER_X - 2 - t * 10, GROUND_Y - 4, 4 * (1 - t) + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      this.dustParticles = this.dustParticles.filter((d) => this.anim < d.until);
    },

    drawTimer(ctx) {
      const ms = this.engine ? this.engine.getState().elapsedMs : 0;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 22px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      ctx.fillText(fmtTime(ms), this.W / 2, 30);
      ctx.restore();
    },

    drawRanking(ctx, L) {
      const others = this.opponents;
      if (!others.length) return;
      const liveMs = this.liveElapsedMs();
      const rows = others.map((o) => ({
        name: o.name, alive: o.alive,
        // 매치가 끝나면 서버가 이미 전원의 최종 기록을 확정해 보내주므로, 더 이상 흐르는 추정치
        // 대신 그 값을 그대로 쓴다(그렇지 않으면 결과 팝업이 뜬 뒤에도 숫자가 계속 올라가 보임).
        ms: (o.alive && !this.finished) ? liveMs : (o.survivedMs || 0),
      }));
      const x = L.x + L.w - 8, yTop = L.y + 8;
      const rowH = 18;
      ctx.save();
      ctx.textAlign = 'right';
      ctx.font = '700 12px sans-serif';
      rows.forEach((r, i) => {
        const y = yTop + i * rowH;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x - 150, y - 12, 150, 16);
        ctx.fillStyle = r.alive ? '#9fe8ff' : '#6b7280';
        ctx.fillText(`${(r.name || '').slice(0, 8)}${r.alive ? '' : '💀'} ${fmtTime(r.ms)}`, x - 4, y);
      });
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

    drawDeadBanner(ctx) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 20px sans-serif';
      ctx.fillStyle = '#ff8f8f';
      ctx.shadowColor = '#ff8f8f';
      ctx.shadowBlur = 14;
      ctx.fillText('충돌! 다른 플레이어를 지켜보는 중…', this.W / 2, this.H - 20);
      ctx.restore();
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
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(this.W / 2 - w / 2, this.H / 2 - 26, w, 52, 14) : ctx.rect(this.W / 2 - w / 2, this.H / 2 - 26, w, 52);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,231,176,${0.85 + 0.15 * pulse})`;
      ctx.fillText(label, this.W / 2, this.H / 2 + 8);
      ctx.restore();
    },
  };

  window.RunnerUI = RunnerUI;
})();
