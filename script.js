/* CLEAN SLOT-BASED NON-OVERLAPPING script.js
   Paste this file as script.js (replaces any old movement code).
   - Slot gap = 65px (no overlap)
   - Density-based aggressive green scaling (C): green = min(35, 10 + 1.5 * waiting)
   - Exact sizes & signal positions from your Pygame
   - Straight-only movement, smooth motion toward slot centers
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;    // 1000
const H = canvas.height;   // 700
const FPS = 60;

// Pygame-matched constants
const ROAD_WIDTH = 180;
const CAR_LEN = 44;
const CAR_WID = 24;
const STOP_GAP = 140;
const STOP_OFFSET = 30;         // used for stopping threshold
const SPAWN_INTERVAL = 50;      // frames
const MAX_CARS = 40;

// Layout centers
const CENTER_X = Math.floor(W / 2);
const CENTER_Y = Math.floor(H / 2);
const LANE_SHIFT = Math.floor(ROAD_WIDTH / 4);

// Stop lines (same as Pygame)
const STOP = {
  N: CENTER_Y + STOP_GAP,
  S: CENTER_Y - STOP_GAP,
  E: CENTER_X - STOP_GAP,
  W: CENTER_X + STOP_GAP
};

// Lane center positions
const LANE = {
  N: CENTER_X - LANE_SHIFT,
  S: CENTER_X + LANE_SHIFT,
  E: CENTER_Y - LANE_SHIFT,
  W: CENTER_Y + LANE_SHIFT
};

// Slot system settings
const SLOT_GAP = 65;       // chosen Option C
const SLOTS_MAX = 8;       // per-lane slot count

// Precompute slot positions for deterministic non-overlap
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

// Colors
const CAR_COLOR = 'rgb(200,80,70)';
const GLASS = 'rgb(160,220,255)';
const ROAD = 'rgb(30,30,30)';
const BG = 'rgb(50,50,50)';
const WHITE = '#ffffff';
const RED = 'rgb(255,0,0)';
const YELLOW = 'rgb(255,230,0)';
const GREEN = 'rgb(0,255,0)';

// ---------- Utilities ----------
function rand(min, max){ return Math.random() * (max - min) + min; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// ---------- SIGNAL (density-based aggressive scaling C) ----------
class Signal {
  constructor(){
    this.dir = 'S';       // start like original Pygame order starting point
    this.phase = 'green'; // 'green' or 'yellow'
    this.framesLeft = 15 * FPS; // initial green (15s)
  }

  tick(){
    this.framesLeft--;
    if(this.phase === 'green' && this.framesLeft <= 0){
      this.phase = 'yellow';
      this.framesLeft = 3 * FPS; // yellow 3s
      return;
    }
    if(this.phase === 'yellow' && this.framesLeft <= 0){
      // pick next by density
      const next = nextGreenDirection();
      this.dir = next;
      this.phase = 'green';
      // aggressive scaling C: green = min(35, 10 + 1.5 * waiting)
      const waiting = waitingCount(next);
      const secs = Math.min(35, 10 + 1.5 * waiting);
      this.framesLeft = Math.round(secs * FPS);
    }
  }

  state(){
    return {N:'RED',E:'RED',S:'RED',W:'RED', active: this.dir, phase: this.phase};
  }

  countdown(){ return Math.max(0, Math.ceil(this.framesLeft / FPS)); }
  current(){ return this.dir; }
}
const signal = new Signal();

// ---------- SLOT-BASED CAR ----------
class Car {
  constructor(dir, slotIndex, kind='car'){
    this.dir = dir;
    this.slot = slotIndex;   // 0 is nearest to stop line
    this.kind = kind;
    this.crossed = false;
    // speed small for smooth movement (px/frame)
    this.speed = (kind === 'car') ? rand(0.9,1.4) : (kind==='bike' ? rand(1.0,1.6) : rand(0.8,1.2));

    // set size depending on orientation (match Pygame)
    if(dir === 'N' || dir === 'S'){ this.w = CAR_WID; this.h = CAR_LEN; }
    else { this.w = CAR_LEN; this.h = CAR_WID; }

    // spawn exactly at the slot center position
    const p = SLOT_POS[dir][slotIndex];
    this.x = p.x;
    this.y = p.y;
  }

  front(){
    if(this.dir === 'N') return this.y;
    if(this.dir === 'S') return this.y + this.h;
    if(this.dir === 'E') return this.x + this.w;
    return this.x;
  }

  // Update behaviour: move toward slot in front if available; if slot 0 and green -> move forward through intersection
  update(state, curGreen){
    // If already crossed, move straight through offscreen
    if(this.crossed){
      if(this.dir === 'N') this.y -= this.speed;
      else if(this.dir === 'S') this.y += this.speed;
      else if(this.dir === 'E') this.x += this.speed;
      else if(this.dir === 'W') this.x -= this.speed;
      return;
    }

    // Update crossed status when front passes stop line threshold
    if(!this.crossed){
      if(this.dir === 'N' && this.front() < STOP.N) this.crossed = true;
      if(this.dir === 'S' && this.front() > STOP.S) this.crossed = true;
      if(this.dir === 'E' && this.front() > STOP.E) this.crossed = true;
      if(this.dir === 'W' && this.front() < STOP.W) this.crossed = true;
      if(this.crossed){
        // once crossed, allow it to continue next frame
        return;
      }
    }

    // Determine if allowed to move toward center:
    // - If slot > 0: move into slot-1 only if slot-1 is free (we guarantee this by slot occupancy rules)
    // - If slot == 0: move into intersection only if this direction is green
    const myState = state[this.dir]; // 'GREEN'/'YELLOW'/'RED' per draw_signals usage
    const allowed = (this.slot > 0) ? slotAheadIsFree(this.dir, this.slot) : (myState === 'GREEN' && curGreen === this.dir);

    if(allowed){
      if(this.slot > 0){
        // move toward slot center of slot-1
        const target = SLOT_POS[this.dir][this.slot - 1];
        this.moveToward(target.x, target.y);
        // if we are very close to next slot center, hop slot index
        const dx = target.x - this.x, dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if(dist < 1.2) this.slot = this.slot - 1;
      } else {
        // slot 0 and allowed (green): move through intersection - target is a point beyond junction center
        let targetX = this.x, targetY = this.y;
        if(this.dir === 'N') targetY = -200;
        if(this.dir === 'S') targetY = H + 200;
        if(this.dir === 'E') targetX = W + 200;
        if(this.dir === 'W') targetX = -200;
        this.moveToward(targetX, targetY);
      }
    } else {
      // not allowed -> hold position at current slot center (snap-to-slot)
      const slotCenter = SLOT_POS[this.dir][this.slot];
      // gently approach center if slightly moved
      this.moveToward(slotCenter.x, slotCenter.y, true);
    }
  }

  // move toward target with optional snap (if snap true speed reduced)
  moveToward(tx, ty, snap=false){
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    if(dist < 0.01) return;
    // speed factor - snap uses slow factor to avoid jitter
    const step = (snap ? Math.min(this.speed * 0.6, dist) : Math.min(this.speed, dist));
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
  }

  draw(){
    // body
    ctx.fillStyle = CAR_COLOR;
    roundRect(ctx, Math.round(this.x), Math.round(this.y), this.w, this.h, 6);
    ctx.fill();
    // glass
    ctx.fillStyle = GLASS;
    if(this.dir === 'N' || this.dir === 'S'){
      ctx.fillRect(Math.round(this.x + 4), Math.round(this.y + 6), Math.max(2,this.w - 8), Math.round(this.h * 0.3));
    } else {
      ctx.fillRect(Math.round(this.x + 6), Math.round(this.y + 4), Math.round(this.w * 0.3), Math.max(2,this.h - 8));
    }
  }

  offscreen(){
    return (this.x + this.w < -250 || this.x > W + 250 || this.y + this.h < -250 || this.y > H + 250);
  }
}

// Global arrays
const cars = [];
let frame = 0;

// ---------- SLOT / SPAWN HELPERS ----------

// Returns true if slotIndex-1 is free (no car currently assigned to it)
function slotAheadIsFree(dir, slotIndex){
  // if slotIndex==0, ahead is intersection not a slot; this method only called for slot>0
  const occupied = cars.some(c => c.dir === dir && c.slot === (slotIndex - 1) && !c.crossed);
  return !occupied;
}

// count waiting (not crossed) vehicles for a direction
function waitingCount(dir){
  return cars.filter(c => c.dir === dir && !c.crossed).length;
}

// choose next green by highest waiting count; if all zero rotate in S,W,N,E order to avoid starvation
function nextGreenDirection(){
  const counts = {N:0,E:0,S:0,W:0};
  for(const d of ['N','E','S','W']) counts[d] = waitingCount(d);
  let max = -1, best = signal.dir;
  for(const d of ['N','E','S','W']){
    if(counts[d] > max){ max = counts[d]; best = d; }
  }
  if(max === 0){
    const order = ['S','W','N','E'];
    const i = order.indexOf(signal.dir);
    return order[(i + 1) % order.length];
  }
  return best;
}

// spawn: place car into highest empty slot index for chosen direction
function trySpawn(){
  if(frame % SPAWN_INTERVAL !== 0) return;
  if(cars.length >= MAX_CARS) return;

  // pick a lane randomly (you can bias if needed)
  const dirs = ['N','E','S','W'];
  const choice = dirs[Math.floor(Math.random()*dirs.length)];

  // find highest free slot
  const occupiedSlots = new Set(cars.filter(c => c.dir === choice && !c.crossed).map(c => c.slot));
  for(let s = SLOTS_MAX - 1; s >= 0; s--){
    if(!occupiedSlots.has(s)){
      // small chance to spawn bike/auto or else car; keep mostly cars for your screenshot
      const r = Math.random();
      const kind = (r < 0.06 ? 'bike' : (r < 0.12 ? 'auto' : 'car'));
      cars.push(new Car(choice, s, kind));
      return;
    }
  }
}

// ---------- DRAW FUNCTIONS ----------
function drawRoads(){
  ctx.fillStyle = ROAD;
  ctx.fillRect(CENTER_X - ROAD_WIDTH/2, 0, ROAD_WIDTH, H);
  ctx.fillRect(0, CENTER_Y - ROAD_WIDTH/2, W, ROAD_WIDTH);

  // stop lines (thin white)
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(CENTER_X - ROAD_WIDTH/2, STOP.N); ctx.lineTo(CENTER_X + ROAD_WIDTH/2, STOP.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CENTER_X - ROAD_WIDTH/2, STOP.S); ctx.lineTo(CENTER_X + ROAD_WIDTH/2, STOP.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.E, CENTER_Y - ROAD_WIDTH/2); ctx.lineTo(STOP.E, CENTER_Y + ROAD_WIDTH/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.W, CENTER_Y - ROAD_WIDTH/2); ctx.lineTo(STOP.W, CENTER_Y + ROAD_WIDTH/2); ctx.stroke();

  // center white box
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 3;
  const CBOX = 80;
  ctx.strokeRect(CENTER_X - CBOX, CENTER_Y - CBOX, CBOX*2, CBOX*2);
}

// draw a single signal pole (40x120) and 3 lights; show timer above for active pole
function drawSignalPole(x, y, activeState, timer){
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(x, y, 40, 120);
  // lights: red, yellow, green
  // red pos
  const lights = [
    {cx: x+20, cy: y+20, color: RED},
    {cx: x+20, cy: y+50, color: YELLOW},
    {cx: x+20, cy: y+80, color: GREEN}
  ];
  for(let i=0;i<lights.length;i++){
    const L = lights[i];
    // active only if matches the pole's phase
    let fillCol = 'rgb(90,90,90)';
    if(activeState === 'GREEN' && i === 2) fillCol = GREEN;
    if(activeState === 'YELLOW' && i === 1) fillCol = YELLOW;
    if(activeState === 'RED' && i === 0) fillCol = RED;
    // draw circle
    ctx.beginPath(); ctx.fillStyle = fillCol; ctx.arc(L.cx, L.cy, 10, 0, Math.PI*2); ctx.fill();
  }
  // timer above if provided
  if(typeof timer === 'number'){
    ctx.fillStyle = WHITE; ctx.font = '18px Arial'; ctx.textAlign = 'center';
    ctx.fillText(String(timer), x + 20, y - 15);
  }
}

// wrapper to place poles exactly as Pygame coordinates
function drawSignals(){
  const st = signal.state(); // object with N/E/S/W keys 'RED'/'YELLOW'/'GREEN' plus active,phase props
  const mapping = {
    N: [CENTER_X - 20, CENTER_Y - 250],
    S: [CENTER_X - 20, CENTER_Y + 130],
    E: [CENTER_X + 180, CENTER_Y - 60],
    W: [CENTER_X - 250, CENTER_Y - 60]
  };
  for(const d of ['N','E','S','W']){
    const [x,y] = mapping[d];
    const t = (d === signal.current()) ? signal.countdown() : null;
    drawSignalPole(x, y, (st[d] === 'GREEN' ? 'GREEN' : (st[d] === 'YELLOW' ? 'YELLOW' : 'RED')), t);
  }
}

// ---------- MAIN LOOP ----------
function mainLoop(){
  frame++;
  // background
  ctx.fillStyle = BG;
  ctx.fillRect(0,0,W,H);

  // scene
  drawRoads();
  // update signal
  signal.tick();
  drawSignals();

  // spawn
  trySpawn();

  // update cars
  // Update in order farthest to nearest to avoid jitter in slot movement (optional)
  cars.sort((a,b) => {
    const da = Math.hypot((a.x + a.w/2) - CENTER_X, (a.y + a.h/2) - CENTER_Y);
    const db = Math.hypot((b.x + b.w/2) - CENTER_X, (b.y + b.h/2) - CENTER_Y);
    return db - da; // farthest first
  });

  for(let i=cars.length-1;i>=0;i--){
    const c = cars[i];
    c.update(signal.state(), signal.current());
    c.draw();
    if(c.offscreen()){
      cars.splice(i,1);
    }
  }

  // bottom info text
  ctx.fillStyle = WHITE;
  ctx.font = '20px Arial';
  ctx.textAlign = 'center';
  const info = `Current Green: ${signal.current()} | Time Left: ${signal.countdown()}s | Cars: ${cars.length}`;
  ctx.fillText(info, CENTER_X, H - 30);

  requestAnimationFrame(mainLoop);
}

// Initialize with deterministic small queues to visualize stopped cars immediately
(function initQueues(){
  // place first 3 slots in each lane filled like your earlier screenshot
  const initial = 3;
  const lanes = ['N','E','S','W'];
  for(const d of lanes){
    for(let s = 0; s < initial; s++){
      // ensure we don't exceed SLOTS_MAX
      if(s < SLOTS_MAX) cars.push(new Car(d, s, 'car'));
    }
  }
  // extra few to make scene look similar
  cars.push(new Car('E', 3, 'car'));
  cars.push(new Car('W', 3, 'car'));
})();

requestAnimationFrame(mainLoop);
