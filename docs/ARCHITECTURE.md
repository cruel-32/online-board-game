# 아키텍처

여러 보드게임을 한 서비스에서 제공하기 위한 **플러그인 구조**를 설명한다.
방/로비/채팅/음성/봇 오케스트레이션 같은 **게임 독립 공용 계층** 위에, 게임별 규칙·직렬화·UI를
**플러그인(게임 모듈)** 으로 얹는다. 현재 등록된 게임은 `렉시오`, `펠리시티`.

```
┌───────────────────────── 서버 (Node + ws) ─────────────────────────┐
│  index.js  ──  rooms.js (게임 독립 오케스트레이터)                   │
│                   │  방 생명주기 · 로비 · 채팅 · 음성 시그널링 · 봇  │
│                   ▼                                                  │
│         games/registry.js  →  games/<id>/index.js (엔진 인터페이스)   │
│                                   ├─ lexio   (game.js, bot.js)        │
│                                   └─ felicity(game.js, bot.js)        │
│  store.js  ──  Redis / PostgreSQL 영속화(선택)                        │
└──────────────────────────────────────────────────────────────────────┘
        ▲  WebSocket (JSON 메시지)
        ▼
┌───────────────────────── 클라이언트 (브라우저) ────────────────────┐
│  core/shell.js  ── 신원 · 화면전환 · 로비 · 대기실 · 게임 mount      │
│  core/{net,modal,chat,widgets}.js  ·  voice.js · sound.js (공용)      │
│  games/registry.js  →  games/<id>/{index.js, ui.js} (게임 클라이언트) │
│  shared/<game>-core.js  ── 규칙 엔진(서버·클라 공용)                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 서버

### rooms.js — 게임 독립 오케스트레이터
게임 규칙을 전혀 모른다. 다음만 담당한다.
- 방 생성/입장/퇴장/강퇴/방장 위임/빈 방 정리, 로비 브로드캐스트
- 재접속 복구(`hello`), 채팅 중계, 음성 시그널링 중계(`voice_*`)
- 봇 스케줄링: `engine.currentActor(game)` 가 봇/끊긴 좌석이면 `engine.botAction`을 지연 실행
- 게임 종료 감지 → `engine.settle` 호출 → `round_over` 브로드캐스트

방(room) 객체 핵심 필드: `gameId`, `engine`(게임 모듈), `options`(게임별 설정), `game`(인스턴스),
`players`, `maxPlayers`, `hostId`, `state('waiting'|'playing')`, `roundNo`, `matchOver`, `lastResult`.

### 게임 엔진 인터페이스 — `games/<id>/index.js`
```js
module.exports = {
  meta: { id, name, minPlayers, maxPlayers, settleDelay },
  defaultOptions() / normalizeOptions(opts),      // 게임별 설정(렉시오=칩, 펠리시티=없음)
  initPlayer(room, player) / resetMatch(room),    // 대기실 단계의 게임별 경제 초기화
  createGame(room),                               // room.players/options로 인스턴스 생성
  serialize(game, room, viewerId) -> state,       // 클라 상태(비공개 정보는 viewer 기준 마스킹)
  currentActor(game) -> playerId | null,          // 봇 스케줄링용 현재 행동자
  botDelay(game) -> ms,
  applyAction(game, room, playerId, action) -> { ended },  // 제네릭 액션 적용(throw=거절)
  botAction(game, playerId) -> action,            // 봇 행동
  settle(game, room) -> { payload, continues },   // 종료 정산: room 상태 갱신 + 결과 페이로드
  seatLabel(room, player) -> string,              // 대기실 좌석 부가표시
};
```
- **라운드/매치 모델의 차이는 엔진이 흡수한다.** 렉시오는 인스턴스=1라운드이고 `settle`의
  `continues:true`로 방이 대기 상태로 돌아가 다음 라운드를 이어간다(칩은 `room.players[].chips`에 유지).
  펠리시티는 인스턴스=9라운드 전체를 내부에서 진행하고 마지막에만 `ended:true`를 반환한다(코인은 인스턴스 내부).
- 규칙 계산은 `public/shared/<game>-core.js`(서버·클라 공용, 순수 함수)에 두고 엔진/봇/클라가 재사용한다.

### 제네릭 메시지(클라 → 서버)
`hello`, `set_name`, `create_room{gameId}`, `join_room`, `leave_room`, `set_game{gameId}`(방장),
`set_max`, `set_option{key,value}`(방장), `add_bot`/`remove_bot`/`kick`, `ready`, `start`,
`game_action{action}`(엔진 위임), `chat{text}`, `voice_join`/`voice_leave`/`mic_state`/`voice_signal`.

### 서버 → 클라
`hello_ok`, `lobby{rooms,games}`, `room{...,games,game,options,players[seat]}`, `joined`, `left`,
`kicked`, `need_password`, `game{state}`(엔진 serialize), `round_over{result}`, `chat`, `voice_signal`, `error`.

---

## 클라이언트

### core/ — 게임 독립 공용 모듈
| 모듈 | 전역 | 역할 |
|---|---|---|
| `net.js` | `Net` | WebSocket 연결/자동 재연결/전송/메시지 디스패치 |
| `modal.js` | `Modal` | 팝업 open/close, `.popup-close`·`.popup.dismissable` 배경 클릭 자동 배선 |
| `chat.js` | `Chat` | 채팅 패널·뱃지·입력 + 화면 위 말풍선 레이어(위치는 게임의 `bubbleAnchor`) |
| `widgets.js` | `Widgets` | 음성/마이크/채팅 위젯 배치·상태(대기실=상단 줄, 게임=우상단 고정) |
| `voice.js` | `VoiceChat` | WebRTC P2P mesh 음성(서버는 시그널링만 중계) |
| `sound.js` | `Sound` | 합성 효과음 + 음성 안내 |
| `shell.js` | — | 신원·화면전환·로비·대기실 렌더 + 활성 게임 클라이언트 mount/unmount |

### 게임 클라이언트 인터페이스 — `games/<id>/index.js`
`Games.register({...})` 로 등록한다.
```js
{ id, name,
  renderSetup(container, room, {isHost, send}),   // 대기실 게임별 설정 UI(렉시오=칩 스테퍼)
  mount({canvas, hudSlot, ctx}),                  // ctx: {send, toast, myId, showScreen}
  unmount(), setState(state),
  topBarText(state),                              // 상단 바 텍스트
  bubbleAnchor(playerId) -> {x,y}|null,           // 채팅 말풍선 앵커(페이지 좌표)
  onRoundOver(result), isResultOpen(), closeResult() }
