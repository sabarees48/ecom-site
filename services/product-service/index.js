const express = require('express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3002;
const SERVICE_NAME = 'product-service';

const TABLE_NAME = process.env.PRODUCTS_TABLE;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_MODE = Boolean(TABLE_NAME);

const ddb = AWS_MODE ? DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION })) : null;

const mockProducts = [
  { id: '101', name: 'Wireless Mouse', price: 19.99 },
  { id: '102', name: 'Mechanical Keyboard', price: 59.99 },
];

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: SERVICE_NAME, mode: AWS_MODE ? 'dynamodb' : 'mock', timestamp: new Date().toISOString() });
});

app.get('/api/products', async (req, res) => {
  if (!AWS_MODE) {
    return res.status(200).json({ service: SERVICE_NAME, mode: 'mock', count: mockProducts.length, data: mockProducts });
  }
  try {
    const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
    const data = result.Items || [];
    res.status(200).json({ service: SERVICE_NAME, mode: 'dynamodb', count: data.length, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read products from DynamoDB', details: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, price } = req.body || {};
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  const product = { id: randomUUID(), name, price: Number(price) };

  if (!AWS_MODE) {
    mockProducts.push(product);
    return res.status(201).json({ service: SERVICE_NAME, mode: 'mock', product });
  }
  try {
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: product }));
    res.status(201).json({ service: SERVICE_NAME, mode: 'dynamodb', product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create product', details: err.message });
  }
});

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Hello from ' + SERVICE_NAME, mode: AWS_MODE ? 'dynamodb' : 'mock', hostname: require('os').hostname() });
});

app.listen(PORT, () => {
  console.log(SERVICE_NAME + ' listening on port ' + PORT + ' (mode: ' + (AWS_MODE ? 'dynamodb' : 'mock') + ')');
});
