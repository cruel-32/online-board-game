'use strict';
/**
 * 세븐 포커(7-card stud) 한 핸드의 상태 기계 — 널리 알려진 세븐 스터드 규칙.
 * 3rd 스트리트(다운2+오픈1) → 4th~6th(오픈1씩) → 7th(다운1). 각 스트리트마다 베팅.
 * 각자 7장 중 최고 5장으로 쇼다운. 칩은 room.players[].chips 에 유지(멀티핸드 매치).
 */
const poker = require('../../../../public/shared/poker-core.js');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

class SevenGame {
  constructor(players, opts) {
    opts = opts || {};
    this.ante = opts.ante || 10;
    this.unit = opts.unit || 20; // 베팅 단위(최소 벳/레이즈)
    this.seats = players.map((p) => ({
      id: p.id, stack: p.chips, cards: [], committed: 0, totalCommitted: 0,
      folded: false, allIn: false, acted: false, won: 0,
    }));
    this.n = this.seats.length;
    this.deck = shuffle(poker.buildDeck());
    this.streetNo = 3;
    this.betToMatch = 0;
    this.minRaise = this.unit;
    this.finished = false;
    this.winners = null;
    this.showdownIds = null;
    this.lastAction = null;

    // 앤티
    for (const s of this.seats) {
      const pay = Math.min(this.ante, s.stack);
      s.stack -= pay; s.totalCommitted += pay;
      if (s.stack === 0) s.allIn = true;
    }
    // 3rd 스트리트: 다운 2 + 오픈 1
    for (const s of this.seats) { s.cards.push({ card: this.deck.shift(), up: false }); s.cards.push({ card: this.deck.shift(), up: false }); s.cards.push({ card: this.deck.shift(), up: true }); }

    if (this._canActCount() <= 1) this._runoutAndShowdown();
    else this.toAct = this._firstActor(true);
  }

  seatById(id) { return this.seats.find((s) => s.id === id); }
  potTotal() { return this.seats.reduce((s, x) => s + x.totalCommitted, 0); }
  currentActorId() { if (this.finished) return null; const s = this.seats[this.toAct]; return s ? s.id : null; }
  _canActCount() { return this.seats.filter((s) => !s.folded && !s.allIn).length; }
  _inHandCount() { return this.seats.filter((s) => !s.folded).length; }

  _nextCanAct(fromIdx) {
    for (let k = 1; k <= this.n; k++) { const j = (fromIdx + k) % this.n; if (!this.seats[j].folded && !this.seats[j].allIn) return j; }
    return fromIdx;
  }

  upCards(seat) { return seat.cards.filter((c) => c.up).map((c) => c.card); }

