import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.join(__dirname, '..', 'orders.db');

let db: Database | null = null;

export async function initDb(): Promise<Database> {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerName TEXT NOT NULL,
      customerEmail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      totalAmount REAL NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productName TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unitPrice REAL NOT NULL CHECK (unitPrice > 0),
      FOREIGN KEY (orderId) REFERENCES orders(id)
    )
  `);

  saveDb();
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// Persist in-memory database to disk after writes
export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}
