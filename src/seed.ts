import { initDb, getDb, saveDb } from './database';
import type { OrderStatus } from './models/order';

interface SeedOrder {
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  items: { productName: string; quantity: number; unitPrice: number }[];
}

const seedData: SeedOrder[] = [
  {
    customerName: 'Alice Johnson',
    customerEmail: 'alice@example.com',
    status: 'pending',
    items: [
      { productName: 'Wireless Headphones', quantity: 1, unitPrice: 89.99 },
      { productName: 'USB-C Cable', quantity: 2, unitPrice: 12.99 },
    ],
  },
  {
    customerName: 'Bob Smith',
    customerEmail: 'bob@example.com',
    status: 'pending',
    items: [
      { productName: 'Mechanical Keyboard', quantity: 1, unitPrice: 149.99 },
      { productName: 'Mouse Pad XL', quantity: 1, unitPrice: 24.99 },
      { productName: 'HDMI Cable 2m', quantity: 2, unitPrice: 9.99 },
    ],
  },
  {
    customerName: 'Carol White',
    customerEmail: 'carol@example.com',
    status: 'confirmed',
    items: [
      { productName: 'Monitor Stand', quantity: 1, unitPrice: 45.99 },
      { productName: 'Laptop Stand', quantity: 1, unitPrice: 39.99 },
    ],
  },
  {
    customerName: 'David Brown',
    customerEmail: 'david@example.com',
    status: 'shipped',
    items: [
      { productName: 'HD Webcam', quantity: 1, unitPrice: 79.99 },
      { productName: 'Ring Light', quantity: 1, unitPrice: 35.99 },
      { productName: 'USB Microphone', quantity: 1, unitPrice: 49.99 },
    ],
  },
  {
    customerName: 'Eve Davis',
    customerEmail: 'eve@example.com',
    status: 'delivered',
    items: [
      { productName: 'Standing Desk Mat', quantity: 1, unitPrice: 55.99 },
      { productName: 'Ergonomic Cushion', quantity: 1, unitPrice: 42.99 },
      { productName: 'Cable Management Box', quantity: 1, unitPrice: 19.99 },
    ],
  },
];

function getLastInsertId(): number {
  const db = getDb();
  const result = db.exec('SELECT last_insert_rowid() as id');
  return result[0].values[0][0] as number;
}

async function seed() {
  await initDb();
  const db = getDb();
  const now = new Date().toISOString();

  db.run('DELETE FROM order_items');
  db.run('DELETE FROM orders');
  db.run("DELETE FROM sqlite_sequence WHERE name IN ('orders', 'order_items')");

  for (const order of seedData) {
    const total = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

    db.run(
      `INSERT INTO orders (customerName, customerEmail, status, totalAmount, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [order.customerName, order.customerEmail, order.status, Math.round(total * 100) / 100, now, now]
    );

    const orderId = getLastInsertId();

    for (const item of order.items) {
      db.run(
        `INSERT INTO order_items (orderId, productName, quantity, unitPrice)
         VALUES (?, ?, ?, ?)`,
        [orderId, item.productName, item.quantity, item.unitPrice]
      );
    }

    console.log(`Inserted order #${orderId} for ${order.customerName} (${order.status})`);
  }

  saveDb();
  console.log('Seeding complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
