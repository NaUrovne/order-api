import { Router, Request, Response } from 'express';
import { getDb, saveDb } from '../database';
import { OrderStatus } from '../models/order';

const router = Router();

const INVENTORY_BASE = 'http://localhost:5000/api/products';

const VALID_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

function rowToOrder(row: Record<string, unknown>) {
  return {
    id: row['id'],
    customerName: row['customerName'],
    customerEmail: row['customerEmail'],
    status: row['status'],
    totalAmount: row['totalAmount'],
    createdAt: row['createdAt'],
    updatedAt: row['updatedAt'],
  };
}

function rowToItem(row: Record<string, unknown>) {
  return {
    id: row['id'],
    orderId: row['orderId'],
    productName: row['productName'],
    sku: row['sku'],
    quantity: row['quantity'],
    unitPrice: row['unitPrice'],
  };
}

function queryRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// GET /api/orders
router.get('/', (req: Request, res: Response) => {
  const { status } = req.query;

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status as OrderStatus)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    const rows = queryRows('SELECT * FROM orders WHERE status = ?', [status as string]);
    const orders = rows.map(rowToOrder);
    res.json({ count: orders.length, orders });
    return;
  }

  const rows = queryRows('SELECT * FROM orders');
  const orders = rows.map(rowToOrder);
  res.json({ count: orders.length, orders });
});

// GET /api/orders/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const orderRows = queryRows('SELECT * FROM orders WHERE id = ?', [id]);

  if (orderRows.length === 0) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const order = rowToOrder(orderRows[0]);
  const itemRows = queryRows('SELECT * FROM order_items WHERE orderId = ?', [id]);
  const items = itemRows.map(rowToItem);

  res.json({ ...order, items });
});

// POST /api/orders
router.post('/', async (req: Request, res: Response) => {
  const { customerName, customerEmail, items } = req.body;
  const errors: string[] = [];

  if (!customerName || typeof customerName !== 'string' || customerName.trim() === '') {
    errors.push('customerName is required and must be a non-empty string');
  }
  if (!customerEmail || typeof customerEmail !== 'string' || customerEmail.trim() === '') {
    errors.push('customerEmail is required and must be a non-empty string');
  }
  if (!Array.isArray(items) || items.length === 0) {
    errors.push('items must be a non-empty array');
  } else {
    items.forEach((item: unknown, i: number) => {
      if (typeof item !== 'object' || item === null) {
        errors.push(`items[${i}] must be an object`);
        return;
      }
      const it = item as Record<string, unknown>;
      if (!it['productName'] || typeof it['productName'] !== 'string' || (it['productName'] as string).trim() === '') {
        errors.push(`items[${i}].productName is required and must be a non-empty string`);
      }
      if (!it['sku'] || typeof it['sku'] !== 'string' || (it['sku'] as string).trim() === '') {
        errors.push(`items[${i}].sku is required and must be a non-empty string`);
      }
      if (!Number.isInteger(it['quantity']) || (it['quantity'] as number) <= 0) {
        errors.push(`items[${i}].quantity must be an integer greater than 0`);
      }
      if (typeof it['unitPrice'] !== 'number' || (it['unitPrice'] as number) <= 0) {
        errors.push(`items[${i}].unitPrice must be a number greater than 0`);
      }
    });
  }

  if (errors.length > 0) {
    res.status(400).json({ error: 'Validation failed', details: errors });
    return;
  }

  const validatedItems = items as Record<string, unknown>[];

  // Check stock availability for all items before touching the DB
  const stockErrors: string[] = [];
  try {
    for (const item of validatedItems) {
      const sku = (item['sku'] as string).trim();
      const qty = item['quantity'] as number;
      const resp = await fetch(`${INVENTORY_BASE}/${encodeURIComponent(sku)}`);
      if (resp.status === 404) {
        stockErrors.push(`SKU '${sku}' not found in inventory`);
        continue;
      }
      if (!resp.ok) {
        stockErrors.push(`Inventory error for SKU '${sku}'`);
        continue;
      }
      const product = await resp.json() as { current_stock: number };
      if (product.current_stock < qty) {
        stockErrors.push(`Insufficient stock for '${sku}': requested ${qty}, available ${product.current_stock}`);
      }
    }
  } catch (_) {
    res.status(503).json({ error: 'Inventory service unavailable' });
    return;
  }

  if (stockErrors.length > 0) {
    res.status(400).json({ error: 'Inventory check failed', details: stockErrors });
    return;
  }

  const totalAmount = validatedItems.reduce(
    (sum, item) => sum + (item['quantity'] as number) * (item['unitPrice'] as number),
    0
  );

  const now = new Date().toISOString();
  const db = getDb();

  db.run(
    'INSERT INTO orders (customerName, customerEmail, status, totalAmount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [customerName.trim(), customerEmail.trim(), 'pending', totalAmount, now, now]
  );

  const idRows = queryRows('SELECT last_insert_rowid() as id');
  const orderId = idRows[0]['id'] as number;

  for (const item of validatedItems) {
    db.run(
      'INSERT INTO order_items (orderId, productName, sku, quantity, unitPrice) VALUES (?, ?, ?, ?, ?)',
      [orderId, (item['productName'] as string).trim(), (item['sku'] as string).trim(), item['quantity'], item['unitPrice']]
    );
  }

  // Deduct stock; if this fails, roll back the in-memory DB insert (don't call saveDb)
  try {
    for (const item of validatedItems) {
      const sku = (item['sku'] as string).trim();
      const qty = item['quantity'] as number;
      const resp = await fetch(`${INVENTORY_BASE}/${encodeURIComponent(sku)}/stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustment: -qty, reason: `Reserved for Order #${orderId}` }),
      });
      if (!resp.ok) throw new Error(`Stock deduction failed for '${sku}'`);
    }
  } catch (_) {
    db.run('DELETE FROM order_items WHERE orderId = ?', [orderId]);
    db.run('DELETE FROM orders WHERE id = ?', [orderId]);
    res.status(503).json({ error: 'Inventory service unavailable' });
    return;
  }

  saveDb();

  const orderRows = queryRows('SELECT * FROM orders WHERE id = ?', [orderId]);
  const order = rowToOrder(orderRows[0]);
  const itemRows = queryRows('SELECT * FROM order_items WHERE orderId = ?', [orderId]);

  res.status(201).json({ ...order, items: itemRows.map(rowToItem) });
});

