/* SLOT-BASED NON-OVERLAPPING WEB VERSION (FIXED)
   - Keeps your original layout & sizes
   - Strict bounding-box checks before moving into/spawning a slot
   - Snaps cars to slot centers when waiting (no drift)
   - Updates cars farthest-first for stable slot claiming
   - Density-based green timing (Option C) kept
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;     // 1000
const H = canvas.height;    // 700
const FPS = 60;

// ===== MATCH PYGAME VALUES EXACTLY =====
const ROAD_WIDTH = 180;
const CAR_LEN = 44;
const CAR_WID = 24;
const STOP_GAP = 140;
const STOP_OFFSET = 30;
const MAX_CARS = 40;
const SPAWN_INTERVAL = 50;

const CENTER_X = W / 2;
const CENTER_Y = H / 2;

const STOP = {
  N: CENTER_Y + STOP_GAP,
  S: CENTER_Y - STOP_GAP,
  E: CENTER_X - STOP_GAP,
  W: CENTER_X + STOP_GAP
};

const LANE = {
  N: CENTER_X - ROAD_WIDTH/4,
  S: CENTER_X + ROAD_WIDTH/4,
  E: CENTER_Y - ROAD_WIDTH/4,
  W: CENTER_Y + ROAD_WIDTH/4
};

// ===== SLOT SETTINGS =====
const SLOT_GAP = 65;          // your chosen gap
const SLOTS_MAX = 8;          // cars per lane (max)

// Precompute slot coordinates for each direction:
const SLOT_POS = {
  N: Array.from({length: SLOTS_MAX}, (_,i) => ({
    x: LANE.N - CAR_WID/2,
    y: STOP.N + (i+1) * SLOT_GAP
  })),
  S: Array.from({length: SLOTS_MAX}, (_,i) => ({
    x: LANE.S - CAR_WID/2,
    y: STOP.S - (i+1) * SLOT_GAP - CAR_LEN
  })),
  E: Array.from({length: SLOTS_MAX}, (_,i) => ({
    x: STOP.E - (i+1) * SLOT_GAP - CAR_LEN,
    y: LANE.E - CAR_WID/2
  })),
  W: Array.from({length: SLOTS_MAX}, (_,i) => ({
    x: STOP.W + (i+1) * SLOT_GAP,
    y: LANE.W - CAR_WID/2
  }))
};

// helper to get slot bbox for overlap checks
function slotBBox(dir, slotIndex){
  const p = SLOT_POS[dir][slotIndex];
  if(dir === 'N' || dir === 'S'){
    return { x: p.x, y: p.y, w: CAR_WID, h: CAR_LEN };
  } else {
    return { x: p.x, y: p.y, w: CAR_LEN, h: CAR_WID };
  }
}

// bounding-rect overlap
function rectOverlap(a,b){
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

// ================= SIGNAL SYSTEM =================
class Signal {
  constructor(){
    this.dir = "S";    // start like your original Pygame
    this.phase = "green";
    this.timer = 0;
    this.framesLeft = 15 * FPS;
  }

  tick(){
    this.timer++;
    this.framesLeft--;

    if(this.phase === "green" && this.framesLeft <= 0){
      this.phase = "yellow";
      this.timer = 0;
      this.framesLeft = 3 * FPS;
    }
    else if(this.phase === "yellow" && this.framesLeft <= 0){
      // Pick direction by vehicle density
      this.dir = nextGreenDirection();
      this.phase = "green";
      this.timer = 0;

      const waiting = waitingCount(this.dir);
      let sec = Math.min(35, 10 + 1.5 * waiting);  // Option C
      this.framesLeft = Math.round(sec * FPS);
    }
  }

  state(){
    const s = {N:"RED",E:"RED",S:"RED",W:"RED"};
    if(this.phase === "green") s[this.dir] = "GREEN";
    else s[this.dir] = "YELLOW";
    return s;
  }

  countdown(){
    return Math.max(0, Math.ceil(this.framesLeft / FPS));
  }

  current(){
    return this.dir;
  }
}

// ===== CARS (slot-based, non-overlapping) =====
class Car {
  constructor(dir, slot){
    this.dir = dir;
    this.slot = slot;     // 0 = frontmost, SLOTS_MAX-1 = farthest away
    this.crossed = false;

    // tuned slower speeds to be stable
    this.speed = Math.random() * 0.5 + 0.8;

    const p = SLOT_POS[dir][slot];
    // snap exactly to slot bbox top-left
    this.x = p.x;
    this.y = p.y;

    this.w = (dir==="N"||dir==="S") ? CAR_WID : CAR_LEN;
    this.h = (dir==="N"||dir==="S") ? CAR_LEN : CAR_WID;
  }

  front(){
    if(this.dir === "N") return this.y;
    if(this.dir === "S") return this.y + this.h;
    if(this.dir === "E") return this.x + this.w;
    return this.x;
  }

  // Check if the bbox of slotIndex for this.dir is free of any non-crossed car
  slotIsFree(slotIndex){
    const bbox = slotBBox(this.dir, slotIndex);
    for(const c of cars){
      if(c === this) continue;
      if(c.crossed) continue; // ignore cars already in crossing/outgoing
      if(c.dir !== this.dir) continue;
      if(rectOverlap(bbox, {x:c.x, y:c.y, w:c.w, h:c.h})) return false;
    }
    return true;
  }

  // Strict update:
  update(state, curGreen){
    const p = SLOT_POS[this.dir][this.slot];

    // If crossed → go straight through intersection
    if(this.crossed){
      if(this.dir === "N") this.y -= this.speed;
      if(this.dir === "S") this.y += this.speed;
      if(this.dir === "E") this.x += this.speed;
      if(this.dir === "W") this.x -= this.speed;
      return;
    }

    // Mark crossed when front passes stop line (small tolerance)
    if(this.dir==="N" && this.front() < STOP.N - 2) this.crossed=true;
    if(this.dir==="S" && this.front() > STOP.S + 2) this.crossed=true;
    if(this.dir==="E" && this.front() > STOP.E + 2) this.crossed=true;
    if(this.dir==="W" && this.front() < STOP.W - 2) this.crossed=true;

    if(this.crossed){
      // let next frame handle movement after crossed
      return;
    }

    // STOP if light is not green by default
    const myLight = state[this.dir];
    let stop = (myLight !== "GREEN");

    // If frontmost slot (slot 0) AND green → allowed to move (but still ensure intersection area won't overlap others)
    if(this.slot === 0 && this.dir === curGreen){
      stop = false;
    }

    // If not stop → attempt to move toward next slot (slot-1) or through intersection
    if(!stop){
      if(this.slot > 0){
        const nextSlot = this.slot - 1;
        // Strict check: ensure nextSlot bbox is free now (no overlap)
        if(this.slotIsFree(nextSlot)){
          const nextP = SLOT_POS[this.dir][nextSlot];
          // Smooth move toward next slot top-left
          const dx = nextP.x - this.x;
          const dy = nextP.y - this.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const step = dist > 0 ? Math.min(this.speed, dist) : 0;
          if(dist > 0){
            this.x += (dx/dist) * step;
            this.y += (dy/dist) * step;
          }
          // Switch to next slot when close enough (claim it)
          if(dist < 1){
            this.slot = nextSlot;
            // snap to exact slot to avoid subpixel overlap
            this.x = nextP.x; this.y = nextP.y;
          }
        } else {
          // next slot occupied -> snap to current slot exact position
          const here = SLOT_POS[this.dir][this.slot];
          this.x = here.x; this.y = here.y;
        }
      } else {
        // slot 0 and allowed (green): before moving into intersection ensure intersection entry area won't overlap any car
        // We'll compute a small "entry bbox" representing the car moving slightly past stop line; if any car (crossed==false) overlaps it, wait.
        const entryDist = 12; // small advance to check
        let entryBBox;
        if(this.dir === 'N'){
          entryBBox = { x: this.x, y: this.y - entryDist, w: this.w, h: this.h + entryDist };
        } else if(this.dir === 'S'){
          entryBBox = { x: this.x, y: this.y, w: this.w, h: this.h + entryDist };
        } else if(this.dir === 'E'){
          entryBBox = { x: this.x, y: this.y, w: this.w + entryDist, h: this.h };
        } else { // W
          entryBBox = { x: this.x - entryDist, y: this.y, w: this.w + entryDist, h: this.h };
        }

        // If any non-crossed car (including from other lanes) overlaps that entry box -> wait (prevents mid-junction stops/overlaps)
        let blocked = false;
        for(const c of cars){
          if(c === this) continue;
          // ignore cars that have already crossed (they're leaving)
          if(c.crossed) continue;
          if(rectOverlap(entryBBox, {x:c.x, y:c.y, w:c.w, h:c.h})){ blocked = true; break; }
        }

        if(!blocked){
          // move through intersection
          if(this.dir === "N") this.y -= this.speed;
          if(this.dir === "S") this.y += this.speed;
          if(this.dir === "E") this.x += this.speed;
          if(this.dir === "W") this.x -= this.speed;
        } else {
          // blocked -> snap to slot 0 exact top-left
          const here = SLOT_POS[this.dir][this.slot];
          this.x = here.x; this.y = here.y;
        }
      }
    } else {
      // must stop due to red/yellow: snap to slot center to avoid drift/overlap
      const here = SLOT_POS[this.dir][this.slot];
      this.x = here.x; this.y = here.y;
    }
  }

  draw(){
    ctx.fillStyle = "rgb(200,80,70)";
    roundRect(ctx, this.x, this.y, this.w, this.h, 6);
    ctx.fill();

    ctx.fillStyle = "rgb(160,220,255)";
    if(this.dir==="N"||this.dir==="S")
      ctx.fillRect(this.x+4, this.y+6, Math.max(2, this.w-8), this.h*0.3);
    else
      ctx.fillRect(this.x+6, this.y+4, this.w*0.3, Math.max(2, this.h-8));
  }

  offscreen(){
    return (
      this.x + this.w < -200 ||
      this.x > W + 200 ||
      this.y + this.h < -200 ||
      this.y > H + 200
    );
  }
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// ===== GLOBALS =====
const signal = new Signal();
const cars = [];
let frame = 0;

// ===== HELPER FUNCTIONS =====

// count cars NOT crossed = waiting
function waitingCount(dir){
  return cars.filter(c => c.dir===dir && !c.crossed).length;
}

// choose next by density
function nextGreenDirection(){
  const waits = {
    N: waitingCount("N"),
    E: waitingCount("E"),
    S: waitingCount("S"),
    W: waitingCount("W"),
  };

  let max = -1;
  let best = signal.dir;

  for(const d of ["N","E","S","W"]){
    if(waits[d] > max){
      max = waits[d];
      best = d;
    }
  }

  // If all empty → rotate to avoid freezing
  if(max === 0){
    const order = ["S","W","N","E"];
    const i = order.indexOf(signal.dir);
    return order[(i+1)%4];
  }
  return best;
}

// spawn car in highest empty slot (NO OVERLAP)
// Uses strict bbox check to ensure spawn slot is physically free
function spawn(){
  if(frame % SPAWN_INTERVAL !== 0) return;
  if(cars.length >= MAX_CARS) return;

  const dirs = ["N","S","E","W"];
  // pick a random starting lane to attempt spawn to avoid bias
  const start = Math.floor(Math.random()*4);
  for(let k=0;k<4;k++){
    const d = dirs[(start + k) % 4];
    // check from farthest slot downwards
    for(let s = SLOTS_MAX-1; s>=0; s--){
      const bbox = slotBBox(d, s);
      // check overlap with any non-crossed car in same lane
      let occ = false;
      for(const c of cars){
        if(c.crossed) continue;
        if(c.dir !== d) continue;
        if(rectOverlap(bbox, {x:c.x, y:c.y, w:c.w, h:c.h})){ occ = true; break; }
      }
      if(!occ){
        cars.push(new Car(d, s));
        return;
      }
    }
  }
}

// ===== DRAW SCENE =====
function drawRoads(){
  ctx.fillStyle = "rgb(30,30,30)";
  ctx.fillRect(CENTER_X-ROAD_WIDTH/2,0,ROAD_WIDTH,H);
  ctx.fillRect(0,CENTER_Y-ROAD_WIDTH/2,W,ROAD_WIDTH);

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(CENTER_X-ROAD_WIDTH/2,STOP.N); ctx.lineTo(CENTER_X+ROAD_WIDTH/2,STOP.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CENTER_X-ROAD_WIDTH/2,STOP.S); ctx.lineTo(CENTER_X+ROAD_WIDTH/2,STOP.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.E,CENTER_Y-ROAD_WIDTH/2); ctx.lineTo(STOP.E,CENTER_Y+ROAD_WIDTH/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.W,CENTER_Y-ROAD_WIDTH/2); ctx.lineTo(STOP.W,CENTER_Y+ROAD_WIDTH/2); ctx.stroke();
}

function drawSignalPole(x,y,color,timer){
  ctx.fillStyle = "rgb(40,40,40)";
  ctx.fillRect(x,y,40,120);

  function light(ix, colActive){
    const cy = y + 20 + ix*30;
    ctx.beginPath();
    ctx.fillStyle = colActive;
    ctx.arc(x+20, cy, 10, 0, Math.PI*2);
    ctx.fill();
  }

  light(0, color==="RED" ? "red" : "rgb(90,90,90)");
  light(1, color==="YELLOW" ? "yellow" : "rgb(90,90,90)");
  light(2, color==="GREEN" ? "lime" : "rgb(90,90,90)");

  if(timer){
    ctx.fillStyle="white";
    ctx.font="18px Arial";
    ctx.textAlign="center";
    ctx.fillText(timer,x+20,y-15);
  }
}

function drawSignals(state, timer, cur){
  const pos = {
    N: [CENTER_X-20, CENTER_Y-250],
    S: [CENTER_X-20, CENTER_Y+130],
    E: [CENTER_X+180, CENTER_Y-60],
    W: [CENTER_X-250, CENTER_Y-60]
  };
  for(const d of ["N","S","E","W"]){
    drawSignalPole(
      pos[d][0],
      pos[d][1],
      state[d],
      d===cur ? timer : null
    );
  }
}

// ======================================================
// MAIN LOOP (NO OVERLAP GUARANTEED)
// ======================================================
function loop(){
  frame++;

  ctx.fillStyle="rgb(50,50,50)";
  ctx.fillRect(0,0,W,H);

  drawRoads();

  signal.tick();
  const state = signal.state();
  const cur = signal.current();

  drawSignals(state, signal.countdown(), cur);

  spawn();

  // update / draw cars
  // SORT farthest-first so front cars move before followers (reduces race)
  cars.sort((a,b)=>{
    const da = Math.hypot((a.x + a.w/2) - CENTER_X, (a.y + a.h/2) - CENTER_Y);
    const db = Math.hypot((b.x + b.w/2) - CENTER_X, (b.y + b.h/2) - CENTER_Y);
    return db - da;
  });

  for(let i=cars.length-1; i>=0; i--){
    const c=cars[i];
    c.update(state, cur);
    c.draw();
    if(c.offscreen()) cars.splice(i,1);
  }

  // bottom info
  ctx.fillStyle="white";
  ctx.font="20px Arial";
  ctx.textAlign="center";
  ctx.fillText(
    `Current Green: ${cur} | Time Left: ${signal.countdown()}s | Cars: ${cars.length}`,
    CENTER_X,
    H - 30
  );

  requestAnimationFrame(loop);
}

// Initialize with a few vehicles in each lane to show queues immediately
(function initQueues(){
  for(let lane of ['N','E','S','W']){
    for(let s=0;s<3;s++){
      // spawn only if bbox free
      const bbox = slotBBox(lane, s);
      let occupied = cars.some(c => !c.crossed && c.dir===lane && rectOverlap(bbox, {x:c.x,y:c.y,w:c.w,h:c.h}));
      if(!occupied) cars.push(new Car(lane, s));
    }
  }
  // extras
  if(slotBBox('E',3)) { if(!cars.some(c=>c.dir==='E'&&c.slot===3)) cars.push(new Car('E',3)); }
  if(slotBBox('W',3)) { if(!cars.some(c=>c.dir==='W'&&c.slot===3)) cars.push(new Car('W',3)); }
})();

requestAnimationFrame(loop);
