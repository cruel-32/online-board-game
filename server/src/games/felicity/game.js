'use strict';
/**
 * 펠리시티 한 게임 세션(9라운드)의 상태 기계.
 * 라운드 = 배치(placing) → 경매(bidding). 낙찰자가 자루(카드 열)를 가져가고 개/토끼 효과를 처리한다.
 */
const core = require('../../../../public/shared/felicity-core.js');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class FelicityGame {
  constructor(players) {
    this.playerIds = players.map((p) => p.id);
    this.n = players.length;
    this.colors = {};
    this.hands = new Map();
    this.coins = new Map();
    this.collected = new Map();

    // 각자 한 색을 배정받아 그 색 10장을 손에 든다.
    players.forEach((p, i) => {
      const color = core.COLORS[i];
      this.colors[p.id] = color;
      this.hands.set(p.id, core.buildColorDeck(color));
      this.coins.set(p.id, core.COINS_PER_PLAYER);
      this.collected.set(p.id, []);
    });

    // 각자 오른쪽 이웃(다음 좌석) 손에서 1장 무작위 제거.
    for (let i = 0; i < this.n; i++) {
      const victim = this.playerIds[(i + 1) % this.n];
      const hand = this.hands.get(victim);
      if (hand.length) hand.splice(Math.floor(Math.random() * hand.length), 1);
    }

    this.mouseNums = core.mouseCardsFor(this.n);
    this.bank = core.bankTotalFor(this.n);
    this.mouseCoins = this.mouseNums.map(() => 0);

    this.round = 1;
    this.startIdx = Math.floor(Math.random() * this.n);
    this.finished = false;
    this.lastResult = null;

    this._startRound(false);
  }

  /* ---------- 라운드 시작/진행 ---------- */
  _refill() {
    const need = this.mouseNums.reduce((s, v) => s + v, 0);
    if (this.bank >= need) {
      this.mouseCoins = this.mouseNums.slice();
      this.bank -= need;
      this.refilled = true;
    } else {
      this.mouseCoins = this.mouseNums.map(() => 0);
      this.refilled = false;
    }
  }

  _startRound(skipRefill) {
    this.phase = 'placing';
    this.placeIdx = 0;
    this.row = []; // { ownerId, card, faceUp }
    this.bids = new Map(this.playerIds.map((id) => [id, 0]));
    this.passed = new Set();
    this.highBid = 0;
    this.highBidder = null;
    if (!skipRefill) this._refill();
    else this.refilled = false;
    this.turnIdx = this.startIdx;
  }

  currentActorId() {
    if (this.finished || this.phase === 'done') return null;
    if (this.phase === 'placing') return this.playerIds[(this.startIdx + this.placeIdx) % this.n];
    if (this.phase === 'bidding') return this.playerIds[this.turnIdx];
    return null;
  }

  _advanceTurn() {
    for (let k = 1; k <= this.n; k++) {
      const idx = (this.turnIdx + k) % this.n;
      if (!this.passed.has(this.playerIds[idx])) { this.turnIdx = idx; return; }
    }
  }

  _revealNextHidden() {
    const slot = this.row.find((s) => !s.faceUp);
    if (slot) slot.faceUp = true;
  }

  /* ---------- 액션 ---------- */
  place(pid, cardId) {
    if (this.phase !== 'placing') throw new Error('지금은 카드를 놓을 수 없습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    const hand = this.hands.get(pid);
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error('가지고 있지 않은 카드입니다.');
    const card = hand.splice(idx, 1)[0];
    this.row.push({ ownerId: pid, card, faceUp: false });
    this.placeIdx += 1;
    if (this.placeIdx === this.n) {
      // 전원 배치 완료 → 시작 플레이어 카드 공개, 경매 시작
      this.phase = 'bidding';
      this.row[0].faceUp = true;
      this.turnIdx = this.startIdx;
    }
    return { ended: false };
  }

  bid(pid, amount) {
    if (this.phase !== 'bidding') throw new Error('지금은 입찰할 수 없습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    amount = Math.floor(Number(amount));
    if (!(amount >= 1)) throw new Error('입찰액은 1 이상이어야 합니다.');
    if (amount <= this.highBid) throw new Error('이전 입찰보다 높게 불러야 합니다.');
    if (amount > this.coins.get(pid)) throw new Error('보유한 코인보다 많이 입찰할 수 없습니다.');
    this.bids.set(pid, amount);
    this.highBid = amount;
    this.highBidder = pid;
    this._advanceTurn();
    return this._checkResolve();
  }

  pass(pid) {
    if (this.phase !== 'bidding') throw new Error('지금은 패스할 수 없습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    this.passed.add(pid);
    this.bids.set(pid, 0);
    // 남은 최저 숫자 쥐 카드의 동전을 가져온다.
    const i = this.mouseCoins.findIndex((c) => c > 0);
    if (i !== -1) {
      this.coins.set(pid, this.coins.get(pid) + this.mouseCoins[i]);
      this.mouseCoins[i] = 0;
    }
    this._revealNextHidden();
    this._advanceTurn();
    return this._checkResolve();
  }

  _checkResolve() {
    const active = this.playerIds.filter((id) => !this.passed.has(id));
    if (active.length === 0) { this._discardRound(); return { ended: this.finished }; }
    if (active.length === 1 && this.highBid > 0) { this._resolveWin(active[0]); return { ended: this.finished }; }
    // active.length===1 && highBid===0 → 마지막 사람에게 결정 기회(_advanceTurn이 그 사람을 가리킴)
    return { ended: false };
  }

  _resolveWin(winnerId) {
    // 낙찰액을 은행에 납부
    this.coins.set(winnerId, this.coins.get(winnerId) - this.highBid);
    this.bank += this.highBid;
    const bag = this.row.map((s) => s.card);
    const { removed, kept } = core.resolveDogs(bag);
    this.collected.get(winnerId).push(...kept);
    this.lastResult = {
      winnerId, bid: this.highBid,
      kept: kept.slice(), removed: removed.slice(), discarded: false,
    };
    this._finishOrNext({ keepStart: false, skipRefill: false });
  }

  _discardRound() {
    this.lastResult = {
      winnerId: null, bid: 0,
      kept: [], removed: this.row.map((s) => s.card), discarded: true,
    };
    // 시작 플레이어 유지, 다음 라운드 코인 미적재
    this._finishOrNext({ keepStart: true, skipRefill: true });
  }

  _finishOrNext(opts) {
    if (this.playerIds.every((id) => this.hands.get(id).length === 0)) {
      this.phase = 'done';
      this.finished = true;
      return;
    }
    this.round += 1;
    if (!opts.keepStart) this.startIdx = (this.startIdx + 1) % this.n;
    this._startRound(opts.skipRefill);
  }

  /* ---------- 최종 점수 ---------- */
  results() {
    return this.playerIds.map((id) => {
      const s = core.scoreOf(this.collected.get(id), this.coins.get(id));
      return { id, cardPts: s.cardPts, coins: s.coins, total: s.total, collected: this.collected.get(id) };
    });
  }
}

module.exports = { FelicityGame, shuffle };
