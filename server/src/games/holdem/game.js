'use strict';
/**
 * 텍사스 홀덤 한 핸드의 상태 기계 — 널리 알려진 노리밋 홀덤 규칙.
 * 블라인드 → 프리플롭/플롭/턴/리버 베팅 라운드 → 쇼다운(사이드 팟 포함).
 * 칩(스택)은 room.players[].chips 에서 시작해 핸드 종료 시 갱신된다(멀티핸드 매치).
 */
const poker = require('../../../../public/shared/poker-core.js');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class HoldemGame {
  constructor(players, opts) {
    opts = opts || {};
    this.sb = opts.smallBlind || 10;
    this.bb = opts.bigBlind || 20;
    this.seats = players.map((p) => ({
      id: p.id, stack: p.chips, hole: [], committed: 0, totalCommitted: 0,
      folded: false, allIn: false, acted: false, won: 0,
    }));
    this.n = this.seats.length;
    this.deck = shuffle(poker.buildDeck());
    for (const s of this.seats) s.hole = this.deck.splice(0, 2);
    this.board = [];
    this.dealerIdx = ((opts.dealerIdx || 0) % this.n + this.n) % this.n;
    this.street = 'preflop';
    this.betToMatch = 0;
    this.minRaise = this.bb;
    this.finished = false;
    this.winners = null;    // [{id, amount}]
    this.showdownIds = null; // 쇼다운에 공개된 손패 소유자 id 배열
    this.lastAction = null;  // { id, text }

    this._postBlinds();
    // 프리플롭 첫 행동: BB 다음
    if (this._canActCount() <= 1) this._runoutAndShowdown();
    else this.toAct = this._nextCanAct(this.bbIdx);
  }

  seatById(id) { return this.seats.find((s) => s.id === id); }
  top() { return this.board; }
  potTotal() { return this.seats.reduce((s, x) => s + x.totalCommitted, 0); }

  currentActorId() {
    if (this.finished) return null;
    const s = this.seats[this.toAct];
    return s ? s.id : null;
  }

  _canActCount() { return this.seats.filter((s) => !s.folded && !s.allIn).length; }
  _inHandCount() { return this.seats.filter((s) => !s.folded).length; }

  _nextCanAct(fromIdx) {
    for (let k = 1; k <= this.n; k++) {
      const j = (fromIdx + k) % this.n;
      if (!this.seats[j].folded && !this.seats[j].allIn) return j;
    }
    return fromIdx;
  }

  _postBlind(idx, amount) {
    const s = this.seats[idx];
    const pay = Math.min(amount, s.stack);
    s.stack -= pay; s.committed += pay; s.totalCommitted += pay;
    if (s.stack === 0) s.allIn = true;
    return pay;
  }

  _postBlinds() {
    if (this.n === 2) { this.sbIdx = this.dealerIdx; this.bbIdx = (this.dealerIdx + 1) % this.n; }
    else { this.sbIdx = (this.dealerIdx + 1) % this.n; this.bbIdx = (this.dealerIdx + 2) % this.n; }
    this._postBlind(this.sbIdx, this.sb);
    this._postBlind(this.bbIdx, this.bb);
    this.betToMatch = this.bb;
    this.minRaise = this.bb;
  }

  // 현재 행동자가 취할 수 있는 동작 정보(클라이언트/봇 공용)
  options(pid) {
    const s = this.seatById(pid);
    if (!s || this.finished || pid !== this.currentActorId()) return null;
    const toCall = this.betToMatch - s.committed;
    const canCheck = toCall <= 0;
    const canCall = toCall > 0 && s.stack > 0;
    const minRaiseTo = this.betToMatch + this.minRaise;
    const maxRaiseTo = s.committed + s.stack; // 올인
    const canRaise = s.stack > toCall; // 콜보다 더 낼 여력
    return {
      toCall: Math.min(toCall, s.stack),
      canCheck, canCall, canRaise,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo, stack: s.stack, committed: s.committed, betToMatch: this.betToMatch,
    };
  }

  /* ---------- 액션 ---------- */
  act(pid, action) {
    if (this.finished) throw new Error('핸드가 끝났습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    const s = this.seats[this.toAct];
    const kind = action && action.kind;
    const toCall = this.betToMatch - s.committed;

    if (kind === 'fold') {
      s.folded = true;
      this.lastAction = { id: pid, text: '폴드' };
    } else if (kind === 'check') {
      if (toCall > 0) throw new Error('체크할 수 없습니다(콜해야 합니다).');
      this.lastAction = { id: pid, text: '체크' };
    } else if (kind === 'call') {
      if (toCall <= 0) throw new Error('콜할 금액이 없습니다.');
      const pay = Math.min(toCall, s.stack);
      s.stack -= pay; s.committed += pay; s.totalCommitted += pay;
      if (s.stack === 0) s.allIn = true;
      this.lastAction = { id: pid, text: s.allIn ? '올인 콜' : '콜 ' + pay };
    } else if (kind === 'raise') {
      const maxTo = s.committed + s.stack;
      let to = Math.floor(Number(action.amount));
      if (!(to > this.betToMatch)) throw new Error('레이즈 금액이 부족합니다.');
      if (to > maxTo) to = maxTo;
      const minTo = this.betToMatch + this.minRaise;
      // 최소 레이즈 미만은 올인일 때만 허용
      if (to < minTo && to < maxTo) throw new Error('최소 레이즈보다 작습니다.');
      const add = to - s.committed;
      if (add > s.stack) throw new Error('보유 칩을 초과했습니다.');
      const raiseSize = to - this.betToMatch;
      s.stack -= add; s.committed = to; s.totalCommitted += add;
      if (s.stack === 0) s.allIn = true;
      if (raiseSize >= this.minRaise) this.minRaise = raiseSize; // 정식 레이즈만 최소 레이즈 갱신
      this.betToMatch = to;
      // 레이즈 → 나머지 행동 재개
      for (const x of this.seats) if (!x.folded && !x.allIn) x.acted = false;
      this.lastAction = { id: pid, text: (this.street === 'preflop' || raiseSize < this.betToMatch ? '레이즈 ' : '벳 ') + to };
    } else {
      throw new Error('알 수 없는 동작입니다.');
    }

    s.acted = true;
    return this._advance();
  }

  _advance() {
    if (this._inHandCount() === 1) return this._awardUncontested();
    if (this._roundComplete()) return this._endStreet();
    this.toAct = this._nextCanAct(this.toAct);
    return { ended: false };
  }

  _roundComplete() {
    const canAct = this.seats.filter((s) => !s.folded && !s.allIn);
    if (canAct.length === 0) return true;
    return canAct.every((s) => s.acted && s.committed === this.betToMatch);
  }

  _endStreet() {
    for (const s of this.seats) { s.committed = 0; s.acted = false; }
    this.betToMatch = 0; this.minRaise = this.bb;
    if (this.street === 'river') return this._showdown();
    if (this._canActCount() <= 1) return this._runoutAndShowdown();
    this._dealNextStreet();
    this.toAct = this._nextCanAct(this.dealerIdx); // 포스트플롭 첫 행동 = 딜러 다음
    return { ended: false };
  }

  _dealNextStreet() {
    if (this.street === 'preflop') { this.street = 'flop'; this.board.push(...this.deck.splice(0, 3)); }
    else if (this.street === 'flop') { this.street = 'turn'; this.board.push(this.deck.shift()); }
    else if (this.street === 'turn') { this.street = 'river'; this.board.push(this.deck.shift()); }
  }

  _runoutAndShowdown() {
    // 더 이상 베팅 불가 → 남은 커뮤니티 카드를 모두 깔고 쇼다운
    while (this.board.length < 5) {
      if (this.street === 'preflop') { this.street = 'flop'; this.board.push(...this.deck.splice(0, 3)); }
      else if (this.street === 'flop') { this.street = 'turn'; this.board.push(this.deck.shift()); }
      else if (this.street === 'turn') { this.street = 'river'; this.board.push(this.deck.shift()); }
      else break;
    }
    this.street = 'river';
    return this._showdown();
  }

  _buildPots() {
    const levels = [...new Set(this.seats.map((s) => s.totalCommitted).filter((v) => v > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      const contributors = this.seats.filter((s) => s.totalCommitted >= level);
      const amount = (level - prev) * contributors.length;
      const eligible = this.seats.filter((s) => !s.folded && s.totalCommitted >= level).map((s) => s.id);
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    return pots;
  }

  _showdown() {
    const contenders = this.seats.filter((s) => !s.folded);
    for (const s of contenders) s.score = poker.evaluateBest([...s.hole, ...this.board]).score;
    const pots = this._buildPots();
    const winTotals = new Map();
    for (const pot of pots) {
      const elig = pot.eligible.map((id) => this.seatById(id)).filter((s) => !s.folded);
      if (!elig.length) continue;
      let best = null;
      for (const s of elig) if (!best || poker.compareScore(s.score, best) > 0) best = s.score;
      const winners = elig.filter((s) => poker.compareScore(s.score, best) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      // 딜러 다음 순서부터 우수리 배분
      const ordered = winners.slice().sort((a, b) =>
        ((this.seats.indexOf(a) - this.dealerIdx + this.n) % this.n) - ((this.seats.indexOf(b) - this.dealerIdx + this.n) % this.n));
      for (const w of ordered) {
        let amt = share;
        if (rem > 0) { amt += 1; rem -= 1; }
        w.stack += amt; w.won += amt;
        winTotals.set(w.id, (winTotals.get(w.id) || 0) + amt);
      }
    }
    this.showdownIds = contenders.length > 1 ? contenders.map((s) => s.id) : null;
    this.winners = [...winTotals.entries()].map(([id, amount]) => ({ id, amount }));
    this.finished = true;
    return { ended: true };
  }

  _awardUncontested() {
    const winner = this.seats.find((s) => !s.folded);
    const amount = this.potTotal();
    winner.stack += amount; winner.won += amount;
    this.winners = [{ id: winner.id, amount }];
    this.showdownIds = null; // 손패 비공개
    this.finished = true;
    return { ended: true };
  }

  results() {
    return this.seats.map((s) => ({ id: s.id, stack: s.stack }));
  }
}

module.exports = { HoldemGame, shuffle };
