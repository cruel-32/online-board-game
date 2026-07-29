'use strict';
const core = require('../../../../public/shared/tichu-core.js');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 한 핸드(라운드)의 게임 상태.
 * 좌석: room.players의 순서가 아니라 team 태그로 A,B,A,B 교차 배치를 직접 구성한다
 * (rooms.js가 매 게임 시작마다 room.players를 셔플하므로, 팀 좌석을 스스로 보장해야 함).
 * partner = (i+2)%4, 오른쪽 이웃 = (i+1)%4, 왼쪽 이웃 = (i+3)%4 (시계방향 고정 컨벤션).
 */
class Game {
  constructor(players) {
    const teamA = players.filter((p) => p.team === 'A');
    const teamB = players.filter((p) => p.team === 'B');
    this.playerIds = [teamA[0].id, teamB[0].id, teamA[1].id, teamB[1].id];
    this.teamOf = new Map(players.map((p) => [p.id, p.team]));

    const deck = shuffle(core.buildDeck());
    this.hands = new Map();
    this.playerIds.forEach((pid, i) => {
      this.hands.set(pid, deck.slice(i * 14, i * 14 + 14)); // 딜 순서 그대로 보관(앞 8장 = 그랜드 티츄 판단용)
    });

    this.phase = 'grand_declare'; // 'grand_declare' | 'exchange' | 'trick'
    this.grandPending = new Set(this.playerIds);
    this.grandTichu = new Map(); // pid -> boolean
    this.tichu = new Map();      // pid -> true (선언한 사람만 등록)
    this.hasPlayedCard = new Set();

    this.exchangeSubmitted = new Set();
    this.exchangeGive = new Map(); // pid -> {left,right,partner: Card}

    this.turnIdx = -1;
    this.leaderId = null;
    this.current = null;         // { combo, byId }
    this.lastPlayerId = null;
    this.trickPile = [];         // 이번 트릭에 쌓인 카드(전원분)
    this.passed = new Set();
    this.collected = new Map(this.playerIds.map((pid) => [pid, []])); // 각자 획득한 카드 누적
    this._pendingTrickForDragon = null;

    this.finishOrder = [];
    this.doubleWinTeam = null;

    this.wish = null;            // 활성 소원 랭크(2~14) | null
    this.pendingWish = null;     // 마작을 낸 직후 소원 결정 대기 중인 pid
    this.pendingDragonGive = null; // 드래곤으로 트릭 승리 직후 증정 대상 결정 대기 중인 pid

    this.finished = false;
    this.endReason = null;       // 'doubleWin' | 'threeOut'
  }

  seatIndex(pid) { return this.playerIds.indexOf(pid); }
  partnerOf(pid) { return this.playerIds[(this.seatIndex(pid) + 2) % 4]; }

  currentPlayerId() {
    if (this.finished || this.phase !== 'trick') return null;
    return this.playerIds[this.turnIdx];
  }

  /* ---------- 그랜드 티츄 ---------- */
  declareGrand(pid, declare) {
    if (this.phase !== 'grand_declare') throw new Error('지금은 그랜드 티츄를 선언할 수 없습니다.');
    if (!this.grandPending.has(pid)) throw new Error('이미 결정했습니다.');
    this.grandPending.delete(pid);
    this.grandTichu.set(pid, !!declare);
    if (this.grandPending.size === 0) this.phase = 'exchange';
  }

  /* ---------- 일반 티츄 ---------- */
  declareTichu(pid) {
    if (this.finished) throw new Error('이미 종료된 라운드입니다.');
    if (this.phase === 'grand_declare') throw new Error('아직 카드를 다 받지 않았습니다.');
    if (this.grandTichu.get(pid) === true) throw new Error('이미 그랜드 티츄를 선언했습니다.');
    if (this.tichu.get(pid)) throw new Error('이미 티츄를 선언했습니다.');
    if (this.hasPlayedCard.has(pid)) throw new Error('카드를 낸 후에는 티츄를 선언할 수 없습니다.');
    this.tichu.set(pid, true);
  }

