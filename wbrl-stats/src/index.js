export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const allowed = env.CORS_ALLOW || "*";

    // --- Basic CORS ---
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": allowed,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    const headers = {
      "Access-Control-Allow-Origin": allowed,
      "Content-Type": "application/json"
    };

    // Load stats from KV
    async function load() {
      const data = await env.STATS.get("global", "json");
      return data || { episodes: 0, average_reward: 0, epsilon: null, runs: [], last_update_iso: null };
    }

    // === GET /api/stats ===
    if (req.method === "GET" && url.pathname === "/api/stats") {
      const data = await load();
      return new Response(JSON.stringify(data), { headers });
    }

    // === POST /api/report ===
    if (req.method === "POST" && url.pathname === "/api/report") {
      let body = {};
      try { body = await req.json(); } catch {}

      const reward = Number(body.reward);
      const steps = Number(body.steps);
      const epsilon = Number(body.epsilon ?? NaN);

      if (!Number.isFinite(reward) || !Number.isFinite(steps)) {
        return new Response(JSON.stringify({ error: "invalid payload" }), { status: 400, headers });
      }

      const data = await load();
      data.episodes = (data.episodes || 0) + 1;
      const run = { id: data.episodes, reward, steps, timestamp: new Date().toISOString() };
      data.runs = data.runs || [];
      data.runs.push(run);
      if (data.runs.length > 500) data.runs.shift();

      const totalReward = data.runs.reduce((a, r) => a + r.reward, 0);
      data.average_reward = Number((totalReward / data.runs.length).toFixed(2));
      if (Number.isFinite(epsilon)) data.epsilon = epsilon;
      data.last_update_iso = new Date().toISOString();

      await env.STATS.put("global", JSON.stringify(data));

      return new Response(JSON.stringify({ ok: true, episodes: data.episodes, avg: data.average_reward }), { headers });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
  }
};
