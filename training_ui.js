// training_ui.js
// Single compact panel: persisted topline + tiny chart + session console.
// Also auto-positions above the legend.

const LS = {
  EPISODE: "whbot_episode",
  EPSILON: "whbot_epsilon",
  REWARD_HISTORY: "whbot_reward_history",   // number[]
  STEPS_HISTORY: "whbot_steps_history"      // number[]
};

const AVG_WINDOW = 100;
const MAX_POINTS = 1000;

class WarehouseTrainingUI {
  constructor() {
    // DOM
    this.elTopline = document.getElementById("rl-topline");
    this.elLog = document.getElementById("rl-log-stream");
    this.elBody = document.getElementById("rl-body");
    this.btnCollapse = document.getElementById("rl-collapse");
    this.panel = document.getElementById("rl-ui");

    // Persistent state
    this.episode = parseInt(localStorage.getItem(LS.EPISODE) || "0", 10);
    this.epsilon = parseFloat(localStorage.getItem(LS.EPSILON) || "1.0");
    this.rewards = this._loadArray(LS.REWARD_HISTORY);
    this.stepsHistory = this._loadArray(LS.STEPS_HISTORY);

    // Chart
    const ctx = document.getElementById("rl-chart");
    this.chart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: this.rewards.map((_, i) => i + 1),
        datasets: [{ label: "Reward", data: this.rewards, tension: 0.25, pointRadius: 0 }],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { beginAtZero: false } }
      },
    });

    // Collapse
    this.btnCollapse?.addEventListener("click", () => {
      const expanded = this.elBody.style.display !== "none";
      this.elBody.style.display = expanded ? "none" : "block";
      this.btnCollapse.setAttribute("aria-expanded", (!expanded).toString());
      this.btnCollapse.textContent = expanded ? "Expand" : "Collapse";
    });

    // Place above the legend
    const place = () => {
      const legend = document.getElementById("legend");
      const lgH = legend ? legend.getBoundingClientRect().height : 160;
      this.panel.style.bottom = `${16 + lgH + 12}px`;
    };
    place();
    window.addEventListener("resize", place);

    // Session-only logs
    this.sessionLogs = [];

    // Paint topline now
    this._renderTopline();
  }

  // ========== API used from app.js ==========
  setEpisode(n) {
    this.episode = n;
    localStorage.setItem(LS.EPISODE, String(n));
    this._renderTopline();
  }

  setEpsilon(eps) {
    this.epsilon = eps;
    localStorage.setItem(LS.EPSILON, String(eps));
    this._renderTopline();
  }

  setLastSteps(steps) {
    // only session display uses steps granularly; topline uses history on episode end
    // noop here
  }

  recordEpisodeReward(reward) {
    // called on EPISODE END — we’ll also expect caller to push the steps count via addStepsLastRun
    this.rewards.push(Number(reward));
    if (this.rewards.length > MAX_POINTS) this.rewards.splice(0, this.rewards.length - MAX_POINTS);
    localStorage.setItem(LS.REWARD_HISTORY, JSON.stringify(this.rewards));

    // chart
    const idx = this.rewards.length;
    this.chart.data.labels.push(idx);
    this.chart.data.datasets[0].data.push(reward);
    if (this.chart.data.labels.length > MAX_POINTS) {
      this.chart.data.labels.shift();
      this.chart.data.datasets[0].data.shift();
    }
    this.chart.update();
    this._renderTopline();
  }

  addStepsLastRun(steps) {
    this.stepsHistory.push(Number(steps));
    if (this.stepsHistory.length > MAX_POINTS) this.stepsHistory.splice(0, this.stepsHistory.length - MAX_POINTS);
    localStorage.setItem(LS.STEPS_HISTORY, JSON.stringify(this.stepsHistory));
    this._renderTopline();
  }

  log(message) {
    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${message}`;
    this.sessionLogs.push(line);
    const div = document.createElement("div");
    div.className = "rl-log-line";
    div.textContent = line;
    this.elLog.appendChild(div);
    this.elLog.scrollTop = this.elLog.scrollHeight;
  }

  // ========== internals ==========
  _renderTopline() {
    const ep = this.episode;

    // avg reward over last window
    const win = this.rewards.slice(-AVG_WINDOW);
    const avg = win.length ? (win.reduce((a,b)=>a+b,0) / win.length) : 0;

    // steps trend: last 3 values if present
    const last3 = this.stepsHistory.slice(-3);
    let trend = "";
    if (last3.length === 3) {
      const [a,b,c] = last3;
      const improving = a > b && b > c;
      trend = `${a} \u2192 ${b} \u2192 ${c}` + (improving ? " (improving)" : "");
    } else if (last3.length > 0) {
      trend = last3.join(" \u2192 ");
    } else {
      trend = "—";
    }

    const epsStr = Number.isFinite(this.epsilon) ? this.epsilon.toFixed(2) : "1.00";
    const avgStr = (avg >= 0 ? "+" : "") + avg.toFixed(1);

    this.elTopline.textContent =
      `Episode: ${ep} · Avg Reward: ${avgStr} · Steps per run: ${trend} · Epsilon: ${epsStr}`;
  }

  _loadArray(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a.map(Number).slice(-MAX_POINTS) : [];
    } catch { return []; }
  }
}

// Singleton
window.__WarehouseUI = window.__WarehouseUI || new WarehouseTrainingUI();
// Leave the class available (app.js checks this symbol)
window.WarehouseTrainingUI = WarehouseTrainingUI;
