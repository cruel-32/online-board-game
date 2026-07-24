'use strict';
/**
 * 우노(UNO) 한 판의 상태 기계 — 일반적으로 널리 알려진 규칙을 따른다.
 * 덱 108장: 색깔(빨/노/초/파)별 0×1, 1~9×2, 스킵/리버스/드로우2 각 ×2 + 와일드×4, 와일드드로우4×4.
 * 각자 7장으로 시작, 색·숫자·기호가 맞거나 와일드면 낼 수 있다. 먼저 손패를 다 내면 승리.
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const deck = [];
  let id = 0;
  const mk = (color, type, num) => ({ id: 'u' + (id++), color, type, num: (num == null ? null : num) });
  for (const c of COLORS) {
    deck.push(mk(c, 'number', 0));
    for (let n = 1; n <= 9; n++) { deck.push(mk(c, 'number', n)); deck.push(mk(c, 'number', n)); }
    for (const t of ['skip', 'reverse', 'draw2']) { deck.push(mk(c, t)); deck.push(mk(c, t)); }
  }
  for (let k = 0; k < 4; k++) { deck.push(mk(null, 'wild')); deck.push(mk(null, 'wild4')); }
  return deck;
}

// 카드 점수(정산용): 숫자=액면가, 기호=20, 와일드=50
function cardPoints(card) {
  if (card.type === 'number') return card.num;
  if (card.type === 'wild' || card.type === 'wild4') return 50;
  return 20;
}

class UnoGame {
  constructor(players) {
    this.playerIds = players.map((p) => p.id);
    this.botIds = new Set((players || []).filter((p) => p.isBot).map((p) => p.id));
    this.n = this.playerIds.length;
    this.hands = new Map();

    this.deck = shuffle(buildDeck());
    for (const id of this.playerIds) this.hands.set(id, this.deck.splice(0, 7));

    // 시작 카드: 규칙 단순화를 위해 숫자 카드가 나올 때까지 다시 뽑는다(기호/와일드 회피).
    let start = this.deck.shift();
    while (start.type !== 'number') { this.deck.push(start); start = this.deck.shift(); }
    this.discard = [start];
    this.currentColor = start.color;

    this.dir = 1;              // +1 시계 / -1 반시계
    this.turnIdx = 0;
    this.justDrew = null;      // { pid, cardId } — 방금 뽑은 카드를 낼지/넘길지 선택 대기
    this.finished = false;
    this.winnerId = null;
    this.lastAction = null;    // { pid, text } — 마지막 행동 안내
    this.penalty = null;       // { byId, targetId, count, seq } — 방금 적용된 드로우 페널티(클라 애니메이션용)
    this.penaltySeq = 0;
  }

  top() { return this.discard[this.discard.length - 1]; }
  handOf(pid) { return this.hands.get(pid) || []; }

  currentActorId() {
    if (this.finished) return null;
    return this.playerIds[this.turnIdx];
  }

  playable(card) {
    if (card.type === 'wild' || card.type === 'wild4') return true;
    if (card.color === this.currentColor) return true;
    const t = this.top();
    if (card.type === 'number' && t.type === 'number') return card.num === t.num;
    if (card.type !== 'number' && card.type === t.type) return true; // 같은 기호끼리
    return false;
  }

  hasPlayable(pid) {
    return this.handOf(pid).some((c) => this.playable(c));
  }

  _advance(steps) {
    this.turnIdx = (((this.turnIdx + this.dir * steps) % this.n) + this.n) % this.n;
  }

  _drawCard() {
    if (this.deck.length === 0) {
      // 버림패(맨 위 제외)를 섞어 새 덱으로
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = [top];
    }
    return this.deck.length ? this.deck.shift() : null;
  }

  _drawTo(pid, count) {
    for (let k = 0; k < count; k++) {
      const c = this._drawCard();
      if (c) this.handOf(pid).push(c);
    }
  }

  /* ---------- 액션 ---------- */
  play(pid, cardId, color) {
    if (this.finished) throw new Error('게임이 끝났습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    const hand = this.handOf(pid);
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error('가지고 있지 않은 카드입니다.');
    const card = hand[idx];
    // 방금 뽑은 상태라면 그 카드만 낼 수 있다.
    if (this.justDrew && this.justDrew.pid === pid && this.justDrew.cardId !== cardId) {
      throw new Error('방금 뽑은 카드만 낼 수 있습니다.');
    }
    if (!this.playable(card)) throw new Error('낼 수 없는 카드입니다.');

    hand.splice(idx, 1);
    this.discard.push(card);
    this.justDrew = null;

    if (card.type === 'wild' || card.type === 'wild4') {
      this.currentColor = COLORS.includes(color) ? color : COLORS[Math.floor(Math.random() * 4)];
    } else {
      this.currentColor = card.color;
    }
    this.lastAction = { pid, text: this._describe(card) };

    if (hand.length === 0) {
      this.finished = true;
      this.winnerId = pid;
      return { ended: true };
    }

    this._applyEffectAndAdvance(card);
    return { ended: false };
  }

  _applyEffectAndAdvance(card) {
    const byId = this.currentActorId();
    if (card.type === 'reverse') this.dir = -this.dir;
    this._advance(1); // 다음 사람
    const nextPid = this.currentActorId();
    if (card.type === 'draw2') { this._drawTo(nextPid, 2); this.penalty = { byId, targetId: nextPid, count: 2, seq: ++this.penaltySeq }; this._advance(1); }
    else if (card.type === 'wild4') { this._drawTo(nextPid, 4); this.penalty = { byId, targetId: nextPid, count: 4, seq: ++this.penaltySeq }; this._advance(1); }
    else if (card.type === 'skip') { this._advance(1); }
    else if (card.type === 'reverse' && this.n === 2) { this._advance(1); } // 2인전 리버스=스킵
  }

  draw(pid) {
    if (this.finished) throw new Error('게임이 끝났습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    if (this.justDrew && this.justDrew.pid === pid) throw new Error('이미 카드를 뽑았습니다.');
    const c = this._drawCard();
    if (c) this.handOf(pid).push(c);
    this.lastAction = { pid, text: '카드를 뽑았습니다' };
    if (c && this.playable(c)) {
      this.justDrew = { pid, cardId: c.id }; // 낼지/넘길지 선택
    } else {
      this._advance(1); // 낼 수 없으면 턴 넘김
    }
    return { ended: false };
  }

  pass(pid) {
    if (this.finished) throw new Error('게임이 끝났습니다.');
    if (pid !== this.currentActorId()) throw new Error('당신의 차례가 아닙니다.');
    if (!(this.justDrew && this.justDrew.pid === pid)) throw new Error('지금은 넘길 수 없습니다(먼저 카드를 뽑으세요).');
    this.justDrew = null;
    this._advance(1);
    return { ended: false };
  }

  _describe(card) {
    if (card.type === 'number') return `${card.num} 냄`;
    const label = { skip: '스킵', reverse: '리버스', draw2: '드로우2', wild: '와일드', wild4: '와일드+4' }[card.type];
    return `${label} 냄`;
  }

  /* ---------- 결과 ---------- */
  results() {
    return this.playerIds.map((id) => {
      const hand = this.handOf(id);
      const points = hand.reduce((s, c) => s + cardPoints(c), 0);
      return { id, remaining: hand.length, points };
    });
  }
}

module.exports = { UnoGame, buildDeck, cardPoints, COLORS, shuffle };
