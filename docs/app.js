// ===== DOM =====
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn  = document.getElementById("clearAllBtn");
const submitBtn    = document.getElementById("submitItems");
const startBtn     = document.getElementById("startBtn");
const resetBtn     = document.getElementById("resetBtn");
const statsEl      = document.getElementById("stats");

// Map picker (add a <select id="mapSelect"> and <button id="loadMapBtn"> in your HTML near the top controls)
const mapSelect    = document.getElementById("mapSelect");
const loadMapBtn   = document.getElementById("loadMapBtn");

// ===== Global state =====
let layout = null;
let state  = null;
let tickTimer = null;
let peopleTick = 0;        // people move half as often as the bot
let currentPath = [];      // A* path cache (array of [r,c])

// "Learned waiting/tempo" heuristic
let waitTicks = 0;
const WAIT_MAX = 3;        // up to N ticks to wait if the path is only human-blocked (tuneable)

// ===== Boot =====
(async function init(){
  await loadLayout("layout-01.json"); // default
  buildItemSelector(layout.items);
  attachControlHandlers();
  attachMapHandlers();
  resetSim();
})();

async function loadLayout(fileName){
  try {
    const res = await fetch(`data/${fileName}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    layout = await res.json();
  } catch (err) {
    console.error("Layout load error:", err);
    alert(`Error loading ${fileName}: ${err.message}`);
    return;
  }
}

// ===== Map Picker =====
function attachMapHandlers(){
  if (!mapSelect || !loadMapBtn) return;

  // Populate options if not present
  if (mapSelect.children.length === 0) {
    ["layout-01.json", "layout-02.json", "layout-03.json"].forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.replace(".json","");
      mapSelect.appendChild(opt);
    });
  }

  loadMapBtn.addEventListener("click", async () => {
    clearInterval(tickTimer);
    const chosen = mapSelect.value;
    await loadLayout(chosen);
    buildItemSelector(layout.items);
    resetSim();
    statsEl.textContent = `Map loaded: ${chosen}. Ready.`;
  });
}

// ===== UI: letter buttons A–J =====
function buildItemSelector(itemsObj) {
  const container = document.getElementById("itemButtons");
  if (!container) return;
  container.innerHTML = "";
  Object.keys(itemsObj).sort().forEach(label => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "item-btn";
    btn.dataset.item = label;
    btn.onclick = () => btn.classList.toggle("selected");
    container.appendChild(btn);
  });
}

function attachControlHandlers(){
  selectAllBtn?.addEventListener("click", () => {
    document.querySelectorAll(".item-btn").forEach(b => b.classList.add("selected"));
  });
  clearAllBtn?.addEventListener("click", () => {
    document.querySelectorAll(".item-btn").forEach(b => b.classList.remove("selected"));
  });

  // --- User submits shipment (keep visible order; plan secretly) ---
  submitBtn?.addEventListener("click", () => {
    const selected = Array.from(document.querySelectorAll(".item-btn.selected"))
      .map(b => b.dataset.item);

    if (selected.length === 0) {
      alert("Select at least one item (A–J).");
      return;
    }

    // Keep what the user sees (do NOT change this order in UI):
    state.displayOrder = selected.slice();

    // Secret internal plan: smarter sequencing (nearest-neighbor + 2-opt polish) from the dock
    const nnOrder = orderByNearestNeighbor(selected, layout.items, layout.dock);
    const planned = twoOptImprove(nnOrder, layout.items, layout.dock);

    // Navigation uses the planned order
    state.orderLabels = planned;
    state.orderCoords = planned.map(s => layout.items[s]);

    // Reset run state
    state.picked = [];
    state.pathLen = 0;
    state.time = 0;
    state.delivered = false;
    state.phase = "picking";
    currentPath = [];
    waitTicks = 0;

    // Keep UI neutral—don’t reveal reordering
    draw();
    statsEl.textContent = `Shipment ready. Items left: ${state.orderCoords.length}`;
  });

  startBtn?.addEventListener("click", () => {
    if (!state.orderCoords || state.orderCoords.length === 0) {
      alert("Pick items first (Update Shipment).");
      return;
    }
    run();
  });

  resetBtn?.addEventListener("click", resetSim);
}

// ===== Simulation core =====
function resetSim(){
  clearInterval(tickTimer);
  state = {
    dock: layout.dock ? [...layout.dock] : (layout.start ? [...layout.start] : [0,0]),
    bot:  layout.start ? [...layout.start] : [0,0],
    displayOrder: [],      // user-visible order (unchanged)
    orderLabels: [],       // internal planned order
    orderCoords: [],
    picked: [],
    drop: layout.drop ? [...layout.drop] : null,
    people: spawnPeople(layout.people?.count ?? 6),
    time: 0,
    pathLen: 0,
    delivered: true,
    phase: "idle"
  };
  peopleTick = 0;
  currentPath = [];
  waitTicks = 0;
  draw();
  statsEl.textContent = "Simulation idle (bot docked).";
}

function run(){
  clearInterval(tickTimer);
  const stepMs = 250; // bot speed
  peopleTick = 0;
  waitTicks = 0;

  tickTimer = setInterval(() => {
    // ---- 1) Move people at half speed ----
    peopleTick++;
    if (peopleTick % 2 === 0) stepPeople();

    // ---- 2) Determine target ----
    let target = null;
    if (state.orderCoords.length > 0) {
      target = state.orderCoords[0];
      state.phase = "picking";
    } else if (!state.delivered && state.drop) {
      target = state.drop;
      state.phase = "drop";
    } else {
      target = state.dock;
      state.phase = "return";
    }

    // ---- 3) Stop if docked and done ----
    if (state.phase === "return" && sameCell(state.bot, state.dock) && state.delivered) {
      clearInterval(tickTimer);
      state.phase = "idle";
      draw();
      statsEl.textContent = `Docked ✅ | Time: ${state.time} | Path length: ${state.pathLen}`;
      return;
    }

    // ---- 4) Move bot via A* path + "tempo" waiting heuristic ----
    const [tr, tc] = target;
    const [r,  c ] = state.bot;

    // Plan if needed
    const needReplan =
      currentPath.length === 0 ||
      !sameCell(currentPath.at(-1) || [-1,-1], [tr, tc]) ||
      (currentPath.length && !inBounds(currentPath[0][0], currentPath[0][1])) ||
      (currentPath.length && isBlocked(currentPath[0][0], currentPath[0][1]));

    if (needReplan) currentPath = astar([r,c], [tr,tc]);

    let nr = r, nc = c;

    // If next step is blocked by *people buffer* (not a shelf), "wait" up to WAIT_MAX ticks before replanning detours
    if (currentPath.length > 0) {
      const [sr, sc] = currentPath[0];
      const blockedByShelf = isBlockedByShelves(sr, sc);
      const blockedByHuman = !blockedByShelf && humanBufferBlocks(sr, sc);

      if (blockedByHuman) {
        if (waitTicks < WAIT_MAX) {
          // Wait this tick (tempo behavior)
          waitTicks++;
          // time still advances, but bot doesn't move
          state.time += 1;
          draw();
          statsEl.textContent = `Waiting for clearance… (${waitTicks}/${WAIT_MAX}) | Phase: ${state.phase} | Time: ${state.time} | Path: ${state.pathLen}`;
          return;
        } else {
          // Gave up waiting → replan (likely picks a detour)
          currentPath = astar([r,c], [tr,tc]);
          waitTicks = 0;
        }
      } else {
        waitTicks = 0; // path is clear; reset timer
      }
    }

    // Step if we have a path; else wait
    if (currentPath.length > 0) {
      [nr, nc] = currentPath.shift();
    }

    if (nr !== r || nc !== c) state.pathLen += 1;
    state.bot = [nr, nc];
    state.time += 1;

    // ---- 5) Arrivals ----
    if (nr === tr && nc === tc) {
      if (state.phase === "picking") {
        const label = state.orderLabels[0];
        state.picked.push({ coord: [tr, tc], label });
        state.orderCoords.shift();
        state.orderLabels.shift();
        currentPath = [];
        waitTicks = 0;
        if (state.orderCoords.length === 0) state.delivered = false;
      } else if (state.phase === "drop") {
        state.delivered = true;
        currentPath = [];
        waitTicks = 0;
      }
    }

    // ---- 6) Draw + stats ----
    draw();
    const targetsLeft =
      state.orderCoords.length +
      (!state.delivered ? 1 : 0) +
      (!sameCell(state.bot, state.dock) ? 1 : 0);
    statsEl.textContent =
      `Phase: ${state.phase} | Time: ${state.time} | Path: ${state.pathLen} | Targets left: ${targetsLeft}`;
  }, stepMs);
}

// ===== People (random walkers) =====
function spawnPeople(n){
  const list = [];
  let guard = 0;
  while (list.length < n && guard < 2000) {
    guard++;
    const r = randInt(0, layout.rows-1);
    const c = randInt(0, layout.cols-1);
    if (isBlockedByShelves(r,c)) continue;

    // 🚫 Avoid item spaces
    const onItem = Object.values(layout.items).some(([ir,ic]) => ir===r && ic===c);
    if (onItem) continue;

    const [dr,dc] = layout.dock || layout.start || [0,0];
    if (r === dr && c === dc) continue;
    list.push({ pos: [r,c], dir: randChoice([[1,0],[-1,0],[0,1],[0,-1]]) });
  }
  return list;
}

function stepPeople(){
  state.people.forEach(p => {
    let [r, c] = p.pos;
    let [dr, dc] = p.dir;
    if (Math.random() < 0.25) [dr, dc] = randChoice([[1,0],[-1,0],[0,1],[0,-1]]);
    let nr = r + dr, nc = c + dc;

    // 🚫 Avoid shelves, items, and the bot
    const onItem = Object.values(layout.items).some(([ir,ic]) => ir===nr && ic===nc);
    if (!inBounds(nr,nc) || isBlockedByShelves(nr,nc) || onItem || (nr===state.bot[0] && nc===state.bot[1])) {
      [dr, dc] = [-dr, -dc];
      nr = r + dr; nc = c + dc;
      const onItem2 = Object.values(layout.items).some(([ir,ic]) => ir===nr && ic===nc);
      if (!inBounds(nr,nc) || isBlockedByShelves(nr,nc) || onItem2) { nr = r; nc = c; }
    }
    p.dir = [dr, dc];
    p.pos = [nr, nc];
  });
}

// ===== Collision helpers =====
function isBlockedByShelves(r,c){
  return layout.obstacles.some(([or,oc]) => or === r && oc === c);
}

function humanBufferBlocks(r,c){
  for (const p of state.people){
    const [pr, pc] = p.pos;
    if (Math.abs(pr - r) <= 1 && Math.abs(pc - c) <= 1) return true;
  }
  return false;
}

// Bot avoids shelves + 1-cell safety buffer around each person
function isBlocked(r,c){
  if (isBlockedByShelves(r,c)) return true;
  return humanBufferBlocks(r,c);
}
function inBounds(r,c){ return r >= 0 && r < layout.rows && c >= 0 && c < layout.cols; }
function sameCell(a,b){ return a[0] === b[0] && a[1] === b[1]; }

// ===== Drawing =====
function draw(){
  const cellW = canvas.width / layout.cols;
  const cellH = canvas.height / layout.rows;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  for (let r = 0; r <= layout.rows; r++){ ctx.beginPath(); ctx.moveTo(0, r*cellH); ctx.lineTo(canvas.width, r*cellH); ctx.stroke(); }
  for (let c = 0; c <= layout.cols; c++){ ctx.beginPath(); ctx.moveTo(c*cellW, 0); ctx.lineTo(c*cellW, canvas.height); ctx.stroke(); }

  // shelves
  ctx.fillStyle = "rgba(255,255,255,.25)";
  layout.obstacles.forEach(([r,c]) => ctx.fillRect(c*cellW, r*cellH, cellW, cellH));

  // drop (green)
  if (layout.drop){
    const [dr,dc] = layout.drop;
    ctx.fillStyle = "#00d36b";
    ctx.fillRect(dc*cellW, dr*cellH, cellW, cellH);
  }

  // dock (cyan)
  if (layout.dock){
    const [rr,cc] = layout.dock;
    ctx.fillStyle = "#00c7c7";
    ctx.fillRect(cc*cellW, rr*cellH, cellW, cellH);
  }

  // all items (green)
  Object.entries(layout.items).forEach(([label,[r,c]]) => {
    drawMarker(r, c, label, "rgba(0,200,0,.85)", "#0b1020");
  });

  // picked (gold)
  state.picked.forEach(({coord:[r,c], label}) => {
    drawMarker(r, c, label, "gold", "#1a1a1a");
  });

  // people (gray)
  ctx.fillStyle = "rgba(180,180,195,.9)";
  state.people.forEach(p => {
    const [r,c] = p.pos;
    drawCircle(c*cellW + cellW/2, r*cellH + cellH/2, Math.min(cellW,cellH)/3.2);
  });

  // bot (blue)
  const [br, bc] = state.bot;
  ctx.fillStyle = "#00b3ff";
  drawCircle(bc*cellW + cellW/2, br*cellH + cellH/2, Math.min(cellW,cellH)/2.8);
}

function drawMarker(r, c, label, fill, textColor){
  const cellW = canvas.width / layout.cols;
  const cellH = canvas.height / layout.rows;
  const rad = Math.min(cellW,cellH)/3.2;
  ctx.fillStyle = fill;
  drawCircle(c*cellW + cellW/2, r*cellH + cellH/2, rad);
  ctx.fillStyle = textColor;
  ctx.font = `${Math.floor(rad*1.2)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, c*cellW + cellW/2, r*cellH + cellH/2);
}

function drawCircle(cx, cy, r){ ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill(); }

// ===== A* pathfinding =====
function manhattan(a, b) { return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]); }

