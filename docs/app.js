// DOM
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const itemSelectorDiv = document.getElementById("itemSelector");
const submitBtn = document.getElementById("submitItems");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const statsEl = document.getElementById("stats");

// State
let layout = null;
let currentState = null;
let pathTimer = null;

// Init
(async function init(){
  layout = await fetch("data/layout-01.json").then(r => r.json());
  buildItemSelector(layout.items);
  resetSim();
})();

// ---------- UI ----------
function buildItemSelector(itemsObj){
  // ItemsObj like { "A":[r,c], ..., "J":[r,c] }
  const keys = Object.keys(itemsObj).sort(); // A..J
  itemSelectorDiv.innerHTML = keys.map(k => {
    const [r,c] = itemsObj[k];
    return `
      <label class="item-chip" title="Row ${r}, Col ${c}">
        <input type="checkbox" value="${k}" />
        <strong>${k}</strong>
        <span>(${r},${c})</span>
      </label>`;
  }).join("");
}

selectAllBtn.addEventListener("click", ()=>{
  itemSelectorDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
});

clearAllBtn.addEventListener("click", ()=>{
  itemSelectorDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
});

submitBtn.addEventListener("click", ()=>{
  const selected = Array.from(itemSelectorDiv.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  if (selected.length === 0) {
    alert("Select at least one item (A–J).");
    return;
  }

  // Translate labels -> coordinates
  const picks = selected.map(label => layout.items[label]).filter(Boolean);
  currentState.pick_points = picks.map(p => [...p]); // clone
  currentState.pick_labels = selected.slice();       // labels in same order
  currentState.picked = [];
  currentState.t = 0;

  drawFrame();
  statsEl.textContent = `Shipment: ${selected.join(", ")} | Items left: ${currentState.pick_points.length}`;
});

// ---------- Sim control ----------
startBtn.addEventListener("click", ()=>{
  if (!currentState.pick_points || currentState.pick_points.length === 0) {
    alert("Pick items first (Update Shipment).");
    return;
  }
  simulateGreedyWithSidestep();
});

resetBtn.addEventListener("click", resetSim);

function resetSim(){
  clearInterval(pathTimer);
  pathTimer = null;
  currentState = {
    pos: layout.start ? [...layout.start] : [0,0],
    pick_points: [],
    pick_labels: [],
    picked: [],
    t: 0,
    path_len: 0
  };
  drawFrame();
  statsEl.textContent = "Simulation idle.";
}

// ---------- Drawing ----------
function drawFrame(){
  const cellW = canvas.width / layout.cols;
  const cellH = canvas.height / layout.rows;

  ctx.clearRect(0,0,canvas.width,canvas.height);

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  for (let r=0; r<=layout.rows; r++){
    ctx.beginPath(); ctx.moveTo(0, r*cellH); ctx.lineTo(canvas.width, r*cellH); ctx.stroke();
  }
  for (let c=0; c<=layout.cols; c++){
    ctx.beginPath(); ctx.moveTo(c*cellW, 0); ctx.lineTo(c*cellW, canvas.height); ctx.stroke();
  }

  // obstacles
  ctx.fillStyle = "rgba(255,255,255,.22)";
  layout.obstacles.forEach(([r,c])=>{
    ctx.fillRect(c*cellW, r*cellH, cellW, cellH);
  });

  // items: draw all A-J labels in light green; highlight active picks in bright green
  const allItems = layout.items;
  Object.entries(allItems).forEach(([label, [r,c]])=>{
    drawLabeledMarker(r, c, label, "rgba(0,200,0,.6)", "#e9ecff");
  });

  // Draw picked (gold)
  ctx.save();
  currentState.picked.forEach(({coord:[r,c], label})=>{
    drawLabeledMarker(r, c, label, "gold", "#1a1a1a");
  });
  ctx.restore();

  // agent
  const [ar, ac] = currentState.pos;
  ctx.fillStyle = "#00b3ff";
  ctx.beginPath();
  ctx.arc(ac*cellW + cellW/2, ar*cellH + cellH/2, Math.min(cellW,cellH)/3, 0, Math.PI*2);
  ctx.fill();
}

function drawLabeledMarker(r, c, label, fill = "limegreen", textColor = "#000"){
  const cellW = canvas.width / layout.cols;
  const cellH = canvas.height / layout.rows;
  const rad = Math.min(cellW,cellH)/3.2;

  // circle
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c*cellW + cellW/2, r*cellH + cellH/2, rad, 0, Math.PI*2);
  ctx.fill();

  // text label
  ctx.fillStyle = textColor;
  ctx.font = `${Math.floor(rad*1.2)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, c*cellW + cellW/2, r*cellH + cellH/2);
}

// ---------- Simple movement (placeholder for RL) ----------
function simulateGreedyWithSidestep(){
  clearInterval(pathTimer);
  const stepMs = 100;

  pathTimer = setInterval(()=>{
    if (currentState.pick_points.length === 0){
      clearInterval(pathTimer);
      statsEl.textContent = `Shipment completed ✅ | Time: ${currentState.t} | Path length: ${currentState.path_len}`;
      return;
    }

    const [tr, tc] = currentState.pick_points[0];
    const label = currentState.pick_labels[0];
    const [r, c] = currentState.pos;

    // move 1 step toward target
    let nr = r + Math.sign(tr - r);
    let nc = c + Math.sign(tc - c);

    // crude obstacle avoidance: if blocked, try lateral sidestep
    if (isObstacle(nr, nc)){
      // try horizontal sidestep first
      const opts = [
        [r, c + 1],
        [r, c - 1],
        [r + 1, c],
        [r - 1, c]
      ];
      const candidate = opts.find(([rr,cc]) => !isObstacle(rr, cc) && inBounds(rr,cc));
      if (candidate){
        [nr, nc] = candidate;
      } else {
        // stuck: wait (no move)
        nr = r; nc = c;
      }
    }

    // apply move
    if (nr !== r || nc !== c) currentState.path_len += 1;
    currentState.pos = [nr, nc];
    currentState.t += 1;

    // reached target
    if (nr === tr && nc === tc){
      currentState.picked.push({ coord: [tr, tc], label });
      currentState.pick_points.shift();
      currentState.pick_labels.shift();
    }

    drawFrame();
    statsEl.textContent = `Time: ${currentState.t} | Path length: ${currentState.path_len} | Items left: ${currentState.pick_points.length}`;
  }, stepMs);
}

function isObstacle(r,c){
  return layout.obstacles.some(([or,oc]) => or === r && oc === c);
}

function inBounds(r,c){
  return r >= 0 && r < layout.rows && c >= 0 && c < layout.cols;
}
