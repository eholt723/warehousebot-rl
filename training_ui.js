// training_ui.js
const LS_KEYS = {
  EPISODE: "whbot_episode",
  EPSILON: "whbot_epsilon",
  REWARD_HISTORY: "whbot_reward_history",   // array of numbers
  QTAB: "whbot_qtable"                       // optional: your policy/Q-table
};

// A small rolling window for the avg reward calc that persists
const AVG_WINDOW = 100;
// Hard cap history so localStorage doesn't bloat
const MAX_HISTORY_POINTS = 1000;

class TrainingUI {
  constructor() {
    // DOM
    this.elEpisode = document.getElementById("rl-episode");
    this.elEpsilon = document.getElementById("rl-epsilon");
    this.elAvgReward = document.getElementById("rl-avg-reward");
    this.elSteps = document.getElementById("rl-steps");
    this.elLog = document.getElementById("rl-log-stream");
    this.bodyMetrics = document.getElementById("rl-metrics");
    this.bodyLogs = document.getElementById("rl-logs-body");

    // Collapsers
    document.getElementById("rl-collapse-metrics")?.addEventListener("click", () => {
      const expanded = this.bodyMetrics.style.display !== "none";
      this.bodyMetrics.style.display = expanded ? "none" : "block";
      const btn = document.getElementById("rl-collapse-metrics");
      btn.setAttribute("aria-expanded", (!expanded).toString());
      btn.textContent = expanded ? "Expand" : "Collapse";
    });

    document.getElementById("rl-collapse-logs")?.addEventListener("click", () => {
      const expanded = this.bodyLogs.style.display !== "none";
      this.bodyLogs.style.display = expanded ? "none" : "block";
      const btn = document.getElementById("rl-collapse-logs");
      btn.setAttribute("aria-expanded", (!expanded).toString());
      btn.textContent = expanded ? "Expand" : "Collapse";
    });

    // Policy buttons (wire to your own save/load if you prefer)
    document.getElementById("rl-save-policy")?.addEventListener("click", () => this.savePolicy());
    document.getElementById("rl-load-policy")?.addEventListener("click", () => this.loadPolicy());
    document.getElementById("rl-reset-persist")?.addEventListener("click", () => this.resetPersistentState());

    // State (persistent)
    this.episode = parseInt(localStorage.getItem(LS_KEYS.EPISODE) || "0", 10);
    this.epsilon = parseFloat(localStorage.getItem(LS_KEYS.EPSILON) || "1.0");
    this.rewardHistory = this._loadRewardHistory();

    // Session-only
    this.sessionLogs = [];

    // Chart
    const ctx = document.getElementById("rl-chart");
    this.chart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: this.rewardHistory.map((_, i) => i + 1),
        datasets: [
          { label: "Reward", data: this.rewardHistory, tension: 0.25, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { display: true } },
        scales: { x: { display: false }, y: { beginAtZero: false } },
      },
    });

    // Initial render
    this._render();
  }

  // === Hooks you can call from your RL loop ===

  setEpisode(n) {
    this.episode = n;
    localStorage.setItem(LS_KEYS.EPISODE, String(this.episode));
    this._renderEpisode();
  }

  setEpsilon(eps) {
    this.epsilon = eps;
    localStorage.setItem(LS_KEYS.EPSILON, String(this.epsilon));
    this._renderEpsilon();
  }

  setLastSteps(steps) {
    this.elSteps.textContent = String(steps);
  }

  recordEpisodeReward(reward) {
    // Update persistent reward history, capped
    this.rewardHistory.push(Number(reward));
    if (this.rewardHistory.length > MAX_HISTORY_POINTS) {
      this.rewardHistory.splice(0, this.rewardHistory.length - MAX_HISTORY_POINTS);
    }
    localStorage.setItem(LS_KEYS.REWARD_HISTORY, JSON.stringify(this.rewardHistory));

    // Update chart
    const idx = this.rewardHistory.length;
    this.chart.data.labels.push(idx);
    this.chart.data.datasets[0].data.push(reward);
    // Keep chart size in sync with cap
    if (this.chart.data.labels.length > MAX_HISTORY_POINTS) {
      this.chart.data.labels.shift();
      this.chart.data.datasets[0].data.shift();
    }
    this.chart.update();

    // Update rolling average
    this._renderAvgReward();
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${message}`;
    this.sessionLogs.push(line);
    const div = document.createElement("div");
    div.className = "rl-log-line";
    div.textContent = line;
    this.elLog.appendChild(div);
    this.elLog.scrollTop = this.elLog.scrollHeight;
  }

  // Optional convenience for your Q-table/weights
  saveQTable(qTable) {
    try {
      localStorage.setItem(LS_KEYS.QTAB, JSON.stringify(qTable));
      this.log("Saved policy to localStorage.");
    } catch (e) {
      this.log("Failed to save policy: " + e.message);
    }
  }
  loadQTable() {
    const raw = localStorage.getItem(LS_KEYS.QTAB);
    if (!raw) return null;
    try {
      const table = JSON.parse(raw);
      this.log("Loaded policy from localStorage.");
      return table;
    } catch (e) {
      this.log("Failed to parse saved policy.");
      return null;
    }
  }

  // === Buttons: default behavior (replace if you prefer custom I/O) ===
  savePolicy() {
    // No-op here; you supply your qTable object to save:
    // ui.saveQTable(qTable)
    this.log("Tip: call ui.saveQTable(qTable) from your code to persist weights.");
  }

  loadPolicy() {
    // No-op here; you receive saved table and rehydrate your agent:
    // const saved = ui.loadQTable(); if (saved) qTable = saved;
    this.log("Tip: const saved = ui.loadQTable(); if (saved) qTable = saved;");
  }

  resetPersistentState() {
    localStorage.removeItem(LS_KEYS.EPISODE);
    localStorage.removeItem(LS_KEYS.EPSILON);
    localStorage.removeItem(LS_KEYS.REWARD_HISTORY);
    // keep policy unless you want to delete it too:
    // localStorage.removeItem(LS_KEYS.QTAB);

    this.episode = 0;
    this.epsilon = 1.0;
    this.rewardHistory = [];
    this.chart.data.labels = [];
    this.chart.data.datasets[0].data = [];
    this.chart.update();
    this._render();
    this.log("Persistent episode/epsilon/reward history cleared.");
  }

  // === Internals ===
  _render() {
    this._renderEpisode();
    this._renderEpsilon();
    this._renderAvgReward();
    this.setLastSteps(0);
  }

  _renderEpisode() { this.elEpisode.textContent = String(this.episode); }
  _renderEpsilon() { this.elEpsilon.textContent = this.epsilon.toFixed(2); }

  _renderAvgReward() {
    const windowed = this.rewardHistory.slice(-AVG_WINDOW);
    const avg = windowed.length
      ? windowed.reduce((a, b) => a + b, 0) / windowed.length
      : 0;
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

// Make available for your training loop
window.WarehouseTrainingUI = TrainingUI;