function buildBlockedSet() {
  const b = new Set();
  // shelves
  layout.obstacles.forEach(([r,c]) => b.add(`${r},${c}`));
  // safety buffer around people
  state.people.forEach(p => {
    const [pr,pc] = p.pos;
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
      const rr = pr+dr, cc = pc+dc;
      if (inBounds(rr,cc)) b.add(`${rr},${cc}`);
    }
  });
  return b;
}

function astar(start, goal) {
  const blocked = buildBlockedSet();
  // If the goal is temporarily blocked (e.g., near a person), wait
  if (blocked.has(`${goal[0]},${goal[1]}`)) return [];

  const open = new Map(); // key -> {r,c,g,f,parent}
  const closed = new Set();
  const key = (r,c) => `${r},${c}`;

  function push(node){ open.set(key(node.r,node.c), node); }
  push({r:start[0], c:start[1], g:0, f:manhattan(start,goal), parent:null});

  while (open.size) {
    // get lowest f
    let bestKey = null, bestF = Infinity, bestNode = null;
    for (const [k,n] of open) if (n.f < bestF) { bestF = n.f; bestKey = k; bestNode = n; }
    open.delete(bestKey);
    closed.add(bestKey);

    if (bestNode.r === goal[0] && bestNode.c === goal[1]) {
      // reconstruct path (excluding start)
      const path = [];
      let cur = bestNode;
      while (cur.parent) {
        path.push([cur.r, cur.c]);
        cur = cur.parent;
      }
      path.reverse();
      return path;
    }

    const cand = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr,dc] of cand) {
      const rr = bestNode.r+dr, cc = bestNode.c+dc;
      const k = key(rr,cc);
      if (!inBounds(rr,cc)) continue;
      if (blocked.has(k)) continue;
      if (closed.has(k)) continue;
      const g = bestNode.g + 1;
      const f = g + manhattan([rr,cc], goal);
      const prev = open.get(k);
      if (!prev || g < prev.g) push({r:rr,c:cc,g,f,parent:bestNode});
    }
  }
  return []; // no path (temporary blockage)
}

