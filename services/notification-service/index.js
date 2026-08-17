const express = require('express');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
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
const PORT = process.env.PORT || 3005;
const SERVICE_NAME = 'notification-service';

const TOPIC_ARN = process.env.TOPIC_ARN;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_MODE = Boolean(TOPIC_ARN);

const sns = AWS_MODE ? new SNSClient({ region: AWS_REGION }) : null;

const mockNotifications = [
  { id: '1', userId: '1', message: 'Your order has shipped!' },
  { id: '2', userId: '2', message: 'Payment is processing.' },
];

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
  res.status(200).json({ status: 'UP', service: SERVICE_NAME, mode: AWS_MODE ? 'sns' : 'mock', timestamp: new Date().toISOString() });
});

app.get('/api/notifications', (req, res) => {
  res.status(200).json({ service: SERVICE_NAME, mode: AWS_MODE ? 'sns' : 'mock', count: mockNotifications.length, data: mockNotifications });
});

// POST /api/notifications — publishes a message to the SNS topic (demo trigger,
// separate from the automatic notification the ProcessOrder Lambda sends).
app.post('/api/notifications', async (req, res) => {
  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  const notification = { id: randomUUID(), message, sentAt: new Date().toISOString() };

  if (!AWS_MODE) {
    mockNotifications.push(notification);
    return res.status(201).json({ service: SERVICE_NAME, mode: 'mock', notification });
  }

  try {
    await sns.send(new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: 'Manual notification (demo)',
      Message: message,
    }));
    res.status(201).json({ service: SERVICE_NAME, mode: 'sns', notification });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to publish to SNS', details: err.message });
  }
});

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Hello from ' + SERVICE_NAME, mode: AWS_MODE ? 'sns' : 'mock', hostname: require('os').hostname() });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(SERVICE_NAME + ' listening on port ' + PORT + ' (mode: ' + (AWS_MODE ? 'sns' : 'mock') + ')');
});
