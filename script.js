/* Web clone of your Pygame simulation (1000x700)
   - Exact sizes (CAR_LENGTH = 44, CAR_WIDTH = 24)
   - STOP lines and signal positions copied
   - Density-based signal selection: C) aggressive scaling
       green_time = 10 + 1.5 * waiting_cars (cap 35s)
   - Yellow = 3s
   - Spawn interval, speeds, gaps match Pygame defaults
   - Straight-only movements, stop before junction, crossed logic
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const SCREEN_WIDTH = canvas.width;
const SCREEN_HEIGHT = canvas.height;
const ROAD_WIDTH = 180;
const FPS = 60;

// Pygame constants (copied)
const BASE_GREEN_FRAMES = 900;  // 15s usually (used initially)
const YELLOW_FRAMES = 180;      // 3s
const STOP_GAP = 140;           // (used in Pygame stop positions)
const SAFE_GAP = 45;
const STOP_OFFSET = 30;         // used for stopping threshold
const SPAWN_INTERVAL = 50;      // frames
const MAX_CARS = 40;

const CAR_LENGTH = 44, CAR_WIDTH = 24;
const CAR_COLOR = 'rgb(200,80,70)';
const GLASS = 'rgb(160,220,255)';

// colors used by signals and background
const GREEN = 'rgb(0,255,0)';
const YELLOW = 'rgb(255,230,0)';
const RED = 'rgb(255,0,0)';
const GREY = 'rgb(50,50,50)';
const ROAD = 'rgb(30,30,30)';
const WHITE = '#ffffff';

// center coordinates
const CENTER_X = Math.floor(SCREEN_WIDTH / 2);
const CENTER_Y = Math.floor(SCREEN_HEIGHT / 2);
const LANE_SHIFT = Math.floor(ROAD_WIDTH / 4);

// STOP_LINES (following your Pygame)
const STOP_LINES = {
  N: CENTER_Y + STOP_GAP,
  S: CENTER_Y - STOP_GAP,
  E: CENTER_X - STOP_GAP,
  W: CENTER_X + STOP_GAP
};

// lane anchor positions (center line)
const LANE_POS = {
  N: [CENTER_X - LANE_SHIFT, null],
  S: [CENTER_X + LANE_SHIFT, null],
  E: [null, CENTER_Y - LANE_SHIFT],
  W: [null, CENTER_Y + LANE_SHIFT]
};

// Utility
function rand(min, max){ return Math.random() * (max - min) + min; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// ---------- Signal system (density-based, aggressive scaling C) ----------
class Signal {
  constructor(){
    this.dir = 'S';         // initial direction (we start with S like your pygame order)
    this.phase = 'green';   // 'green' or 'yellow'
    this.timer = 0;         // frames into current phase
    // initial green frames start with BASE_GREEN_FRAMES to match initial behavior
    this.greenFrames = BASE_GREEN_FRAMES;
    this.timerFramesLeft = this.greenFrames;
  }

  tick(){
    this.timer++;
    this.timerFramesLeft--;
    if(this.phase === 'green' && this.timerFramesLeft <= 0){
      // go yellow
      this.phase = 'yellow';
      this.timer = 0;
      this.timerFramesLeft = YELLOW_FRAMES;
    } else if(this.phase === 'yellow' && this.timerFramesLeft <= 0){
      // yellow finished -> choose next green by density
      this.phase = 'green';
      this.timer = 0;
      // choose next direction by density (see function below)
      const next = chooseHighestDensityDirection();
      this.dir = next;
      // compute green time using aggressive scaling C:
      const waiting = countWaitingCars(next);
      const greenSec = Math.min(35, 10 + 1.5 * waiting); // seconds
      this.greenFrames = Math.round(greenSec * FPS);
      this.timerFramesLeft = this.greenFrames;
    }
  }

  // return display friendly countdown seconds
  countdown(){
    const framesLeft = this.timerFramesLeft;
    return Math.max(0, Math.ceil(framesLeft / FPS));
  }

  state(){
    // return object mapping direction -> "GREEN"/"YELLOW"/"RED"
    const out = {N: 'RED', E: 'RED', S: 'RED', W: 'RED'};
    out[this.dir] = (this.phase === 'green') ? 'GREEN' : 'YELLOW';
    return out;
  }

  current(){
    return this.dir;
  }
}

// Instantiate
const signal = new Signal();

// ---------- Vehicle class (mirror Pygame) ----------
class Car {
  constructor(direction){
    this.direction = direction; // 'N','S','E','W'
    // speed as random as Pygame (frames: px per frame)
    this.speed = rand(1.2, 1.8);
    this.crossed = false;
    this.initRect();
  }

  initRect(){
    let w, h;
    if(this.direction === 'N' || this.direction === 'S'){
      w = CAR_WIDTH; h = CAR_LENGTH;
    } else {
      w = CAR_LENGTH; h = CAR_WIDTH;
    }

    let x,y;
    if(this.direction === 'N'){
      x = LANE_POS.N[0] - Math.floor(w/2);
      y = SCREEN_HEIGHT + Math.floor(rand(100,180));
    } else if(this.direction === 'S'){
      x = LANE_POS.S[0] - Math.floor(w/2);
      y = -h - Math.floor(rand(100,180));
    } else if(this.direction === 'E'){
      x = -w - Math.floor(rand(100,180));
      y = LANE_POS.E[1] - Math.floor(h/2);
    } else { // W
      x = SCREEN_WIDTH + Math.floor(rand(100,180));
      y = LANE_POS.W[1] - Math.floor(h/2);
    }

    this.w = Math.floor(w); this.h = Math.floor(h);
    this.x = x; this.y = y;
  }

  // lock to lane center each update (so vehicles don't drift)
  laneLock(){
    if(this.direction === 'N' || this.direction === 'S'){
      this.x = LANE_POS[this.direction][0] - Math.floor(this.w/2);
    } else {
      this.y = LANE_POS[this.direction][1] - Math.floor(this.h/2);
    }
  }

  frontPos(){
    if(this.direction === 'N') return this.y;
    if(this.direction === 'S') return this.y + this.h;
    if(this.direction === 'E') return this.x + this.w;
    return this.x;
  }

  gap(cars){
    let minGap = null;
    for(const c of cars){
      if(c === this || c.direction !== this.direction) continue;
      let d;
      // use center comparisons similar to your Pygame code
      if(this.direction === 'N' && c.y < this.y){
        d = this.y - (c.y + c.h);
      } else if(this.direction === 'S' && c.y > this.y){
        d = c.y - (this.y + this.h);
      } else if(this.direction === 'E' && c.x > this.x){
        d = c.x - (this.x + this.w);
      } else if(this.direction === 'W' && c.x < this.x){
        d = this.x - (c.x + c.w);
      } else continue;

      if(d >= 0 && (minGap === null || d < minGap)) minGap = d;
    }
    return minGap;
  }

  // update position based on light state & gap logic. Mirrors Pygame's move()
  move(state, current_green, cars){
    this.laneLock();
    const g = this.gap(cars);
    const stop_for_gap = (g !== null && g < SAFE_GAP);

    const light = state[this.direction];
    const front = this.frontPos();

    // mark crossed when front passes the stop line (same condition as Pygame)
    if(!this.crossed){
      if((this.direction === 'N' && front < STOP_LINES['N']) ||
         (this.direction === 'S' && front > STOP_LINES['S']) ||
         (this.direction === 'E' && front > STOP_LINES['E']) ||
         (this.direction === 'W' && front < STOP_LINES['W'])){
        this.crossed = true;
      }
    }

    // Stop only if not crossed and light isn't GREEN and close to stop (using STOP_OFFSET)
    const should_stop = (!this.crossed && light !== 'GREEN' && (
      (this.direction === 'N' && front <= STOP_LINES['N'] + STOP_OFFSET) ||
      (this.direction === 'S' && front >= STOP_LINES['S'] - STOP_OFFSET) ||
      (this.direction === 'E' && front >= STOP_LINES['E'] - STOP_OFFSET) ||
      (this.direction === 'W' && front <= STOP_LINES['W'] + STOP_OFFSET)
    ));

    // If crossed -> always move (unless blocked by gap)
    // If not crossed: move only if light is GREEN for this direction
    if((this.crossed || (!should_stop && this.direction === current_green)) && !stop_for_gap){
      if(this.direction === 'N') this.y -= this.speed;
      else if(this.direction === 'S') this.y += this.speed;
      else if(this.direction === 'E') this.x += this.speed;
      else if(this.direction === 'W') this.x -= this.speed;
    }
  }

  draw(){
    // draw rounded rectangle body and windshield exactly like Pygame
    ctx.fillStyle = CAR_COLOR;
    roundRect(ctx, Math.round(this.x), Math.round(this.y), this.w, this.h, 6);
    ctx.fill();

    // glass area depends on orientation like your Pygame
    ctx.fillStyle = GLASS;
    if(this.direction === 'N' || this.direction === 'S'){
      ctx.fillRect(Math.round(this.x + 4), Math.round(this.y + 6), Math.max(2,this.w - 8), Math.round(this.h * 0.3));
    } else {
      ctx.fillRect(Math.round(this.x + 6), Math.round(this.y + 4), Math.round(this.w * 0.3), Math.max(2,this.h - 8));
    }
  }

  offscreen(){
    return (this.x + this.w < -120 || this.x > SCREEN_WIDTH + 120 || this.y + this.h < -120 || this.y > SCREEN_HEIGHT + 120);
  }
}

// helper to draw rounded rect
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- DRAW FUNCTIONS (roads, stop lines, signals) ----------
function draw_roads(){
  ctx.fillStyle = ROAD;
  ctx.fillRect(CENTER_X - ROAD_WIDTH/2, 0, ROAD_WIDTH, SCREEN_HEIGHT);
  ctx.fillRect(0, CENTER_Y - ROAD_WIDTH/2, SCREEN_WIDTH, ROAD_WIDTH);

  // stop lines (thin white)
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(CENTER_X - ROAD_WIDTH/2, STOP_LINES.N); ctx.lineTo(CENTER_X + ROAD_WIDTH/2, STOP_LINES.N); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CENTER_X - ROAD_WIDTH/2, STOP_LINES.S); ctx.lineTo(CENTER_X + ROAD_WIDTH/2, STOP_LINES.S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP_LINES.E, CENTER_Y - ROAD_WIDTH/2); ctx.lineTo(STOP_LINES.E, CENTER_Y + ROAD_WIDTH/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(STOP_LINES.W, CENTER_Y - ROAD_WIDTH/2); ctx.lineTo(STOP_LINES.W, CENTER_Y + ROAD_WIDTH/2); ctx.stroke();
}

// draw the exact signal pole used in Pygame: 40x120 rect and 3 circles spaced by 30 px
function draw_signal_pole(x, y, color, timerVal){
  // box 40x120
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(x, y, 40, 120);
  // 3 lights
  const circles = [
    {cx: x + 20, cy: y + 20, col: RED},
    {cx: x + 20, cy: y + 50, col: YELLOW},
    {cx: x + 20, cy: y + 80, col: GREEN}
  ];
  for(let i=0;i<circles.length;i++){
    const c = circles[i];
    // if this light is the current phase, draw in bright color; otherwise dim
    let drawColor = (i === 2 && color === GREEN) ? GREEN
                  : (i === 1 && color === YELLOW) ? YELLOW
                  : (i === 0 && color === RED) ? RED
                  : 'rgb(90,90,90)';
    // But Pygame draws the active color for the active phase only on the active pole: we mimic that in draw_signals
    ctx.beginPath();
    ctx.fillStyle = drawColor;
    ctx.arc(c.cx, c.cy, 10, 0, Math.PI*2);
    ctx.fill();
  }
  // timer above pole if provided
  if(typeof timerVal === 'number'){
    ctx.fillStyle = WHITE;
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(String(timerVal), x + 20, y - 15);
  }
}

function draw_signals(state, timer, current){
  // place signals with same coordinates as your python code
  // N: (CENTER_X - 20, CENTER_Y - 250)
  // S: (CENTER_X - 20, CENTER_Y + 130)
  // E: (CENTER_X + 180, CENTER_Y - 60)
  // W: (CENTER_X - 250, CENTER_Y - 60)
  const mapping = {
    N: [CENTER_X - 20, CENTER_Y - 250],
    S: [CENTER_X - 20, CENTER_Y + 130],
    E: [CENTER_X + 180, CENTER_Y - 60],
    W: [CENTER_X - 250, CENTER_Y - 60]
  };

  for(const d of ['N','S','E','W']){
    const [x,y] = mapping[d];
    // decide what color to pass to draw_signal_pole:
    // if this pole is the current dir:
    const colTxt = state[d];
    let activeColor = null;
    if(colTxt === 'GREEN') activeColor = GREEN;
    else if(colTxt === 'YELLOW') activeColor = YELLOW;
    else activeColor = RED;
    const showTimer = (d === current) ? timer : null;
    draw_signal_pole(x, y, activeColor, showTimer);
  }
}

// ---------- Main simulation state ----------
const cars = []; // list of Car objects
let frameCount = 0;

// spawn function similar to Pygame
function trySpawn(){
  if(frameCount % SPAWN_INTERVAL !== 0) return;
  if(cars.length >= MAX_CARS) return;
  const dir = ['N','S','E','W'][Math.floor(Math.random()*4)];
  cars.push(new Car(dir));
}

// count waiting cars (not crossed) for each direction
function countWaitingCars(dir){
  return cars.filter(c => c.direction === dir && !c.crossed).length;
}
function waitingCountsAll(){
  return {
    N: cars.filter(c=>c.direction==='N' && !c.crossed).length,
    E: cars.filter(c=>c.direction==='E' && !c.crossed).length,
    S: cars.filter(c=>c.direction==='S' && !c.crossed).length,
    W: cars.filter(c=>c.direction==='W' && !c.crossed).length
  };
}

// choose direction with highest waiting cars (if tie, choose longest-waiting: we pick existing signal.dir if tied else random among ties)
function chooseHighestDensityDirection(){
  const counts = waitingCountsAll();
  let max = -1;
  let best = signal.dir; // prefer current if tied
  for(const d of ['N','E','S','W']){
    if(counts[d] > max){
      max = counts[d];
      best = d;
    }
  }
  // if all zero -> rotate to next to avoid starvation (choose next clockwise of current)
  if(max === 0){
    const order = ['S','W','N','E']; // your original order—use this to rotate
    const idx = order.indexOf(signal.dir);
    return order[(idx + 1) % order.length];
  }
  return best;
}

// ---------- Main loop ----------
function updateAndDraw(){
  frameCount++;

  // background
  ctx.fillStyle = GREY;
  ctx.fillRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);

  // draw roads and stop lines
  draw_roads();

  // update signal
  signal.tick();
  const state = signal.state();
  const current = signal.current();
  draw_signals(state, signal.countdown(), current);

  // spawn cars
  trySpawn();

  // move & draw cars copy of Pygame loop
  for(let i = cars.length - 1; i >= 0; i--){
    const c = cars[i];
    c.move(state, current, cars);
    c.draw();
    // remove offscreen
    if(c.offscreen()){
      cars.splice(i,1);
    }
  }

  // bottom info text (big)
  ctx.fillStyle = WHITE;
  ctx.font = '20px Arial';
  ctx.textAlign = 'center';
  const infoText = `Current Green: ${signal.current()} | Time Left: ${signal.countdown()}s | Cars: ${cars.length}`;
  ctx.fillText(infoText, CENTER_X, SCREEN_HEIGHT - 30);

  // next frame
  requestAnimationFrame(updateAndDraw);
}

// init: optionally prefill a few cars to show queues (like your Pygame example sometimes had)
for(let i=0;i<6;i++){
  cars.push(new Car(['N','E','S','W'][i%4]));
}

// start
requestAnimationFrame(updateAndDraw);
