// training_ui.js  (deferred, non-module; initializes immediately)

// LocalStorage keys
const LS = {
  EPISODE: "whbot_episode",
  EPSILON: "whbot_epsilon",
  REWARD_HISTORY: "whbot_reward_history",
  STEPS_HISTORY: "whbot_steps_history"
};

const AVG_WINDOW = 100;
const MAX_POINTS = 1000;

function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(Number).slice(-MAX_POINTS) : [];
  } catch { return []; }
}

function renderTopline(el, episode, rewards, steps, epsilon) {
  const win = rewards.slice(-AVG_WINDOW);
  const avg = win.length ? (win.reduce((a,b)=>a+b,0) / win.length) : 0;
  const avgStr = (avg >= 0 ? "+" : "") + avg.toFixed(1);

  const s = steps.slice(-3);
  const improving = s.length === 3 && s[0] > s[1] && s[1] > s[2];
  const trend = s.length ? s.join(", ") + (improving ? " (improving)" : "") : "—";

  const epsStr = Number.isFinite(epsilon) ? epsilon.toFixed(2) : "1.00";
  el.textContent = `Episode: ${episode} · Avg Reward: ${avgStr} · Steps per run: ${trend} · Epsilon: ${epsStr}`;
}

function note(el, text) {
  const div = document.createElement("div");
  div.className = "rl-log-line rl-log-dim";
  div.textContent = text;
  el.appendChild(div);
}

// ===== Immediate init (DOM is already parsed because of 'defer') =====
(function initUI() {
  const panel   = document.getElementById("rl-ui");
  const body    = document.getElementById("rl-body");
  const btn     = document.getElementById("rl-collapse");
  const topline = document.getElementById("rl-topline");
  const logEl   = document.getElementById("rl-log-stream");
  const chartEl = document.getElementById("rl-chart");

  if (!panel || !body || !btn || !topline || !logEl) {
    console.warn("[RL UI] Missing required elements.");
    return;
  }

  // Persistent state
  let episode = parseInt(localStorage.getItem(LS.EPISODE) || "0", 10);
  let epsilon = parseFloat(localStorage.getItem(LS.EPSILON) || "1.0");
  let rewards = loadArray(LS.REWARD_HISTORY);
  let steps   = loadArray(LS.STEPS_HISTORY);

  // Position above legend
  const place = () => {
    const legend = document.getElementById("legend");
    const h = legend ? legend.getBoundingClientRect().height : 160;
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = `${16 + h + 12}px`;
    panel.style.width = "340px";
    panel.style.maxHeight = "58vh";
    panel.style.overflow = "hidden";
    panel.style.zIndex = "501";
  };
  place();
  window.addEventListener("resize", place);

  // Collapse toggle
  btn.addEventListener("click", () => {
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    btn.setAttribute("aria-expanded", (!open).toString());
    btn.textContent = open ? "Expand" : "Collapse";
  });

  // Chart (optional)
  let chart = null;
  if (window.Chart && chartEl) {
    chart = new window.Chart(chartEl, {
      type: "line",
      data: { labels: rewards.map((_, i) => i + 1),
        datasets: [{ label: "Reward", data: rewards, tension: 0.25, pointRadius: 0 }] },
      options: { responsive: true, animation: false,
        plugins: { legend: { display: false } },
        scales: { x: { display:false }, y: { beginAtZero:false } } }
    });
  } else if (chartEl) {
    chartEl.style.display = "none";
    note(logEl, "Chart disabled (Chart.js not loaded).");
  }

  // Public API exposed to app.js
  const api = {
    setEpisode(n) {
      episode = n;
      localStorage.setItem(LS.EPISODE, String(n));
      renderTopline(topline, episode, rewards, steps, epsilon);
    },
    setEpsilon(eps) {
      epsilon = eps;
      localStorage.setItem(LS.EPSILON, String(eps));
      renderTopline(topline, episode, rewards, steps, epsilon);
    },
    setLastSteps(_steps) { /* no-op for topline */ },
    recordEpisodeReward(reward) {
      rewards.push(Number(reward));
      if (rewards.length > MAX_POINTS) rewards.splice(0, rewards.length - MAX_POINTS);
      localStorage.setItem(LS.REWARD_HISTORY, JSON.stringify(rewards));
      if (chart) {
        const idx = rewards.length;
        chart.data.labels.push(idx);
        chart.data.datasets[0].data.push(reward);
        if (chart.data.labels.length > MAX_POINTS) {
          chart.data.labels.shift(); chart.data.datasets[0].data.shift();
        }
        chart.update();
      }
      renderTopline(topline, episode, rewards, steps, epsilon);
    },
    addStepsLastRun(s) {
      steps.push(Number(s));
      if (steps.length > MAX_POINTS) steps.splice(0, steps.length - MAX_POINTS);
      localStorage.setItem(LS.STEPS_HISTORY, JSON.stringify(steps));
      renderTopline(topline, episode, rewards, steps, epsilon);
    },
    log(message) {
      const ts = new Date().toLocaleTimeString();
      const div = document.createElement("div");
      div.className = "rl-log-line";
      div.textContent = `[${ts}] ${message}`;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  };

  // Expose singleton BEFORE app.js runs
  window.__WarehouseUI = api;
  window.WarehouseTrainingUI = function(){}; // truthy for guards

  // First paint + self-test log so you see activity immediately
  renderTopline(topline, episode, rewards, steps, epsilon);
  api.log("RL UI initialized.");
})();
