/**
 * 게임 독립 셸 — 신원/화면전환/로비/대기실/채팅·음성 배선 + 활성 게임 클라이언트 mount·unmount.
 * 게임별 규칙/HUD/렌더링은 Games 레지스트리의 게임 클라이언트가 담당한다.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ---------- 신원 ---------- */
  const clientId =
    localStorage.getItem('lexio.clientId') ||
    (crypto.randomUUID ? crypto.randomUUID() : 'c-' + Math.random().toString(36).slice(2));
  localStorage.setItem('lexio.clientId', clientId);
  let myName = localStorage.getItem('lexio.name') || '';

  let currentRoom = null;
  let gameState = null;
  let activeGame = null;      // 마운트된 게임 클라이언트
  let games = [];             // 서버가 알려준 게임 메타 목록
  let pendingJoinRoomId = new URLSearchParams(location.search).get('room');

  const send = (msg) => window.Net.send(msg);

  /* ---------- 공통 UI ---------- */
  function showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
    $('screen-' + name).classList.add('active');
    window.Widgets.place(name);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  /* ---------- 게임 클라이언트 mount/unmount ---------- */
  function ensureGameMounted(gameId) {
    if (activeGame && activeGame.id === gameId) return activeGame;
    if (activeGame) { try { activeGame.unmount(); } catch (_) {} activeGame = null; }
    const client = window.Games.get(gameId);
    if (!client) { toast('알 수 없는 게임입니다: ' + gameId); return null; }
    client.mount({
      canvas: $('game-canvas'),
      hudSlot: $('game-hud-slot'),
      ctx: { send, toast, myId: clientId, showScreen },
    });
    activeGame = client;
    return client;
  }

  function unmountGame() {
    if (activeGame) { try { activeGame.unmount(); } catch (_) {} activeGame = null; }
  }

  /* ---------- 메시지 처리 ---------- */
  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello_ok':
        myName = msg.name;
        localStorage.setItem('lexio.name', myName);
        window.Net.setHelloName(myName);
        $('input-name').value = myName;
        if (msg.view === 'lobby') { showScreen('lobby'); updateInviteBanner(); }
        break;
      case 'lobby':
        if (msg.games) games = msg.games;
        renderLobby(msg.rooms);
        updateInviteBanner(msg.rooms);
        if (!currentRoom) showScreen('lobby');
        break;
      case 'room': {
        const prevRoom = currentRoom;
        currentRoom = msg.room;
        if (msg.room.games) games = msg.room.games;
        playRoomDiffSounds(prevRoom, msg.room);
        renderRoom(msg.room);
        window.Widgets.update(true);
        window.VoiceChat.handleRoster(msg.room.players.filter((p) => p.inVoice).map((p) => p.id));
        if (msg.room.state !== 'playing') {
          // 게임 화면에서 결과/점수판을 보는 중이면 화면을 유지(게임별로 팝업 id가 다르므로 클라이언트에 위임)
          const resultOpen = activeGame && activeGame.isResultOpen ? activeGame.isResultOpen() : false;
          if (!$('screen-game').classList.contains('active') || !resultOpen) showScreen('room');
        }
        break;
      }
      case 'joined':
        history.replaceState(null, '', location.pathname);
        pendingJoinRoomId = null;
        showScreen('room');
        if (window.Sound) window.Sound.join();
        break;
      case 'left':
      case 'kicked':
        if (msg.type === 'kicked') toast('방에서 강퇴되었습니다.');
        currentRoom = null;
        gameState = null;
        unmountGame();
        showScreen('lobby');
        if (window.Sound) window.Sound.leave();
        window.VoiceChat.reset();
        window.Chat.clear();
        window.Chat.clearBubbles();
        window.Widgets.update(false);
        break;
      case 'need_password': {
        const pw = prompt(msg.wrong ? '비밀번호가 틀렸습니다. 다시 입력하세요.' : '방 비밀번호를 입력하세요.');
        if (pw !== null) send({ type: 'join_room', roomId: msg.roomId, password: pw, name: nameFromInput() });
        break;
      }
      case 'game': {
        gameState = msg.state;
        showScreen('game');
        const client = ensureGameMounted(msg.state.gameId);
        if (!client) break;
        if (client.closeResult) client.closeResult();
        $('game-room-name').textContent = client.topBarText ? client.topBarText(msg.state) : (msg.state.roomName || '');
        client.setState(msg.state);
        window.Widgets.update(true);
        window.VoiceChat.handleRoster((msg.state.players || []).filter((p) => p.inVoice).map((p) => p.id));
        break;
      }
      case 'round_over':
        if (activeGame && activeGame.onRoundOver) activeGame.onRoundOver(msg.result);
        break;
      case 'chat':
        window.Chat.addMessage(msg);
        break;
      case 'voice_signal':
        window.VoiceChat.handleSignal(msg.from, msg.data);
        break;
      case 'error':
        toast(msg.message);
        break;
    }
  }

  /* ---------- 효과음(입퇴장) ---------- */
  function playRoomDiffSounds(prevRoom, nextRoom) {
    if (!window.Sound || !prevRoom || prevRoom.id !== nextRoom.id) return;
    const prevIds = new Set(prevRoom.players.map((p) => p.id));
    const nextIds = new Set(nextRoom.players.map((p) => p.id));
    let joined = false, left = false;
    for (const id of nextIds) if (!prevIds.has(id)) joined = true;
    for (const id of prevIds) if (!nextIds.has(id)) left = true;
    if (joined) window.Sound.join();
    else if (left) window.Sound.leave();
  }

  /* ---------- 이름 ---------- */
  function nameFromInput() {
    const v = $('input-name').value.trim();
    if (v) { myName = v; localStorage.setItem('lexio.name', v); window.Net.setHelloName(v); }
    return myName;
  }

  /* ---------- 초대 배너 ---------- */
  function updateInviteBanner(roomsArr) {
    const banner = $('invite-banner');
    if (!pendingJoinRoomId) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    const found = (roomsArr || []).find((r) => r.id === pendingJoinRoomId);
    $('invite-room-name').textContent = found ? found.name : pendingJoinRoomId;
  }
  $('btn-invite-join').addEventListener('click', () => {
    const name = nameFromInput();
    if (!name) return toast('닉네임을 입력하세요.');
    if (!pendingJoinRoomId) return;
    send({ type: 'join_room', roomId: pendingJoinRoomId, name });
  });

  /* ---------- 로비 ---------- */
  function renderGameOptions(selectEl, selectedId) {
    selectEl.innerHTML = games.map((g) => `<option value="${g.id}"${g.id === selectedId ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
  }

  function renderLobby(roomsArr) {
    const gameSel = $('input-room-game');
    if (gameSel && games.length && !gameSel.dataset.filled) {
      renderGameOptions(gameSel, games[0].id);
      gameSel.dataset.filled = '1';
    }
    const ul = $('room-list');
    ul.innerHTML = '';
    $('room-list-empty').style.display = roomsArr.length ? 'none' : 'block';
    for (const r of roomsArr) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <div class="rname">${r.locked ? '🔒 ' : ''}${esc(r.name)}</div>
          <div class="rmeta">${esc(r.gameName || '')} · ${r.players}/${r.maxPlayers}명 · 코드 ${r.id}</div>
        </div>
        <span class="rstate ${r.state === 'playing' ? 'playing' : ''}">${r.state === 'playing' ? '게임 중' : '대기 중'}</span>`;
      li.addEventListener('click', () => {
        if (r.state === 'playing') return toast('게임이 진행 중인 방입니다.');
        send({ type: 'join_room', roomId: r.id, name: nameFromInput() });
      });
      ul.appendChild(li);
    }
  }

  $('btn-create').addEventListener('click', () => {
    const name = nameFromInput();
    if (!name) return toast('닉네임을 입력하세요.');
    send({
      type: 'create_room',
      playerName: name,
      name: $('input-room-name').value.trim() || name + '의 방',
      password: $('input-room-pw').value,
      gameId: $('input-room-game') ? $('input-room-game').value : undefined,
    });
  });
  $('input-name').addEventListener('change', () => { nameFromInput(); send({ type: 'set_name', name: myName }); });

  /* ---------- 대기실 ---------- */
  function renderRoom(room) {
    $('room-title').textContent = `${room.locked ? '🔒 ' : ''}${room.name} · ${room.game.name} (코드 ${room.id})`;
    const isHost = room.hostId === room.you;
    const me = room.players.find((p) => p.id === room.you);

    const seats = $('room-seats');
    seats.innerHTML = '';
    for (let i = 0; i < room.maxPlayers; i++) {
      const p = room.players[i];
      const div = document.createElement('div');
      if (!p) {
        div.className = 'seat-card empty';
        div.textContent = '빈 자리';
      } else {
        div.className = 'seat-card';
        const tags = [];
        if (p.id === room.hostId) tags.push('<span class="tag host">방장</span>');
        if (p.isBot) tags.push('<span class="tag bot">봇</span>');
        if (p.ready && p.id !== room.hostId) tags.push('<span class="tag ready">준비완료</span>');
        if (!p.isBot && !p.connected) tags.push('<span class="tag off">접속끊김</span>');
        if (p.inVoice) tags.push(`<span class="tag mic-tag${p.micMuted ? ' muted' : ''}">${p.micMuted ? '🔕 음소거' : '🎙️ 음성중'}</span>`);
        if (p.seat) tags.push(`<span class="tag">${esc(p.seat)}</span>`);
        div.innerHTML = `<div class="sname">${esc(p.name)}</div><div class="stags">${tags.join('')}</div>`;
        if (isHost && p.id !== room.you) {
          const btn = document.createElement('button');
          btn.className = 'seat-kick';
          btn.textContent = '✕';
          btn.title = '강퇴';
          btn.addEventListener('click', () => send({ type: p.isBot ? 'remove_bot' : 'kick', playerId: p.id }));
          div.appendChild(btn);
        }
      }
      seats.appendChild(div);
    }

    // 방장 컨트롤: 게임 선택 + 게임별 설정 + 최대 인원
    $('host-controls').style.display = isHost ? 'flex' : 'none';
    const gameSel = $('select-game');
    renderGameOptions(gameSel, room.gameId);
    gameSel.disabled = !isHost;

    const maxSel = $('select-max');
    const { minPlayers, maxPlayers } = room.game;
    maxSel.innerHTML = '';
    for (let n = minPlayers; n <= maxPlayers; n++) {
      maxSel.innerHTML += `<option value="${n}"${n === room.maxPlayers ? ' selected' : ''}>${n}인</option>`;
    }
    maxSel.disabled = !isHost;

    // 게임별 설정 슬롯
    const client = window.Games.get(room.gameId);
    const slot = $('setup-slot');
    slot.innerHTML = '';
    if (client && client.renderSetup) client.renderSetup(slot, room, { isHost, send });

    $('btn-start').style.display = isHost ? 'block' : 'none';
    $('btn-ready').style.display = isHost ? 'none' : 'block';
    if (me) {
      $('btn-ready').textContent = me.ready ? '준비 취소' : '준비';
      $('btn-ready').classList.toggle('on', me.ready);
    }
  }

  $('btn-invite').addEventListener('click', async () => {
    if (!currentRoom) return;
    const url = `${location.origin}${location.pathname}?room=${currentRoom.id}`;
    try { await navigator.clipboard.writeText(url); toast('초대 링크가 복사되었습니다.'); }
    catch (_) { prompt('초대 링크를 복사하세요:', url); }
  });
  $('btn-leave').addEventListener('click', () => send({ type: 'leave_room' }));
  $('btn-game-leave').addEventListener('click', () => {
    if (confirm('게임을 나가면 남은 게임은 봇이 대신합니다. 나가시겠습니까?')) send({ type: 'leave_room' });
  });
  $('select-game').addEventListener('change', () => send({ type: 'set_game', gameId: $('select-game').value }));
  $('select-max').addEventListener('change', () => send({ type: 'set_max', maxPlayers: +$('select-max').value }));
  $('btn-add-bot').addEventListener('click', () => send({ type: 'add_bot' }));
  $('btn-ready').addEventListener('click', () => {
    const me = currentRoom && currentRoom.players.find((p) => p.id === currentRoom.you);
    send({ type: 'ready', ready: !(me && me.ready) });
  });
  $('btn-start').addEventListener('click', () => send({ type: 'start' }));

  /* ---------- 부팅 ---------- */
  window.Modal.init();
  window.Chat.init({
    myId: clientId,
    send,
    getAnchor: (id) => (activeGame && activeGame.bubbleAnchor ? activeGame.bubbleAnchor(id) : null),
  });
  window.Widgets.init({ voice: window.VoiceChat, chat: window.Chat, toast });

  $('input-name').value = myName;
  showScreen('lobby');
  window.Net.connect({ clientId, name: myName, onMessage: handleMessage });
})();
