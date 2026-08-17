const express = require("express");
// --- Prometheus metrics ---
const promClient = require('prom-client');
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests received',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const app = express();
const PORT = process.env.PORT || 3004;
const SERVICE_NAME = "payment-service";

const data = [{"id":9001,"orderId":5001,"amount":19.99,"status":"COMPLETED"},{"id":9002,"orderId":5002,"amount":59.99,"status":"PROCESSING"}];

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  const end = httpRequestDurationSeconds.startTimer();
  res.on('finish', () => {
    const labels = { method: req.method, route: req.path, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "UP", service: SERVICE_NAME, timestamp: new Date().toISOString() });
});

app.get("/api/payments", (req, res) => {
  res.status(200).json({ service: SERVICE_NAME, count: data.length, data });
});

app.get("/", (req, res) => {
  res.status(200).json({ message: "Hello from " + SERVICE_NAME, hostname: require("os").hostname() });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(SERVICE_NAME + " listening on port " + PORT);
});
