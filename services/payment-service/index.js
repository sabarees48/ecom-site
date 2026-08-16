const express = require("express");
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

app.get("/health", (req, res) => {
  res.status(200).json({ status: "UP", service: SERVICE_NAME, timestamp: new Date().toISOString() });
});

app.get("/api/payments", (req, res) => {
  res.status(200).json({ service: SERVICE_NAME, count: data.length, data });
});

app.get("/", (req, res) => {
  res.status(200).json({ message: "Hello from " + SERVICE_NAME, hostname: require("os").hostname() });
});

app.listen(PORT, () => {
  console.log(SERVICE_NAME + " listening on port " + PORT);
});
