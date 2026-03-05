import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../wbrl-stats/worker.js';

const BASE = 'http://example.com';
let roomCounter = 0;

// Each call gets a unique room so tests never share a DO instance
function freshRoom() {
  return `test-room-${++roomCounter}`;
}

async function req(method, path, body, room) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('room', room);
  const init = { method };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const request = new Request(url.toString(), init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('CORS preflight', () => {
  it('OPTIONS returns 200 with CORS headers', async () => {
    const res = await req('OPTIONS', '/stats', null, freshRoom());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('GET /stats', () => {
  it('returns JSON with expected default shape', async () => {
    const res = await req('GET', '/stats', null, freshRoom());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const data = await res.json();
    expect(typeof data.episode).toBe('number');
    expect(typeof data.epsilon).toBe('number');
    expect(typeof data.avgReward).toBe('number');
    expect(Array.isArray(data.recentRewards)).toBe(true);
    expect(Array.isArray(data.stepsRecent)).toBe(true);
  });
});

describe('POST /stats', () => {
  it('updates episode when higher', async () => {
    const room = freshRoom();
    const res = await req('POST', '/stats', { episode: 99 }, room);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.episode).toBe(99);
  });

  it('does not lower episode when posting a smaller value', async () => {
    const room = freshRoom();
    await req('POST', '/stats', { episode: 50 }, room);
    const res = await req('POST', '/stats', { episode: 1 }, room);
    const data = await res.json();
    expect(data.episode).toBeGreaterThanOrEqual(50);
  });

  it('updates epsilon', async () => {
    const room = freshRoom();
    const res = await req('POST', '/stats', { epsilon: 0.42 }, room);
    const data = await res.json();
    expect(data.epsilon).toBe(0.42);
  });

  it('accumulates recentRewards and caps at 20', async () => {
    const room = freshRoom();
    for (let i = 0; i < 25; i++) {
      await req('POST', '/stats', { reward: i }, room);
    }
    const res = await req('GET', '/stats', null, room);
    const data = await res.json();
    expect(data.recentRewards.length).toBeLessThanOrEqual(20);
  });

  it('updates avgReward to a rolling average', async () => {
    const room = freshRoom();
    await req('POST', '/stats', { reward: 10 }, room);
    await req('POST', '/stats', { reward: 20 }, room);
    const res = await req('GET', '/stats', null, room);
    const data = await res.json();
    expect(data.avgReward).toBeGreaterThan(0);
  });

  it('tracks stepsRecent and caps at 3', async () => {
    const room = freshRoom();
    for (let i = 0; i < 5; i++) {
      await req('POST', '/stats', { steps: i * 10 }, room);
    }
    const res = await req('GET', '/stats', null, room);
    const data = await res.json();
    expect(data.stepsRecent.length).toBeLessThanOrEqual(3);
  });

  it('returns CORS header on POST response', async () => {
    const room = freshRoom();
    const res = await req('POST', '/stats', { episode: 1 }, room);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('unknown routes', () => {
  it('GET /unknown returns 404', async () => {
    const res = await req('GET', '/unknown', null, freshRoom());
    expect(res.status).toBe(404);
  });

  it('POST /other returns 404', async () => {
    const res = await req('POST', '/other', {}, freshRoom());
    expect(res.status).toBe(404);
  });
});