// ===== Route planning (hidden from user) =====
function orderByNearestNeighbor(labels, itemMap, start) {
  const remaining = [...labels];
  const ordered = [];
  let current = start;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const [r,c] = itemMap[remaining[i]];
      const dist = Math.abs(current[0] - r) + Math.abs(current[1] - c);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    const nextLabel = remaining.splice(bestIdx, 1)[0];
    ordered.push(nextLabel);
    current = itemMap[nextLabel];
  }
  return ordered;
}

// One-pass 2-opt improvement (fast polish)
function twoOptImprove(order, itemMap, start){
  const path = [start, ...order.map(k => itemMap[k])];
  const labels = order.slice();

  // try limited swaps
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    guard++;
    improved = false;
    for (let i = 1; i < path.length - 2; i++){
      for (let j = i + 1; j < path.length - 1; j++){
        const a = path[i-1], b = path[i], c = path[j], d = path[j+1];
        const cur = manhattan(a,b) + manhattan(c,d);
        const alt = manhattan(a,c) + manhattan(b,d);
        if (alt + 0.0001 < cur) {
          // reverse segment [i..j]
          path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse());
          labels.splice(i-1, j - (i-1), ...labels.slice(i-1, j).reverse());
          improved = true;
        }
      }
    }
  }
  return labels;
}

// ===== utils =====
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