```
게임별 HUD·팝업(어시스트/게임룰/결과·점수판)은 `mount` 시 게임 클라이언트가 `#game-hud-slot`과
`#screen-game`에 주입하고 `unmount` 시 제거한다. 캔버스 렌더링은 `games/<id>/ui.js`가 담당한다.

### shell 흐름
- `game` 메시지 → 화면 전환 후 `state.gameId` 게임 클라이언트를 mount(교체 시 이전 것 unmount) → `setState`.
- `round_over` → 활성 게임의 `onRoundOver`. 방 상태 브로드캐스트가 와도 `isResultOpen()`이면 게임 화면 유지.
- `Chat`의 말풍선 위치는 `activeGame.bubbleAnchor(id)`로 위임(게임마다 좌표계가 다르므로).

---

## 새 게임 추가하기
1. `public/shared/<game>-core.js` — 순수 규칙 함수(덱/셋업/판정/점수).
2. `server/src/games/<game>/index.js` — 엔진 인터페이스 구현(+ 필요 시 `game.js`, `bot.js`).
   `server/src/games/registry.js`에 등록.
3. `public/js/games/<game>/{index.js, ui.js}` — 게임 클라이언트 + 캔버스 렌더러. `Games.register(...)`.
4. `public/index.html`의 `<script>`에 core.js/ui.js/index.js 추가.

공용 계층(방/로비/채팅/음성/봇/화면 셸)은 건드릴 필요가 없다.

---

## 영속화 (선택)
`store.js`가 `DATABASE_URL`/`REDIS_URL`이 있을 때만 활성화된다. `round_results` 테이블에 `game_id`
컬럼과 함께 라운드/게임 결과를 기록하고, Redis 리스트 `boardgames:recent_rounds`에 최근 결과를 캐시한다.
둘 다 없어도(로컬 개발) 서버는 정상 동작한다.

## 테스트
`npm test`(`test/simulate.js`)는 순수 규칙 엔진과 봇 자동 대전을 검증한다(렉시오 조합/서열/정산,
펠리시티 개·토끼 효과 및 4·5인 봇 완주). 새 게임은 여기에 코어 단위 테스트와 봇 완주 테스트를 추가한다.
