'use strict';
/**
 * 게임 플러그인 레지스트리. 새 게임은 여기에 엔진 모듈을 등록하면 된다.
 */
const lexio = require('./lexio');
const felicity = require('./felicity');

const engines = { lexio, felicity };

const DEFAULT_GAME = 'lexio';

function getEngine(gameId) {
  return engines[gameId] || engines[DEFAULT_GAME];
}

// 로비 게임 선택용 메타 목록
function listGames() {
  return Object.values(engines).map((e) => ({
    id: e.meta.id,
    name: e.meta.name,
    minPlayers: e.meta.minPlayers,
    maxPlayers: e.meta.maxPlayers,
  }));
}

module.exports = { engines, getEngine, listGames, DEFAULT_GAME };
