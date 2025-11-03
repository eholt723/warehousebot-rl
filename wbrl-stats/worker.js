export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(req.url);
    const room = url.searchParams.get("room") || "prod";
    const id = env.RL_STATE.idFromName(room);
    const obj = env.RL_STATE.get(id);
    return obj.fetch(req, cors);
  },
};

export class RLState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      this.data = (await this.state.storage.get("data")) || {
        episode: 0,
        epsilon: 1.0,
        avgReward: 0,
        recentRewards: [],
        stepsRecent: [],
        updatedAt: 0,
      };
    });
  }

  async fetch(req, cors) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/stats") {
      return new Response(JSON.stringify(this.data), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    if (req.method === "POST" && url.pathname === "/stats") {
      const body = await req.json();
      const d = this.data;

      // monotonic episode
      if (typeof body.episode === "number" && body.episode > d.episode) {
        d.episode = body.episode;
      }
      if (typeof body.epsilon === "number") d.epsilon = body.epsilon;

      // rolling avg (last 20)
      if (typeof body.reward === "number") {
        d.recentRewards.push(body.reward);
        if (d.recentRewards.length > 20) d.recentRewards.shift();
        d.avgReward =
          d.recentRewards.reduce((a, b) => a + b, 0) / d.recentRewards.length;
      }

      // keep last 3 step counts
      if (typeof body.steps === "number") {
        d.stepsRecent.push(body.steps);
        if (d.stepsRecent.length > 3) d.stepsRecent.shift();
      }

      d.updatedAt = Date.now();
      await this.state.storage.put("data", d);

      return new Response(JSON.stringify(d), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