// PATCH /api/orders/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const orderRows = queryRows('SELECT * FROM orders WHERE id = ?', [id]);

  if (orderRows.length === 0) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const current = rowToOrder(orderRows[0]);
  const { status, customerName, customerEmail } = req.body;
  const errors: string[] = [];

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status as OrderStatus)) {
      errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    } else {
      const allowed = STATUS_TRANSITIONS[current.status as OrderStatus];
      if (allowed.length === 0) {
        errors.push(`Order is in a final state (${current.status}) and cannot be updated`);
      } else if (!allowed.includes(status as OrderStatus)) {
        errors.push(`Cannot transition from '${current.status}' to '${status}'. Allowed: ${allowed.join(', ')}`);
      }
    }
  }

  if (customerName !== undefined && (typeof customerName !== 'string' || customerName.trim() === '')) {
    errors.push('customerName must be a non-empty string');
  }
  if (customerEmail !== undefined && (typeof customerEmail !== 'string' || customerEmail.trim() === '')) {
    errors.push('customerEmail must be a non-empty string');
  }

  if (errors.length > 0) {
    res.status(400).json({ error: 'Validation failed', details: errors });
    return;
  }

  // Restore stock when cancelling an order
  if (status === 'cancelled') {
    const itemRows = queryRows('SELECT * FROM order_items WHERE orderId = ?', [id]);
    try {
      for (const itemRow of itemRows) {
        const sku = itemRow['sku'] as string;
        const qty = itemRow['quantity'] as number;
        const resp = await fetch(`${INVENTORY_BASE}/${encodeURIComponent(sku)}/stock`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adjustment: qty, reason: `Cancelled Order #${id}` }),
        });
        if (!resp.ok) throw new Error(`Stock restore failed for '${sku}'`);
      }
    } catch (_) {
      res.status(503).json({ error: 'Inventory service unavailable' });
      return;
    }
  }

  const newStatus = status !== undefined ? (status as string) : current.status;
  const newName = customerName !== undefined ? customerName.trim() : current.customerName;
  const newEmail = customerEmail !== undefined ? customerEmail.trim() : current.customerEmail;
  const now = new Date().toISOString();

  const db = getDb();
  db.run(
    'UPDATE orders SET status = ?, customerName = ?, customerEmail = ?, updatedAt = ? WHERE id = ?',
    [newStatus, newName, newEmail, now, id]
  );
  saveDb();

  const updatedRows = queryRows('SELECT * FROM orders WHERE id = ?', [id]);
  res.json(rowToOrder(updatedRows[0]));
});

// DELETE /api/orders/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const orderRows = queryRows('SELECT * FROM orders WHERE id = ?', [id]);

  if (orderRows.length === 0) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const db = getDb();
  db.run('DELETE FROM order_items WHERE orderId = ?', [id]);
  db.run('DELETE FROM orders WHERE id = ?', [id]);
  saveDb();

  res.status(204).send();
});

export default router;
