/* Final realistic straight-only traffic sim
   - density-based green selection
   - yellow transition
   - smooth acceleration & deceleration
   - cars/bikes/autos optionally but default mostly cars
   - ONLY straight movement (no turning)
   - vehicles stop before stop line and do not stop inside junction
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width, H = canvas.height;
const CX = W/2, CY = H/2;

// Visual config (tuned to match your reference screenshot)
const ROAD_W = 160;
const STOP_OFFSET = 110; // distance from center to stop line
const STOP = {
  N: CY + STOP_OFFSET,
  S: CY - STOP_OFFSET,
  E: CX - STOP_OFFSET,
  W: CX + STOP_OFFSET
};

// car appearance
const CAR_W = 36, CAR_H = 18;
const SAFE_GAP = 48;         // px between vehicles
const FPS = 60;

// directions
const DIRS = ['N','E','S','W'];

// signal state
let signal = { dir: 'N', phase: 'green' }; // phase = 'green' or 'yellow'
let timerFrames = 15 * FPS;                // frames left in current phase

// spawn / vehicles
let vehicles = [];
let spawnCounter = 0;
const SPAWN_INTERVAL = 80;
const MAX_VEHICLES = 160;

// lanes for spawn alignment
const LANE = {
  N: { x: CX - ROAD_W/4, startY: H + 120 },
  S: { x: CX + ROAD_W/4, startY: -160 },
  E: { y: CY - ROAD_W/4, startX: -160 },
  W: { y: CY + ROAD_W/4, startX: W + 160 }
};

// helper random
const rand = (a,b) => Math.random()*(b-a)+a;

// Vehicle class (straight-only)
class Vehicle {
  constructor(dir, kind='car'){
    this.dir = dir;          // 'N','E','S','W'
    this.kind = kind;        // 'car','bike','auto' (visual size diff)
    // sizes
    if(this.kind === 'car'){ this.w = CAR_W; this.h = CAR_H; }
    else if(this.kind === 'bike'){ this.w = 26; this.h = 12; }
    else { this.w = 30; this.h = 14; } // auto

    // spawn position
    if(this.dir === 'N'){ this.x = LANE.N.x - this.w/2; this.y = LANE.N.startY + rand(0,80); }
    if(this.dir === 'S'){ this.x = LANE.S.x - this.w/2; this.y = LANE.S.startY - rand(0,80); }
    if(this.dir === 'E'){ this.x = LANE.E.startX - rand(0,80); this.y = LANE.E.y - this.h/2; }
    if(this.dir === 'W'){ this.x = LANE.W.startX + rand(0,80); this.y = LANE.W.y - this.h/2; }

    // movement & physics
    this.v = 0;                      // current speed px/frame
    this.desiredV = this.baseSpeed();
    this.crossed = false;            // becomes true when front passes stop line
    this.color = this.defaultColor();
  }

  baseSpeed(){
    // slower realistic speeds (px/frame)
    if(this.kind === 'car') return rand(0.7,1.05);
    if(this.kind === 'bike') return rand(0.85,1.2);
    return rand(0.6,0.95); // auto
  }

  defaultColor(){
    if(this.kind === 'car') return '#c95752';
    if(this.kind === 'bike') return '#ffd46a';
    return '#9be07b';
  }

  front(){
    if(this.dir === 'N') return this.y;
    if(this.dir === 'S') return this.y + this.h;
    if(this.dir === 'E') return this.x + this.w;
    return this.x;
  }

  gapToAhead(){
    let min = null;
    for(const o of vehicles){
      if(o === this || o.dir !== this.dir) continue;
      if(this.dir === 'N' && o.y < this.y){
        const d = this.y - (o.y + o.h);
        if(d >= 0 && (min == null || d < min)) min = d;
      }
      if(this.dir === 'S' && o.y > this.y){
        const d = o.y - (this.y + this.h);
        if(d >= 0 && (min == null || d < min)) min = d;
      }
      if(this.dir === 'E' && o.x > this.x){
        const d = o.x - (this.x + this.w);
        if(d >= 0 && (min == null || d < min)) min = d;
      }
      if(this.dir === 'W' && o.x < this.x){
        const d = this.x - (o.x + o.w);
        if(d >= 0 && (min == null || d < min)) min = d;
      }
    }
    return min;
  }

  atStopZone(){
    const f = this.front();
    if(this.dir === 'N') return f <= STOP.N + 6;
    if(this.dir === 'S') return f >= STOP.S - 6;
    if(this.dir === 'E') return f >= STOP.E - 6;
    if(this.dir === 'W') return f <= STOP.W + 6;
    return false;
  }

  step(){
    // lane alignment
    if(this.dir === 'N' || this.dir === 'S') this.x = (this.dir === 'N' ? LANE.N.x : LANE.S.x) - this.w/2;
    else this.y = (this.dir === 'E' ? LANE.E.y : LANE.W.y) - this.h/2;

    // gap check
    const gap = this.gapToAhead();
    const tooClose = (gap != null && gap < SAFE_GAP);

    // check crossing
    const f = this.front();
    if(!this.crossed){
      if(this.dir === 'N' && f < STOP.N) this.crossed = true;
      if(this.dir === 'S' && f > STOP.S) this.crossed = true;
      if(this.dir === 'E' && f > STOP.E) this.crossed = true;
      if(this.dir === 'W' && f < STOP.W) this.crossed = true;
    }

    // determine whether movement allowed:
    const allowStart = (signal.dir === this.dir && signal.phase === 'green');

    const mustStop = (!this.crossed && !allowStart && this.atStopZone());

    // smooth accel/decel parameters
    const ACCEL = 0.02;   // px/frame^2 approx (accelerate)
    const DECEL = 0.06;   // braking

    if(tooClose || mustStop){
      // brake quickly
      this.v = Math.max(0, this.v - DECEL);
    } else if(this.crossed || allowStart){
      // accelerate to desired speed
      if(this.v < this.desiredV) this.v = Math.min(this.desiredV, this.v + ACCEL);
      else this.v = Math.max(this.desiredV, this.v - 0.001);
    } else {
      // red and not crossed: hold
      this.v = Math.max(0, this.v - DECEL*1.2);
    }

    // apply movement straight only
    if(this.v > 0){
      if(this.dir === 'N') this.y -= this.v;
      else if(this.dir === 'S') this.y += this.v;
      else if(this.dir === 'E') this.x += this.v;
      else if(this.dir === 'W') this.x -= this.v;
    }
  }

  offscreen(){
    return (this.x < -300 || this.x > W + 300 || this.y < -300 || this.y > H + 300);
  }

  draw(){
    // car body with small windshield similar to your reference
    ctx.save();
    ctx.fillStyle = this.color;
    roundRect(ctx, this.x, this.y, this.w, this.h, 4);
    ctx.fill();

    // slight border
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // windshield/window highlight
    ctx.fillStyle = '#9fd8ff';
    if(this.dir === 'N' || this.dir === 'S'){
      ctx.fillRect(this.x + 6, this.y + 3, this.w - 12, Math.max(2, this.h * 0.45));
    } else {
      ctx.fillRect(this.x + 3, this.y + 4, Math.max(2, this.w * 0.4), this.h - 8);
    }
    ctx.restore();
  }
}

// helper to draw rounded rect
function roundRect(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r);
  c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r);
  c.arcTo(x,y,x+w,y,r); c.closePath();
}

// -------------------- DRAW SCENE --------------------
function drawScene(){
  ctx.clearRect(0,0,W,H);
  // background
  ctx.fillStyle = '#262626';
  ctx.fillRect(0,0,W,H);

  // horizontal road
  ctx.fillStyle = '#232323';
  ctx.fillRect(0, CY - ROAD_W/2, W, ROAD_W);

  // vertical road
  ctx.fillRect(CX - ROAD_W/2, 0, ROAD_W, H);

  // central white junction box
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(CX - 80, CY - 80, 160, 160);

  // stop lines (thin white)
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(CX - ROAD_W/2, STOP.N); ctx.lineTo(CX + ROAD_W/2, STOP.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CX - ROAD_W/2, STOP.S); ctx.lineTo(CX + ROAD_W/2, STOP.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.E, CY - ROAD_W/2); ctx.lineTo(STOP.E, CY + ROAD_W/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.W, CY - ROAD_W/2); ctx.lineTo(STOP.W, CY + ROAD_W/2); ctx.stroke();

  // subtle center dashed lines (match reference)
  ctx.strokeStyle = '#1f1f1f';
  ctx.lineWidth = 2;
  for(let x=20; x < W-20; x += 28){ ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x+12, CY); ctx.stroke(); }
  for(let y=20; y < H-20; y += 28){ ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX, y+12); ctx.stroke(); }
}

// -------------------- DRAW SIGNALS (exact style) --------------------
function drawSignals(){
  // positions tuned to match reference screenshot precisely
  const pos = {
    N: [CX - 12, STOP.N - 50],
    S: [CX + 12, STOP.S + 18],
    E: [STOP.E + 18, CY - 12],
    W: [STOP.W - 50, CY + 12]
  };

  for(const d of DIRS){
    const [x,y] = pos[d];

    // box
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x, y, 28, 72);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(x, y, 28, 72);

    // draw three circles vertical
    // top (red)
    ctx.beginPath();
    ctx.fillStyle = (signal.dir === d && signal.phase === 'green') ? '#6b1e1e' : '#d63a3a';
    // For correctness: top should be red. We'll make top red highlighted only when NOT green (as in your ref top red is off)
    // So top is red always (dim/red) but not lit when green; We'll make green show bottom lit
    ctx.arc(x + 14, y + 12, 8, 0, Math.PI*2);
    ctx.fill();

    // middle (yellow)
    ctx.beginPath();
    ctx.fillStyle = '#7a6f21';
    ctx.arc(x + 14, y + 32, 8, 0, Math.PI*2);
    ctx.fill();

    // bottom (green)
    ctx.beginPath();
    const greenLit = (signal.dir === d && signal.phase === 'green');
    ctx.fillStyle = greenLit ? '#36c72a' : '#2a4f2b';
    ctx.arc(x + 14, y + 52, 8, 0, Math.PI*2);
    ctx.fill();

    // small numeric timer above green in N position (match reference)
    if(d === 'N'){
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(Math.max(0, Math.ceil(timerFrames / FPS)), x + 14, y - 12);
    }
  }
}

// -------------------- SPAWNING --------------------
function canSpawn(dir){
  for(const v of vehicles){
    if(v.dir !== dir) continue;
    if(dir === 'N'){ if(v.y < LANE.N.startY + 140) return false; }
    if(dir === 'S'){ if(v.y > LANE.S.startY - 140) return false; }
    if(dir === 'E'){ if(v.x > LANE.E.startX - 140) return false; }
    if(dir === 'W'){ if(v.x < LANE.W.startX + 140) return false; }
  }
  return true;
}

function spawnStep(){
  spawnCounter++;
  if(spawnCounter < SPAWN_INTERVAL) return;
  spawnCounter = 0;
  const order = DIRS.slice();
  for(let i=0;i<4;i++){
    const idx = Math.floor(Math.random()*order.length);
    const dir = order.splice(idx,1)[0];
    if(vehicles.length >= MAX_VEHICLES) return;
    if(canSpawn(dir)){
      // choose type with bias towards cars (keeps look like reference)
      const r = Math.random();
      let kind = 'car';
      if(r < 0.08) kind = 'bike';
      else if(r < 0.14) kind = 'auto';
      vehicles.push(new Vehicle(dir, kind));
      return;
    }
  }
}

// -------------------- SIGNAL LOGIC (density + yellow) --------------------
function evaluateSignals(){
  if(timerFrames > 0) return;

  if(signal.phase === 'green'){
    // move to yellow
    signal.phase = 'yellow';
    timerFrames = 2 * FPS; // fixed yellow (2s)
    return;
  }

  if(signal.phase === 'yellow'){
    // pick next green based on queued vehicles (not crossed)
    const density = { N:0, E:0, S:0, W:0 };
    for(const v of vehicles) if(!v.crossed) density[v.dir]++;

    // choose max queue
    let next = 'N', max = -1;
    for(const d of DIRS){
      if(density[d] > max){ max = density[d]; next = d; }
    }

    // if all queues are 0, rotate to next to prevent stalling
    if(max === 0){
      const idx = (DIRS.indexOf(signal.dir) + 1) % DIRS.length;
      next = DIRS[idx];
    }

    signal.dir = next;
    signal.phase = 'green';
    // green duration based on queue length (more queue => longer green)
    let greenSec = Math.min(25, 8 + max * 1.6);
    if(greenSec < 8) greenSec = 8;
    timerFrames = Math.round(greenSec * FPS);
    return;
  }
}

// -------------------- MAIN LOOP --------------------
function mainLoop(){
  // timer decrement
  timerFrames--;
  evaluateSignals();

  // spawn vehicles
  spawnStep();

  // update vehicles
  for(const v of vehicles) v.step();

  // remove offscreen
  for(let i = vehicles.length -1; i >= 0; i--){
    if(vehicles[i].offscreen()) vehicles.splice(i,1);
  }

  // drawing
  drawScene();
  drawSignals();

  // painter order: farther first -> near last
  vehicles.sort((a,b) => {
    const da = Math.hypot((a.x+a.w/2)-CX, (a.y+a.h/2)-CY);
    const db = Math.hypot((b.x+b.w/2)-CX, (b.y+b.h/2)-CY);
    return da - db;
  });

  for(const v of vehicles) v.draw();

  // update status bottom text
  const total = vehicles.length;
  const secLeft = Math.max(0, Math.ceil(timerFrames / FPS));
  document.getElementById('statusText').textContent = `Current Green: ${signal.dir} | Time Left: ${secLeft}s | Cars: ${total}`;

  requestAnimationFrame(mainLoop);
}

// -------------------- INIT --------------------
// populate initial vehicles so red directions show waiting cars
for(let i=0;i<5;i++){
  vehicles.push(new Vehicle('N','car'));
  vehicles.push(new Vehicle('E','car'));
  vehicles.push(new Vehicle('S','car'));
  vehicles.push(new Vehicle('W','car'));
}
// add a few bikes/autos randomly
vehicles.push(new Vehicle('E','bike'));
vehicles.push(new Vehicle('W','auto'));

signal = { dir: 'N', phase: 'green' };
timerFrames = 15 * FPS;

requestAnimationFrame(mainLoop);