  /* ---------- 카드 나눔(스컵프) ---------- */
  submitExchange(pid, gives) {
    if (this.phase !== 'exchange') throw new Error('지금은 카드를 나눌 수 없습니다.');
    if (this.exchangeSubmitted.has(pid)) throw new Error('이미 제출했습니다.');
    const hand = this.hands.get(pid);
    const ids = [gives && gives.left, gives && gives.right, gives && gives.partner];
    if (ids.some((id) => !id) || new Set(ids).size !== 3) throw new Error('세 장을 각각 다르게 골라야 합니다.');
    const cards = ids.map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new Error('가지고 있지 않은 카드입니다.');
    this.exchangeGive.set(pid, { left: cards[0], right: cards[1], partner: cards[2] });
    this.exchangeSubmitted.add(pid);
    if (this.exchangeSubmitted.size === this.playerIds.length) this._resolveExchange();
  }

  _resolveExchange() {
    const received = new Map(this.playerIds.map((id) => [id, []]));
    for (const pid of this.playerIds) {
      const i = this.seatIndex(pid);
      const rightNeighborId = this.playerIds[(i + 1) % 4];
      const leftNeighborId = this.playerIds[(i + 3) % 4];
      const partnerId = this.playerIds[(i + 2) % 4];
      const give = this.exchangeGive.get(pid);
      received.get(rightNeighborId).push(give.right);
      received.get(leftNeighborId).push(give.left);
      received.get(partnerId).push(give.partner);
    }
    for (const pid of this.playerIds) {
      const give = this.exchangeGive.get(pid);
      const givenIds = new Set([give.left.id, give.right.id, give.partner.id]);
      const kept = this.hands.get(pid).filter((c) => !givenIds.has(c.id));
      this.hands.set(pid, kept.concat(received.get(pid)));
    }
    this.phase = 'trick';
    const mahjongHolder = this.playerIds.find((pid) => this.hands.get(pid).some((c) => c.special === 'mahjong'));
    this.turnIdx = this.seatIndex(mahjongHolder);
    this.leaderId = mahjongHolder;
  }

