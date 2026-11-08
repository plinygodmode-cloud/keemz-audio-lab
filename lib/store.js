'use strict';

/*
  Persistent key/value store for orders, fulfilment claims and rate limits.

  Backends
  --------
  1. Vercel KV / Upstash Redis over REST (recommended for production).
     Configure either:
        KV_REST_API_URL  + KV_REST_API_TOKEN          (Vercel KV integration)
        UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
     No npm dependency: the REST API is plain HTTPS.

  2. In-memory Map (development only, single instance).
     Enabled automatically outside production, or with
     ALLOW_EPHEMERAL_STORE=true. Never used silently in production:
     `storeInfo().durable` is false and the webhook refuses to fulfil so a
     customer can never pay for something the server cannot remember.

  Order records live for 30 days; fulfilment claims for 14 days, which is
  longer than Paymob's retry window, so a replayed callback can never
  trigger a second delivery.
*/

const ORDER_TTL_SECONDS = 30 * 24 * 60 * 60;
const CLAIM_TTL_SECONDS = 14 * 24 * 60 * 60;

const memory = new Map();

function pruneMemory() {
  if (memory.size < 5000) return;
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt && entry.expiresAt <= now) memory.delete(key);
  }
}

function memorySet(key, value, ttlSeconds, onlyIfAbsent) {
  const existing = memory.get(key);
  if (existing && existing.expiresAt && existing.expiresAt <= Date.now()) memory.delete(key);
  if (onlyIfAbsent && memory.has(key)) return false;
  memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  pruneMemory();
  return true;
}

function memoryGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memoryDelete(key) {
  memory.delete(key);
}

function redisCredentials() {
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function redisCommand(credentials, args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(credentials.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args.map(value => (typeof value === 'number' ? String(value) : value))),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(`KV command failed (${response.status}): ${data.error || 'unknown error'}`);
    }
    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

function storeInfo() {
  const credentials = redisCredentials();
  return {
    backend: credentials ? 'redis-rest' : 'memory',
    durable: Boolean(credentials)
  };
}

/* ------------------------------- orders -------------------------------- */

const orderKey = ref => `kal:order:${ref}`;

async function saveOrder(order, ttlSeconds = ORDER_TTL_SECONDS) {
  const credentials = redisCredentials();
  const payload = JSON.stringify(order);
  if (!credentials) {
    memorySet(orderKey(order.ref), payload, ttlSeconds, false);
    return true;
  }
  await redisCommand(credentials, ['SET', orderKey(order.ref), payload, 'EX', ttlSeconds]);
  return true;
}

async function getOrder(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  const credentials = redisCredentials();
  let raw;
  if (!credentials) {
    raw = memoryGet(orderKey(ref));
  } else {
    raw = await redisCommand(credentials, ['GET', orderKey(ref)]);
  }
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function updateOrder(ref, patch) {
  const current = await getOrder(ref);
  if (!current) return null;
  const merged = { ...current, ...patch, updatedAt: Date.now() };
  await saveOrder(merged);
  return merged;
}

/* ---------------------------- idempotency ------------------------------ */

/**
 * Atomically claim a piece of work (e.g. fulfilling one transaction).
 * Returns true only for the first caller; false for duplicates/replays.
 */
async function claim(key, ttlSeconds = CLAIM_TTL_SECONDS) {
  const credentials = redisCredentials();
  if (!credentials) return memorySet(`kal:claim:${key}`, '1', ttlSeconds, true);
  const result = await redisCommand(credentials, ['SET', `kal:claim:${key}`, '1', 'NX', 'EX', ttlSeconds]);
  return result === 'OK';
}

async function releaseClaim(key) {
  const credentials = redisCredentials();
  if (!credentials) return memoryDelete(`kal:claim:${key}`);
  await redisCommand(credentials, ['DEL', `kal:claim:${key}`]);
  return true;
}

/* ----------------------------- rate limit ------------------------------ */

/**
 * Fixed-window rate limiter. Returns { allowed, remaining, retryAfter }.
 * Failures in the store never block traffic (fail-open) but are logged, so a
 * KV outage cannot take the checkout down.
 */
async function rateLimit(bucket, { limit, windowSeconds }) {
  const key = `kal:rl:${bucket}`;
  const credentials = redisCredentials();
  try {
    if (!credentials) {
      const now = Date.now();
      const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
      const entry = memoryGet(key);
      const state = entry && entry.windowStart === windowStart ? entry : { windowStart, count: 0 };
      state.count += 1;
      memorySet(key, state, windowSeconds * 2, false);
      const remaining = Math.max(0, limit - state.count);
      return {
        allowed: state.count <= limit,
        remaining,
        retryAfter: Math.max(1, Math.ceil((windowStart + windowSeconds * 1000 - now) / 1000))
      };
    }

    const count = Number(await redisCommand(credentials, ['INCR', key]));
    if (count === 1) await redisCommand(credentials, ['EXPIRE', key, windowSeconds]);
    let ttl = Number(await redisCommand(credentials, ['TTL', key]));
    if (!Number.isFinite(ttl) || ttl < 1) {
      await redisCommand(credentials, ['EXPIRE', key, windowSeconds]);
      ttl = windowSeconds;
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter: ttl
    };
  } catch (error) {
    console.error('[keemz] rate limit store error (failing open):', error.message);
    return { allowed: true, remaining: -1, retryAfter: 0 };
  }
}

/** Test helper — clears the in-memory backend. */
function __resetMemory() {
  memory.clear();
}

module.exports = {
  storeInfo,
  saveOrder,
  getOrder,
  updateOrder,
  claim,
  releaseClaim,
  rateLimit,
  ORDER_TTL_SECONDS,
  CLAIM_TTL_SECONDS,
  __resetMemory
};
