const canvas = document.getElementById("trafficCanvas");
const ctx = canvas.getContext("2d");

let directions = ["N", "E", "S", "W"];
let index = 0;
let timeLeft = 15;

// Car positions
let cars = {
  "N": Array(5).fill(0).map((_, i) => 550 + i * 60),
  "S": Array(5).fill(0).map((_, i) => 50 - i * 60),
  "E": Array(5).fill(0).map((_, i) => 100 - i * 60),
  "W": Array(5).fill(0).map((_, i) => 700 + i * 60)
};

// Car image
const carImage = new Image();
carImage.src = "https://cdn-icons-png.flaticon.com/512/743/743131.png";

// Adaptive signal timing
function getAdaptiveTime() {
  const currentDensity = cars[directions[index]].length;
  return Math.min(25, 10 + currentDensity * 2);
}

function drawRoads() {
  ctx.fillStyle = "#444";
  ctx.fillRect(0, 210, 900, 80);
  ctx.fillRect(410, 0, 80, 500);

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.strokeRect(350, 150, 200, 200);
}

function drawSignals() {
  const signals = {
    "N": [440, 120],
    "S": [440, 430],
    "E": [620, 260],
    "W": [280, 260]
  };

  for (let d in signals) {
    const [x, y] = signals[d];
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fillStyle = (d === directions[index]) ? "limegreen" : "red";
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.stroke();
  }
}

function drawCars() {
  for (let y of cars["N"]) ctx.drawImage(carImage, 435, y, 25, 20);
  for (let y of cars["S"]) ctx.drawImage(carImage, 455, y, 25, 20);
  for (let x of cars["E"]) ctx.drawImage(carImage, x, 240, 25, 20);
  for (let x of cars["W"]) ctx.drawImage(carImage, x, 260, 25, 20);
}

function moveCars() {
  const dir = directions[index];
  const speed = 2;

  if (dir === "N") cars["N"] = cars["N"].map(y => y - speed);
  if (dir === "S") cars["S"] = cars["S"].map(y => y + speed);
  if (dir === "E") cars["E"] = cars["E"].map(x => x + speed);
  if (dir === "W") cars["W"] = cars["W"].map(x => x - speed);

  // Respawn cars
  if (cars["N"][0] < -50) cars["N"].push(500);
  if (cars["S"][0] > 550) cars["S"].unshift(-50);
  if (cars["E"][0] > 950) cars["E"].unshift(0);
  if (cars["W"][0] < -50) cars["W"].push(900);
}

// ---- CHART.JS ----

const ctxChart = document.getElementById("trafficChart").getContext("2d");

const trafficChart = new Chart(ctxChart, {
  type: "bar",
  data: {
    labels: ["North", "East", "South", "West"],
    datasets: [{
      label: "Number of Vehicles",
      backgroundColor: ["#00ffff", "#ff6600", "#33ff33", "#ff3333"],
      data: [5, 5, 5, 5]
    }]
  },
  options: {
    responsive: false,
    scales: {
      y: { beginAtZero: true, ticks: { color: "#fff" }, grid: { color: "#444" } },
      x: { ticks: { color: "#fff" }, grid: { color: "#444" } }
    },
    plugins: { legend: { labels: { color: "#fff" } } }
  }
});

function updateCounts() {
  document.getElementById("northCount").textContent = cars["N"].length;
  document.getElementById("eastCount").textContent = cars["E"].length;
  document.getElementById("southCount").textContent = cars["S"].length;
  document.getElementById("westCount").textContent = cars["W"].length;

  trafficChart.data.datasets[0].data = [
    cars["N"].length,
    cars["E"].length,
    cars["S"].length,
    cars["W"].length
  ];
  trafficChart.update();
}

function updateSignal() {
  timeLeft--;
  if (timeLeft <= 0) {
    index = (index + 1) % 4;
    timeLeft = getAdaptiveTime();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawRoads();
  drawSignals();
  moveCars();
  drawCars();
  updateCounts();

  document.getElementById("info").innerText =
    `🟢 Current Green: ${directions[index]} | ⏱️ Time Left: ${timeLeft}s`;

  updateSignal();
  requestAnimationFrame(draw);
}

carImage.onload = draw;
