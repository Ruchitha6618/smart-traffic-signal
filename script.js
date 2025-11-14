/* SLOT-BASED NON-OVERLAPPING WEB VERSION
   Matches Pygame layout exactly.
   Gap between cars = 65px (Option C)
   Density-based green logic (Option C)
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
const SLOT_GAP = 65;          // <==== YOUR GAP CHOICE
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
      this.framesLeft = sec * FPS;
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
}

// ===== CARS (slot-based, non-overlapping) =====
class Car {
  constructor(dir, slot){
    this.dir = dir;
    this.slot = slot;     // 0 = frontmost, SLOTS_MAX-1 = farthest away
    this.crossed = false;

    this.speed = Math.random() * 0.5 + 0.8;  // slow realistic speed

    const p = SLOT_POS[dir][slot];
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

    // Mark crossed when front passes stop line
    if(this.dir==="N" && this.front() < STOP.N) this.crossed=true;
    if(this.dir==="S" && this.front() > STOP.S) this.crossed=true;
    if(this.dir==="E" && this.front() > STOP.E) this.crossed=true;
    if(this.dir==="W" && this.front() < STOP.W) this.crossed=true;

    if(this.crossed){
      this.update(state, curGreen);
      return;
    }

    // STOP if red or yellow
    const myLight = state[this.dir];
    let stop = (myLight !== "GREEN");

    // If frontmost slot (slot 0) AND green → move through intersection
    if(this.slot === 0 && this.dir === curGreen){
      stop = false;
    }

    // If not stop → move toward intersection (reduce slot index)
    if(!stop){
      // Move closer to intersection: reduce slot index
      if(this.slot > 0){
        const nextSlot = this.slot - 1;
        const nextP = SLOT_POS[this.dir][nextSlot];

        // Smooth move
        const dx = nextP.x - this.x;
        const dy = nextP.y - this.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const step = Math.min(this.speed, dist);

        this.x += dx/dist * step;
        this.y += dy/dist * step;

        // Switch to next slot when close enough
        if(dist < 1) this.slot = nextSlot;
      }
    }
  }

  draw(){
    ctx.fillStyle = "rgb(200,80,70)";
    roundRect(ctx, this.x, this.y, this.w, this.h, 6);
    ctx.fill();

    ctx.fillStyle = "rgb(160,220,255)";
    if(this.dir==="N"||this.dir==="S")
      ctx.fillRect(this.x+4, this.y+6, this.w-8, this.h*0.3);
    else
      ctx.fillRect(this.x+6, this.y+4, this.w*0.3, this.h-8);
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

// spawn car in highest empty slot (NO OVERLAP EVER)
function spawn(){
  if(frame % SPAWN_INTERVAL !== 0) return;
  if(cars.length >= MAX_CARS) return;

  const dirs = ["N","S","E","W"];
  const d = dirs[Math.floor(Math.random()*4)];

  const filled = cars.filter(c => c.dir===d).map(c => c.slot);
  for(let s = SLOTS_MAX-1; s>=0; s--){
    if(!filled.includes(s)){
      cars.push(new Car(d, s));
      return;
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

requestAnimationFrame(loop);
