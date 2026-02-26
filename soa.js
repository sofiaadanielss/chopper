// ============================================================
//  Chopper Coffee — Service-Oriented Architecture (SOA) Demo
//  Each "service" is an independent unit that communicates
//  through a shared message bus (the Service Bus pattern).
// ============================================================

// ── Service Bus (Message Broker) ────────────────────────────
// The bus routes messages between services. No service talks
// directly to another — they only publish/subscribe via the bus.
class ServiceBus {
  constructor() {
    this._subscribers = {};
    this._log = [];
  }

  subscribe(event, handler) {
    if (!this._subscribers[event]) this._subscribers[event] = [];
    this._subscribers[event].push(handler);
  }

  async publish(event, payload) {
    const entry = { event, payload, timestamp: Date.now() };
    this._log.push(entry);
    notifyBusLog(entry); // update UI

    const handlers = this._subscribers[event] || [];
    for (const handler of handlers) {
      await delay(400); // simulate async inter-service latency
      await handler(payload);
    }
  }

  getLog() { return this._log; }
}

// ── Shared Bus Instance ──────────────────────────────────────
const bus = new ServiceBus();

// ── Service: Order Service ───────────────────────────────────
// Responsible for receiving and validating orders
class OrderService {
  constructor(bus) {
    this.name = 'OrderService';
    this._bus = bus;
    this._orders = {};
  }

  async placeOrder(items, customerName) {
    const orderId = `ORD-${Math.floor(Math.random() * 9000 + 1000)}`;
    const total = items.reduce((sum, i) => sum + i.price, 0);
    this._orders[orderId] = { orderId, items, customerName, total, status: 'placed' };

    await this._bus.publish('order.placed', {
      orderId, customerName, items, total,
      service: this.name
    });

    return orderId;
  }
}

// ── Service: Inventory Service ───────────────────────────────
// Tracks ingredient stock and reacts to orders
class InventoryService {
  constructor(bus) {
    this.name = 'InventoryService';
    this._stock = {
      'Espresso Beans': 240,
      'Oat Milk': 18,
      'Brown Sugar Syrup': 12,
      'Matcha Powder': 8,
    };

    bus.subscribe('order.placed', async ({ orderId, items, service }) => {
      const deductions = {};
      items.forEach(item => {
        if (item.ingredient && this._stock[item.ingredient] !== undefined) {
          this._stock[item.ingredient] -= item.ingredientQty || 1;
          deductions[item.ingredient] = this._stock[item.ingredient];
        }
      });

      await bus.publish('inventory.updated', {
        orderId, deductions,
        stock: { ...this._stock },
        service: this.name
      });
    });
  }

  getStock() { return { ...this._stock }; }
}

// ── Service: Loyalty Service ─────────────────────────────────
// Awards points and tracks customer rewards
class LoyaltyService {
  constructor(bus) {
    this.name = 'LoyaltyService';
    this._accounts = {};

    bus.subscribe('order.placed', async ({ orderId, customerName, total }) => {
      if (!this._accounts[customerName]) {
        this._accounts[customerName] = { points: 0, tier: 'Newcomer' };
      }

      const earned = Math.floor(total * 10);
      this._accounts[customerName].points += earned;

      const pts = this._accounts[customerName].points;
      this._accounts[customerName].tier =
        pts >= 500 ? 'Gold' : pts >= 150 ? 'Silver' : 'Newcomer';

      await bus.publish('loyalty.updated', {
        orderId, customerName,
        pointsEarned: earned,
        totalPoints: this._accounts[customerName].points,
        tier: this._accounts[customerName].tier,
        service: this.name
      });
    });
  }

  getAccount(name) { return this._accounts[name] || null; }
}

// ── Service: Notification Service ───────────────────────────
// Listens for events and triggers customer notifications
class NotificationService {
  constructor(bus) {
    this.name = 'NotificationService';
    this._sent = [];

    bus.subscribe('order.placed', async ({ orderId, customerName }) => {
      const msg = `📨 Order ${orderId} confirmed for ${customerName}`;
      this._sent.push(msg);
      await bus.publish('notification.sent', {
        orderId, message: msg, channel: 'email', service: this.name
      });
    });

    bus.subscribe('loyalty.updated', async ({ customerName, pointsEarned, totalPoints, tier }) => {
      const msg = `⭐ ${customerName} earned ${pointsEarned} pts → ${totalPoints} total (${tier})`;
      this._sent.push(msg);
      await bus.publish('notification.sent', {
        message: msg, channel: 'push', service: this.name
      });
    });
  }
}

