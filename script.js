/* Realistic junction web simulation (Style A)
   - Cars on all 4 sides waiting at red
   - Only green direction moves
   - Cars stop before stop line, never inside central box
   - Counts & bottom status text
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;
const H = canvas.height;
const CX = W/2, CY = H/2;

// Visual config (match Pygame)
const ROAD_W = 160;
const STOP_OFFSET = 110;   // how far stop line from center
const STOP_N = CY + STOP_OFFSET;
const STOP_S = CY - STOP_OFFSET;
const STOP_E = CX - STOP_OFFSET;
const STOP_W = CX + STOP_OFFSET;

const CAR_W = 32, CAR_H = 16;
const SAFE_GAP = 34;    // px gap between cars
const SPAWN_INTERVAL_FRAMES = 70;
const MAX_CARS = 120;

// directions order
const DIRS = ['N','E','S','W'];
let currentIndex = 0;
let baseGreenSeconds = 15;
const FPS = 60;
let timerFrames = baseGreenSeconds * FPS;

// cars storage
let cars = [];
let spawnCounter = 0;

// helper random
const rand = (a,b)=> Math.random()*(b-a)+a;

// lane anchors (centered lane positions)
const LANE = {
  N: {x: CX - ROAD_W/4, startY: H + 60},
  S: {x: CX + ROAD_W/4, startY: -80},
  E: {y: CY - ROAD_W/4, startX: -80},
  W: {y: CY + ROAD_W/4, startX: W + 60}
};

// Car class (rectangular car with small windshield)
class Car {
  constructor(dir){
    this.dir = dir;
    this.speed = rand(1.2, 1.9);
    this.crossed = false; // true once front passes stop line
    // orient size so car faces movement direction
    if(dir === 'N' || dir === 'S'){ this.w = CAR_W; this.h = CAR_H; }
    else { this.w = CAR_H; this.h = CAR_W; }

    // spawn position slightly randomized
    if(dir === 'N'){ this.x = LANE.N.x - this.w/2; this.y = LANE.N.startY + rand(0,40); }
    if(dir === 'S'){ this.x = LANE.S.x - this.w/2; this.y = LANE.S.startY - rand(0,40); }
    if(dir === 'E'){ this.x = LANE.E.startX - rand(0,40); this.y = LANE.E.y - this.h/2; }
    if(dir === 'W'){ this.x = LANE.W.startX + rand(0,40); this.y = LANE.W.y - this.h/2; }
  }

  front(){
    // front edge depending on movement direction
    if(this.dir === 'N') return this.y;            // top edge
    if(this.dir === 'S') return this.y + this.h;  // bottom edge
    if(this.dir === 'E') return this.x + this.w;  // right edge
    return this.x;                                 // left edge (W)
  }

  gapToAhead(){
    let minGap = null;
    for(const other of cars){
      if(other === this || other.dir !== this.dir) continue;
      if(this.dir === 'N' && other.y < this.y){
        const d = this.y - (other.y + other.h);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
      if(this.dir === 'S' && other.y > this.y){
        const d = other.y - (this.y + this.h);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
      if(this.dir === 'E' && other.x > this.x){
        const d = other.x - (this.x + this.w);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
      if(this.dir === 'W' && other.x < this.x){
        const d = this.x - (other.x + other.w);
        if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
      }
    }
    return minGap;
  }

  atStopZone(){
    const f = this.front();
    if(this.dir === 'N') return f <= STOP_N + 6;
    if(this.dir === 'S') return f >= STOP_S - 6;
    if(this.dir === 'E') return f >= STOP_E - 6;
    if(this.dir === 'W') return f <= STOP_W + 6;
    return false;
  }

  move(){
    // keep lane alignment
    if(this.dir === 'N' || this.dir === 'S'){
      this.x = (this.dir === 'N' ? LANE.N.x : LANE.S.x) - this.w/2;
    } else {
      this.y = (this.dir === 'E' ? LANE.E.y : LANE.W.y) - this.h/2;
    }

    const gap = this.gapToAhead();
    const tooClose = (gap !== null && gap < SAFE_GAP);

    // check crossing
    const f = this.front();
    if(!this.crossed){
      if(this.dir === 'N' && f < STOP_N) this.crossed = true;
      if(this.dir === 'S' && f > STOP_S) this.crossed = true;
      if(this.dir === 'E' && f > STOP_E) this.crossed = true;
      if(this.dir === 'W' && f < STOP_W) this.crossed = true;
    }

    const green = DIRS[currentIndex];

    // if not crossed and not green and at stop -> must stop
    const shouldStop = (!this.crossed && green !== this.dir && this.atStopZone());

    let willMove = false;
    if(this.crossed){
      willMove = !tooClose;
    } else {
      if(green === this.dir && !tooClose && !shouldStop) willMove = true;
    }

    if(willMove){
      if(this.dir === 'N') this.y -= this.speed;
      if(this.dir === 'S') this.y += this.speed;
      if(this.dir === 'E') this.x += this.speed;
      if(this.dir === 'W') this.x -= this.speed;
    }
  }

  offscreen(){
    return (this.x < -300 || this.x > W + 300 || this.y < -300 || this.y > H + 300);
  }

  draw(){
    // body
    ctx.save();
    ctx.fillStyle = "#c95752"; // red car like screenshot
    ctx.strokeStyle = "#0008";
    ctx.lineWidth = 1;
    roundRect(ctx, this.x, this.y, this.w, this.h, 4);
    ctx.fill(); ctx.stroke();

    // windshield
    ctx.fillStyle = "#aad8ff";
    if(this.dir === 'N' || this.dir === 'S'){
      ctx.fillRect(this.x + 4, this.y + 3, this.w - 8, Math.max(2, this.h * 0.45));
    } else {
      ctx.fillRect(this.x + 3, this.y + 4, Math.max(2, this.w * 0.45), this.h - 8);
    }
    ctx.restore();
  }
}

function roundRect(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// SCENE DRAWING (roads, white box, stop lines, signals)
function drawScene(){
  ctx.clearRect(0,0,W,H);
  // dark outer panel
  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(0,0,W,H);

  // horizontal road
  ctx.fillStyle = "#252525";
  ctx.fillRect(0, CY - ROAD_W/2, W, ROAD_W);

  // vertical road
  ctx.fillRect(CX - ROAD_W/2, 0, ROAD_W, H);

  // central white square (junction box)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.strokeRect(CX - 80, CY - 80, 160, 160);

  // stop lines (thin white)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  // north stop
  ctx.beginPath(); ctx.moveTo(CX - ROAD_W/2, STOP_N); ctx.lineTo(CX + ROAD_W/2, STOP_N); ctx.stroke();
  // south
  ctx.beginPath(); ctx.moveTo(CX - ROAD_W/2, STOP_S); ctx.lineTo(CX + ROAD_W/2, STOP_S); ctx.stroke();
  // east
  ctx.beginPath(); ctx.moveTo(STOP_E, CY - ROAD_W/2); ctx.lineTo(STOP_E, CY + ROAD_W/2); ctx.stroke();
  // west
  ctx.beginPath(); ctx.moveTo(STOP_W, CY - ROAD_W/2); ctx.lineTo(STOP_W, CY + ROAD_W/2); ctx.stroke();

  // small dashed center lines to match screenshot
  ctx.strokeStyle = "#2f2f2f";
  ctx.lineWidth = 2;
  for(let x = 20; x < W-20; x += 28){ ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x+12, CY); ctx.stroke(); }
  for(let y = 20; y < H-20; y += 28){ ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX, y+12); ctx.stroke(); }
}

// draw traffic lights as rectangular boxes with circular light
function drawSignals(){
  const green = DIRS[currentIndex];
  const positions = {
    N: [CX - 12, STOP_N - 36],
    S: [CX + 12, STOP_S + 12],
    E: [STOP_E + 12, CY - 12],
    W: [STOP_W - 36, CY + 12]
  };
  for(const d of DIRS){
    const [x,y] = positions[d];
    // box
    ctx.fillStyle = "#222";
    ctx.fillRect(x-8, y-8, 24, 44);
    // three circles (only show green/red for simplified look)
    const isGreen = (d === green);
    // top/dummy circles: draw as grey, show green for current
    ctx.fillStyle = isGreen ? "#36c72a" : "#b93e3e";
    // small circle near center to mimic screenshot
    ctx.beginPath(); ctx.arc(x+4, y+12, 8, 0, Math.PI*2); ctx.fill();
  }
}

// spawn control (keep cars on all sides)
function canSpawn(dir){
  for(const c of cars) if(c.dir === dir){
    if(dir === 'N'){ if(c.y < LANE.N.startY + 120) return false; }
    if(dir === 'S'){ if(c.y > LANE.S.startY - 120) return false; }
    if(dir === 'E'){ if(c.x > LANE.E.startX - 120) return false; }
    if(dir === 'W'){ if(c.x < LANE.W.startX + 120) return false; }
  }
  return true;
}

function spawn(){
  spawnCounter++;
  if(spawnCounter < SPAWN_INTERVAL_FRAMES) return;
  spawnCounter = 0;
  // attempt spawn in each direction in random order until success
  const order = DIRS.slice();
  for(let i=0;i<4;i++){
    const idx = Math.floor(Math.random()*order.length);
    const dir = order.splice(idx,1)[0];
    if(cars.length > MAX_CARS) return;
    if(canSpawn(dir)) { cars.push(new Car(dir)); return; }
  }
}

// cleanup cars off-screen
function cleanup(){
  for(let i = cars.length-1; i>=0; i--){
    if(cars[i].offscreen()) cars.splice(i,1);
  }
}

// status update
function updateStatus(){
  const total = cars.length;
  const green = DIRS[currentIndex];
  const secLeft = Math.max(0, Math.ceil(timerFrames / FPS));
  document.getElementById('statusText').textContent = `Current Green: ${green} | Time Left: ${secLeft}s | Cars: ${total}`;
}

// adaptive green time (simple)
function adaptiveTime(){
  const current = cars.filter(c=>c.dir === DIRS[currentIndex]).length;
  return Math.min(25, 8 + current * 2); // 8s base + 2s per queued car
}

// main loop
function tick(){
  // timer
  timerFrames--;
  if(timerFrames <= 0){
    currentIndex = (currentIndex + 1) % DIRS.length;
    timerFrames = Math.round(adaptiveTime() * FPS);
  }

  spawn();

  for(const c of cars) c.move();
  cleanup();

  // draw
  drawScene();
  drawSignals();
  // draw cars - ensure cars behind stop line are visible
  // draw in order so front-most cars render last (simple approach)
  cars.sort((a,b)=>{
    // simple painter order by distance to center for nicer overlap: farther first
    const da = distanceToCenter(a), db = distanceToCenter(b);
    return da - db;
  });
  for(const c of cars) c.draw();

  updateStatus();
  requestAnimationFrame(tick);
}

function distanceToCenter(car){
  const cx = car.x + car.w/2;
  const cy = car.y + car.h/2;
  const dx = cx - CX, dy = cy - CY;
  return Math.sqrt(dx*dx + dy*dy);
}

// initial population: put some cars on each direction so red sides show waiting cars
for(let i=0;i<6;i++){
  cars.push(new Car('N'));
  cars.push(new Car('E'));
  cars.push(new Car('S'));
  cars.push(new Car('W'));
}
// reduce count slightly so it looks like screenshot
cars = cars.slice(0, 18);

timerFrames = Math.round(baseGreenSeconds * FPS);
requestAnimationFrame(tick);
