/* Advanced realistic traffic sim
 - Density-adaptive signals
 - Yellow transition
 - Smooth acceleration & deceleration
 - Turning (L/S/R) with probabilities
 - Mixed vehicles: car, bike, auto
 - SVG-based data-URL vehicle icons embedded as sprites (top-view style)
*/

/* ----------------- CONFIG ----------------- */
const CONFIG = {
  canvasW: 1000,
  canvasH: 700,
  roadWidth: 180,
  stopOffset: 120,
  fps: 60,
  baseGreenSec: 8,      // base green time used in density calc
  yellowSec: 2,         // yellow transition duration
  maxGreenSec: 30,
  spawnIntervalFrames: 80,
  maxVehicles: 220,
  safeGap: 52,          // distance in px between vehicles
  accelRate: 0.02,      // per frame speed change (for acceleration)
  decelRate: 0.06,      // deceleration rate when braking
  turnProbabilities: { left: 0.25, right: 0.25, straight: 0.5 },
  vehicleMix: { car: 0.65, bike: 0.2, auto: 0.15 }
};

/* ----------------- SETUP ----------------- */
const canvas = document.getElementById('canvas');
canvas.width = CONFIG.canvasW;
canvas.height = CONFIG.canvasH;
const ctx = canvas.getContext('2d');

const W = canvas.width, H = canvas.height;
const CX = W/2, CY = H/2;
const ROAD_W = CONFIG.roadWidth;
const STOP = {
  N: CY + CONFIG.stopOffset,
  S: CY - CONFIG.stopOffset,
  E: CX - CONFIG.stopOffset,
  W: CX + CONFIG.stopOffset
};
const LANE = {
  N: {x: CX - ROAD_W/4, startY: H + 120},
  S: {x: CX + ROAD_W/4, startY: -160},
  E: {y: CY - ROAD_W/4, startX: -160},
  W: {y: CY + ROAD_W/4, startX: W + 160}
};
const DIRS = ['N','E','S','W'];

/* ----------------- SIGNAL STATE ----------------- */
// states: "green", "yellow"
let signalState = { dir: 'N', phase: 'green' };
let timerFrames = CONFIG.baseGreenSec * CONFIG.fps;
let spawnCounter = 0;
let vehicles = []; // all vehicles