// ── Instantiate Services ─────────────────────────────────────
const orderService     = new OrderService(bus);
const inventoryService = new InventoryService(bus);
const loyaltyService   = new LoyaltyService(bus);
const notifService     = new NotificationService(bus);

// ── Helpers ──────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const SERVICE_COLORS = {
  OrderService:        { bg: '#c8894a', text: '#2c1a0e' },
  InventoryService:    { bg: '#9da882', text: '#2c1a0e' },
  LoyaltyService:      { bg: '#7a4a2c', text: '#e8ddd0' },
  NotificationService: { bg: '#2c1a0e', text: '#e8ddd0' },
};

const EVENT_ICONS = {
  'order.placed':       '🛒',
  'inventory.updated':  '📦',
  'loyalty.updated':    '⭐',
  'notification.sent':  '📨',
};

// ── UI: notify bus log ────────────────────────────────────────
function notifyBusLog(entry) {
  const logEl = document.getElementById('soa-bus-log');
  if (!logEl) return;

  const item = document.createElement('div');
  item.className = 'soa-log-item';

  const svc = entry.payload.service || '—';
  const col = SERVICE_COLORS[svc] || { bg: '#8a7060', text: '#fff' };
  const icon = EVENT_ICONS[entry.event] || '📡';
  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  item.innerHTML = `
    <span class="soa-log-time">${time}</span>
    <span class="soa-log-event">${icon} <strong>${entry.event}</strong></span>
    <span class="soa-log-svc" style="background:${col.bg};color:${col.text}">${svc}</span>
  `;

  logEl.prepend(item);
  // cap log at 20 items
  while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
}

// ── UI: update service panels ─────────────────────────────────
function updateServicePanels(customerName) {
  // Loyalty
  const acc = loyaltyService.getAccount(customerName);
  if (acc) {
    const el = document.getElementById('soa-loyalty-display');
    if (el) {
      el.innerHTML = `
        <div class="soa-panel-stat">${acc.points}<span>pts</span></div>
        <div class="soa-panel-tier tier-${acc.tier.toLowerCase()}">${acc.tier}</div>
      `;
    }
  }

  // Inventory
  const stock = inventoryService.getStock();
  const invEl = document.getElementById('soa-inventory-display');
  if (invEl) {
    invEl.innerHTML = Object.entries(stock).map(([k, v]) => `
      <div class="soa-inv-row">
        <span>${k}</span>
        <span class="soa-inv-val ${v < 10 ? 'low' : ''}">${v}</span>
      </div>
    `).join('');
  }
}

// ── UI: place a demo order ────────────────────────────────────
async function placeDemoOrder() {
  const btn = document.getElementById('soa-order-btn');
  const nameInput = document.getElementById('soa-customer-name');
  const customerName = nameInput.value.trim() || 'Guest';

  btn.disabled = true;
  btn.textContent = 'Processing…';

  // Clear old log
  const logEl = document.getElementById('soa-bus-log');
  if (logEl) logEl.innerHTML = '';

  // Pick random items
  const catalog = [
    { name: 'Flat White',        price: 5.00, ingredient: 'Espresso Beans',   ingredientQty: 2 },
    { name: 'Brown Sugar Latte', price: 5.75, ingredient: 'Brown Sugar Syrup', ingredientQty: 1 },
    { name: 'Oat Milk Add-on',   price: 0.75, ingredient: 'Oat Milk',          ingredientQty: 1 },
    { name: 'Matcha Latte',      price: 4.75, ingredient: 'Matcha Powder',     ingredientQty: 2 },
    { name: 'Pour Over',         price: 4.25, ingredient: 'Espresso Beans',   ingredientQty: 3 },
  ];
  const count = Math.floor(Math.random() * 2) + 1;
  const items = Array.from({ length: count }, () =>
    catalog[Math.floor(Math.random() * catalog.length)]
  );

  // Show what was ordered
  const orderPreview = document.getElementById('soa-order-preview');
  if (orderPreview) {
    const total = items.reduce((s, i) => s + i.price, 0);
    orderPreview.innerHTML = `
      <div class="soa-order-items">
        ${items.map(i => `<span class="soa-order-item">☕ ${i.name} <em>$${i.price.toFixed(2)}</em></span>`).join('')}
      </div>
      <div class="soa-order-total">Total: $${total.toFixed(2)}</div>
    `;
  }

  await orderService.placeOrder(items, customerName);

  // Wait for all async events to settle then update panels
  await delay(items.length * 400 + 1200);
  updateServicePanels(customerName);

  btn.disabled = false;
  btn.textContent = 'Place Order';
}

