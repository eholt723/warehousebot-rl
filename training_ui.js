// training_ui.js
// Single compact RL window: persistent metrics + chart, and session-only logs.
// Auto-initializes and exposes instance on window.__WarehouseUI for app.js to use.

const LS_KEYS = {
  EPISODE: "whbot_episode",
  EPSILON: "whbot_epsilon",
  REWARD_HISTORY: "whbot_reward_history" // array of numbers
};

const AVG_WINDOW = 100;
const MAX_HISTORY_POINTS = 1000;

class WarehouseTrainingUI {
  constructor() {
    // Bind DOM
    this.elEpisode = document.getElementById("rl-episode");
    this.elEpsilon = document.getElementById("rl-epsilon");
    this.elAvgReward = document.getElementById("rl-avg-reward");
    this.elSteps = document.getElementById("rl-steps");
    this.elLog = document.getElementById("rl-log-stream");
    this.elBody = document.getElementById("rl-body");
    this.btnCollapse = document.getElementById("rl-collapse");

    // Collapse handler
    this.btnCollapse?.addEventListener("click", () => {
      const expanded = this.elBody.style.display !== "none";
      this.elBody.style.display = expanded ? "none" : "block";
      this.btnCollapse.setAttribute("aria-expanded", (!expanded).toString());
      this.btnCollapse.textContent = expanded ? "Expand" : "Collapse";
    });

    // Persistent state
    this.episode = parseInt(localStorage.getItem(LS_KEYS.EPISODE) || "0", 10);
    this.epsilon = parseFloat(localStorage.getItem(LS_KEYS.EPSILON) || "1.0");
    this.rewardHistory = this._loadRewardHistory();

    // Chart
    const ctx = document.getElementById("rl-chart");
    this.chart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: this.rewardHistory.map((_, i) => i + 1),
        datasets: [{ label: "Reward", data: this.rewardHistory, tension: 0.25, pointRadius: 0 }],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { display: true } },
        scales: { x: { display: false }, y: { beginAtZero: false } },
      },
    });

    // Session-only logs
    this.sessionLogs = [];

    // Initial paint
    this._render();
  }

  // === API used by app.js ===
  setEpisode(n) {
    this.episode = n;
    localStorage.setItem(LS_KEYS.EPISODE, String(n));
    this._renderEpisode();
  }

  setEpsilon(eps) {
    this.epsilon = eps;
    localStorage.setItem(LS_KEYS.EPSILON, String(eps));
    this._renderEpsilon();
  }

  setLastSteps(steps) {
    this.elSteps.textContent = String(steps);
  }

  recordEpisodeReward(reward) {
    this.rewardHistory.push(Number(reward));
    if (this.rewardHistory.length > MAX_HISTORY_POINTS) {
      this.rewardHistory.splice(0, this.rewardHistory.length - MAX_HISTORY_POINTS);
    }
    localStorage.setItem(LS_KEYS.REWARD_HISTORY, JSON.stringify(this.rewardHistory));

    // Update chart
    const idx = this.rewardHistory.length;
    this.chart.data.labels.push(idx);
    this.chart.data.datasets[0].data.push(reward);
    if (this.chart.data.labels.length > MAX_HISTORY_POINTS) {
      this.chart.data.labels.shift();
      this.chart.data.datasets[0].data.shift();
    }
    this.chart.update();

    // Update rolling avg
    this._renderAvgReward();
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

  // === internals ===
  _render() {
    this._renderEpisode();
    this._renderEpsilon();
    this._renderAvgReward();
    this.setLastSteps(0);
  }
  _renderEpisode(){ this.elEpisode.textContent = String(this.episode); }
  _renderEpsilon(){ this.elEpsilon.textContent = Number.isFinite(this.epsilon) ? this.epsilon.toFixed(2) : "1.00"; }

  _renderAvgReward() {
    const windowed = this.rewardHistory.slice(-AVG_WINDOW);
    const avg = windowed.length ? windowed.reduce((a,b) => a+b, 0) / windowed.length : 0;
    this.elAvgReward.textContent = avg.toFixed(2);
  }

  _loadRewardHistory() {
    try {
      const raw = localStorage.getItem(LS_KEYS.REWARD_HISTORY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(Number).slice(-MAX_HISTORY_POINTS) : [];
    } catch {
      return [];
    }
  }
}

// Auto-init once DOM is ready (Chart.js is already loaded in <head>)
(function initUI(){
  // If elements aren’t present, do nothing (keeps page resilient)
  if (!document.getElementById("rl-ui")) return;
  window.__WarehouseUI = new WarehouseTrainingUI();
  // Also expose class for type checks in app.js if needed
  window.WarehouseTrainingUI = WarehouseTrainingUI;
})();