  /* ---------- 트릭 플레이 ---------- */
  play(pid, cardIds, wish) {
    if (this.finished) throw new Error('이미 종료된 라운드입니다.');
    if (this.phase !== 'trick') throw new Error('지금은 낼 수 없습니다.');
    if (this.pendingWish) throw new Error('소원을 먼저 정해야 합니다.');
    if (this.pendingDragonGive) throw new Error('드래곤을 먼저 넘겨줘야 합니다.');
    const isMyTurn = pid === this.currentPlayerId();
    // 봄(폭탄)은 예외적으로 자기 차례가 아니어도 언제든 끼어들어 낼 수 있다(정식 규칙).
    // 그 외 조합은 반드시 자기 차례에만 낼 수 있다.
    const mayInterrupt = !isMyTurn && this.current && !this.finishOrder.includes(pid) &&
      this.hands.has(pid) && this.hands.get(pid).length > 0;
    if (!isMyTurn && !mayInterrupt) throw new Error('당신의 차례가 아닙니다.');
    if (!Array.isArray(cardIds) || !cardIds.length || new Set(cardIds).size !== cardIds.length)
      throw new Error('잘못된 카드 선택입니다.');
    const hand = this.hands.get(pid);
    const cards = cardIds.map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new Error('가지고 있지 않은 카드입니다.');

    let combo = core.analyze(cards);
    if (!combo) throw new Error('유효한 조합이 아닙니다.');
    if (!isMyTurn && !combo.isBomb) throw new Error('자기 차례가 아닐 때는 봄(폭탄)만 낼 수 있습니다.');

    const isDog = combo.type === 'single' && cards[0].special === 'dog';
    if (isDog && this.current) throw new Error('강아지는 리드로만 낼 수 있습니다.');

    const isPhoenixSingle = combo.type === 'single' && cards[0].special === 'phoenix';
    if (isPhoenixSingle) {
      combo = Object.assign({}, combo, { rank: core.resolvePhoenixSingleRank(this.current && this.current.combo) });
    }

    if (this.current) {
      if (!core.beats(combo, this.current.combo)) throw new Error('앞 사람보다 더 높은 조합을 내야 합니다.');
    }

    // 마작 소원 강제는 실제로 차례가 된 사람에게만 적용된다(끼어든 봄은 소원 이행 의무가 없음).
    if (isMyTurn && this.wish != null) {
      const fulfillsNow = cards.some((c) => c.rank === this.wish && !c.special);
      const ctx = this.current ? this.current.combo : null;
      if (!fulfillsNow && core.hasWishFulfillingPlay(hand, ctx, this.wish))
        throw new Error(`마작 소원(${this.wish})을 만족하는 패가 있으면 그것을 내야 합니다.`);
    }

    const includesMahjong = cards.some((c) => c.special === 'mahjong');

    this.hands.set(pid, hand.filter((c) => !cardIds.includes(c.id)));
    this.hasPlayedCard.add(pid);
    if (this.wish != null && cards.some((c) => c.rank === this.wish && !c.special)) this.wish = null;

    if (isDog) {
      this.current = null;
      this.trickPile = [];
      this.passed = new Set();
      const finished = this._checkFinish(pid);
      if (!finished) {
        this._advanceToPartnerOf(pid);
        if (includesMahjong) this._armWish(pid, wish);
      }
      return;
    }

    this.trickPile = this.trickPile.concat(cards);
    this.current = { combo, byId: pid };
    this.lastPlayerId = pid;
    this.passed = new Set();
    // 끼어든 봄이면, 이후 턴 순서는 원래 차례였던 사람이 아니라 끼어든 사람의 다음 자리부터 이어간다.
    if (!isMyTurn) this.turnIdx = this.seatIndex(pid);

    const finished = this._checkFinish(pid);
    if (!finished) {
      if (includesMahjong) this._armWish(pid, wish);
      else this._advanceTurn();
    }
  }

  _armWish(pid, wish) {
    this.pendingWish = pid;
    if (wish !== undefined) this.resolveWish(pid, wish);
  }

  resolveWish(pid, rank) {
    if (this.pendingWish !== pid) throw new Error('지금은 소원을 정할 수 없습니다.');
    if (rank != null && !(Number.isInteger(rank) && rank >= 2 && rank <= 14))
      throw new Error('잘못된 소원입니다.');
    this.wish = rank != null ? rank : null;
    this.pendingWish = null;
    this._advanceTurn();
  }

  pass(pid) {
    if (this.finished) throw new Error('이미 종료된 라운드입니다.');
    if (this.phase !== 'trick') throw new Error('지금은 패스할 수 없습니다.');
    if (this.pendingWish) throw new Error('소원을 먼저 정해야 합니다.');
    if (this.pendingDragonGive) throw new Error('드래곤을 먼저 넘겨줘야 합니다.');
    if (pid !== this.currentPlayerId()) throw new Error('당신의 차례가 아닙니다.');
    if (!this.current) throw new Error('선(先)은 반드시 카드를 내야 합니다.');
    if (this.wish != null) {
      const hand = this.hands.get(pid);
      if (core.hasWishFulfillingPlay(hand, this.current.combo, this.wish))
        throw new Error(`마작 소원(${this.wish})을 만족하는 패가 있으면 패스할 수 없습니다.`);
    }
    this.passed.add(pid);
    // 트릭을 낸 사람을 제외한 "아직 활동 중인"(손패를 다 털지 않은) 응수자들이 전원 패스하면 종료.
    // (턴 회전만으로 판정하면, 트릭을 낸 사람이 그 사이 손패를 소진해 회전에서 제외될 때
    //  다시는 그 자리로 돌아오지 못해 무한히 패스만 도는 버그가 생긴다.)
    const activeResponders = this.playerIds.filter(
      (id) => id !== this.current.byId && !this.finishOrder.includes(id)
    );
    if (activeResponders.every((id) => this.passed.has(id))) this._resolveTrickWin();
    else this._advanceTurn();
  }

