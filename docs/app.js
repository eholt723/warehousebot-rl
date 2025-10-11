// ===================== DOM =====================
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn  = document.getElementById("clearAllBtn");
const submitBtn    = document.getElementById("submitItems");
const startBtn     = document.getElementById("startBtn");
const resetBtn     = document.getElementById("resetBtn");
const statsEl      = document.getElementById("stats");

// Map picker UI (add <select id="mapSelect"></select> + <button id="loadMapBtn">Load Map</button> in index.html)
const mapSelect    = document.getElementById("mapSelect");
const loadMapBtn   = document.getElementById("loadMapBtn");

// ===================== Global State =====================
let layout = null;
let state  = null;
let tickTimer = null;
let peopleTick = 0;        // people move half as often
let currentPath = [];      // path = array of [r,c] steps

// Waiting behavior: we plan through people and wait until they clear
let waitTicks = 0;         // consecutive waiting ticks
const WAIT_MAX = 40;       // optional cap (40*250ms ≈ 10s); bot prefers waiting over detours

// ===================== Boot =====================
(async function init(){
  await loadLayout("layout-01.json"); // default map
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
  }
}

// ===================== Map Picker =====================
function attachMapHandlers(){
  if (!mapSelect || !loadMapBtn) return;

  if (mapSelect.children.length === 0) {
    ["layout-01.json","layout-02.json","layout-03.json"].forEach(name => {
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

// ===================== Item Buttons A–J =====================
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

  // User submits shipment — keep visible order; secretly optimize route
  submitBtn?.addEventListener("click", () => {
    const selected = Array.from(document.querySelectorAll(".item-btn.selected"))
      .map(b => b.dataset.item);

    if (selected.length === 0) {
      alert("Select at least one item (A–J).");
      return;
    }

    // Keep what the user sees (don’t change)
    state.displayOrder = selected.slice();

    // Hidden internal plan: NN + 2-opt polish from the dock
    const nn = orderByNearestNeighbor(selected, layout.items, layout.dock);
    const planned = twoOptImprove(nn, layout.items, layout.dock);

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

// ===================== Simulation =====================
function resetSim(){
  clearInterval(tickTimer);
  state = {
    dock: layout.dock ? [...layout.dock] : (layout.start ? [...layout.start] : [0,0]),
    bot:  layout.start ? [...layout.start] : [0,0],
    displayOrder: [],      // user-visible order
    orderLabels: [],       // internal planned order
    orderCoords: [],
    picked: [],
    drop: layout.drop ? [...layout.drop] : null,
    people: spawnPeople(layout.people?.count ?? 8),
    time: 0,
    pathLen: 0,
    delivered: true,       // nothing to deliver until we pick something
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
    // 1) People move at half speed
    peopleTick++;
    if (peopleTick % 2 === 0) stepPeople();

    // 2) Current target
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

    // 3) Done & docked
    if (state.phase === "return" && sameCell(state.bot, state.dock) && state.delivered) {
      clearInterval(tickTimer);
      state.phase = "idle";
      draw();
      statsEl.textContent = `Docked ✅ | Time: ${state.time} | Path length: ${state.pathLen}`;
      return;
    }

    // 4) Plan through people (ignore them), wait if next step is human-blocked
    const [tr, tc] = target;
    const [r,  c ] = state.bot;

    const targetChanged = !(currentPath.length && sameCell(currentPath.at(-1) || [-1,-1], [tr, tc]));
    let mustReplan = currentPath.length === 0 || targetChanged;

    // Replan if next step is shelf-blocked/out-of-bounds
    if (!mustReplan && currentPath.length > 0) {
      const [nr0, nc0] = currentPath[0];
      if (!inBounds(nr0, nc0) || isBlockedByShelves(nr0, nc0)) {
        mustReplan = true;
      }
    }

    if (mustReplan) {
      currentPath = astarStatic([r, c], [tr, tc]); // shelves-only A*
      waitTicks = 0; // reset patience on new plan
    }

    let nr = r, nc = c;

    if (currentPath.length > 0) {
      const [stepR, stepC] = currentPath[0];

      // If a person (or 1-cell buffer) is on the next step, WAIT (don’t pop the step)
      if (humanBufferBlocks(stepR, stepC)) {
        waitTicks++;
        state.time += 1;
        draw();
        const waitMsg = WAIT_MAX ? ` (${Math.min(waitTicks, WAIT_MAX)}/${WAIT_MAX})` : "";
        statsEl.textContent = `Waiting for clearance${waitMsg}… | Phase: ${state.phase} | Time: ${state.time} | Path: ${state.pathLen}`;
        // Optional cap: after WAIT_MAX, replan to look for alternative through shelves
        if (WAIT_MAX && waitTicks >= WAIT_MAX) {
          currentPath = astarStatic([r, c], [tr, tc]);
          waitTicks = 0;
        }
        return; // skip movement this tick
      }

      // Otherwise, advance one step along the planned path
      [nr, nc] = currentPath.shift();
    }

    if (nr !== r || nc !== c) state.pathLen += 1;
    state.bot = [nr, nc];
    state.time += 1;

    // 5) Arrivals
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

    // 6) Draw + stats
    draw();
    const targetsLeft =
      state.orderCoords.length +
      (!state.delivered ? 1 : 0) +
      (!sameCell(state.bot, state.dock) ? 1 : 0);
    statsEl.textContent =
      `Phase: ${state.phase} | Time: ${state.time} | Path: ${state.pathLen} | Targets left: ${targetsLeft}`;
  }, stepMs);
}

// ===================== People =====================
function spawnPeople(n){
  const list = [];
  let guard = 0;
  while (list.length < n && guard < 4000) {
    guard++;
    const r = randInt(0, layout.rows-1);
    const c = randInt(0, layout.cols-1);
    if (isBlockedByShelves(r,c)) continue;

    // Avoid item cells
    const onItem = Object.values(layout.items).some(([ir,ic]) => ir===r && ic===c);
    if (onItem) continue;

    // Avoid dock/start
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

    // Avoid shelves, items, and the bot
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

// ===================== Collision / Geometry =====================
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

function inBounds(r,c){ return r >= 0 && r < layout.rows && c >= 0 && c < layout.cols; }
function sameCell(a,b){ return a[0] === b[0] && a[1] === b[1]; }

// ===================== Drawing =====================
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

// ===================== Pathfinding =====================
// A* that ignores people (treat people as temporary). Only shelves are hard obstacles.
function astarStatic(start, goal) {
  const blocked = new Set();
  layout.obstacles.forEach(([r,c]) => blocked.add(`${r},${c}`));

  const key = (r,c) => `${r},${c}`;
  const open = new Map();  // key -> node
  const closed = new Set();

  function h(a,b){ return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]); }
  function push(n){ open.set(key(n.r,n.c), n); }

  push({r:start[0], c:start[1], g:0, f:h(start,goal), parent:null});

  while (open.size) {
    let bestK=null, bestF=Infinity, bestN=null;
    for (const [k,n] of open) if (n.f < bestF) { bestF=n.f; bestK=k; bestN=n; }
    open.delete(bestK);
    closed.add(bestK);

    if (bestN.r===goal[0] && bestN.c===goal[1]) {
      const path=[]; let cur=bestN;
      while (cur.parent){ path.push([cur.r,cur.c]); cur=cur.parent; }
      path.reverse(); return path;
    }

    for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const rr = bestN.r+dr, cc = bestN.c+dc, k = key(rr,cc);
      if (!inBounds(rr,cc)) continue;
      if (blocked.has(k)) continue;
      if (closed.has(k)) continue;
      const g = bestN.g+1, f=g+h([rr,cc],goal);
      const prev = open.get(k);
      if (!prev || g < prev.g) push({r:rr,c:cc,g,f,parent:bestN});
    }
  }
  return [];
}

// ===================== Route planning (hidden from user) =====================
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

// Quick 2-opt improvement pass
function twoOptImprove(order, itemMap, start){
  const path = [start, ...order.map(k => itemMap[k])];
  const labels = order.slice();

  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    guard++;
    improved = false;
    for (let i = 1; i < path.length - 2; i++){
      for (let j = i + 1; j < path.length - 1; j++){
        const a = path[i-1], b = path[i], c = path[j], d = path[j+1];
        const cur = Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1])
                  + Math.abs(c[0]-d[0]) + Math.abs(c[1]-d[1]);
        const alt = Math.abs(a[0]-c[0]) + Math.abs(a[1]-c[1])
                  + Math.abs(b[0]-d[0]) + Math.abs(b[1]-d[1]);
        if (alt + 0.0001 < cur) {
          path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse());
          labels.splice(i-1, j - (i-1), ...labels.slice(i-1, j).reverse());
          improved = true;
        }
      }
    }
  }
  return labels;
}

// ===================== Utils =====================
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
