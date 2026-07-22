'use strict';
/**
 * 선택적 영속화 계층.
 * - PostgreSQL: 라운드/매치 결과 기록
 * - Redis: 최근 결과 캐시
 * 둘 다 없어도(로컬 개발) 서버는 정상 동작한다.
 */
let redis = null;
let pg = null;

async function initPg() {
  if (!process.env.DATABASE_URL) return;
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (e) => console.error('[pg] pool error:', e.message));
    await pool.query(`
      CREATE TABLE IF NOT EXISTS round_results (
        id SERIAL PRIMARY KEY,
        room_name TEXT NOT NULL,
        round_no INT NOT NULL,
        results JSONB NOT NULL,
        match_over BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    pg = pool;
    console.log('[pg] connected');
  } catch (e) {
    console.error('[pg] init failed, retry in 5s:', e.message);
    setTimeout(initPg, 5000);
  }
}

function initRedis() {
  if (!process.env.REDIS_URL) return;
  try {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 1000, 10000),
    });
    redis.on('error', () => {}); // 연결 오류는 조용히 재시도
    redis.on('connect', () => console.log('[redis] connected'));
  } catch (e) {
    console.error('[redis] init failed:', e.message);
    redis = null;
  }
}

async function init() {
  initRedis();
  await initPg();
}

async function saveRound(roomName, roundNo, results, matchOver) {
  if (pg) {
    try {
      await pg.query(
        'INSERT INTO round_results (room_name, round_no, results, match_over) VALUES ($1,$2,$3,$4)',
        [roomName, roundNo, JSON.stringify(results), !!matchOver]
      );
    } catch (e) {
      console.error('[pg] saveRound failed:', e.message);
    }
  }
  if (redis) {
    try {
      await redis.lpush(
        'lexio:recent_rounds',
        JSON.stringify({ roomName, roundNo, results, matchOver, at: Date.now() })
      );
      await redis.ltrim('lexio:recent_rounds', 0, 199);
    } catch (_) { /* 무시 */ }
  }
}

module.exports = { init, saveRound };