  // 오픈 카드 족보 점수(개수 우선 → 높은 숫자). 4th 이후 최고 오픈이 선.
  _showingScore(seat) {
    const ranks = this.upCards(seat).map((c) => c.rank);
    const cnt = {};
    for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
    const groups = Object.keys(cnt).map((r) => [cnt[r], +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const flat = [];
    for (const g of groups) { flat.push(g[0], g[1]); }
    return flat;
  }

  _firstActor(third) {
    const inHand = this.seats.map((s, i) => ({ s, i })).filter((o) => !o.s.folded && !o.s.allIn);
    if (!inHand.length) return this.toAct || 0;
    if (third) {
      // 3rd: 가장 낮은 오픈 카드가 선(브링인)
      let best = inHand[0];
      for (const o of inHand) if (this.upCards(o.s)[0].rank < this.upCards(best.s)[0].rank) best = o;
      return best.i;
    }
    // 4th 이후: 가장 높은 오픈 족보가 선
    let best = inHand[0];
    for (const o of inHand) if (poker.compareScore(this._showingScore(o.s), this._showingScore(best.s)) > 0) best = o;
    return best.i;
  }

  options(pid) {
    const s = this.seatById(pid);
    if (!s || this.finished || pid !== this.currentActorId()) return null;
    const toCall = this.betToMatch - s.committed;
    const minRaiseTo = this.betToMatch + this.minRaise;
    const maxRaiseTo = s.committed + s.stack;
    return {
      toCall: Math.min(toCall, s.stack),
      canCheck: toCall <= 0, canCall: toCall > 0 && s.stack > 0, canRaise: s.stack > toCall,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo), maxRaiseTo,
      stack: s.stack, committed: s.committed, betToMatch: this.betToMatch,
    };
  }

  act(pid, action) {
    if (this.finished) throw new Error('핸드가 끝났습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    const s = this.seats[this.toAct];
    const kind = action && action.kind;
    const toCall = this.betToMatch - s.committed;

    if (kind === 'fold') { s.folded = true; this.lastAction = { id: pid, text: '다이' }; }
    else if (kind === 'check') { if (toCall > 0) throw new Error('체크할 수 없습니다.'); this.lastAction = { id: pid, text: '체크' }; }
    else if (kind === 'call') {
      if (toCall <= 0) throw new Error('콜할 금액이 없습니다.');
      const pay = Math.min(toCall, s.stack);
      s.stack -= pay; s.committed += pay; s.totalCommitted += pay;
      if (s.stack === 0) s.allIn = true;
      this.lastAction = { id: pid, text: s.allIn ? '올인 콜' : '콜 ' + pay };
    } else if (kind === 'raise') {
      const maxTo = s.committed + s.stack;
      let to = Math.floor(Number(action.amount));
      if (!(to > this.betToMatch)) throw new Error('금액이 부족합니다.');
      if (to > maxTo) to = maxTo;
      const minTo = this.betToMatch + this.minRaise;
      if (to < minTo && to < maxTo) throw new Error('최소 벳/레이즈보다 작습니다.');
      const add = to - s.committed;
      if (add > s.stack) throw new Error('보유 칩을 초과했습니다.');
      const raiseSize = to - this.betToMatch;
      s.stack -= add; s.committed = to; s.totalCommitted += add;
      if (s.stack === 0) s.allIn = true;
      if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
      const wasBet = this.betToMatch === 0;
      this.betToMatch = to;
      for (const x of this.seats) if (!x.folded && !x.allIn) x.acted = false;
      this.lastAction = { id: pid, text: (wasBet ? '벳 ' : '레이즈 ') + to };
    } else throw new Error('알 수 없는 동작입니다.');

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
    this.betToMatch = 0; this.minRaise = this.unit;
    if (this.streetNo === 7) return this._showdown();
    if (this._canActCount() <= 1) return this._runoutAndShowdown();
    this.streetNo += 1;
    this._dealStreet(this.streetNo);
    this.toAct = this._firstActor(false);
    return { ended: false };
  }

  _dealStreet(streetNo) {
    const up = streetNo !== 7; // 7th만 다운
    for (const s of this.seats) if (!s.folded) s.cards.push({ card: this.deck.shift(), up });
  }

  _runoutAndShowdown() {
    while (this.streetNo < 7) { this.streetNo += 1; this._dealStreet(this.streetNo); }
    return this._showdown();
  }

  _buildPots() {
    const levels = [...new Set(this.seats.map((s) => s.totalCommitted).filter((v) => v > 0))].sort((a, b) => a - b);
    const pots = []; let prev = 0;
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
    for (const s of contenders) s.score = poker.evaluateBest(s.cards.map((c) => c.card)).score;
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
      const ordered = winners.slice().sort((a, b) => this.seats.indexOf(a) - this.seats.indexOf(b));
      for (const w of ordered) {
        let amt = share; if (rem > 0) { amt += 1; rem -= 1; }
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
    this.showdownIds = null;
    this.finished = true;
    return { ended: true };
  }

  results() { return this.seats.map((s) => ({ id: s.id, stack: s.stack })); }
}

module.exports = { SevenGame, shuffle };
