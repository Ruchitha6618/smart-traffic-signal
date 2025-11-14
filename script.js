/* Realistic traffic simulation
   - Vehicles stop before junction (stop lines)
   - Only green direction moves
   - Cars keep safe gap and do not overlap
   - Cars already crossing the stop line continue through
*/

const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;
const H = canvas.height;
const CX = W/2, CY = H/2;

// Road / stop-line configuration
const ROAD_WIDTH = 160;
const STOP_LINE_OFFSET = 110; // distance from center to stop line
const SAFE_GAP = 36;          // minimum gap between vehicles (px)
const SPAWN_GAP = 140;        // spacing between spawned cars (px)
const CAR_W = 36, CAR_H = 18; // car visual size (portrait)
const SPEED_MIN = 1.2, SPEED_MAX = 2.0;

// directions in rotation order (only one green at a time)
const DIRS = ['N','E','S','W'];

// traffic signal control
let currentIndex = 0;
let baseGreen = 15;      // base seconds
let timerFrames = baseGreen * 60; // frames left
const FPS = 60;

// store cars
let cars = [];
let spawnCounter = 0;
const SPAWN_INTERVAL = 70; // frames

// helpers
function rand(min,max){ return Math.random()*(max-min)+min; }

// stop line positions by direction
const STOP = {
  N: CY + STOP_LINE_OFFSET,
  S: CY - STOP_LINE_OFFSET,
  E: CX - STOP_LINE_OFFSET,
  W: CX + STOP_LINE_OFFSET
};

// lane anchors for spawn location
const LANE = {
  N: {x: CX - ROAD_WIDTH/4, startY: H + 80},
  S: {x: CX + ROAD_WIDTH/4, startY: -120},
  E: {y: CY - ROAD_WIDTH/4, startX: -120},
  W: {y: CY + ROAD_WIDTH/4, startX: W + 80}
};

// Car class
class Car{
  constructor(dir){
    this.dir = dir;
    this.speed = rand(SPEED_MIN, SPEED_MAX);
    this.crossed = false; // true when front passes stop line
    this.w = (dir === 'N' || dir === 'S') ? CAR_W : CAR_H;
    this.h = (dir === 'N' || dir === 'S') ? CAR_H : CAR_W;
    if(dir === 'N'){
      this.x = LANE.N.x - this.w/2;
      this.y = LANE.N.startY + rand(0,40);
    } else if(dir === 'S'){
      this.x = LANE.S.x - this.w/2;
      this.y = LANE.S.startY - rand(0,40);
    } else if(dir === 'E'){
      this.x = LANE.E.startX - rand(0,40);
      this.y = LANE.E.y - this.h/2;
    } else { // W
      this.x = LANE.W.startX + rand(0,40);
      this.y = LANE.W.y - this.h/2;
    }
  }

  frontPos(){
    if(this.dir === 'N') return this.y;                 // top edge (smaller Y)
    if(this.dir === 'S') return this.y + this.h;       // bottom edge (larger Y)
    if(this.dir === 'E') return this.x + this.w;       // right edge
    return this.x;                                      // left edge
  }

