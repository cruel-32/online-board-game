'use strict';
/**
 * 게임 플러그인 레지스트리. 새 게임은 여기에 엔진 모듈을 등록하면 된다.
 */
const lexio = require('./lexio');
const felicity = require('./felicity');
const uno = require('./uno');
const holdem = require('./holdem');
const seven = require('./seven');
const notthanks = require('./notthanks');
const tetris = require('./tetris');
const tetrisServer = require('./tetris-server');
const tichu = require('./tichu');
const runner = require('./runner');

const engines = { lexio, felicity, uno, holdem, seven, notthanks, tetris, 'tetris-server': tetrisServer, tichu, runner };

// 사용자에게는 노출하지 않지만(로비/방장 게임선택 드롭다운에서 제외) 엔진 자체는 그대로 두는 게임들.
// tetris(클라이언트 권위 버전)는 tetris-server(서버 권위, 사용자에게는 "테트리스"로 노출)와 비교하기 위해
// 코드베이스에는 남겨두되, 최종적으로 서버 권위 버전만 노출하기로 결정해 목록에서만 뺐다.
const HIDDEN_FROM_LOBBY = new Set(['tetris']);

const DEFAULT_GAME = 'lexio';

function getEngine(gameId) {
  return engines[gameId] || engines[DEFAULT_GAME];
}

// 로비 게임 선택용 메타 목록(사용자에게 노출할 게임만)
function listGames() {
  return Object.values(engines)
    .filter((e) => !HIDDEN_FROM_LOBBY.has(e.meta.id))
    .map((e) => ({
      id: e.meta.id,
      name: e.meta.name,
      minPlayers: e.meta.minPlayers,
      maxPlayers: e.meta.maxPlayers,
    }));
}

module.exports = { engines, getEngine, listGames, DEFAULT_GAME };
