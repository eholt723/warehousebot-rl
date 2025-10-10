// ===== DOM
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const itemSelectorDiv = document.getElementById("itemSelector");
const submitBtn = document.getElementById("submitItems");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const statsEl = document.getElementById("stats");

// ===== State
let layout = null;
let state = null;
let tickTimer = null;

// ===== Init
(async function init(){
  try {
    layout = await fetch("data/layout-01.json", {cache:"no-store"}).then(r => r.json());
  } catch (e) {
    console.error("Failed to load layout JSON", e);
    alert("Error: couldn't load data/layout-01.json");
    return;
  }
  buildItemSelector(layout.items);
  resetSim();
})();

// ===== UI build
function buildItemSelector(itemsObj){
  const keys = Object.keys(itemsObj).sort();
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

// ===== Controls
submitBtn.addEventListener("click", ()=>{
  const selected = Array.from(itemSelectorDiv.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  if (selected.length === 0) { alert("Select at least one item (A–J)."); return; }

  state.orderLabels = selected.slice();
  state.orderCoords = selected.map(s => layout.items[s]);

  // Reset progress but keep bot position
  state.picked = [];
  state.pathLen = 0;
  state.time = 0;
  state.targetPhase = "picking"; // then "drop"
  draw();
  statsEl.textContent = `Shipment: ${selected.join(", ")} | Items left: ${state.orderCoords.length}`;
});

startBtn.addEventListener("click", ()=>{
  if (state.orderCoords.length === 0) { alert("Pick items first (Update Shipment)."); return; }
  run();
});
resetBtn.addEventListener("click", resetSim);

// ===== Simulation core
function resetSim(){
  clearInterval(tickTimer);
  // spawn random walkers
  const people = spawnPeople(layout.people?.count ?? 6);
  state = {
    bot: layout.start ? [...layout.start] : [0,0],
    orderLabels: [],
    orderCoords: [],
    picked: [],
    drop: layout.drop ? [...layout.drop] : null,
    people,
    time: 0,
    pathLen: 0,
    targetPhase: "idle" // picking -> drop -> done
  };
  draw();
  statsEl.textContent = "Simulation idle.";
}

function run(){
  clearInterval(tickTimer);
  const stepMs = 90;
  tickTimer = setInterval(()=>{
    stepPeopleRandom(); // move people first

    // Determine current target (next item or drop)
    let target = null, label = null;
    if (state.orderCoords.length > 0){
      target = state.orderCoords[0];
      label  = state.orderLabels[0];
      state.targetPhase = "picking";
    } else if (state.drop){
      target = state.drop;
      label  = "DROP";
      state.targetPhase = "drop";
    }

    if (!target){
      clearInterval(tickTimer);
      state.targetPhase = "done";
      statsEl.textContent = `Completed ✅ | Time: ${state.time} | Path length: ${state.pathLen}`;
      draw();
      return;
    }

    // Take one step toward target (greedy) with sidestep avoidance vs shelves & people
    const [tr, tc] = target;
    const [r,  c ] = state.bot;
    let nr = r + Math.sign(tr - r);
    let nc = c + Math.sign(tc - c);

    if (!inBounds(nr,nc) || isBlocked(nr,nc)){
      // Try alternatives (right, left, down, up)
      const opts = shuffle([
        [r, c+1], [r, c-1], [r+1, c], [r-1, c]
      ]);
      const alt = opts.find(([rr,cc]) => inBounds(rr,cc) && !isBlocked(rr,cc));
      if (alt) [nr,nc] = alt; else { nr=r; nc=c; } // stuck
    }

    if (nr!==r || nc!==c) state.pathLen += 1;
    state.bot = [nr,nc];
    state.time += 1;

    // Reached current target
    if (nr === tr && nc === tc){
      if (label === "DROP"){
        // finished
        state.targetPhase = "done";
      } else {
        state.picked.push({coord:[tr,tc], label});
        state.orderCoords.shift();
        state.orderLabels.shift();
      }
    }

    draw();
    const left = state.orderCoords.length + (state.targetPhase === "drop" ? 1 : 0);
    statsEl.textContent = `Phase: ${state.targetPhase} | Time: ${state.time} | Path: ${state.pathLen} | Targets left: ${left}`;
  }, stepMs);
}

// ===== People (random walkers)
function spawnPeople(n){
  const list = [];
  let attempts = 0;
  while (list.length < n && attempts < 2000){
    attempts++;
    const r = randInt(0, layout.rows-1);
    const c = randInt(0, layout.cols-1);
    if (isBlocked(r,c) || (layout.start && r===layout.start[0] && c===layout.start[1])) continue;
    list.push({pos:[r,c], dir: randChoice([[1,0],[-1,0],[0,1],[0,-1]])});
  }
  return list;
}
function stepPeopleRandom(){
  state.people.forEach(p=>{
    const [r,c] = p.pos;
    let [dr,dc] = p.dir;
    if (Math.random() < 0.25) { // random turn sometimes
      [dr,dc] = randChoice([[1,0],[-1,0],[0,1],[0,-1]]);
    }
    let nr = r + dr, nc = c + dc;
    if (!inBounds(nr,nc) || isBlocked(nr,nc) || equals([nr,nc], state.bot)){
      // bounce
      [dr,dc] = [-dr,-dc];
      nr = r + dr; nc = c + dc;
      if (!inBounds(nr,nc) || isBlocked(nr,nc)) { nr=r; nc=c; }
    }
    p.dir = [dr,dc];
    p.pos = [nr,nc];
  });
}

// ===== Collision helpers
function isBlocked(r,c){
  // shelves or people occupy the cell
  if (layout.obstacles.some(([or,oc]) => or===r && oc===c)) return true;
  if (state.people.some(p => p.pos[0]===r && p.pos[1]===c)) return true;
  return false;
}
function inBounds(r,c){ return r>=0 && r<layout.rows && c>=0 && c<layout.cols; }
function equals(a,b){ return a[0]===b[0] && a[1]===b[1]; }

// ===== Drawing
function draw(){
  const cellW = canvas.width / layout.cols;
  const cellH = canvas.height / layout.rows;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  for (let r=0;r<=layout.rows;r++){ ctx.beginPath(); ctx.moveTo(0,r*cellH); ctx.lineTo(canvas.width,r*cellH); ctx.stroke(); }
  for (let c=0;c<=layout.cols;c++){ ctx.beginPath(); ctx.moveTo(c*cellW,0); ctx.lineTo(c*cellW,canvas.height); ctx.stroke(); }

  // shelves/obstacles
  ctx.fillStyle = "rgba(255,255,255,.25)";
  layout.obstacles.forEach(([r,c])=> ctx.fillRect(c*cellW, r*cellH, cellW, cellH));

  // drop location (shipping box)
  if (state.drop){
    const [dr,dc] = state.drop;
    ctx.fillStyle = "#00d36b";
    ctx.fillRect(dc*cellW, dr*cellH, cellW, cellH);
  }

  // all items A–J as green markers with labels
  Object.entries(layout.items).forEach(([label,[r,c]])=>{
    drawMarker(r,c,label,"rgba(0,200,0,.85)", "#0b1020");
  });

  // picked items in gold
  state.picked.forEach(({coord:[r,c], label})=>{
    drawMarker(r,c,label,"gold","#222");
  });

  // people (random walkers) in gray
  ctx.fillStyle = "rgba(180,180,195,.9)";
  state.people.forEach(p=>{
    const [r,c] = p.pos;
    drawCircle(c*cellW + cellW/2, r*cellH + cellH/2, Math.min(cellW,cellH)/3.2);
  });

  // bot (blue)
  const [br,bc] = state.bot;
  ctx.fillStyle = "#00b3ff";
  drawCircle(bc*cellW + cellW/2, br*cellH + cellH/2, Math.min(cellW,cellH)/2.8);
}

function drawCircle(cx,cy,r){
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
}
function drawMarker(r,c,label,fill,textColor){
  const cellW = canvas.width / layout.cols;
  const cellH = canvas.height / layout.rows;
  const rad = Math.min(cellW,cellH)/3.2;
  // circle
  ctx.fillStyle = fill;
  drawCircle(c*cellW + cellW/2, r*cellH + cellH/2, rad);
  // text
  ctx.fillStyle = textColor;
  ctx.font = `${Math.floor(rad*1.2)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, c*cellW + cellW/2, r*cellH + cellH/2);
}

// ===== utils
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