// ── Inject SOA Section HTML ───────────────────────────────────
function initSOASection() {
  const section = document.createElement('section');
  section.className = 'soa-section';
  section.id = 'soa';

  section.innerHTML = `
    <div class="container">
      <span class="label">Architecture Demo</span>
      <h2>Service-Oriented Architecture</h2>
      <div class="divider"></div>
      <p class="soa-intro">
        Four independent services communicate exclusively through a <strong>Service Bus</strong> — no direct calls between them.
        Place an order below and watch messages flow in real time.
      </p>

      <!-- Architecture diagram -->
      <div class="soa-diagram">
        <div class="soa-service soa-service--order">
          <div class="soa-service-icon">🛒</div>
          <div class="soa-service-name">Order Service</div>
          <div class="soa-service-desc">Validates &amp; places orders</div>
        </div>

        <div class="soa-bus-column">
          <div class="soa-bus-label">SERVICE BUS</div>
          <div class="soa-bus-track">
            <div class="soa-bus-pulse"></div>
          </div>
          <div class="soa-bus-events">
            <span>order.placed</span>
            <span>inventory.updated</span>
            <span>loyalty.updated</span>
            <span>notification.sent</span>
          </div>
        </div>

        <div class="soa-services-right">
          <div class="soa-service soa-service--inventory">
            <div class="soa-service-icon">📦</div>
            <div class="soa-service-name">Inventory Service</div>
            <div class="soa-service-desc">Tracks ingredient stock</div>
            <div class="soa-panel-data" id="soa-inventory-display">
              <div class="soa-inv-row"><span>Espresso Beans</span><span class="soa-inv-val">240</span></div>
              <div class="soa-inv-row"><span>Oat Milk</span><span class="soa-inv-val">18</span></div>
              <div class="soa-inv-row"><span>Brown Sugar Syrup</span><span class="soa-inv-val">12</span></div>
              <div class="soa-inv-row"><span>Matcha Powder</span><span class="soa-inv-val">8</span></div>
            </div>
          </div>

          <div class="soa-service soa-service--loyalty">
            <div class="soa-service-icon">⭐</div>
            <div class="soa-service-name">Loyalty Service</div>
            <div class="soa-service-desc">Awards &amp; tracks points</div>
            <div class="soa-panel-data" id="soa-loyalty-display">
              <div class="soa-panel-stat">—<span>pts</span></div>
            </div>
          </div>

          <div class="soa-service soa-service--notif">
            <div class="soa-service-icon">📨</div>
            <div class="soa-service-name">Notification Service</div>
            <div class="soa-service-desc">Sends confirmations &amp; alerts</div>
          </div>
        </div>
      </div>

      <!-- Interactive demo -->
      <div class="soa-demo">
        <div class="soa-demo-controls">
          <h4 class="soa-demo-title">Try it — place a random order</h4>
          <div class="soa-input-row">
            <input type="text" id="soa-customer-name" placeholder="Your name" value="Alex" />
            <button class="btn btn-primary" id="soa-order-btn" onclick="placeDemoOrder()">Place Order</button>
          </div>
          <div id="soa-order-preview" class="soa-order-preview"></div>
        </div>

        <div class="soa-demo-log">
          <div class="soa-log-header">
            <span class="soa-log-title">📡 Service Bus Log</span>
            <span class="soa-log-hint">Messages flow here in real time</span>
          </div>
          <div class="soa-bus-log" id="soa-bus-log">
            <div class="soa-log-empty">Place an order to see events flow →</div>
          </div>
        </div>
      </div>

    </div>
  `;

  // Insert before #customize section
  const customizeSection = document.getElementById('customize');
  if (customizeSection) {
    customizeSection.parentNode.insertBefore(section, customizeSection);
  } else {
    const signupSection = document.getElementById('signup');
    signupSection.parentNode.insertBefore(section, signupSection);
  }
}

