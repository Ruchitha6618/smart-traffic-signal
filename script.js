/* STRICT SLOT-BASED NON-OVERLAP (REPLACE your script.js with this)
   - Slot gap = 65 px
   - Strict slot occupancy checks using bounding boxes
   - Spawning refuses occupied slot bounding boxes
   - Snaps cars to slot center each frame (no drift)
   - Density-based aggressive green scaling (C)
   - Debug console prints occupancy (can be removed later)
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width, H = canvas.height, FPS = 60;

// Pygame constants
const ROAD_WIDTH = 180;
const CAR_LEN = 44;
const CAR_WID = 24;
const STOP_GAP = 140;
const STOP_OFFSET = 30;
const SPAWN_INTERVAL = 50;
const MAX_CARS = 40;

const CENTER_X = Math.floor(W/2), CENTER_Y = Math.floor(H/2);
const LANE_SHIFT = Math.floor(ROAD_WIDTH/4);

const STOP = {
  N: CENTER_Y + STOP_GAP,
  S: CENTER_Y - STOP_GAP,
  E: CENTER_X - STOP_GAP,
  W: CENTER_X + STOP_GAP
};

const LANE = {
  N: CENTER_X - LANE_SHIFT,
  S: CENTER_X + LANE_SHIFT,
  E: CENTER_Y - LANE_SHIFT,
  W: CENTER_Y + LANE_SHIFT
};

// Slot config
const SLOT_GAP = 65;
const SLOTS_MAX = 8;

// Compute slot centers and bounding boxes per orientation.
// For each slot we store {cx, cy, bbox: {x,y,w,h}} where bbox is where car would occupy at that slot.
const SLOT = { N:[], S:[], E:[], W:[] };

// For N: slot 0 center sits just below stop line (y slightly > STOP.N) with car oriented vertical (w=CAR_WID, h=CAR_LEN)
// We'll set slot i center at STOP.N + (i+0.5)*SLOT_GAP + offset to align visually (use 0.5 to center)
for(let i=0;i<SLOTS_MAX;i++){
  // N
  const n_cx = LANE.N - CAR_WID/2;
  const n_cy = STOP.N + (i+0.5)*SLOT_GAP;
  SLOT.N.push({
    cx: n_cx, cy: n_cy,
    bbox: { x: n_cx, y: n_cy, w: CAR_WID, h: CAR_LEN }
  });
  // S (faces down; car rectangle top-left must be at STOP.S - (i+0.5)*SLOT_GAP - CAR_LEN)
  const s_cx = LANE.S - CAR_WID/2;
  const s_cy = STOP.S - (i+0.5)*SLOT_GAP - CAR_LEN;
  SLOT.S.push({
    cx: s_cx, cy: s_cy,
    bbox: { x: s_cx, y: s_cy, w: CAR_WID, h: CAR_LEN }
  });
  // E (faces right, horizontal)
  const e_cx = STOP.E - (i+0.5)*SLOT_GAP - CAR_LEN;
  const e_cy = LANE.E - CAR_WID/2;
  SLOT.E.push({
    cx: e_cx, cy: e_cy,
    bbox: { x: e_cx, y: e_cy, w: CAR_LEN, h: CAR_WID }
  });
  // W (faces left)
  const w_cx = STOP.W + (i+0.5)*SLOT_GAP;
  const w_cy = LANE.W - CAR_WID/2;
  SLOT.W.push({
    cx: w_cx, cy: w_cy,
    bbox: { x: w_cx, y: w_cy, w: CAR_LEN, h: CAR_WID }
  });
}

// Colors
const CAR_COLOR = 'rgb(200,80,70)';
const GLASS = 'rgb(160,220,255)';
const ROAD = 'rgb(30,30,30)';
const BG = 'rgb(50,50,50)';
const WHITE = '#ffffff';
const RED = 'rgb(255,0,0)';
const YELLOW = 'rgb(255,230,0)';
const GREEN = 'rgb(0,255,0)';

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// Utility intersect check
function rectsOverlap(a,b){
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

// ---------- Signal (density-based Aggressive C) ----------
class Signal {
  constructor(){
    this.dir='S'; this.phase='green'; this.framesLeft = 15*FPS;
  }
  tick(){
    this.framesLeft--;
    if(this.phase==='green' && this.framesLeft<=0){
      this.phase='yellow'; this.framesLeft = 3*FPS; return;
    }
    if(this.phase==='yellow' && this.framesLeft<=0){
      const next = pickNextDirByDensity();
      this.dir = next;
      this.phase = 'green';
      const waiting = waitingCount(next);
      const secs = Math.min(35, 10 + 1.5 * waiting);
      this.framesLeft = Math.round(secs * FPS);
    }
  }
  state(){
    return { N:'RED', E:'RED', S:'RED', W:'RED' , active:this.dir, phase:this.phase };
  }
  countdown(){ return Math.max(0, Math.ceil(this.framesLeft / FPS)); }
  current(){ return this.dir; }
}
const signal = new Signal();

// ---------- Car (slot-based, snap-to-slot strict) ----------
class Car {
  constructor(dir, slot, kind='car'){
    this.dir=dir; this.slot=slot; this.kind=kind; this.crossed=false;
    this.w = (dir==='N' || dir==='S') ? CAR_WID : CAR_LEN;
    this.h = (dir==='N' || dir==='S') ? CAR_LEN : CAR_WID;
    // speed small for smooth visible motion
    this.speed = (kind==='car') ? 1.15 : (kind==='bike'?1.25:1.05);
    // Place exactly at slot bounding box (snap)
    const s = SLOT[dir][slot];
    this.x = s.bbox.x; this.y = s.bbox.y;
  }

  front(){
    if(this.dir==='N') return this.y;
    if(this.dir==='S') return this.y + this.h;
    if(this.dir==='E') return this.x + this.w;
    return this.x;
  }

  // Strict update: snap to slot centers and only move if next slot free (or green if slot0)
  update(state, curGreen){
    // if crossed -> continue offscreen (straight)
    if(this.crossed){
      if(this.dir==='N') this.y -= this.speed;
      else if(this.dir==='S') this.y += this.speed;
      else if(this.dir==='E') this.x += this.speed;
      else if(this.dir==='W') this.x -= this.speed;
      return;
    }

    // mark crossed when front passes stop
    if(!this.crossed){
      if(this.dir==='N' && this.front() < STOP.N) this.crossed=true;
      if(this.dir==='S' && this.front() > STOP.S) this.crossed=true;
      if(this.dir==='E' && this.front() > STOP.E) this.crossed=true;
      if(this.dir==='W' && this.front() < STOP.W) this.crossed=true;
      if(this.crossed) return;
    }

    // Determine allowed to move:
    // if slot>0 -> allowed if slot-1 bbox is empty
    // if slot==0 -> allowed only if this dir is green
    const st = state[this.dir]; // 'GREEN'/'YELLOW'/'RED'
    let allowed = false;
    if(this.slot > 0){
      // check occupancy: is there any car occupying slot-1 bbox (not crossed)
      const targetBBox = SLOT[this.dir][this.slot - 1].bbox;
      const occupied = cars.some(c => c !== this && c.dir===this.dir && !c.crossed && rectsOverlap(targetBBox, {x:c.x,y:c.y,w:c.w,h:c.h}));
      allowed = !occupied;
    } else {
      // slot 0
      allowed = (st === 'GREEN' && curGreen === this.dir);
    }

    if(allowed){
      if(this.slot > 0){
        // move toward next slot bbox center
        const target = SLOT[this.dir][this.slot - 1];
        this.moveToward(target.bbox.x, target.bbox.y);
        // snap condition: if center is reached close enough -> claim slot-1
        const dx = target.bbox.x - this.x, dy = target.bbox.y - this.y;
        if(Math.hypot(dx,dy) < 0.8) this.slot = this.slot - 1;
      } else {
        // slot0 and allowed -> move through intersection with target far
        if(this.dir === 'N') this.y -= this.speed;
        if(this.dir === 'S') this.y += this.speed;
        if(this.dir === 'E') this.x += this.speed;
        if(this.dir === 'W') this.x -= this.speed;
      }
    } else {
      // Not allowed: snap back to current slot bbox exactly (prevent drift)
      const here = SLOT[this.dir][this.slot].bbox;
      // Snap instantly (stronger) to avoid any overlap from small floating drift
      this.x = here.x;
      this.y = here.y;
    }
  }

  moveToward(tx, ty){
    const dx = tx - this.x, dy = ty - this.y;
    const dist = Math.hypot(dx,dy);
    if(dist < 0.5) { this.x = tx; this.y = ty; return; }
    const step = Math.min(this.speed, dist);
    this.x += dx/dist * step;
    this.y += dy/dist * step;
  }

  draw(){
    ctx.fillStyle = CAR_COLOR;
    roundRect(ctx, Math.round(this.x), Math.round(this.y), this.w, this.h, 6);
    ctx.fill();
    ctx.fillStyle = GLASS;
    if(this.dir==='N' || this.dir==='S') ctx.fillRect(this.x+4, this.y+6, Math.max(2,this.w-8), Math.round(this.h*0.3));
    else ctx.fillRect(this.x+6, this.y+4, Math.round(this.w*0.3), Math.max(2,this.h-8));
  }

  offscreen(){
    return (this.x + this.w < -200 || this.x > W + 200 || this.y + this.h < -200 || this.y > H + 200);
  }
}

// global car list
const cars = [];
let frame = 0;

// ===== helpers =====
function waitingCount(dir){ return cars.filter(c=>c.dir===dir && !c.crossed).length; }

function pickNextDirByDensity(){
  const counts = {N:0,E:0,S:0,W:0};
  for(const d of ['N','E','S','W']) counts[d]=waitingCount(d);
  let max=-1, best=signal.dir;
  for(const d of ['N','E','S','W']) if(counts[d]>max){ max=counts[d]; best=d; }
  if(max===0){
    const order=['S','W','N','E'];
    const i=order.indexOf(signal.dir);
    return order[(i+1)%4];
  }
  return best;
}

// Check if a slot bbox is completely free (no overlap with any car not crossed)
function isSlotFree(dir, slotIndex){
  const bbox = SLOT[dir][slotIndex].bbox;
  for(const c of cars){
    if(c.crossed) continue;
    if(c.dir !== dir) continue;
    const cb = { x: c.x, y: c.y, w: c.w, h: c.h };
    if(rectsOverlap(bbox, cb)) return false;
  }
  return true;
}

// Strict spawn: choose random direction but only claim a slot if its bbox free
function trySpawn(){
  if(frame % SPAWN_INTERVAL !== 0) return;
  if(cars.length >= MAX_CARS) return;

  const lanes = ['N','E','S','W'];
  // try up to all lanes to spawn
  const order = lanes.sort(()=>Math.random()-0.5);
  for(const d of order){
    // find highest free slot index
    for(let s = SLOTS_MAX-1; s>=0; s--){
      if(isSlotFree(d,s)){
        // spawn
        const r = Math.random(); const kind = (r<0.06?'bike':(r<0.12?'auto':'car'));
        cars.push(new Car(d,s,kind));
        return;
      }
    }
  }
}

// ---------- draw functions ----------
function drawRoads(){
  ctx.fillStyle = ROAD;
  ctx.fillRect(CENTER_X-ROAD_WIDTH/2,0,ROAD_WIDTH,H);
  ctx.fillRect(0,CENTER_Y-ROAD_WIDTH/2,W,ROAD_WIDTH);

  ctx.strokeStyle = WHITE; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(CENTER_X-ROAD_WIDTH/2, STOP.N); ctx.lineTo(CENTER_X+ROAD_WIDTH/2, STOP.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CENTER_X-ROAD_WIDTH/2, STOP.S); ctx.lineTo(CENTER_X+ROAD_WIDTH/2, STOP.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.E, CENTER_Y-ROAD_WIDTH/2); ctx.lineTo(STOP.E, CENTER_Y+ROAD_WIDTH/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.W, CENTER_Y-ROAD_WIDTH/2); ctx.lineTo(STOP.W, CENTER_Y+ROAD_WIDTH/2); ctx.stroke();

  // center box
  ctx.strokeStyle = WHITE; ctx.lineWidth = 3;
  ctx.strokeRect(CENTER_X - 80, CENTER_Y - 80, 160, 160);
}

function drawSignalPole(x,y,active, timer){
  ctx.fillStyle='rgb(40,40,40)'; ctx.fillRect(x,y,40,120);
  const lights = [{cy:y+20},{cy:y+50},{cy:y+80}];
  for(let i=0;i<3;i++){
    const color = (active==='GREEN' && i===2) ? GREEN : (active==='YELLOW' && i===1) ? YELLOW : (active==='RED' && i===0) ? RED : 'rgb(90,90,90)';
    ctx.beginPath(); ctx.fillStyle = color; ctx.arc(x+20, lights[i].cy, 10, 0, Math.PI*2); ctx.fill();
  }
  if(typeof timer === 'number'){ ctx.fillStyle=WHITE; ctx.font='18px Arial'; ctx.textAlign='center'; ctx.fillText(String(timer), x+20, y-15); }
}

function drawSignals(){
  const st = signal.state();
  const map = { N:[CENTER_X-20, CENTER_Y-250], S:[CENTER_X-20, CENTER_Y+130], E:[CENTER_X+180, CENTER_Y-60], W:[CENTER_X-250, CENTER_Y-60] };
  for(const d of ['N','E','S','W']){
    const [x,y]=map[d];
    const t = (d===signal.current())? signal.countdown() : null;
    drawSignalPole(x,y, st[d] === 'GREEN' ? 'GREEN' : st[d] === 'YELLOW' ? 'YELLOW' : 'RED', t);
  }
}

// ---------- main loop ----------
function loop(){
  frame++;
  ctx.fillStyle=BG; ctx.fillRect(0,0,W,H);
  drawRoads();
  // signal tick
  signal.tick();
  drawSignals();

  // spawn
  trySpawn();

  // update cars (sort farthest first helps stable slot movements)
  cars.sort((a,b)=>{
    const da = Math.hypot((a.x+a.w/2)-CENTER_X,(a.y+a.h/2)-CENTER_Y);
    const db = Math.hypot((b.x+b.w/2)-CENTER_X,(b.y+b.h/2)-CENTER_Y);
    return db - da;
  });

  for(let i=cars.length-1;i>=0;i--){
    const c = cars[i];
    c.update(signal.state(), signal.current());
    c.draw();
    if(c.offscreen()) cars.splice(i,1);
  }

  // bottom status
  ctx.fillStyle = WHITE; ctx.font='20px Arial'; ctx.textAlign='center';
  ctx.fillText(`Current Green: ${signal.current()} | Time Left: ${signal.countdown()}s | Cars: ${cars.length}`, CENTER_X, H - 30);

  // debugging - uncomment to see slot occupancy counts per lane in console (temporary)
  if(frame % (5*FPS) === 0){
    // console.log('slot occupancy: N', SLOT.N.map((s,i)=>!isSlotFree('N',i)), 'E', SLOT.E.map((s,i)=>!isSlotFree('E',i)), 'S', SLOT.S.map((s,i)=>!isSlotFree('S',i)), 'W', SLOT.W.map((s,i)=>!isSlotFree('W',i)));
  }

  requestAnimationFrame(loop);
}

// initialize with small deterministic queues similar to screenshot
(function init(){
  for(const d of ['N','E','S','W']){
    for(let s=0;s<3 && s<SLOTS_MAX;s++){
      cars.push(new Car(d,s,'car'));
    }
  }
  cars.push(new Car('E',3,'car')); cars.push(new Car('W',3,'car'));
})();

requestAnimationFrame(loop);
