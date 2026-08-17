const express = require('express');
const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { randomUUID } = require('crypto');

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
const PORT = process.env.PORT || 3003;
const SERVICE_NAME = 'order-service';

// AWS wiring is optional: if these env vars aren't set (e.g. running the
// container locally without the full stack deployed), the service falls
// back to an in-memory mock so it's still useful for local dev / class demo.
const DB_SECRET_ARN = process.env.DB_SECRET_ARN;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT || 5432;
const DB_NAME = process.env.DB_NAME || 'ordersdb';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const AWS_MODE = Boolean(DB_SECRET_ARN && DB_HOST && EVENT_BUS_NAME);

const secretsManager = AWS_MODE ? new SecretsManagerClient({ region: AWS_REGION }) : null;
const eventBridge = AWS_MODE ? new EventBridgeClient({ region: AWS_REGION }) : null;

let mockOrders = [
  { orderId: '5001', userId: '1', productId: '101', status: 'SHIPPED', createdAt: new Date().toISOString() },
  { orderId: '5002', userId: '2', productId: '102', status: 'PENDING', createdAt: new Date().toISOString() },
];

let pgClientPromise = null;

async function getDbClient() {
  if (pgClientPromise) return pgClientPromise;

  pgClientPromise = (async () => {
    const secret = await secretsManager.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
    const { username, password } = JSON.parse(secret.SecretString);

    const client = new Client({
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: username,
      password,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    return client;
  })();

  return pgClientPromise;
}

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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: SERVICE_NAME, mode: AWS_MODE ? 'rds' : 'mock', timestamp: new Date().toISOString() });
});

// GET /api/orders
app.get('/api/orders', async (req, res) => {
  if (!AWS_MODE) {
    return res.status(200).json({ service: SERVICE_NAME, mode: 'mock', count: mockOrders.length, data: mockOrders });
  }
  try {
    const client = await getDbClient();
    const result = await client.query('SELECT order_id AS "orderId", user_id AS "userId", product_id AS "productId", status, created_at AS "createdAt" FROM orders ORDER BY created_at DESC');
    res.status(200).json({ service: SERVICE_NAME, mode: 'rds', count: result.rows.length, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read orders from RDS', details: err.message });
  }
});

// POST /api/orders — creates the order, then publishes OrderPlaced to EventBridge
app.post('/api/orders', async (req, res) => {
  const { userId, productId } = req.body || {};
  if (!userId || !productId) {
    return res.status(400).json({ error: 'userId and productId are required' });
  }

  const order = {
    orderId: randomUUID(),
    userId,
    productId,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  if (!AWS_MODE) {
    mockOrders.push(order);
    return res.status(201).json({ service: SERVICE_NAME, mode: 'mock', order });
  }

  try {
    const client = await getDbClient();
    await client.query(
      'INSERT INTO orders (order_id, user_id, product_id, status, created_at) VALUES ($1, $2, $3, $4, $5)',
      [order.orderId, order.userId, order.productId, order.status, order.createdAt]
    );

    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'eks.demo.orders',
        DetailType: 'OrderPlaced',
        Detail: JSON.stringify(order),
        EventBusName: EVENT_BUS_NAME,
      }],
    }));

    res.status(201).json({ service: SERVICE_NAME, mode: 'rds', order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order', details: err.message });
  }
});

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Hello from ' + SERVICE_NAME, mode: AWS_MODE ? 'rds' : 'mock', hostname: require('os').hostname() });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(SERVICE_NAME + ' listening on port ' + PORT + ' (mode: ' + (AWS_MODE ? 'rds' : 'mock') + ')');
});