  giveDragon(pid, toPlayerId) {
    if (this.pendingDragonGive !== pid) throw new Error('지금은 드래곤을 넘길 수 없습니다.');
    const myTeam = this.teamOf.get(pid);
    if (!this.playerIds.includes(toPlayerId) || toPlayerId === pid || this.teamOf.get(toPlayerId) === myTeam)
      throw new Error('상대팀 플레이어에게만 넘길 수 있습니다.');
    const pile = this._pendingTrickForDragon || [];
    this._pendingTrickForDragon = null;
    this.pendingDragonGive = null;
    const existing = this.collected.get(toPlayerId) || [];
    this.collected.set(toPlayerId, existing.concat(pile));
    this._setLeadAfterTrick(pid);
  }

  // 트릭을 이긴 사람이 다음 트릭의 리드를 잡는다. 그 사람이 이미 손패를 다 털었다면(finishOrder에
  // 있음) 본인은 더 낼 수 없으므로, 좌석 순서상 바로 다음(오른쪽) 활동 중인 플레이어가 리드한다.
  _setLeadAfterTrick(winnerId) {
    this.turnIdx = this.seatIndex(winnerId);
    if (this.finishOrder.includes(winnerId)) this._advanceTurn();
    this.leaderId = this.playerIds[this.turnIdx];
  }

  _resolveTrickWin() {
    const winnerId = this.current.byId;
    const winningCombo = this.current.combo;
    const isDragonWin = winningCombo.type === 'single' && winningCombo.cards[0].special === 'dragon';
    const pile = this.trickPile;
    this.trickPile = [];
    this.current = null;
    this.passed = new Set();
    // 드래곤 승리는 giveDragon()에서 증정을 마친 뒤에 리드를 확정한다(그 전엔 turnIdx를 건드리지 않음).
    if (!isDragonWin) this._setLeadAfterTrick(winnerId);

    if (isDragonWin) {
      this._pendingTrickForDragon = pile;
      this.pendingDragonGive = winnerId;
      return;
    }
    const existing = this.collected.get(winnerId) || [];
    this.collected.set(winnerId, existing.concat(pile));
  }

  _checkFinish(pid) {
    if (this.hands.get(pid).length > 0) return false;
    this.finishOrder.push(pid);
    if (this.finishOrder.length === 2) {
      const [a, b] = this.finishOrder;
      if (this.teamOf.get(a) === this.teamOf.get(b)) {
        this.finished = true;
        this.endReason = 'doubleWin';
        this.doubleWinTeam = this.teamOf.get(a);
        return true;
      }
    }
    if (this.finishOrder.length === 3) {
      this.finished = true;
      this.endReason = 'threeOut';
      if (this.trickPile.length) {
        const pile = this.collected.get(pid) || [];
        this.collected.set(pid, pile.concat(this.trickPile));
        this.trickPile = [];
      }
      return true;
    }
    return false;
  }

  _advanceTurn() {
    let idx = this.turnIdx;
    for (let step = 0; step < 4; step++) {
      idx = (idx + 1) % 4;
      const pid = this.playerIds[idx];
      if (!this.finishOrder.includes(pid)) { this.turnIdx = idx; return; }
    }
  }

  _advanceToPartnerOf(pid) {
    this.turnIdx = (this.seatIndex(pid) + 2) % 4;
    if (this.finishOrder.includes(this.playerIds[this.turnIdx])) this._advanceTurn();
    this.leaderId = this.playerIds[this.turnIdx];
  }
}

module.exports = { Game, shuffle };