// ── Inject SOA Styles ─────────────────────────────────────────
function injectSOAStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ── SOA Section ─────────────────────────── */
    .soa-section {
      background: var(--foam);
      padding: 6rem 5%;
    }

    .soa-intro {
      max-width: 560px;
      margin: 0 auto 3rem;
      color: var(--text-muted);
    }

    .soa-intro strong {
      color: var(--roast);
    }

    /* ── Architecture Diagram ─────────────────── */
    .soa-diagram {
      display: grid;
      grid-template-columns: 200px 1fr 1fr;
      gap: 1.5rem;
      align-items: center;
      margin-bottom: 3rem;
    }

    .soa-service {
      background: #fff;
      border-radius: 14px;
      padding: 1.25rem;
      border: 1.5px solid rgba(122, 74, 44, 0.12);
      text-align: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .soa-service:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 30px rgba(44, 26, 14, 0.1);
    }

    .soa-service--order  { border-top: 3px solid var(--caramel); }
    .soa-service--inventory { border-top: 3px solid var(--sage); }
    .soa-service--loyalty   { border-top: 3px solid var(--roast); }
    .soa-service--notif     { border-top: 3px solid var(--espresso); }

    .soa-service-icon  { font-size: 1.8rem; margin-bottom: 0.4rem; }
    .soa-service-name  {
      font-family: 'DM Sans', sans-serif;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--espresso);
      letter-spacing: 0.04em;
    }
    .soa-service-desc  {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
      line-height: 1.4;
    }

    /* ── Bus Column ──────────────────────────── */
    .soa-bus-column {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .soa-bus-label {
      font-size: 0.6rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--caramel);
      font-weight: 500;
    }

    .soa-bus-track {
      width: 100%;
      height: 6px;
      background: rgba(200, 137, 74, 0.2);
      border-radius: 3px;
      position: relative;
      overflow: hidden;
    }

    .soa-bus-pulse {
      position: absolute;
      top: 0; left: -60%;
      width: 60%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--caramel), transparent);
      animation: busPulse 2.2s ease-in-out infinite;
    }

    @keyframes busPulse {
      0%   { left: -60%; opacity: 0; }
      20%  { opacity: 1; }
      80%  { opacity: 1; }
      100% { left: 110%; opacity: 0; }
    }

    .soa-bus-events {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      align-items: center;
    }

    .soa-bus-events span {
      font-size: 0.65rem;
      font-family: 'DM Sans', monospace;
      background: rgba(200, 137, 74, 0.1);
      color: var(--roast);
      padding: 0.2rem 0.7rem;
      border-radius: 1rem;
      border: 1px solid rgba(200, 137, 74, 0.25);
      letter-spacing: 0.04em;
    }

    /* ── Right Services Column ───────────────── */
    .soa-services-right {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    /* ── Panel data (inventory / loyalty) ───── */
    .soa-panel-data {
      margin-top: 0.75rem;
      text-align: left;
    }

    .soa-inv-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: var(--text-muted);
      padding: 0.2rem 0;
      border-bottom: 1px solid rgba(122, 74, 44, 0.07);
    }

    .soa-inv-val { color: var(--espresso); font-weight: 500; }
    .soa-inv-val.low { color: #c0392b; }

    .soa-panel-stat {
      font-family: 'Playfair Display', serif;
      font-size: 1.6rem;
      color: var(--caramel);
      font-weight: 700;
      text-align: center;
    }

    .soa-panel-stat span {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-left: 0.25rem;
      font-family: 'DM Sans', sans-serif;
    }

    .soa-panel-tier {
      text-align: center;
      font-size: 0.7rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      padding: 0.2rem 0.8rem;
      border-radius: 1rem;
      margin: 0.5rem auto 0;
      width: fit-content;
    }

    .tier-newcomer { background: var(--foam); color: var(--roast); }
    .tier-silver   { background: #e0e0e0; color: #555; }
    .tier-gold     { background: #f5c842; color: #5a3a00; }

    /* ── Demo Area ───────────────────────────── */
    .soa-demo {
      display: grid;
      grid-template-columns: 1fr 1.4fr;
      gap: 2rem;
      align-items: start;
      background: var(--espresso);
      border-radius: 20px;
      padding: 2rem;
    }

    .soa-demo-title {
      font-family: 'DM Sans', sans-serif;
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--caramel);
      margin-bottom: 1rem;
    }

    .soa-input-row {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
    }

    .soa-input-row input {
      flex: 1;
      min-width: 120px;
      padding: 0.75rem 1rem;
      border-radius: 2rem;
      border: 1.5px solid rgba(200, 137, 74, 0.35);
      background: rgba(255,255,255,0.06);
      color: var(--foam);
      font-family: 'DM Sans', sans-serif;
      font-size: 0.9rem;
      outline: none;
    }

    .soa-input-row input::placeholder { color: rgba(232,221,208,0.4); }
    .soa-input-row input:focus { border-color: var(--caramel); }

    .soa-order-preview {
      margin-top: 1rem;
      font-size: 0.82rem;
    }

    .soa-order-items {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      margin-bottom: 0.5rem;
    }

    .soa-order-item {
      color: rgba(232,221,208,0.75);
    }

    .soa-order-item em {
      font-style: normal;
      color: var(--caramel);
      margin-left: 0.3rem;
    }

    .soa-order-total {
      color: var(--caramel);
      font-family: 'Playfair Display', serif;
      font-size: 1rem;
    }

    /* ── Bus Log ─────────────────────────────── */
    .soa-demo-log { }

    .soa-log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .soa-log-title {
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--caramel);
    }

    .soa-log-hint {
      font-size: 0.7rem;
      color: rgba(232,221,208,0.3);
    }

    .soa-bus-log {
      max-height: 220px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
      scrollbar-width: thin;
      scrollbar-color: var(--caramel) transparent;
    }

    .soa-log-empty {
      color: rgba(232,221,208,0.3);
      font-size: 0.82rem;
      text-align: center;
      padding: 1.5rem 0;
    }

    .soa-log-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      animation: logSlide 0.25s ease both;
      font-size: 0.78rem;
    }

    @keyframes logSlide {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .soa-log-time {
      color: rgba(232,221,208,0.3);
      font-size: 0.68rem;
      font-family: monospace;
      white-space: nowrap;
    }

    .soa-log-event {
      flex: 1;
      color: var(--foam);
    }

    .soa-log-event strong {
      color: var(--caramel);
    }

    .soa-log-svc {
      font-size: 0.65rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      padding: 0.2rem 0.65rem;
      border-radius: 1rem;
      white-space: nowrap;
    }

    /* ── Nav link ───────────────────────────── */
    .nav-link-soa a { color: var(--sage) !important; }

    /* ── Responsive ─────────────────────────── */
    @media (max-width: 900px) {
      .soa-diagram {
        grid-template-columns: 1fr;
      }
      .soa-bus-track { width: 100%; height: 6px; }
    }

    @media (max-width: 700px) {
      .soa-demo {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

// ── Add nav link ──────────────────────────────────────────────
function addSOANavLink() {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  const li = document.createElement('li');
  li.className = 'nav-link-soa';
  li.innerHTML = '<a href="#soa">SOA</a>';
  // insert before the customize link if it exists
  const customizeLink = navLinks.querySelector('.nav-link-customize');
  if (customizeLink) {
    navLinks.insertBefore(li, customizeLink);
  } else {
    navLinks.appendChild(li);
  }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  injectSOAStyles();
  addSOANavLink();
  initSOASection();
});
