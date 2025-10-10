// ===== DOM =====
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn  = document.getElementById("clearAllBtn");
const submitBtn    = document.getElementById("submitItems");
const startBtn     = document.getElementById("startBtn");
const resetBtn     = document.getElementById("resetBtn");
const statsEl      = document.getElementById("stats");

// ===== Global state =====
let layout = null;
let state  = null;
let tickTimer = null;
let peopleTick = 0;  // half-speed tracker

// ===== Boot =====
(async function init(){
  try {
    const res = await fetch("data/layout-01.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    layout = await res.json();
  } catch (err) {
    console.error("Layout load error:", err);
    alert(`Error loading layout-01.json: ${err.message}`);
    return;
  }
  buildItemSelector(layout.items);
  attachControlHandlers();
  resetSim();
})();

// ===== UI: letter buttons A–J =====
function buildItemSelector(itemsObj) {
  const container = document.getElementById("itemButtons");
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
  selectAllBtn.addEventListener("click", () => {
    document.querySelectorAll(".item-btn").forEach(b => b.classList.add("selected"));
  });
  clearAllBtn.addEventListener("click", () => {
    document.querySelectorAll(".item-btn").forEach(b => b.classList.remove("selected"));
  });

  submitBtn.addEventListener("click", () => {
    const selected = Array.from(document.querySelectorAll(".item-btn.selected"))
      .map(b => b.dataset.item);
    if (selected.length === 0) { alert("Select at least one item (A–J)."); return; }

    state.orderLabels = selected.slice();
    state.orderCoords = selected.map(s => layout.items[s]);
    state.picked = [];
    state.pathLen = 0;
    state.time = 0;
    state.delivered = false;
    state.phase = "picking";
    draw();
    statsEl.textContent = `Shipment: ${selected.join(", ")} | Items left: ${state.orderCoords.length}`;
  });

  startBtn.addEventListener("click", () => {
    if (!state.orderCoords || state.orderCoords.length === 0) {
      alert("Pick items first (Update Shipment).");
      return;
    }
    run();
  });

  resetBtn.addEventListener("click", resetSim);
}

// ===== Simulation core =====
function resetSim(){
  clearInterval(tickTimer);
  state = {
    dock: layout.dock ? [...layout.dock] : (layout.start ? [...layout.start] : [0,0]),
    bot:  layout.start ? [...layout.start] : [0,0],
    orderLabels: [],
    orderCoords: [],
    picked: [],
    drop: layout.drop ? [...layout.drop] : null,
    people: spawnPeople(layout.people?.count ?? 6),
    time: 0,
    pathLen: 0,
    delivered: true,
    phase: "idle"
  };
  draw();
  statsEl.textContent = "Simulation idle (bot docked).";
}

function run(){
  clearInterval(tickTimer);
  const stepMs = 250; // bot speed
  peopleTick = 0;

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

    // ---- 4) Move bot ----
    const [tr, tc] = target;
    const [r,  c ] = state.bot;
    let nr = r + Math.sign(tr - r);
    let nc = c + Math.sign(tc - c);

    if (!inBounds(nr,nc) || isBlocked(nr,nc)) {
      const alternatives = shuffle([[r, c+1], [r, c-1], [r+1, c], [r-1, c]]);
      const ok = alternatives.find(([rr,cc]) => inBounds(rr,cc) && !isBlocked(rr,cc));
      if (ok) [nr,nc] = ok; else { nr = r; nc = c; }
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
        if (state.orderCoords.length === 0) state.delivered = false;
      } else if (state.phase === "drop") {
        state.delivered = true;
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
      if (!inBounds(nr,nc) || isBlockedByShelves(nr,nc) || onItem) { nr = r; nc = c; }
    }
    p.dir = [dr, dc];
    p.pos = [nr, nc];
  });
}

// ===== Collision helpers =====
function isBlockedByShelves(r,c){
  return layout.obstacles.some(([or,oc]) => or === r && oc === c);
}

// === SAFETY BUFFER ZONE ===
function isBlocked(r,c){
  if (isBlockedByShelves(r,c)) return true;

  // Bot avoids people and their 1-cell buffer
  for (const p of state.people){
    const [pr, pc] = p.pos;
    if (Math.abs(pr - r) <= 1 && Math.abs(pc - c) <= 1) return true;
  }
  return false;
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

// ===== utils =====
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
