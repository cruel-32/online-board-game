/**
 * 러너 캔버스 렌더러 — 테트리스(public/js/games/tetris/ui.js)와 같은 구조.
 * - 내 캐릭터(로컬 엔진이 실시간 시뮬레이션)를 화면 가득 옆으로 스크롤되는 레인에 그린다.
 * - 이 렌더러의 requestAnimationFrame 루프가 로컬 엔진의 tick()도 함께 구동한다. 충돌로
 *   죽으면 callbacks.onDead(elapsedMs)로 네트워킹 쪽에 "버틴 시간"을 1회 보고한다.
 * - 상대방은 "고스트" — 나와 똑같은 시드로 만든 로컬 엔진 인스턴스를 상대 대신 들고 있다가,
 *   서버가 중계해주는 "상대가 점프했다"는 알림만 받으면 그 엔진에 jump()를 적용한다. 장애물은
 *   시드+경과시간만으로 100% 결정론적이라(러너 코어 참고) 그 외에는 네트워킹이 필요 없다 —
 *   매 프레임 내 엔진처럼 로컬에서 tick()을 돌리기만 하면 상대의 실제 장애물·점프를 그대로
 *   재현해 작은 미니 뷰로 보여줄 수 있다. 내 입력 반응성에는 전혀 영향을 주지 않는다(순수
 *   연출이며, 혹시 이벤트가 씹혀도 — 판정에 쓰이는 game_action은 "죽음" 보고 하나뿐이므로 —
 *   승패·순위에는 전혀 지장이 없다).
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
    deathToasts: [], // [{text, start, until}] — 상대가 죽을 때마다 쌓이는 큰 알림(가시성 강화)
    hitFlashUntil: 0, // 생명력이 남아 살아남은 피격 순간의 화면 플래시
    shakeUntil: 0,     // 같은 순간의 화면 흔들림
    ghosts: new Map(), // id -> { engine } — 상대방 재현용 로컬 엔진(나와 같은 시드)
    ghostSeed: null, ghostLives: 1,

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
          else if (ev.hit) this._onHit();
        }
        if (!this.paused) this._tickGhosts(dt);
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

    startLocal(seed, lives) {
      this.engine = Engine.createEngine(seed, lives);
      this.myDead = false;
      this.paused = true;
      this.countdownStart = performance.now();
      this._lastCountdownLabel = null;
      this.dustParticles = [];
      this.hitFlashUntil = 0;
      this.shakeUntil = 0;
      this.localStartAnim = null; // paused가 풀리는 순간(카운트다운 종료) 기록 — 내가 죽어도 계속 흐르는 독립 시계
      this.ghostSeed = seed;
      this.ghostLives = lives;
      this.ghosts.clear(); // 새 매치 — 고스트도 처음부터 새로 만든다(index.js가 이어서 ensureGhost로 채움)
    },

    /* ---------- 상대방 "고스트"(나와 같은 시드의 로컬 엔진으로 실제 진행 상황을 그대로 재현) ---------- */
    ensureGhost(id) {
      if (this.ghosts.has(id) || this.ghostSeed == null) return;
      this.ghosts.set(id, { engine: Engine.createEngine(this.ghostSeed, this.ghostLives) });
    },

    applyGhostJump(id) {
      const g = this.ghosts.get(id);
      if (g) g.engine.jump();
    },

    _tickGhosts(dt) {
      for (const o of this.opponents) {
        if (!o.alive) continue; // 탈락한 상대는 더 이상 진행시키지 않는다(마지막 모습에서 멈춤)
        const g = this.ghosts.get(o.id);
        if (!g) continue;
        // 안전장치: 점프 알림이 어쩌다 씹혀 고스트가 실제보다 먼저(시뮬레이션상) 죽어버렸는데
        // 서버는 아직 살아있다고 하면, 고스트를 새로 시작해 계속 달리는 모습을 보여준다 —
        // 애초에 "눈대중 재현"이 목적이라 완벽히 같을 필요는 없다.
        if (g.engine.getState().dead) g.engine = Engine.createEngine(this.ghostSeed, this.ghostLives);
        g.engine.tick(dt);
      }
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

    // 생명력이 남아있는 상태로 부딪혔을 때(죽지 않음) — 짧은 플래시+흔들림+효과음으로
    // "맞았다"는 걸 분명히 알리고, 이어지는 무적 구간은 render()가 캐릭터를 깜빡여 표시한다.
    _onHit() {
      const now = performance.now();
      this.hitFlashUntil = now + 260;
      this.shakeUntil = now + 220;
      if (window.Sound) window.Sound.hitSoft();
    },

    // 상대가 죽었을 때 index.js가 호출 — 작은 랭킹 패널만으로는 놓치기 쉬우므로 화면 중앙에
    // 크게 한 번 더 알린다(여러 명이 거의 동시에 죽어도 겹쳐 보이게 살짝 아래로 쌓는다).
    notifyOpponentDown(name) {
      const now = performance.now();
      this.deathToasts.push({ text: `💀 ${name}님 탈락!`, start: now, until: now + 1800 });
      if (this.deathToasts.length > 4) this.deathToasts.shift();
      if (window.Sound) window.Sound.rivalDown();
    },

    jump() {
      if (!this.engine || this.myDead || this.finished || this.paused) return;
      const st = this.engine.getState();
      const wasFirstJump = st.jumpsUsed === 0;
      if (this.engine.jump()) {
        if (window.Sound) (wasFirstJump ? window.Sound.jump : window.Sound.doubleJump)();
        this._spawnDust();
        // 다른 플레이어가 내 "고스트"를 재현할 수 있도록 점프 사실을 알린다(판정과 무관한
        // 순수 연출용 — 유실돼도 내 플레이에는 전혀 영향 없다).
        if (this.callbacks.onJump) this.callbacks.onJump();
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
      ctx.save();
      if (this.anim < this.shakeUntil) {
        const power = Math.min(1, (this.shakeUntil - this.anim) / 220) * 6;
        ctx.translate((Math.random() - 0.5) * power, (Math.random() - 0.5) * power);
      }
      this.drawBackground(ctx);
      const L = this.layout();
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.scale(L.scale, L.scale);
      this.drawScene(ctx);
      ctx.restore();
      this.drawHitFlash(ctx);
      this.drawOpponentPanels(ctx, L);
      this.drawTimer(ctx);
      this.drawHearts(ctx);
      if (this.myDead && !this.finished) this.drawDeadBanner(ctx);
      if (this.isSoleSurvivor() && !this.finished) this.drawSoleSurvivorBadge(ctx);
      if (this.finished) this.drawFinishedOverlay(ctx);
      if (this.countdownStart != null) this.drawCountdown(ctx);
      this.drawDeathToasts(ctx);
      ctx.restore();
    },

    drawHitFlash(ctx) {
      if (this.anim >= this.hitFlashUntil) return;
      const t = (this.hitFlashUntil - this.anim) / 260;
      ctx.save();
      ctx.globalAlpha = 0.35 * t;
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    },

    // 생명력 하트 — 생명력 1(기본값)일 때는 굳이 보여줄 게 없으니 2 이상일 때만 그린다.
    drawHearts(ctx) {
      const st = this.engine ? this.engine.getState() : null;
      if (!st || st.maxLives <= 1) return;
      const size = 16, gap = 5;
      const totalW = st.maxLives * size + (st.maxLives - 1) * gap;
      const x0 = this.W / 2 - totalW / 2, y = 58;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `${size}px sans-serif`;
      for (let i = 0; i < st.maxLives; i++) {
        const filled = i < st.lives;
        ctx.globalAlpha = filled ? 1 : 0.3;
        ctx.fillText('❤', x0 + i * (size + gap) + size / 2, y + size * 0.8);
      }
      ctx.restore();
    },

    // 나 말고 전원이 이미 탈락했고 나는 아직 살아있는 상태 — 혼자 남아 기록 경신 중임을 알려준다.
    isSoleSurvivor() {
      return !this.myDead && this.opponents.length > 0 && this.opponents.every((o) => !o.alive);
    },

    drawBackground(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, '#2b3a55');
      g.addColorStop(1, '#0d1320');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    },

    // 둥근 사각형 경로(roundRect 미지원 브라우저는 그냥 사각형으로). beginPath까지 포함하므로
    // 호출부는 바로 fill()/stroke()만 하면 된다.
    _rr(ctx, x, y, w, h, r) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    },

    // 반짝이는 눈 한 쌍(장애물 캐릭터용) — 흰자 위에 색이 있는 동공을 살짝 발광시켜 그린다.
    _drawEyePair(ctx, cx, cy, spread, glowColor, r) {
      r = r || 2.6;
      for (const side of [-1, 1]) {
        const ex = cx + side * spread;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = glowColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(ex, cy, r * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
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

    // 장애물 = 적 괴물 캐릭터. tall(타워형)은 여러 쌍의 눈이 세로로 달린 키 큰 괴물로 그려
    // "2단 점프로만 넘을 수 있다"는 걸 높이뿐 아니라 생김새로도 암시한다.
    drawObstacle(ctx, o) {
      const w = o.w, h = o.h, y = GROUND_Y - h;
      const bodyColor = o.tall ? '#8a4de0' : '#454e60';
      const edgeColor = o.tall ? '#5b2f99' : '#1b1f28';
      const eyeGlow = o.tall ? '#ffe28a' : '#ff5a5a';

      ctx.save();
      ctx.translate(o.x + w / 2, 0);

      // 몸통(아래는 바닥에 붙고 위는 둥글게)
      ctx.fillStyle = bodyColor;
      this._rr(ctx, -w / 2, y, w, h, Math.min(w * 0.4, 10));
      ctx.fill();
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 머리 위 뿔(멀리서도 "장애물"임을 바로 읽히게 하는 실루엣)
      const horns = o.tall ? 1 : (w > 26 ? 2 : 1);
      ctx.fillStyle = edgeColor;
      for (let i = 0; i < horns; i++) {
        const hx = horns === 1 ? 0 : (i === 0 ? -w * 0.22 : w * 0.22);
        ctx.beginPath();
        ctx.moveTo(hx - w * 0.16, y + 3);
        ctx.lineTo(hx + w * 0.16, y + 3);
        ctx.lineTo(hx, y - Math.min(10, h * 0.12));
        ctx.closePath();
        ctx.fill();
      }

      if (o.tall) {
        // 세그먼트마다 눈이 달린 토템형 괴물
        for (let i = 0; i < 3; i++) this._drawEyePair(ctx, 0, y + h * (0.2 + i * 0.27), w * 0.17, eyeGlow);
      } else {
        this._drawEyePair(ctx, 0, y + h * 0.32, w * 0.18, eyeGlow);
        // 이빨(지그재그)
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const toothY = y + h * 0.56, n = 3, step = (w * 0.44) / (n - 1);
        for (let i = 0; i < n; i++) {
          const tx = -w * 0.22 + i * step;
          ctx.moveTo(tx, toothY);
          ctx.lineTo(tx + step * 0.5, toothY + h * 0.08);
          ctx.lineTo(tx + step, toothY);
        }
        ctx.stroke();
      }
      ctx.restore();
    },

    // 플레이어 = 토끼. 정면이 아니라 진행 방향(오른쪽, 장애물이 다가오는 쪽)을 보는 옆모습으로
    // 그린다 — 머리와 주둥이가 오른쪽으로 튀어나와 있어야 눈 하나가 "외눈박이"가 아니라
    // 자연스러운 옆얼굴로 읽힌다. 점프하면 귀가 뒤로 눕고, 착지해 있을 땐 발을 까딱이며 달린다.
    // 충돌하면(dead) 털이 발그레해지고 눈이 "X"로 바뀌어 기절한 티를 낸다.
    drawPlayer(ctx, st) {
      const y = GROUND_Y - PLAYER_H - st.airHeight;
      const squash = st.grounded ? 1 : Math.max(0.82, 1 - Math.abs(st.vy) / 60);
      const w = PLAYER_W, h = PLAYER_H * squash;
      const yy = y + (PLAYER_H - h);
      const dead = !!this.myDead;
      const furColor = dead ? '#ffc2b8' : '#fff6ec';
      const muzzleColor = dead ? '#ffd6ce' : '#fffdfa';
      // 점프 중 가속도에 따라 귀가 더 눕거나(상승) 서거나(하강) 한다.
      const earLean = Math.max(-0.35, Math.min(0.35, -st.vy / 22));

      // 머리를 몸통 "앞쪽 위"가 아니라 거의 "바로 위"에 둬서, 등이 둥글게 말린 것처럼 보이지
      // 않고 목을 세운 듯 똑바로 선 자세로 읽히게 한다(머리-몸통 사이에 살짝 틈을 둬 구분감도 줌).
      // 머리를 몸통보다 눈에 띄게 크게 둬(치비 비율) 더 귀여워 보이게 한다.
      const bodyX = -w * 0.02, bodyY = h * 0.24, bodyRX = w * 0.3, bodyRY = h * 0.33;
      const headX = w * 0.1, headY = -h * 0.5, headR = w * 0.42;
      const snoutX = headX + headR * 0.88, snoutY = headY + headR * 0.14, snoutR = headR * 0.42;
      const eyeX = headX + headR * 0.2, eyeY = headY - headR * 0.14;

      // 무적 중에는 실시간(anim) 기준으로 깜빡인다 — 엔진 틱이 아니라 실제 경과 시간을 써서
      // 프레임레이트와 무관하게 일정한 주기로 깜빡이게 한다.
      ctx.save();
      if (st.invincible) {
        const blinkOn = Math.floor(this.anim / core.BLINK_INTERVAL_MS) % 2 === 0;
        ctx.globalAlpha = blinkOn ? 1 : 0.3;
      }
      ctx.translate(PLAYER_X + w / 2, yy + h / 2);

      // 귀(머리 뒤쪽에서 솟아오름 — 머리보다 먼저 그려 밑동이 가려지게 함). 뒤쪽 귀 하나,
      // 살짝 앞쪽에 겹치는 귀 하나를 둬서 입체감을 준다.
      const earBase = -0.3 + earLean;
      [[-0.1, 0], [0.08, w * 0.05]].forEach(([angleOfs, xOfs]) => {
        ctx.save();
        ctx.translate(headX - headR * 0.15 + xOfs, headY - headR * 0.55);
        ctx.rotate(earBase + angleOfs);
        ctx.fillStyle = furColor;
        this._rr(ctx, -w * 0.1, -h * 0.74, w * 0.2, h * 0.76, w * 0.1);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,80,70,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#ffc9d6';
        this._rr(ctx, -w * 0.05, -h * 0.63, w * 0.1, h * 0.52, w * 0.05);
        ctx.fill();
        ctx.restore();
      });

      // 꼬리(몸통 뒤쪽 뭉치)
      ctx.fillStyle = muzzleColor;
      ctx.beginPath();
      ctx.arc(bodyX - bodyRX * 0.85, bodyY + bodyRY * 0.2, w * 0.13, 0, Math.PI * 2);
      ctx.fill();

      // 몸통
      ctx.fillStyle = furColor;
      ctx.beginPath();
      ctx.ellipse(bodyX, bodyY, bodyRX, bodyRY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,80,70,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 머리(몸통 앞쪽 위에 얹음 — 진행 방향인 오른쪽으로 튀어나와 옆모습을 만듦)
      ctx.fillStyle = furColor;
      ctx.beginPath();
      ctx.arc(headX, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,80,70,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 주둥이(머리보다 더 앞으로 튀어나온 옅은 패치 — 이게 있어야 "옆을 보는 얼굴"로 읽힘)
      ctx.fillStyle = muzzleColor;
      ctx.beginPath();
      ctx.ellipse(snoutX, snoutY, snoutR, snoutR * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // 배(밝은 패치) + 볼터치(눈 아래, 주둥이 쪽)
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(bodyX + bodyRX * 0.1, bodyY + bodyRY * 0.35, bodyRX * 0.6, bodyRY * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,150,170,0.55)';
      ctx.beginPath();
      ctx.arc(snoutX - snoutR * 0.3, snoutY + snoutR * 0.5, w * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // 눈 — 진행 방향 쪽에 하나만(옆모습이므로 반대쪽 눈은 가려져 안 보이는 게 자연스럽다).
      // 기절했으면 X, 아니면 반짝이는 동그란 눈.
      if (dead) {
        ctx.strokeStyle = '#6b3b30';
        ctx.lineWidth = 2;
        const r = w * 0.065;
        ctx.beginPath();
        ctx.moveTo(eyeX - r, eyeY - r); ctx.lineTo(eyeX + r, eyeY + r);
        ctx.moveTo(eyeX + r, eyeY - r); ctx.lineTo(eyeX - r, eyeY + r);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#2a1f1a';
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, Math.max(2, w * 0.072), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(eyeX + w * 0.025, eyeY - w * 0.025, Math.max(1, w * 0.026), 0, Math.PI * 2);
        ctx.fill();
      }

      // 코(주둥이 끝의 작은 분홍 코)
      ctx.fillStyle = '#ff8fa3';
      ctx.beginPath();
      ctx.ellipse(snoutX + snoutR * 0.75, snoutY - snoutR * 0.1, w * 0.045, w * 0.032, 0.3, 0, Math.PI * 2);
      ctx.fill();

      // 2단 점프 중일 때 잔상 느낌의 궤적
      if (!st.grounded && st.jumpsUsed >= 2) {
        ctx.strokeStyle = 'rgba(255,201,214,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, h * 0.7, w * 0.6, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }
      ctx.restore();

      // 다리(달리는 애니메이션 + 발바닥) — 바닥에 있을 때만
      if (st.grounded) {
        const t = this.anim / 70;
        const leg1x = PLAYER_X + w * 0.32 + Math.sin(t) * 5;
        const leg2x = PLAYER_X + w * 0.68 + Math.sin(t + Math.PI) * 5;
        ctx.strokeStyle = furColor;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(PLAYER_X + w * 0.32, y + h * 0.9);
        ctx.lineTo(leg1x, GROUND_Y - 2);
        ctx.moveTo(PLAYER_X + w * 0.68, y + h * 0.9);
        ctx.lineTo(leg2x, GROUND_Y - 2);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.fillStyle = furColor;
        ctx.beginPath(); ctx.ellipse(leg1x, GROUND_Y - 1, 4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(leg2x, GROUND_Y - 1, 4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
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

      // 생존자 수(나 포함) — 한눈에 몇 명이나 남았는지 보여준다(랭킹 패널보다 더 눈에 띄게).
      if (this.opponents.length) {
        const aliveCount = (this.myDead ? 0 : 1) + this.opponents.filter((o) => o.alive).length;
        const total = 1 + this.opponents.length;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '700 12px sans-serif';
        ctx.fillStyle = aliveCount <= 1 ? '#ffd76e' : 'rgba(210,225,255,0.8)';
        ctx.fillText(`생존 ${aliveCount} / ${total}`, this.W / 2, 48);
        ctx.restore();
      }
    },

    // 상대방 패널 — 각자의 "고스트" 엔진이 실제로 시뮬레이션한 장애물·점프를 작은 미니 레인에
    // 그대로 그린다(생존 중일 때만). 탈락한 상대는 더 그릴 게 없으므로 해골+최종 기록만 보여준다.
    drawOpponentPanels(ctx, L) {
      const others = this.opponents;
      if (!others.length) return;
      // 아직 살아있는 쪽을 위로 모아 "누가 아직 위협적인지"를 한눈에 보기 쉽게 한다.
      const sorted = others.slice().sort((a, b) => (b.alive - a.alive));
      const n = sorted.length;
      const rowW = 130, gap = 10; // 줄 사이 간격을 넉넉히 둬서 인원이 많아도 겹쳐 보이지 않게 함
      const top = L.y + 6, bottom = L.y + L.h - 6;
      const availableH = Math.max(0, bottom - top);
      // 한 줄 높이는 "최대 54px"에서 시작해, 인원이 많아 다 안 들어가면 최소 22px(텍스트만
      // 보이는 압축 모드)까지 줄어든다 — 줄이 늘어나도 서로 겹치는 대신 한 줄 한 줄이 작아진다.
      const rowH = Math.max(22, Math.min(54, Math.floor((availableH - (n - 1) * gap) / n)));
      const x = L.x + L.w - rowW - 6;
      let y = top;
      ctx.save();
      for (const o of sorted) {
        this.drawOpponentRow(ctx, o, x, y, rowW, rowH);
        y += rowH + gap;
      }
      ctx.restore();
    },

    drawOpponentRow(ctx, o, x, y, w, h) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      this._rr(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.strokeStyle = o.alive ? 'rgba(90,209,255,0.3)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const liveMs = this.liveElapsedMs();
      const ms = (o.alive && !this.finished) ? liveMs : (o.survivedMs || 0);
      const compact = h < 36; // 인원이 많아 줄이 빽빽해지면 미니 장면 없이 한 줄 텍스트로만 보여줌

      if (compact) {
        ctx.textAlign = 'left';
        ctx.font = '700 11px sans-serif';
        ctx.fillStyle = o.alive ? '#eaf6ff' : '#9099a8';
        ctx.fillText(`${(o.name || '').slice(0, 8)}${o.alive ? '' : ' 💀'}`, x + 6, y + h / 2 + 4);
        ctx.textAlign = 'right';
        ctx.fillStyle = o.alive ? '#9fe8ff' : '#747b89';
        ctx.fillText(fmtTime(ms), x + w - 6, y + h / 2 + 4);
        ctx.restore();
        return;
      }

      const sceneY = y + 3, sceneH = h - 17, sceneX = x + 3, sceneW = w - 6;
      const ghost = o.alive ? this.ghosts.get(o.id) : null;

      if (ghost) {
        this.drawGhostScene(ctx, ghost.engine.getState(), sceneX, sceneY, sceneW, sceneH);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.textAlign = 'center';
        ctx.font = `${Math.round(sceneH * 0.65)}px sans-serif`;
        ctx.fillText('💀', x + w / 2, sceneY + sceneH * 0.8);
        ctx.restore();
      }

      // 생존 표시 점(초록 네온 = 생존, 회색 = 탈락)
      ctx.beginPath();
      ctx.arc(x + w - 8, sceneY + 7, 3, 0, Math.PI * 2);
      if (o.alive) { ctx.fillStyle = '#4ee37a'; ctx.shadowColor = '#4ee37a'; ctx.shadowBlur = 5; }
      else ctx.fillStyle = '#7a8090';
      ctx.fill();
      ctx.shadowBlur = 0;

      // 이름 + 시간
      ctx.textAlign = 'left';
      ctx.font = '700 10px sans-serif';
      ctx.fillStyle = o.alive ? '#eaf6ff' : '#9099a8';
      ctx.fillText((o.name || '').slice(0, 10), x + 4, y + h - 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = o.alive ? '#9fe8ff' : '#747b89';
      ctx.fillText(fmtTime(ms), x + w - 4, y + h - 4);
      ctx.restore();
    },

    // 고스트 엔진 상태를 작은 사각형(sceneX,sceneY,sceneW,sceneH) 안에 간략화해 그린다.
    // 장애물은 그리지 않는다 — 고스트는 어디까지나 근사 재현이라 실제 장애물 위치와는
    // 체감상 차이가 날 수 있어서, 오해를 주지 않도록 "달리는/점프하는 모습"만 보여준다.
    drawGhostScene(ctx, st, sceneX, sceneY, sceneW, sceneH) {
      const scale = sceneH / WORLD_H;
      const groundY = sceneY + GROUND_Y * scale;
      const px = sceneX + sceneW / 2; // 장애물이 없으니 기준점은 그냥 가운데로 고정

      ctx.save();
      ctx.beginPath();
      ctx.rect(sceneX, sceneY, sceneW, sceneH);
      ctx.clip();

      ctx.strokeStyle = 'rgba(200,220,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sceneX, groundY);
      ctx.lineTo(sceneX + sceneW, groundY);
      ctx.stroke();

      const blinkOn = !st.invincible || Math.floor(this.anim / core.BLINK_INTERVAL_MS) % 2 === 0;
      if (blinkOn) {
        const pw = Math.max(7, PLAYER_W * scale), ph = Math.max(7, PLAYER_H * scale);
        const pTop = groundY - ph - st.airHeight * scale;
        // 다리(달리는 느낌 — 바닥에 있을 때만)
        if (st.grounded) {
          const t = this.anim / 70;
          ctx.strokeStyle = '#fff6ec';
          ctx.lineWidth = Math.max(1.5, pw * 0.14);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px - pw * 0.18, groundY - ph * 0.08);
          ctx.lineTo(px - pw * 0.18 + Math.sin(t) * pw * 0.2, groundY);
          ctx.moveTo(px + pw * 0.18, groundY - ph * 0.08);
          ctx.lineTo(px + pw * 0.18 + Math.sin(t + Math.PI) * pw * 0.2, groundY);
          ctx.stroke();
          ctx.lineCap = 'butt';
        }
        ctx.fillStyle = '#fff6ec';
        this._rr(ctx, px - pw / 2, pTop, pw, ph, pw * 0.4);
        ctx.fill();
        // 귀(진행 방향을 알 수 있게 살짝 앞쪽으로 기울여 붙임)
        ctx.beginPath();
        ctx.moveTo(px - pw * 0.1, pTop + ph * 0.1);
        ctx.lineTo(px - pw * 0.22, pTop - ph * 0.55);
        ctx.lineTo(px + pw * 0.08, pTop + ph * 0.02);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px + pw * 0.12, pTop + ph * 0.02);
        ctx.lineTo(px + pw * 0.24, pTop - ph * 0.5);
        ctx.lineTo(px + pw * 0.38, pTop + ph * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },

    // 상대가 죽는 순간 화면 중앙 위쪽에 크게 띄우는 알림(쌓이면 아래로 밀려나며 겹쳐 보임).
    drawDeathToasts(ctx) {
      this.deathToasts = this.deathToasts.filter((t) => this.anim < t.until);
      this.deathToasts.forEach((t, i) => {
        const total = t.until - t.start;
        const p = Math.min(1, (this.anim - t.start) / total);
        const fadeIn = Math.min(1, p / 0.12);
        const fadeOut = p > 0.7 ? Math.max(0, (1 - p) / 0.3) : 1;
        const alpha = Math.min(fadeIn, fadeOut);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = '800 17px sans-serif';
        const y = this.H * 0.16 + i * 24;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(10,6,6,0.85)';
        ctx.strokeText(t.text, this.W / 2, y);
        ctx.fillStyle = '#ff9a9a';
        ctx.fillText(t.text, this.W / 2, y);
        ctx.restore();
      });
    },

    // 상대가 전원 탈락했고 나만 남았을 때 — 왜 게임이 안 끝나는지, 지금 뭘 하고 있는지 알려준다.
    drawSoleSurvivorBadge(ctx) {
      ctx.save();
      ctx.textAlign = 'center';
      const pulse = 0.75 + 0.25 * Math.sin(this.anim / 260);
      ctx.font = '700 13px sans-serif';
      ctx.fillStyle = `rgba(255,215,110,${pulse})`;
      ctx.shadowColor = '#ffd76e';
      ctx.shadowBlur = 10 * pulse;
      ctx.fillText('🏁 최후 생존! 내 최고 기록에 도전 중…', this.W / 2, 92);
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
      this._rr(ctx, this.W / 2 - w / 2, this.H / 2 - 26, w, 52, 14);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,231,176,${0.85 + 0.15 * pulse})`;
      ctx.fillText(label, this.W / 2, this.H / 2 + 8);
      ctx.restore();
    },
  };

  window.RunnerUI = RunnerUI;
})();
