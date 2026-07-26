'use strict';
/**
 * 노땡스(No Thanks!) 한 게임(=한 매치)의 상태.
 * 3~35 숫자 카드 33장 중 9장을 보지 않고 제외한 24장으로 진행한다.
 * 자기 차례에 칩을 한 개 내고 다음 사람에게 넘기거나(pass), 카드(및 카드 위에 쌓인 칩)를 가져간다(take).
 * 카드를 가져간 사람은 덱에서 새 카드를 뒤집어 즉시 다시 선택하므로(연속 가져가기 가능) 차례가 넘어가지 않는다.
 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 5인 이상은 9칩, 그 외(3~4인)는 11칩 지급(공식 룰)
function startingChips(playerCount) {
  return playerCount >= 5 ? 9 : 11;
}

class Game {
  constructor(players) {
    this.playerIds = players.map((p) => p.id);

    const numbers = [];
    for (let n = 3; n <= 35; n++) numbers.push(n);
    const shuffled = shuffle(numbers);
    this.deck = shuffled.slice(9); // 9장은 보지 않고 제외, 나머지 24장이 draw pile

    const chips = startingChips(players.length);
    this.chips = new Map(this.playerIds.map((id) => [id, chips]));
    this.cardsOwned = new Map(this.playerIds.map((id) => [id, []]));

    this.turnIdx = Math.floor(Math.random() * this.playerIds.length);
    this.current = this.deck.pop();
    this.pot = 0; // 현재 카드 위에 쌓인 칩
    this.finished = false;
    this.lastAction = null; // { type:'take'|'pass', playerId, pot }
    this.seq = 0; // 매 액션마다 증가 — 클라이언트가 새 이벤트를 감지하는 용도
  }

  currentPlayerId() {
    return this.playerIds[this.turnIdx];
  }

  pass(pid) {
    if (this.finished) throw new Error('이미 종료된 게임입니다.');
    if (pid !== this.currentPlayerId()) throw new Error('당신의 차례가 아닙니다.');
    const bal = this.chips.get(pid);
    if (bal <= 0) throw new Error('칩이 없어 카드를 가져가야 합니다.');
    this.chips.set(pid, bal - 1);
    this.pot += 1;
    this.lastAction = { type: 'pass', playerId: pid, pot: 0 };
    this.seq += 1;
    this.turnIdx = (this.turnIdx + 1) % this.playerIds.length;
  }

  take(pid) {
    if (this.finished) throw new Error('이미 종료된 게임입니다.');
    if (pid !== this.currentPlayerId()) throw new Error('당신의 차례가 아닙니다.');
    const gained = this.pot;
    this.chips.set(pid, this.chips.get(pid) + gained);
    this.cardsOwned.get(pid).push(this.current);
    this.lastAction = { type: 'take', playerId: pid, pot: gained, card: this.current };
    this.pot = 0;
    this.seq += 1;
    if (this.deck.length === 0) {
      this.finished = true;
      this.current = null;
      return { finished: true };
    }
    this.current = this.deck.pop();
    // turnIdx는 그대로 유지 — 가져간 사람이 새 카드에 대해 다시 선택한다.
    return { finished: false };
  }

  /** 최종 점수 계산: 연속된 숫자는 가장 낮은 숫자만 더하고, 보유 칩 개수만큼 차감(낮을수록 좋음) */
  results() {
    return this.playerIds.map((id) => {
      const cards = this.cardsOwned.get(id).slice().sort((a, b) => a - b);
      let cardSum = 0;
      for (let i = 0; i < cards.length; i++) {
        if (i > 0 && cards[i] === cards[i - 1] + 1) continue; // 연속 구간의 두 번째 숫자부터는 무시
        cardSum += cards[i];
      }
      const chips = this.chips.get(id);
      return { id, cards, cardSum, chips, score: cardSum - chips };
    });
  }
}

module.exports = { Game, shuffle, startingChips };
