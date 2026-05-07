import { initDb, getDb, saveDb } from './database';
import type { OrderStatus } from './models/order';

interface SeedOrder {
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  items: { productName: string; sku: string; quantity: number; unitPrice: number }[];
}

const seedData: SeedOrder[] = [
  {
    customerName: 'Alice Johnson',
    customerEmail: 'alice@example.com',
    status: 'pending',
    items: [
      { productName: 'Wireless Keyboard', sku: 'ELEC-002', quantity: 1, unitPrice: 89.99 },
      { productName: 'USB-C Charging Cable 1m', sku: 'ELEC-001', quantity: 2, unitPrice: 12.99 },
    ],
  },
  {
    customerName: 'Bob Smith',
    customerEmail: 'bob@example.com',
    status: 'pending',
    items: [
      { productName: 'Wireless Mouse', sku: 'ELEC-003', quantity: 1, unitPrice: 34.99 },
      { productName: 'USB Hub 4-Port', sku: 'ELEC-006', quantity: 1, unitPrice: 24.99 },
      { productName: 'HDMI Cable 2m', sku: 'ELEC-005', quantity: 2, unitPrice: 9.99 },
    ],
  },
  {
    customerName: 'Carol White',
    customerEmail: 'carol@example.com',
    status: 'confirmed',
    items: [
      { productName: 'Ergonomic Office Chair', sku: 'FURN-001', quantity: 2, unitPrice: 249.99 },
      { productName: 'Standing Desk (adjustable)', sku: 'FURN-002', quantity: 1, unitPrice: 449.99 },
    ],
  },
  {
    customerName: 'David Brown',
    customerEmail: 'david@example.com',
    status: 'shipped',
    items: [
      { productName: 'Disinfectant Wipes (canister)', sku: 'CLEN-005', quantity: 4, unitPrice: 8.99 },
      { productName: 'All-Purpose Cleaner (5L)', sku: 'CLEN-001', quantity: 2, unitPrice: 15.99 },
      { productName: 'Paper Towels (case of 12)', sku: 'CLEN-002', quantity: 3, unitPrice: 24.99 },
    ],
  },
  {
    customerName: 'Eve Davis',
    customerEmail: 'eve@example.com',
    status: 'delivered',
    items: [
      { productName: 'A4 Copy Paper (ream)', sku: 'OFFC-001', quantity: 5, unitPrice: 8.99 },
      { productName: 'Ballpoint Pens (box of 12)', sku: 'OFFC-002', quantity: 2, unitPrice: 7.99 },
      { productName: 'Sticky Notes 3x3', sku: 'OFFC-003', quantity: 3, unitPrice: 4.99 },
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
        `INSERT INTO order_items (orderId, productName, sku, quantity, unitPrice)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, item.productName, item.sku, item.quantity, item.unitPrice]
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