/* ----------------- VEHICLE ICONS (SVG data-URLs) ----------------- */
/* small top-view SVGs encoded as data URLs so page works offline */
const ICONS = {
  car: 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="24" viewBox="0 0 48 24">
      <rect rx="4" ry="4" x="2" y="6" width="44" height="12" fill="#c95752"/>
      <rect x="6" y="8" width="12" height="6" fill="#aee1ff" rx="1"/>
      <rect x="30" y="8" width="12" height="6" fill="#aee1ff" rx="1"/>
      <circle cx="10" cy="20" r="2.6" fill="#111"/>
      <circle cx="38" cy="20" r="2.6" fill="#111"/>
    </svg>`),
  bike: 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="18" viewBox="0 0 36 18">
      <rect x="0" y="6" width="36" height="6" rx="3" fill="#ffd46a"/>
      <rect x="6" y="2" width="8" height="4" rx="1" fill="#f7d88a"/>
      <circle cx="6" cy="16" r="2.2" fill="#111"/>
      <circle cx="30" cy="16" r="2.2" fill="#111"/>
    </svg>`),
  auto: 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="42" height="20" viewBox="0 0 42 20">
      <rect x="1" y="4" width="40" height="12" rx="4" fill="#9be07b"/>
      <rect x="6" y="6" width="8" height="6" rx="1" fill="#e9ffea"/>
      <rect x="28" y="6" width="8" height="6" rx="1" fill="#e9ffea"/>
      <circle cx="10" cy="18" r="2" fill="#111"/>
      <circle cx="32" cy="18" r="2" fill="#111"/>
    </svg>`)
};

/* ----------------- VEHICLE CLASS ----------------- */
class Vehicle {
  constructor(dir, kind){
    this.dir = dir;           // N/E/S/W
    this.kind = kind;         // car/bike/auto
    this.assignDimensions();
    this.chooseTurn();        // left/right/straight
    this.resetPosition();
    this.v = 0;               // current speed (px/frame)
    this.desiredV = this.baseSpeed(); // target cruising speed
    this.crossed = false;     // has front passed stop line?
    this.pathProgress = 0;    // for turning curves (0..1)
    this.colorOffset = Math.random()*0.15; // small color variation
  }

  assignDimensions(){
    if(this.kind === 'car'){ this.w = 36; this.h = 18; }
    else if(this.kind === 'bike'){ this.w = 24; this.h = 10; }
    else { this.w = 30; this.h = 14; } // auto
    this.icon = new Image();
    this.icon.src = ICONS[this.kind];
  }

  baseSpeed(){
    // pixels per frame target (slower than before to feel realistic)
    if(this.kind === 'car') return rand(0.85, 1.2);
    if(this.kind === 'bike') return rand(0.9, 1.4);
    return rand(0.7, 1.0); // auto
  }

  chooseTurn(){
    const p = Math.random();
    const t = CONFIG.turnProbabilities;
    if(p < t.left) this.turn = 'left';
    else if(p < t.left + t.right) this.turn = 'right';
    else this.turn = 'straight';
  }

  resetPosition(){
    // spawn a bit behind the lane start to allow queueing
    if(this.dir === 'N'){
      this.x = LANE.N.x - this.w/2;
      this.y = LANE.N.startY + rand(0,80);
      this.angle = -Math.PI/2;
    } else if(this.dir === 'S'){
      this.x = LANE.S.x - this.w/2;
      this.y = LANE.S.startY - rand(0,80);
      this.angle = Math.PI/2;
    } else if(this.dir === 'E'){
      this.x = LANE.E.startX - rand(0,80);
      this.y = LANE.E.y - this.h/2;
      this.angle = 0;
    } else { // W
      this.x = LANE.W.startX + rand(0,80);
      this.y = LANE.W.y - this.h/2;
      this.angle = Math.PI;
    }
  }

  frontPos(){
    if(this.dir==='N') return this.y;
    if(this.dir==='S') return this.y + this.h;
    if(this.dir==='E') return this.x + this.w;
    return this.x;
  }

  gapToAhead(){
    let minGap = null;
    for(const o of vehicles){
      if(o === this || o.dir !== this.dir) continue;
      // relative based on dir
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
    const f = this.frontPos();
    if(this.dir==='N') return f <= STOP.N + 6;
    if(this.dir==='S') return f >= STOP.S - 6;
    if(this.dir==='E') return f >= STOP.E - 6;
    if(this.dir==='W') return f <= STOP.W + 6;
    return false;
  }

  // compute path target when turning: we will use a simple bezier path through center
  computeTurnPath(){
    // Determine start point (car center), mid control points and end point based on turn
    // We'll form a cubic-bezier-like parametric path using 2 control points
    const cx = CX, cy = CY;
    // offsets for lane centers used as entry/exit
    const inX = this.x + this.w/2, inY = this.y + this.h/2;
    let outX = inX, outY = inY;

    // compute end direction based on this.turn and this.dir
    // mapping (dir,turn) -> exit dir
    const exitMap = {
      N: { straight: 'S', left: 'E', right: 'W' },
      S: { straight: 'N', left: 'W', right: 'E' },
      E: { straight: 'W', left: 'N', right: 'S' },
      W: { straight: 'E', left: 'S', right: 'N' }
    };
    const exitDir = exitMap[this.dir][this.turn];

    // pick end point a bit beyond stop to allow smooth exit
    if(exitDir === 'N'){ outX = CX - ROAD_W/4; outY = -160; }
    if(exitDir === 'S'){ outX = CX + ROAD_W/4; outY = H + 160; }
    if(exitDir === 'E'){ outX = W + 160; outY = CY - ROAD_W/4; }
    if(exitDir === 'W'){ outX = -160; outY = CY + ROAD_W/4; }

    // control points: use center offsets
    const cp1 = { x: (inX + cx)/2, y: (inY + cy)/2 };
    const cp2 = { x: (outX + cx)/2, y: (outY + cy)/2 };

    this.turnPath = {start:{x:inX,y:inY}, cp1, cp2, end:{x:outX,y:outY} };
  }

  updatePositionAlongTurn(t){
    // simple cubic bezier: B(t) = (1-t)^3 start + 3(1-t)^2 t cp1 + 3(1-t) t^2 cp2 + t^3 end
    const s = this.turnPath.start, c1 = this.turnPath.cp1, c2 = this.turnPath.cp2, e = this.turnPath.end;
    const u = 1 - t;
    const x = u*u*u * s.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*e.x;
    const y = u*u*u * s.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*e.y;
    this.x = x - this.w/2;
    this.y = y - this.h/2;
  }

  step(){
    // Lane align (non-turning) - ensure lane center
    if(!this.isTurning()){
      if(this.dir==='N' || this.dir==='S') this.x = (this.dir==='N'?LANE.N.x:LANE.S.x) - this.w/2;
      else this.y = (this.dir==='E'?LANE.E.y:LANE.W.y) - this.h/2;
    }

    // gap to vehicle ahead
    const gap = this.gapToAhead();
    const tooClose = (gap !== null && gap < CONFIG.safeGap);

    // mark crossed when front passes stop
    const f = this.frontPos();
    if(!this.crossed){
      if(this.dir==='N' && f < STOP.N) this.crossed = true;
      if(this.dir==='S' && f > STOP.S) this.crossed = true;
      if(this.dir==='E' && f > STOP.E) this.crossed = true;
      if(this.dir==='W' && f < STOP.W) this.crossed = true;
      if(this.crossed && this.turn && this.turn!=='straight'){
        this.computeTurnPath();
        this.pathProgress = 0;
      }
    }

    // determine whether this vehicle should be allowed to start moving (if not crossed)
    const allowStart = (signalState.dir === this.dir && signalState.phase === 'green');

    // if not crossed: don't start if red/yellow
    const inStop = (!this.crossed && this.atStopZone());
    const shouldStop = (!this.crossed && !allowStart && inStop);

    // velocity control: accelerate, decelerate smoothly
    if(this.isTurning() && this.crossed){
      // follow bezier path; we move pathProgress based on desiredV
      const stepAmount = this.desiredV / 1.2; // path speed multiplier
      this.pathProgress += stepAmount / 60; // normalized per frame
      this.pathProgress = Math.min(this.pathProgress, 1);
      this.updatePositionAlongTurn(this.pathProgress);
      // small fade out of speed near end
      if(this.pathProgress >= 0.98) this.v = Math.max(0, this.v - CONFIG.decelRate);
      return;
    }

    // if too close -> decelerate quickly to maintain safe gap
    if(tooClose || shouldStop){
      // brake
      this.v = Math.max(0, this.v - CONFIG.decelRate);
    } else if(this.crossed || allowStart){
      // accelerate toward desired speed
      if(this.v < this.desiredV) this.v = Math.min(this.desiredV, this.v + CONFIG.accelRate);
      else this.v = Math.max(this.desiredV, this.v - 0); // no decel while cruising
    } else {
      // red and not crossed: hold still
      this.v = Math.max(0, this.v - CONFIG.decelRate*1.2);
    }

    // move according to direction
    if(this.v > 0){
      if(this.dir === 'N') this.y -= this.v;
      if(this.dir === 'S') this.y += this.v;
      if(this.dir === 'E') this.x += this.v;
      if(this.dir === 'W') this.x -= this.v;
    }
  }

  isTurning(){
    return this.turn && this.crossed && (this.turn==='left' || this.turn==='right') && this.turnPath;
  }

  offscreen(){
    return (this.x < -260 || this.x > W+260 || this.y < -260 || this.y > H+260);
  }

  draw(){
    // draw icon rotated according to direction
    ctx.save();
    const cx = this.x + this.w/2, cy = this.y + this.h/2;
    ctx.translate(cx, cy);
    let angle = 0;
    if(this.dir==='N') angle = -Math.PI/2;
    if(this.dir==='S') angle = Math.PI/2;
    if(this.dir==='E') angle = 0;
    if(this.dir==='W') angle = Math.PI;
    ctx.rotate(angle);
    // draw icon scaled to vehicle size
    try {
      ctx.drawImage(this.icon, -this.w/2, -this.h/2, this.w, this.h);
    } catch(e){
      // fallback: colored rectangle
      ctx.fillStyle = (this.kind==='car' ? '#c95752' : (this.kind==='bike' ? '#ffd46a' : '#9be07b'));
      ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
    }
    ctx.restore();
  }
}

/* ----------------- HELPERS ----------------- */
function rand(a,b){ return Math.random()*(b-a)+a; }

/* ----------------- SPAWNING ----------------- */
function chooseVehicleKind(){
  const p = Math.random();
  let acc = 0;
  for(const k of ['car','bike','auto']){
    acc += CONFIG.vehicleMix[k];
    if(p <= acc) return k;
  }
  return 'car';
}

function canSpawn(dir){
  for(const v of vehicles){
    if(v.dir !== dir) continue;
    if(dir==='N' && v.y < LANE.N.startY + 140) return false;
    if(dir==='S' && v.y > LANE.S.startY - 140) return false;
    if(dir==='E' && v.x > LANE.E.startX - 140) return false;
    if(dir==='W' && v.x < LANE.W.startX + 140) return false;
  }
  return true;
}

function spawnRoutine(){
  spawnCounter++;
  if(spawnCounter < CONFIG.spawnIntervalFrames) return;
  spawnCounter = 0;
  // try spawn in random order
  const order = DIRS.slice();
  for(let i=0;i<4;i++){
    const idx = Math.floor(Math.random()*order.length);
    const dir = order.splice(idx,1)[0];
    if(vehicles.length >= CONFIG.maxVehicles) return;
    if(canSpawn(dir)){
      const kind = chooseVehicleKind();
      const v = new Vehicle(dir, kind);
      vehicles.push(v);
      return;
    }
  }
}

/* ----------------- SIGNAL CONTROL (density-based with yellow) ----------------- */
function evaluateAndSwitch(){
  if(timerFrames > 0) return;
  // if currently green -> transition to yellow
  if(signalState.phase === 'green'){
    signalState.phase = 'yellow';
    timerFrames = CONFIG.yellowSec * CONFIG.fps;
    return;
  }
  // if yellow finished -> choose next green based on density
  if(signalState.phase === 'yellow'){
    // compute queued counts (not crossed)
    const dens = { N:0, E:0, S:0, W:0 };
    for(const v of vehicles) if(!v.crossed) dens[v.dir]++;

    // choose direction with max queued vehicles (tie-breaker: keep current if tie)
    let next = 'N', max = -1;
    for(const d of DIRS){
      if(dens[d] > max){ max = dens[d]; next = d; }
    }
    // if no queued vehicles at all, rotate to next to avoid starvation
    if(max === 0){
      const idx = (DIRS.indexOf(signalState.dir) + 1) % DIRS.length;
      next = DIRS[idx];
    }
    signalState.dir = next;
    signalState.phase = 'green';
    // green time based on queue length
    let greenSec = Math.min(CONFIG.maxGreenSec, CONFIG.baseGreenSec + max * 1.6);
    if(greenSec < CONFIG.baseGreenSec) greenSec = CONFIG.baseGreenSec;
    timerFrames = Math.round(greenSec * CONFIG.fps);
  }
}

/* ----------------- DRAW SCENE ----------------- */
function drawRoadsAndJunction(){
  // background panel
  ctx.fillStyle = '#222';
  ctx.fillRect(0,0,W,H);

  // horizontal road
  ctx.fillStyle = '#1f1f1f';
  ctx.fillRect(0, CY-ROAD_W/2, W, ROAD_W);

  // vertical road
  ctx.fillRect(CX-ROAD_W/2, 0, ROAD_W, H);

  // central white box
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(CX-80, CY-80, 160, 160);

  // stop lines
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(CX-ROAD_W/2, STOP.N); ctx.lineTo(CX+ROAD_W/2, STOP.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CX-ROAD_W/2, STOP.S); ctx.lineTo(CX+ROAD_W/2, STOP.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.E, CY-ROAD_W/2); ctx.lineTo(STOP.E, CY+ROAD_W/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP.W, CY-ROAD_W/2); ctx.lineTo(STOP.W, CY+ROAD_W/2); ctx.stroke();

  // center dashed lines
  ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 2;
  for(let x=20;x<W-20;x+=28){ ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x+12, CY); ctx.stroke(); }
  for(let y=20;y<H-20;y+=28){ ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX, y+12); ctx.stroke(); }
}

/* ----------------- DRAW SIGNAL BOXES (realistic) ----------------- */
function drawSignalBoxes(){
  const pos = {
    N: [CX-26, STOP.N-85],
    S: [CX+26, STOP.S+20],
    E: [STOP.E+26, CY-26],
    W: [STOP.W-85, CY+26]
  };
  for(const d of DIRS){
    const [x,y] = pos[d];
    ctx.fillStyle = '#111';
    ctx.fillRect(x, y, 36, 96);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(x, y, 36, 96);
    // lights: red, yellow, green
    const isGreen = (d === signalState.dir && signalState.phase === 'green');
    const isYellow = (d === signalState.dir && signalState.phase === 'yellow');
    // red (top)
    ctx.beginPath(); ctx.fillStyle = (isGreen ? '#4a1919' : '#d63a3a'); ctx.arc(x+18, y+18, 11, 0, Math.PI*2); ctx.fill();
    // yellow (middle)
    ctx.beginPath(); ctx.fillStyle = (isYellow ? '#ffd84a' : '#c6a52e'); ctx.arc(x+18, y+48, 11, 0, Math.PI*2); ctx.fill();
    // green (bottom)
    ctx.beginPath(); ctx.fillStyle = (isGreen ? '#2ecc3a' : '#1c4f22'); ctx.arc(x+18, y+78, 11, 0, Math.PI*2); ctx.fill();
  }
}

/* ----------------- MAIN LOOP ----------------- */
function updateAndDraw(){
  // timer decrement
  timerFrames--;
  evaluateAndSwitch();

  // spawn new vehicles
  spawnRoutine();

  // move vehicles: step each vehicle
  for(const v of vehicles) v.step();

  // remove offscreen
  for(let i=vehicles.length-1;i>=0;i--){
    if(vehicles[i].offscreen()) vehicles.splice(i,1);
  }

  // draw
  drawRoadsAndJunction();
  drawSignalBoxes();

  // painter order: draw farther vehicles first -> near last (optional sorting)
  vehicles.sort((a,b) => {
    const da = Math.hypot((a.x + a.w/2) - CX, (a.y + a.h/2) - CY);
    const db = Math.hypot((b.x + b.w/2) - CX, (b.y + b.h/2) - CY);
    return da - db;
  });

  for(const v of vehicles) v.draw();

  // update DOM status
  const total = vehicles.length;
  const secLeft = Math.max(0, Math.ceil(timerFrames / CONFIG.fps));
  document.getElementById('statusText').textContent = `Current Green: ${signalState.dir} | Time Left: ${secLeft}s | Total: ${total}`;
  document.getElementById('countN').textContent = vehicles.filter(v=>v.dir==='N' && !v.crossed).length;
  document.getElementById('countE').textContent = vehicles.filter(v=>v.dir==='E' && !v.crossed).length;
  document.getElementById('countS').textContent = vehicles.filter(v=>v.dir==='S' && !v.crossed).length;
  document.getElementById('countW').textContent = vehicles.filter(v=>v.dir==='W' && !v.crossed).length;

  requestAnimationFrame(updateAndDraw);
}

/* ----------------- INIT ----------------- */
// initial vehicles to show queues
for(let i=0;i<4;i++){
  vehicles.push(new Vehicle('N', 'car'));
  vehicles.push(new Vehicle('E', 'car'));
  vehicles.push(new Vehicle('S', 'car'));
  vehicles.push(new Vehicle('W', 'car'));
}
// replace some with bikes/autos
for(let i=0;i<6;i++){
  const k = chooseVehicleKind();
  vehicles.push(new Vehicle(DIRS[i%4], k));
}

timerFrames = CONFIG.baseGreenSec * CONFIG.fps;
signalState = {dir:'N', phase:'green'};

requestAnimationFrame(updateAndDraw);

/* ----------------- UTILS ----------------- */
function spawnRoutine(){
  spawnCounter++;
  if(spawnCounter < CONFIG.spawnIntervalFrames) return;
  spawnCounter = 0;
  // spawn attempt up to 4 tries to find room
  const order = DIRS.slice();
  for(let i=0;i<4;i++){
    const idx = Math.floor(Math.random()*order.length);
    const dir = order.splice(idx,1)[0];
    if(vehicles.length >= CONFIG.maxVehicles) return;
    if(canSpawn(dir)){
      const kind = chooseVehicleKind();
      vehicles.push(new Vehicle(dir, kind));
      return;
    }
  }
}

function chooseVehicleKind(){
  const r = Math.random();
  const mix = CONFIG.vehicleMix;
  if(r < mix.car) return 'car';
  if(r < mix.car + mix.bike) return 'bike';
  return 'auto';
}
