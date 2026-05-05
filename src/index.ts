import express from 'express';
import { initDb } from './database';
import ordersRouter from './routes/orders';

const app = express();
const PORT = 3000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Order Management API', version: '1.0.0' });
});

app.use('/api/orders', ordersRouter);

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
