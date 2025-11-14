/* Final pixel-faithful straight-only simulation
   - Exact-looking signals & cars (rectangles + windshield)
   - No turning, only straight
   - No overlapping (safe-gap enforced)
   - Density-based green selection with yellow transition
   - Smooth acceleration and deceleration
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width, H = canvas.height;
const CX = W/2, CY = H/2;

// Layout tuned to match your reference screenshot
const ROAD_W = 160;
const CENTER_BOX = 80;        // half-size for central white square
const STOP_OFFSET = 110;      // distance from center to stop line

const STOP = {
  N: CY + STOP_OFFSET,
  S: CY - STOP_OFFSET,
  E: CX - STOP_OFFSET,
  W: CX + STOP_OFFSET
};

// lanes for alignment and spawn positions
const LANE = {
  N: { x: CX - ROAD_W/4, startY: H + 120 },
  S: { x: CX + ROAD_W/4, startY: -160 },
  E: { y: CY - ROAD_W/4, startX: -160 },
  W: { y: CY + ROAD_W/4, startX: W + 160 }
};

const DIRS = ['N','E','S','W'];
const FPS = 60;

// vehicle parameters
const SAFE_GAP = 48;         // px gap to avoid overlap
const MAX_VEHICLES = 160;
const SPAWN_INTERVAL = 80;   // frames
const ACCEL = 0.02;
const DECEL = 0.06;

// signal state
let signal = { dir: 'N', phase: 'green' }; // phase: green | yellow
let timerFrames = 15 * FPS;

// vehicles list
let vehicles = [];
let spawnCounter = 0;

// random helper
const rand = (a,b) => Math.random()*(b-a)+a;

// Vehicle class (straight only)
class Vehicle {
  constructor(dir, kind='car'){
    this.dir = dir;
    this.kind = kind; // 'car','bike','auto' (visual sizes)
    if(this.kind === 'car'){ this.w = 36; this.h = 18; this.color = '#c95752'; }
    else if(this.kind === 'bike'){ this.w = 26; this.h = 12; this.color = '#ffd46a'; }
    else { this.w = 30; this.h = 14; this.color = '#9be07b'; }

    // spawn a bit back so vehicles form queue
    if(dir === 'N'){ this.x = LANE.N.x - this.w/2; this.y = LANE.N.startY + rand(0,60); }
    if(dir === 'S'){ this.x = LANE.S.x - this.w/2; this.y = LANE.S.startY - rand(0,60); }
    if(dir === 'E'){ this.x = LANE.E.startX - rand(0,60); this.y = LANE.E.y - this.h/2; }
    if(dir === 'W'){ this.x = LANE.W.startX + rand(0,60); this.y = LANE.W.y - this.h/2; }

    this.v = 0;                    // current speed (px/frame)
    this.desiredV = this.baseSpeed();
    this.crossed = false;          // true once front passes stop line
  }

  baseSpeed(){
    if(this.kind === 'car') return rand(0.7,1.05);
    if(this.kind === 'bike') return rand(0.85,1.2);
    return rand(0.6,0.95); // auto
  }

  // front edge position depending on orientation
  front(){
    if(this.dir === 'N') return this.y;
    if(this.dir === 'S') return this.y + this.h;
    if(this.dir === 'E') return this.x + this.w;
    return this.x;
  }

  // find gap to next vehicle ahead in same lane and direction
  gapToAhead(){
    let minGap = null;
    for(const o of vehicles){
      if(o === this || o.dir !== this.dir) continue;
      if(this.dir === 'N' && o.y < this.y){
        const d = this.y - (o.y + o.h);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
      if(this.dir === 'S' && o.y > this.y){
        const d = o.y - (this.y + this.h);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
      if(this.dir === 'E' && o.x > this.x){
        const d = o.x - (this.x + this.w);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
      if(this.dir === 'W' && o.x < this.x){
        const d = this.x - (o.x + o.w);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
    }
    return minGap;
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
    // keep lane alignment (so cars look straight)
    if(this.dir === 'N' || this.dir === 'S'){
      this.x = (this.dir === 'N' ? LANE.N.x : LANE.S.x) - this.w/2;
    } else {
      this.y = (this.dir === 'E' ? LANE.E.y : LANE.W.y) - this.h/2;
    }

    // compute gap and braking decision
    const gap = this.gapToAhead();
    const tooClose = gap !== null && gap < SAFE_GAP;

    // check if crossed stop line
    const f = this.front();
    if(!this.crossed){
      if(this.dir === 'N' && f < STOP.N) this.crossed = true;
      if(this.dir === 'S' && f > STOP.S) this.crossed = true;
      if(this.dir === 'E' && f > STOP.E) this.crossed = true;
      if(this.dir === 'W' && f < STOP.W) this.crossed = true;
    }

    // allowed to start only if this dir is green & phase is green
    const allowStart = (signal.dir === this.dir && signal.phase === 'green');

    // must stop if not crossed and at stopline and not allowed
    const mustStop = (!this.crossed && !allowStart && this.atStopZone());

    // speed control (smooth)
    if(tooClose || mustStop){
      this.v = Math.max(0, this.v - DECEL);
    } else if(this.crossed || allowStart){
      if(this.v < this.desiredV) this.v = Math.min(this.desiredV, this.v + ACCEL);
    } else {
      // red before crossing
      this.v = Math.max(0, this.v - DECEL*1.2);
    }

    // movement straight only
    if(this.v > 0){
      if(this.dir === 'N') this.y -= this.v;
      if(this.dir === 'S') this.y += this.v;
      if(this.dir === 'E') this.x += this.v;
      if(this.dir === 'W') this.x -= this.v;
    }
  }

  offscreen(){
    return (this.x < -300 || this.x > W + 300 || this.y < -300 || this.y > H + 300);
  }

  draw(){
    ctx.save();
    // body
    ctx.fillStyle = this.color;
    roundRect(ctx, this.x, this.y, this.w, this.h, 6);
    ctx.fill();
    // stroke
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // windshield/window
    ctx.fillStyle = '#9fd8ff';
    if(this.dir === 'N' || this.dir === 'S'){
      ctx.fillRect(this.x + 6, this.y + 3, this.w - 12, Math.max(2, this.h * 0.45));
    } else {
      ctx.fillRect(this.x + 3, this.y + 4, Math.max(2, this.w * 0.4), this.h - 8);
    }
    ctx.restore();
  }
}

// utility: rounded rect
function roundRect(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r);
  c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r);
  c.arcTo(x,y,x+w,y,r); c.closePath();
}

// draw roads, center, stop lines (matching reference)
function drawScene(){
  ctx.clearRect(0,0,W,H);

  // background panel
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(0,0,W,H);

  // horizontal road (darker outer, inner band)
  ctx.fillStyle = '#232323';
  ctx.fillRect(0, CY - ROAD_W/2, W, ROAD_W);

  // vertical road
  ctx.fillRect(CX - ROAD_W/2, 0, ROAD_W, H);

  // central white square (junction)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(CX - CENTER_BOX, CY - CENTER_BOX, CENTER_BOX*2, CENTER_BOX*2);

  // stop lines
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(CX - ROAD_W/2, STOP.N); ctx.lineTo(CX + ROAD_W/2, STOP.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CX - ROAD_W/2, STOP.S); ctx.lineTo(CX + ROAD_W/2, STOP.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.E, CY - ROAD_W/2); ctx.lineTo(STOP.E, CY + ROAD_W/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.W, CY - ROAD_W/2); ctx.lineTo(STOP.W, CY + ROAD_W/2); ctx.stroke();

  // subtle dashed cross center (aesthetic)
  ctx.strokeStyle = '#1f1f1f';
  ctx.lineWidth = 2;
  for(let x = 20; x < W-20; x += 28){ ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x+12, CY); ctx.stroke(); }
  for(let y = 20; y < H-20; y += 28){ ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX, y+12); ctx.stroke(); }
}

// draw traffic signals placed to match reference positions/pixels
function drawSignals(){
  const positions = {
    N: [CX - 12, STOP.N - 50],
    S: [CX + 12, STOP.S + 18],
    E: [STOP.E + 18, CY - 12],
    W: [STOP.W - 50, CY + 12]
  };

  for(const d of DIRS){
    const [x,y] = positions[d];

    // signal box
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x, y, 28, 72);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(x, y, 28, 72);

    // three circles (top red, mid grey, bottom grey/green)
    // top (red)
    ctx.beginPath();
    ctx.fillStyle = (signal.dir === d && signal.phase === 'green') ? '#6b1e1e' : '#d63a3a';
    ctx.arc(x + 14, y + 12, 8, 0, Math.PI*2);
    ctx.fill();

    // middle (dim grey)
    ctx.beginPath();
    ctx.fillStyle = '#6f6f6f';
    ctx.arc(x + 14, y + 32, 8, 0, Math.PI*2);
    ctx.fill();

    // bottom (green if active else dim)
    const bottomIsGreen = (signal.dir === d && signal.phase === 'green');
    ctx.beginPath();
    ctx.fillStyle = bottomIsGreen ? '#36c72a' : '#2a4f2b';
    ctx.arc(x + 14, y + 52, 8, 0, Math.PI*2);
    ctx.fill();

    // numeric timer above north signal only (match reference)
    if(d === 'N'){
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px Arial';
      ctx.textAlign = 'center';
      const secs = Math.max(0, Math.ceil(timerFrames / FPS));
      ctx.fillText(secs, x + 14, y - 12);
    }
  }
}

// spawning: ensure spacing so no overlap (use canSpawn)
function canSpawn(dir){
  for(const v of vehicles){
    if(v.dir !== dir) continue;
    if(dir === 'N' && v.y < LANE.N.startY + 140) return false;
    if(dir === 'S' && v.y > LANE.S.startY - 140) return false;
    if(dir === 'E' && v.x > LANE.E.startX - 140) return false;
    if(dir === 'W' && v.x < LANE.W.startX + 140) return false;
  }
  return true;
}

function spawnStep(){
  spawnCounter++;
  if(spawnCounter < SPAWN_INTERVAL) return;
  spawnCounter = 0;
  // random order try
  const order = DIRS.slice();
  for(let i=0;i<4;i++){
    const idx = Math.floor(Math.random()*order.length);
    const dir = order.splice(idx,1)[0];
    if(vehicles.length >= MAX_VEHICLES) return;
    if(canSpawn(dir)){
      // mostly cars to match your screenshot, occasional bike/auto
      const r = Math.random();
      const kind = r < 0.08 ? 'bike' : (r < 0.14 ? 'auto' : 'car');
      vehicles.push(new Vehicle(dir, kind));
      return;
    }
  }
}

// density-based signal logic with yellow transition
function evaluateSignals(){
  if(timerFrames > 0) return;

  if(signal.phase === 'green'){
    signal.phase = 'yellow';
    timerFrames = 2 * FPS; // 2s yellow
    return;
  }

  if(signal.phase === 'yellow'){
    // count queued (not crossed) vehicles per dir
    const q = { N:0, E:0, S:0, W:0 };
    for(const v of vehicles) if(!v.crossed) q[v.dir]++;

    // choose dir with maximum queue
    let next = 'N', max = -1;
    for(const d of DIRS){
      if(q[d] > max){ max = q[d]; next = d; }
    }
    // if none waiting, rotate
    if(max === 0){
      const idx = (DIRS.indexOf(signal.dir) + 1) % DIRS.length;
      next = DIRS[idx];
    }

    signal.dir = next;
    signal.phase = 'green';
    // green time depends on queue length
    let greenSec = Math.min(25, 8 + max * 1.6);
    if(greenSec < 8) greenSec = 8;
    timerFrames = Math.round(greenSec * FPS);
    return;
  }
}

// main loop
function mainLoop(){
  timerFrames--;
  evaluateSignals();
  spawnStep();

  // update vehicles
  for(const v of vehicles) v.step();

  // remove offscreen
  for(let i = vehicles.length - 1; i >= 0; i--){
    if(vehicles[i].offscreen()) vehicles.splice(i,1);
  }

  // draw everything
  drawScene();
  drawSignals();

  // painter order: farthest first
  vehicles.sort((a,b)=>{
    const da = Math.hypot((a.x + a.w/2) - CX, (a.y + a.h/2) - CY);
    const db = Math.hypot((b.x + b.w/2) - CX, (b.y + b.h/2) - CY);
    return da - db;
  });

  for(const v of vehicles) v.draw();

  // update bottom status
  const total = vehicles.length;
  const secLeft = Math.max(0, Math.ceil(timerFrames / FPS));
  document.getElementById('statusText').textContent =
    `Current Green: ${signal.dir} | Time Left: ${secLeft}s | Cars: ${total}`;

  requestAnimationFrame(mainLoop);
}

// init: add initial queues so red sides show waiting vehicles
for(let i=0;i<5;i++){
  vehicles.push(new Vehicle('N','car'));
  vehicles.push(new Vehicle('E','car'));
  vehicles.push(new Vehicle('S','car'));
  vehicles.push(new Vehicle('W','car'));
}
// add occasional bike/auto
vehicles.push(new Vehicle('E','bike'));
vehicles.push(new Vehicle('W','auto'));

timerFrames = 15 * FPS;
signal = { dir: 'N', phase: 'green' };
requestAnimationFrame(mainLoop);


