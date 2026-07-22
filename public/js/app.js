/**
 * 렉시오 온라인 — 화면 전환 / WebSocket / 로비·대기실 UI / 게임 HUD·팝업.
 */
(function () {
  'use strict';
  const core = window.LexioCore;
  const $ = (id) => document.getElementById(id);

  /* ---------- 식별자/이름 ---------- */
  const clientId =
    localStorage.getItem('lexio.clientId') ||
    (crypto.randomUUID ? crypto.randomUUID() : 'c-' + Math.random().toString(36).slice(2));
  localStorage.setItem('lexio.clientId', clientId);

  let myName = localStorage.getItem('lexio.name') || '';
  let ws = null;
  let currentRoom = null;
  let gameState = null;
  let pendingJoinRoomId = new URLSearchParams(location.search).get('room');
  let reconnectDelay = 500;
  let autoPassEnabled = localStorage.getItem('lexio.autoPass') === '1';
  let autoPassTimer = null;

  /* ---------- 공통 UI ---------- */
  function showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
    $('screen-' + name).classList.add('active');
    placeSideWidgets(name);
  }

  // 대기룸에서는 음성/마이크/채팅 버튼을 초대 링크·나가기 버튼과 같은 줄(헤더 바로 아래 상단)로 옮기고,
  // 게임 화면에서는 원래 자리(우측 상단 고정)로 되돌린다.
  function placeSideWidgets(screenName) {
    const widgets = $('side-widgets');
    if (screenName === 'room') {
      $('room-footer-actions').insertBefore(widgets, $('room-footer-actions').firstChild);
      widgets.classList.add('inline');
    } else {
      $('side-widgets-home').after(widgets);
      widgets.classList.remove('inline');
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // 오토패스 안내: 놓치기 쉬우므로 일반 토스트보다 훨씬 크게 화면 정가운데에 띄운다.
  let autoPassNoticeTimer = null;
  function showAutoPassNotice(msg) {
    const el = $('autopass-notice');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(autoPassNoticeTimer);
    autoPassNoticeTimer = setTimeout(() => el.classList.remove('show'), 1200);
  }

  function openPopup(id) { $(id).classList.remove('hidden'); }
  function closePopup(id) { $(id).classList.add('hidden'); }
  document.querySelectorAll('.popup-close').forEach((b) => {
    b.addEventListener('click', () => closePopup(b.dataset.close));
  });
  // 어시스트/게임룰처럼 'dismissable' 팝업은 배경(팝업 바깥 어두운 영역)을 클릭해도 닫힌다.
  document.querySelectorAll('.popup.dismissable').forEach((p) => {
    p.addEventListener('click', (e) => {
      if (e.target === p) closePopup(p.id);
    });
  });

  /* ---------- WebSocket ---------- */
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
      reconnectDelay = 500;
      send({ type: 'hello', clientId, name: myName });
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      handleMessage(msg);
    };
    ws.onclose = () => {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /* ---------- 효과음: 서버 상태 변화를 이전 값과 비교해 적절한 사운드 재생 ---------- */
  function playRoomDiffSounds(prevRoom, nextRoom) {
    if (!Sound || !prevRoom || prevRoom.id !== nextRoom.id) return;
    const prevIds = new Set(prevRoom.players.map((p) => p.id));
    const nextIds = new Set(nextRoom.players.map((p) => p.id));
    let joined = false, left = false;
    for (const id of nextIds) if (!prevIds.has(id)) joined = true;
    for (const id of prevIds) if (!nextIds.has(id)) left = true;
    if (joined) Sound.join();
    else if (left) Sound.leave();
  }

  function playGameDiffSounds(prevState, nextState) {
    if (!Sound) return;
    // 내 차례 시작: 라운드가 바뀌거나 방을 새로 들어온 경우에도(=이전 차례 정보가 의미 없어도)
    // 지금 상태가 내 차례라면 놓치지 않도록 항상 검사한다.
    const sameContext = prevState && prevState.roomId === nextState.roomId && prevState.roundNo === nextState.roundNo;
    const myTurnNow = nextState.turnId === nextState.you && !nextState.finished;
    const myTurnBefore = sameContext && prevState.turnId === prevState.you && !prevState.finished;
    if (myTurnNow && !myTurnBefore) Sound.myTurn();

    if (!sameContext) return;
    const nt = nextState.table, pt = prevState.table;
    if (nt && (!pt || pt.byId !== nt.byId || pt.tiles.length !== nt.tiles.length ||
        pt.tiles.map((t) => t.id).join() !== nt.tiles.map((t) => t.id).join())) {
      Sound.play();
      return;
    }
    const prevPassed = new Map(prevState.players.map((p) => [p.id, p.passed]));
    for (const p of nextState.players) {
      if (p.passed && !prevPassed.get(p.id)) {
        Sound.pass();
        return;
      }
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello_ok':
        myName = msg.name;
        localStorage.setItem('lexio.name', myName);
        $('input-name').value = myName;
        if (msg.view === 'lobby') {
          showScreen('lobby');
          updateInviteBanner();
        }
        break;
      case 'lobby':
        renderLobby(msg.rooms);
        updateInviteBanner(msg.rooms);
        if (!currentRoom) showScreen('lobby');
        break;
      case 'room': {
        const prevRoom = currentRoom;
        currentRoom = msg.room;
        playRoomDiffSounds(prevRoom, msg.room);
        renderRoom(msg.room);
        updateSideWidgets();
        VoiceChat.handleRoster(msg.room.players.filter((p) => p.inVoice).map((p) => p.id));
        if (msg.room.state !== 'playing') {
          // 게임 화면에서 결과 팝업을 보는 중이면 화면 유지
          if (!$('screen-game').classList.contains('active') || $('result-popup').classList.contains('hidden')) {
            showScreen('room');
          }
        }
        break;
      }
      case 'joined':
        history.replaceState(null, '', location.pathname);
        pendingJoinRoomId = null;
        showScreen('room');
        if (Sound) Sound.join();
        break;
      case 'left':
        currentRoom = null;
        gameState = null;
        clearTimeout(autoPassTimer);
        showScreen('lobby');
        if (Sound) Sound.leave();
        VoiceChat.reset();
        clearChat();
        GameUI.clearChatBubbles();
        updateSideWidgets();
        break;
      case 'kicked':
        currentRoom = null;
        gameState = null;
        clearTimeout(autoPassTimer);
        toast('방에서 강퇴되었습니다.');
        showScreen('lobby');
        if (Sound) Sound.leave();
        VoiceChat.reset();
        clearChat();
        GameUI.clearChatBubbles();
        updateSideWidgets();
        break;
      case 'need_password': {
        const pw = prompt(msg.wrong ? '비밀번호가 틀렸습니다. 다시 입력하세요.' : '방 비밀번호를 입력하세요.');
        if (pw !== null) send({ type: 'join_room', roomId: msg.roomId, password: pw, name: nameFromInput() });
        break;
      }
      case 'game': {
        const prevState = gameState;
        gameState = msg.state;
        playGameDiffSounds(prevState, msg.state);
        closePopup('result-popup');
        showScreen('game');
        if (GameUI.resize) GameUI.resize();
        $('game-room-name').textContent = `${msg.state.roomName} · ${msg.state.roundNo}라운드`;
        GameUI.setState(msg.state);
        updateHudButtons();
        maybeAutoPass();
        updateSideWidgets();
        VoiceChat.handleRoster(msg.state.players.filter((p) => p.inVoice).map((p) => p.id));
        break;
      }
      case 'round_over':
        showResult(msg.result);
        break;
      case 'chat':
        addChatMessage(msg);
        break;
      case 'voice_signal':
        VoiceChat.handleSignal(msg.from, msg.data);
        break;
      case 'error':
        toast(msg.message);
        break;
    }
  }

  function nameFromInput() {
    const v = $('input-name').value.trim();
    if (v) {
      myName = v;
      localStorage.setItem('lexio.name', v);
    }
    return myName;
  }

  function updateInviteBanner(roomsArr) {
    const banner = $('invite-banner');
    if (!pendingJoinRoomId) {
      banner.classList.add('hidden');
      return;
    }
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
  function renderLobby(roomsArr) {
    const ul = $('room-list');
    ul.innerHTML = '';
    $('room-list-empty').style.display = roomsArr.length ? 'none' : 'block';
    for (const r of roomsArr) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <div class="rname">${r.locked ? '🔒 ' : ''}${escapeHtml(r.name)}</div>
          <div class="rmeta">${r.players}/${r.maxPlayers}명 · 코드 ${r.id}</div>
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
      maxPlayers: +$('input-room-max').value,
    });
  });
  $('input-name').addEventListener('change', () => {
    nameFromInput();
    send({ type: 'set_name', name: myName });
  });

  /* ---------- 대기실 ---------- */
  function renderRoom(room) {
    $('room-title').textContent = `${room.locked ? '🔒 ' : ''}${room.name} (코드 ${room.id})`;
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
        tags.push(`<span class="tag">● ${p.chips}점</span>`);
        div.innerHTML = `<div class="sname">${escapeHtml(p.name)}</div><div class="stags">${tags.join('')}</div>`;
        if (isHost && p.id !== room.you) {
          const btn = document.createElement('button');
          btn.className = 'seat-kick';
          btn.textContent = '✕';
          btn.title = '강퇴';
          btn.addEventListener('click', () => {
            send({ type: p.isBot ? 'remove_bot' : 'kick', playerId: p.id });
          });
          div.appendChild(btn);
        }
      }
      seats.appendChild(div);
    }

    $('host-controls').style.display = isHost ? 'flex' : 'none';
    $('select-max').value = String(room.maxPlayers);
    $('chips-value').textContent = room.chipsPerPlayer;
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
    try {
      await navigator.clipboard.writeText(url);
      toast('초대 링크가 복사되었습니다.');
    } catch (_) {
      prompt('초대 링크를 복사하세요:', url);
    }
  });
  $('btn-leave').addEventListener('click', () => send({ type: 'leave_room' }));
  $('btn-game-leave').addEventListener('click', () => {
    if (confirm('게임을 나가면 남은 게임은 봇이 대신합니다. 나가시겠습니까?')) {
      send({ type: 'leave_room' });
    }
  });
  $('select-max').addEventListener('change', () => send({ type: 'set_max', maxPlayers: +$('select-max').value }));
  $('btn-chips-minus').addEventListener('click', () => {
    const cur = currentRoom ? currentRoom.chipsPerPlayer : 50;
    send({ type: 'set_chips', chips: Math.max(50, cur - 10) });
  });
  $('btn-chips-plus').addEventListener('click', () => {
    const cur = currentRoom ? currentRoom.chipsPerPlayer : 50;
    send({ type: 'set_chips', chips: cur + 10 });
  });
  $('btn-add-bot').addEventListener('click', () => send({ type: 'add_bot' }));
  $('btn-ready').addEventListener('click', () => {
    const me = currentRoom && currentRoom.players.find((p) => p.id === currentRoom.you);
    send({ type: 'ready', ready: !(me && me.ready) });
  });
  $('btn-start').addEventListener('click', () => send({ type: 'start' }));

  /* ---------- 음성채팅 / 채팅 위젯 (방·게임 화면 공통) ---------- */
  function updateSideWidgets() {
    const inRoom = !!currentRoom;
    $('side-widgets').classList.toggle('hidden', !inRoom);
    if (!inRoom) $('chat-panel').classList.add('hidden');
    refreshVoiceButtons();
  }

  function refreshVoiceButtons() {
    const voiceBtn = $('btn-voice-toggle');
    const micBtn = $('btn-mic-toggle');
    voiceBtn.textContent = VoiceChat.enabled ? '🔊 음성' : '🔇 음성';
    voiceBtn.classList.toggle('on', VoiceChat.enabled);
    micBtn.disabled = !VoiceChat.enabled;
    micBtn.textContent = VoiceChat.muted ? '🔕' : '🎙️';
    micBtn.classList.toggle('muted', VoiceChat.muted);
  }

  VoiceChat.init({
    myId: clientId,
    send,
    onStateChange: refreshVoiceButtons,
    onError: (m) => toast(m),
  });

  $('btn-voice-toggle').addEventListener('click', async () => {
    if (VoiceChat.enabled) VoiceChat.disable();
    else await VoiceChat.enable();
  });
  $('btn-mic-toggle').addEventListener('click', () => VoiceChat.setMuted(!VoiceChat.muted));

  $('btn-chat-toggle').addEventListener('click', () => {
    const panel = $('chat-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      $('chat-badge').classList.add('hidden');
      $('chat-input').focus();
    }
  });
  $('btn-chat-close').addEventListener('click', () => $('chat-panel').classList.add('hidden'));

  function clearChat() {
    $('chat-messages').innerHTML = '';
    $('chat-badge').classList.add('hidden');
  }

  function addChatMessage(msg) {
    const list = $('chat-messages');
    const row = document.createElement('div');
    row.className = 'chat-msg';
    row.innerHTML = `<span class="cname">${escapeHtml(msg.name)}</span>${escapeHtml(msg.text)}`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    if ($('chat-panel').classList.contains('hidden')) {
      $('chat-badge').classList.remove('hidden');
    }
    // 채팅창과 별개로, 게임 화면에서 상대방 아이콘 옆에 말풍선으로도 잠시 보여준다.
    // 내 메시지는 이미 채팅창에 보이므로 중복 표시하지 않는다.
    if (msg.id !== clientId) GameUI.showChatBubble(msg.id, msg.text);
  }

  function sendChat() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    input.value = '';
  }
  $('btn-chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  /* ---------- 게임 HUD ---------- */
  function updateHudButtons() {
    if (!gameState) return;
    const myTurn = gameState.turnId === gameState.you && !gameState.finished;
    $('btn-pass').disabled = !(myTurn && gameState.table);
    $('btn-play').disabled = !GameUI.canPlaySelection();
  }

  /* ---------- 오토패스: 낼 수 있는 패가 없을 때 자동으로 패스 ---------- */
  $('chk-autopass').checked = autoPassEnabled;
  $('chk-autopass').addEventListener('change', () => {
    autoPassEnabled = $('chk-autopass').checked;
    localStorage.setItem('lexio.autoPass', autoPassEnabled ? '1' : '0');
    maybeAutoPass(); // 켜진 순간 이미 낼 수 없는 상황이면 바로 예약하고, 끄면 예약된 패스를 취소한다
  });

  function maybeAutoPass() {
    clearTimeout(autoPassTimer);
    if (!autoPassEnabled || !gameState) return;
    const myTurn = gameState.turnId === gameState.you && !gameState.finished;
    // 선(先)일 때는 항상 낼 수 있는 패가 있으므로(테이블이 비어 있음) 오토패스 대상이 아니다.
    if (!myTurn || !gameState.table) return;
    if (!GameUI.playable || GameUI.playable.size > 0) return;

    showAutoPassNotice('낼 수 있는 패가 없어 자동으로 패스합니다');
    autoPassTimer = setTimeout(() => {
      const stillMyTurn = gameState && gameState.turnId === gameState.you && !gameState.finished;
      if (autoPassEnabled && stillMyTurn && gameState.table && GameUI.playable && GameUI.playable.size === 0) {
        send({ type: 'pass' });
        GameUI.selected.clear();
      }
    }, 1000);
  }

  $('btn-play').addEventListener('click', () => {
    if (!GameUI.canPlaySelection()) return;
    send({ type: 'play', tileIds: [...GameUI.selected] });
    GameUI.selected.clear();
  });
  $('btn-pass').addEventListener('click', () => {
    clearTimeout(autoPassTimer);
    send({ type: 'pass' });
    GameUI.selected.clear();
  });
  $('btn-sort').addEventListener('click', () => GameUI.sortHand());
  $('btn-assist').addEventListener('click', () => {
    renderAssist();
    openPopup('assist-popup');
  });
  $('btn-rules').addEventListener('click', () => openPopup('rules-popup'));

  /* ---------- 어시스트 팝업 ---------- */
  function miniTileHtml(t) {
    const top = t.num === 2 ? ' mini-tile-top' : '';
    return `<span class="mini-tile ${t.suit}${top}">${t.num}<small>${core.SUIT_SYMBOL[t.suit]}</small></span>`;
  }

  function renderAssist() {
    if (!gameState) return;
    const body = $('assist-body');
    body.innerHTML = '';
    const hand = gameState.hand;
    const maxN = gameState.maxN;
    // 손패 타일 비활성화 표시와 같은 기준: 내 차례가 아니면 판단 불가하니 비활성화하지 않고,
    // 내 차례라면 테이블의 현재 조합과 개수가 같고 더 높아야 낼 수 있는 조합으로 간주한다.
    const myTurn = GameUI.isMyTurn();
    const cur = GameUI.currentCombo();
    const groupsDef = [
      ['pair', '페어'], ['triple', '트리플'],
      ['straight', '스트레이트'], ['flush', '플러쉬'],
      ['fullhouse', '풀하우스'], ['four', '포카드'], ['straightflush', '스트레이트플러쉬'],
    ];
    let all = [];
    for (const c of [2, 3, 5]) all = all.concat(core.enumeratePlays(hand, c, maxN));
    let any = false;
    for (const [type, label] of groupsDef) {
      const combos = all.filter((c) => c.type === type);
      if (!combos.length) continue;
      any = true;
      combos.sort((a, b) => core.cmpRank(a.rank, b.rank));
      const title = document.createElement('div');
      title.className = 'assist-group-title';
      title.textContent = `${label} (${combos.length})`;
      body.appendChild(title);
      for (const c of combos.slice(0, 30)) {
        const row = document.createElement('div');
        const playable = !myTurn || !cur || (c.count === cur.count && core.beats(c, cur));
        row.className = 'assist-row' + (playable ? '' : ' assist-row-disabled');
        row.innerHTML = c.tiles.map(miniTileHtml).join('');
        row.addEventListener('click', () => {
          GameUI.selectTiles(c.tiles.map((t) => t.id));
          closePopup('assist-popup');
          updateHudButtons();
        });
        body.appendChild(row);
      }
      if (combos.length > 30) {
        const more = document.createElement('div');
        more.className = 'assist-empty';
        more.textContent = `… 외 ${combos.length - 30}개`;
        body.appendChild(more);
      }
    }
    if (!any) body.innerHTML = '<div class="assist-empty">만들 수 있는 조합(2개 이상)이 없습니다. 싱글로 승부하세요!</div>';
  }

  /* ---------- 결과 팝업 ---------- */
  function showResult(result) {
    $('result-title').textContent = result.matchOver
      ? `🏁 매치 종료 (${result.roundNo}라운드)`
      : `${result.roundNo}라운드 결과`;
    const body = $('result-body');
    const rows = result.rows
      .map((r) => {
        const deltaCls = r.delta > 0 ? 'delta-plus' : r.delta < 0 ? 'delta-minus' : '';
        const deltaTxt = (r.delta > 0 ? '+' : '') + r.delta;
        const twoNote = r.twos ? ` (2×${r.twos} → ${r.eff}장 계산)` : '';
        return `<tr class="r${r.rank}">
          <td>${r.rank}등</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.remaining}장${twoNote}</td>
          <td class="${deltaCls}">${deltaTxt}</td>
          <td>${r.chips}</td>
        </tr>`;
      })
      .join('');
    let extra = '';
    if (result.matchOver) {
      const champion = result.rows.slice().sort((a, b) => b.chips - a.chips)[0];
      extra = `<div class="result-busted">💥 칩 소진: ${result.bustedNames.map(escapeHtml).join(', ')}</div>
               <div class="result-champion">🏆 최다 칩 보유: ${escapeHtml(champion.name)} (${champion.chips}점)</div>`;
    }
    body.innerHTML = `<table class="result-table">
      <tr><th>순위</th><th>이름</th><th>남은 타일</th><th>칩 변동</th><th>보유 칩</th></tr>
      ${rows}</table>${extra}`;
    $('btn-result-ready').textContent = result.matchOver ? '다시 게임 준비' : '준비 완료';
    // 매치가 완전히 끝났을 때(칩 소진자 발생)만 대기실로 나가는 버튼을 보여준다.
    // 단순히 한 라운드만 끝난 경우엔 바로 다음 라운드로 이어지므로 숨긴다.
    $('btn-result-room').style.display = result.matchOver ? 'block' : 'none';
    openPopup('result-popup');
  }

  $('btn-result-ready').addEventListener('click', () => {
    send({ type: 'ready', ready: true });
    $('btn-result-ready').textContent = '다른 플레이어 대기 중…';
    $('btn-result-ready').disabled = true;
    setTimeout(() => { $('btn-result-ready').disabled = false; }, 1500);
  });
  $('btn-result-room').addEventListener('click', () => {
    closePopup('result-popup');
    showScreen('room');
  });

  /* ---------- 시작 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  GameUI.init($('game-canvas'), {
    onSelectionChange: updateHudButtons,
  });
  $('input-name').value = myName;
  showScreen('lobby');
  connect();
})();
