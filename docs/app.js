const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const itemsInput = document.getElementById("items");
const submitBtn = document.getElementById("submitItems");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const statsEl = document.getElementById("stats");

let layout, currentState, pathTimer;

async function loadLayout() {
  layout = await fetch("data/layout-01.json").then(r => r.json());
  resetSim();
}

function resetSim() {
  currentState = {
    pos: [0, 0],
    pick_points: [],
    picked: [],
    t: 0
  };
  clearInterval(pathTimer);
  drawFrame(currentState);
  statsEl.textContent = "Simulation idle.";
}

function drawFrame(state) {
  const cellW = canvas.width / layout.cols;
  const cellH = canvas.height / layout.rows;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  for (let r = 0; r <= layout.rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellH);
    ctx.lineTo(canvas.width, r * cellH);
    ctx.stroke();
  }
  for (let c = 0; c <= layout.cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellW, 0);
    ctx.lineTo(c * cellW, canvas.height);
    ctx.stroke();
  }

  // obstacles
  ctx.fillStyle = "rgba(255,255,255,.2)";
  layout.obstacles.forEach(([r, c]) =>
    ctx.fillRect(c * cellW, r * cellH, cellW, cellH)
  );

  // pick points
  ctx.fillStyle = "limegreen";
  state.pick_points.forEach(([r, c]) => {
    ctx.beginPath();
    ctx.arc(c * cellW + cellW / 2, r * cellH + cellH / 2, Math.min(cellW, cellH) / 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // picked points
  ctx.fillStyle = "gold";
  state.picked.forEach(([r, c]) => {
    ctx.beginPath();
    ctx.arc(c * cellW + cellW / 2, r * cellH + cellH / 2, Math.min(cellW, cellH) / 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // agent
  const [r, c] = state.pos;
  ctx.fillStyle = "#00b3ff";
  ctx.beginPath();
  ctx.arc(c * cellW + cellW / 2, r * cellH + cellH / 2, Math.min(cellW, cellH) / 3, 0, Math.PI * 2);
  ctx.fill();
}

// Shipment input
submitBtn.addEventListener("click", () => {
  const userItems = itemsInput.value
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const available = layout.items;
  const newPickPoints = userItems
    .map(name => available[name])
    .filter(Boolean);

  if (newPickPoints.length === 0) {
    alert("No valid items found in warehouse layout.");
    return;
  }

  currentState.pick_points = [...newPickPoints];
  currentState.picked = [];
  drawFrame(currentState);

  statsEl.textContent = `Shipment received: ${userItems.join(", ")}`;
});

startBtn.addEventListener("click", () => {
  if (currentState.pick_points.length === 0) {
    alert("Enter shipment items first.");
    return;
  }
  simulateBotBehavior();
});

resetBtn.addEventListener("click", resetSim);

function simulateBotBehavior() {
  clearInterval(pathTimer);
  pathTimer = setInterval(() => {
    if (currentState.pick_points.length === 0) {
      clearInterval(pathTimer);
      statsEl.textContent = "Shipment completed ✅";
      return;
    }

    const [r, c] = currentState.pos;
    const [tr, tc] = currentState.pick_points[0];

    // Simple greedy step
    let nr = r + Math.sign(tr - r);
    let nc = c + Math.sign(tc - c);

    // avoid obstacles crudely by sidestepping
    if (layout.obstacles.some(([or, oc]) => or === nr && oc === nc)) {
      nc += Math.random() < 0.5 ? 1 : -1;
    }

    currentState.pos = [nr, nc];
    currentState.t++;

    // Reached target
    if (nr === tr && nc === tc) {
      currentState.picked.push(currentState.pick_points.shift());
    }

    drawFrame(currentState);
    statsEl.textContent = `Time: ${currentState.t}`;
  }, 120);
}

loadLayout();