  gapToCarAhead(){
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

  isAtStopZone(){
    const front = this.frontPos();
    if(this.dir === 'N') return front <= STOP.N + 6;
    if(this.dir === 'S') return front >= STOP.S - 6;
    if(this.dir === 'E') return front >= STOP.E - 6;
    if(this.dir === 'W') return front <= STOP.W + 6;
    return false;
  }

  move(){
    // lane alignment
    if(this.dir === 'N' || this.dir === 'S'){
      this.x = (this.dir === 'N' ? LANE.N.x : LANE.S.x) - this.w/2;
    } else {
      this.y = (this.dir === 'E' ? LANE.E.y : LANE.W.y) - this.h/2;
    }

    const gap = this.gapToCarAhead();
    const tooClose = (gap !== null && gap < SAFE_GAP);

    // check crossing stop line
    const front = this.frontPos();
    if(!this.crossed){
      if(this.dir === 'N' && front < STOP.N) this.crossed = true;
      if(this.dir === 'S' && front > STOP.S) this.crossed = true;
      if(this.dir === 'E' && front > STOP.E) this.crossed = true;
      if(this.dir === 'W' && front < STOP.W) this.crossed = true;
    }

    const greenDir = DIRS[currentIndex];

    // determine should_stop: car not crossed & light != green & at/near stop zone
    let should_stop = false;
    if(!this.crossed && greenDir !== this.dir && this.isAtStopZone()){
      should_stop = true;
    }

    let willMove = false;
    if(this.crossed){
      willMove = !tooClose; // crossed cars move if not colliding
    } else {
      if(greenDir === this.dir && !tooClose && !should_stop) willMove = true;
    }

    if(willMove){
      if(this.dir === 'N') this.y -= this.speed;
      if(this.dir === 'S') this.y += this.speed;
      if(this.dir === 'E') this.x += this.speed;
      if(this.dir === 'W') this.x -= this.speed;
    }
  }

  isOffscreen(){
    return (this.x < -300 || this.x > W + 300 || this.y < -300 || this.y > H + 300);
  }

  draw(){
    ctx.save();
    ctx.fillStyle = "#d9534f";
    ctx.strokeStyle = "#0008";
    ctx.lineWidth = 1;
    roundRect(ctx, this.x, this.y, this.w, this.h, 4);
    ctx.fill(); ctx.stroke();

    // windshield
    ctx.fillStyle = "#9fd8ff";
    if(this.dir === 'N' || this.dir === 'S'){
      ctx.fillRect(this.x + 4, this.y + 3, this.w - 8, Math.max(2, this.h * 0.45));
    } else {
      ctx.fillRect(this.x + 3, this.y + 4, Math.max(2, this.w * 0.45), this.h - 8);
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// drawing scene
function drawScene(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#222";
  ctx.fillRect(30,30,W-60,H-60);

  // horizontal road
  ctx.fillStyle = "#2f2f2f";
  ctx.fillRect(30, CY - ROAD_WIDTH/2, W-60, ROAD_WIDTH);

  // vertical road
  ctx.fillRect(CX - ROAD_WIDTH/2, 30, ROAD_WIDTH, H-60);

  // junction box
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(CX - 80, CY - 80, 160, 160);

  // stop lines
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(CX - ROAD_WIDTH/2, STOP.N); ctx.lineTo(CX + ROAD_WIDTH/2, STOP.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CX - ROAD_WIDTH/2, STOP.S); ctx.lineTo(CX + ROAD_WIDTH/2, STOP.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.E, CY - ROAD_WIDTH/2); ctx.lineTo(STOP.E, CY + ROAD_WIDTH/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.W, CY - ROAD_WIDTH/2); ctx.lineTo(STOP.W, CY + ROAD_WIDTH/2); ctx.stroke();

  // dashed center lines
  ctx.strokeStyle = "#3b3b3b"; ctx.lineWidth = 2;
  for(let x=40; x < W-40; x+=30){ ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x+12, CY); ctx.stroke(); }
  for(let y=40; y < H-40; y+=30){ ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX, y+12); ctx.stroke(); }
}

// draw traffic lights
function drawSignals(){
  const currentGreen = DIRS[currentIndex];
  const pos = {
    N: [CX - ROAD_WIDTH/2 + 18, STOP.N - 24],
    S: [CX + ROAD_WIDTH/2 - 18, STOP.S + 8],
    E: [STOP.E + 8, CY - ROAD_WIDTH/2 + 18],
    W: [STOP.W - 24, CY + ROAD_WIDTH/2 - 18]
  };
  ctx.save();
  for(const d of DIRS){
    const [x,y] = pos[d];
    ctx.beginPath();
    ctx.fillStyle = (d === currentGreen) ? "#36c72a" : "#b93e3e";
    ctx.arc(x, y, 8, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = "#0008"; ctx.stroke();
  }
  ctx.restore();
}

// spawning
function canSpawn(dir){
  for(const c of cars){
    if(c.dir !== dir) continue;
    if(dir === 'N'){
      if(c.y < LANE.N.startY + SPAWN_GAP) return false;
    }
    if(dir === 'S'){
      if(c.y > LANE.S.startY - SPAWN_GAP) return false;
    }
    if(dir === 'E'){
      if(c.x > LANE.E.startX - SPAWN_GAP) return false;
    }
    if(dir === 'W'){
      if(c.x < LANE.W.startX + SPAWN_GAP) return false;
    }
  }
  return true;
}

function spawnIfNeeded(){
  spawnCounter++;
  if(spawnCounter < SPAWN_INTERVAL) return;
  spawnCounter = 0;
  // spawn in a random direction that has space
  const order = DIRS.slice();
  for(let i=0;i<4;i++){
    const idx = Math.floor(Math.random()*order.length);
    const d = order.splice(idx,1)[0];
    if(cars.length > 160) return; // safety cap
    if(canSpawn(d)){
      cars.push(new Car(d));
      return;
    }
  }
}

// cleanup
function cleanupCars(){
  for(let i = cars.length -1; i >= 0; i--){
    if(cars[i].isOffscreen()) cars.splice(i,1);
  }
}

// counts update
function updateCountsDisplay(){
  const n = cars.filter(c=>c.dir==='N').length;
  const e = cars.filter(c=>c.dir==='E').length;
  const s = cars.filter(c=>c.dir==='S').length;
  const w = cars.filter(c=>c.dir==='W').length;
  document.getElementById('countN').textContent = n;
  document.getElementById('countE').textContent = e;
  document.getElementById('countS').textContent = s;
  document.getElementById('countW').textContent = w;
  document.getElementById('greenDir').textContent = DIRS[currentIndex];
  document.getElementById('timeLeft').textContent = Math.max(0, Math.ceil(timerFrames / FPS));
}

// adaptive green time (simple)
function getAdaptiveGreen(){
  const currentCount = cars.filter(c=>c.dir===DIRS[currentIndex]).length;
  return Math.min(25, 8 + currentCount * 2); // base 8s + 2s per car (cap)
}

// main update loop
let frameCount = 0;
function step(){
  frameCount++;
  // update signals timer once per frame
  timerFrames--;
  if(timerFrames <= 0){
    // switch
    currentIndex = (currentIndex + 1) % DIRS.length;
    const newSeconds = getAdaptiveGreen();
    timerFrames = Math.round(newSeconds * FPS);
  }

  // spawn & update cars
  spawnIfNeeded();

  for(const c of cars){
    c.move();
  }
  cleanupCars();

  // drawing
  drawScene();
  drawSignals();
  for(const c of cars) c.draw();

  updateCountsDisplay();

  requestAnimationFrame(step);
}

// initialize a few cars so scene isn't empty
for(let i=0;i<4;i++){
  cars.push(new Car(DIRS[i]));
  cars.push(new Car(DIRS[i]));
}

// start with adaptive timer based on initial counts
timerFrames = Math.round(getAdaptiveGreen() * FPS);

// start loop
requestAnimationFrame(step);
