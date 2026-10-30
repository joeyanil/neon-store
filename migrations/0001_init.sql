-- Neon Store P2P: schema.
-- Money is stored as integers only:
--   usdt_micro  = USDT * 1,000,000   (6 decimals)
--   *_cents     = ETB  * 100         (2 decimals)
-- Times are unix seconds.

CREATE TABLE users (
  id           INTEGER PRIMARY KEY,                -- Telegram user id
  first_name   TEXT    NOT NULL DEFAULT '',
  username     TEXT,
  language     TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'am')),
  can_dm       INTEGER NOT NULL DEFAULT 0,         -- 1 once the user allowed the bot to message them
  blocked      INTEGER NOT NULL DEFAULT 0,         -- 1: may look around but cannot create orders
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Staff admins added inside the app. Owners are the ids in the ADMIN_IDS variable and are not stored here.
CREATE TABLE admins (
  id         INTEGER PRIMARY KEY,                  -- Telegram user id
  name       TEXT    NOT NULL DEFAULT '',
  added_by   INTEGER,
  created_at INTEGER NOT NULL
);

-- Birr accounts. The admin adds as many as needed: "customers can pay me here" (buy orders) and
-- "I can pay customers here" (sell orders) are separate switches.
CREATE TABLE birr_methods (
  code           TEXT PRIMARY KEY,
  kind           TEXT    NOT NULL CHECK (kind IN ('bank', 'mobile')),
  label_en       TEXT    NOT NULL,
  label_am       TEXT    NOT NULL DEFAULT '',      -- empty: show the English name
  account_name   TEXT    NOT NULL DEFAULT '',      -- who the customer pays (buy orders)
  account_number TEXT    NOT NULL DEFAULT '',
  note           TEXT    NOT NULL DEFAULT '',      -- optional instruction shown on the payment screen
  accept_buy     INTEGER NOT NULL DEFAULT 1,       -- customers can pay us with this
  pay_sell       INTEGER NOT NULL DEFAULT 1,       -- we can pay customers with this
  -- Trust rule: a customer must have done this much before this method is offered to them (all 0 = open to everyone).
  unlock_orders      INTEGER NOT NULL DEFAULT 0,   -- completed orders needed
  unlock_volume_micro INTEGER NOT NULL DEFAULT 0,  -- completed USDT volume needed
  unlock_need_ratio  INTEGER NOT NULL DEFAULT 0,   -- 1: completed orders must outnumber cancelled ones
  active         INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- USDT networks: where customers send USDT (sell orders) and which networks we can send on (buy orders).
CREATE TABLE usdt_networks (
  code            TEXT PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('tron', 'evm', 'bybit_uid', 'other')),  -- picks the address check
  label           TEXT    NOT NULL,
  deposit_address TEXT    NOT NULL DEFAULT '',     -- our address or UID customers send to (sell orders)
  accept_sell     INTEGER NOT NULL DEFAULT 1,      -- customers can send USDT to us here
  send_buy        INTEGER NOT NULL DEFAULT 1,      -- we can send USDT out on this network
  active          INTEGER NOT NULL DEFAULT 1,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Neon Ghost services (followers, views, likes ...). Price is ETB cents per 1,000 units.
CREATE TABLE service_items (
  code               TEXT PRIMARY KEY,
  platform           TEXT    NOT NULL CHECK (platform IN ('telegram', 'instagram', 'tiktok', 'youtube', 'other')),
  name_en            TEXT    NOT NULL,
  name_am            TEXT    NOT NULL DEFAULT '',
  price_cents_per_1000 INTEGER NOT NULL CHECK (price_cents_per_1000 > 0),
  min_qty            INTEGER NOT NULL CHECK (min_qty > 0),
  max_qty            INTEGER NOT NULL CHECK (max_qty >= min_qty),
  eta_text           TEXT    NOT NULL DEFAULT '',   -- e.g. "Starts within 24 hours"
  warranty_days      INTEGER NOT NULL DEFAULT 0,    -- 0 = no warranty
  note               TEXT    NOT NULL DEFAULT '',   -- shown to the customer before they order
  active             INTEGER NOT NULL DEFAULT 1,
  sort               INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,               -- short code shown to people, e.g. NG-7K2F9Q
  user_id          INTEGER NOT NULL REFERENCES users(id),
  side             TEXT    NOT NULL CHECK (side IN ('buy', 'sell', 'service')),   -- from the customer's point of view
  status           TEXT    NOT NULL CHECK (status IN
                     ('awaiting_payment', 'evidence_submitted', 'processing', 'completed', 'rejected', 'cancelled', 'expired')),
  usdt_micro       INTEGER CHECK (usdt_micro IS NULL OR usdt_micro > 0),      -- NULL for service orders
  rate_cents       INTEGER CHECK (rate_cents IS NULL OR rate_cents > 0),      -- ETB cents per 1 USDT, locked at creation
  etb_cents        INTEGER NOT NULL CHECK (etb_cents > 0),                    -- total in ETB: what the customer pays or receives
  method_code      TEXT    NOT NULL REFERENCES birr_methods(code),
  network_code     TEXT    REFERENCES usdt_networks(code),
  service_code     TEXT    REFERENCES service_items(code),                    -- service orders only
  quantity         INTEGER,                                                   -- service orders: how many followers, views ...
  target           TEXT,                                                      -- service orders: the link the service is delivered to
  pay_snapshot     TEXT    NOT NULL,               -- JSON copy of the details shown to the customer at creation
  usdt_address     TEXT,                           -- buy: where we send the customer's USDT
  payout_name      TEXT,                           -- sell: customer's birr account name
  payout_account   TEXT,                           -- sell: customer's birr account number
  evidence_text    TEXT,                           -- latest transaction number the customer typed
  evidence_count   INTEGER NOT NULL DEFAULT 0,
  late             INTEGER NOT NULL DEFAULT 0,     -- 1: the proof arrived after the payment window closed
  reject_reason    TEXT,                           -- not_received | amount_mismatch | unreadable | other
  alerted_at       INTEGER,                        -- when the admins were first told about the proof (NULL: retry)
  completion_ref   TEXT,                           -- transaction id or bank reference sent by the admin
  idem_key         TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);

CREATE UNIQUE INDEX orders_idem ON orders (user_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX orders_user_created ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_expires ON orders (status, expires_at);
CREATE INDEX orders_status_updated ON orders (status, updated_at DESC);
CREATE INDEX orders_side_status ON orders (side, status);

-- Everything a customer sent as proof. Photos live in the private R2 bucket; this row points at them.
CREATE TABLE order_proofs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     TEXT    NOT NULL REFERENCES orders(id),
  user_id      INTEGER NOT NULL,
  r2_key       TEXT,                               -- NULL for a text-only submission
  content_type TEXT,
  size         INTEGER NOT NULL DEFAULT 0,
  sha256       TEXT,                               -- lets us notice the same image used on two orders
  ref_text     TEXT,                               -- transaction number typed by the customer
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER                             -- set when the retention job removed the file
);
CREATE INDEX order_proofs_order ON order_proofs (order_id, id);
CREATE INDEX order_proofs_sha ON order_proofs (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX order_proofs_ref ON order_proofs (ref_text) WHERE ref_text IS NOT NULL;

-- Full history: every status change with who did it.
CREATE TABLE order_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT    NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status   TEXT    NOT NULL,
  actor       TEXT    NOT NULL,                    -- user:<id> | admin:<id> | system
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX order_events_order ON order_events (order_id, id);

-- Every copy of the alert sent to an admin, so all of them can be updated when anyone acts.
CREATE TABLE admin_notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT    NOT NULL,                     -- an order id (NG-...) or a ticket id (TK-...); no foreign key on purpose
  chat_id    INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX admin_notices_order ON admin_notices (order_id);

-- Who changed which setting, account or team member.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      INTEGER NOT NULL,
  action     TEXT    NOT NULL,
  detail     TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Terms and policies shown to customers. The owner edits these in the app.
CREATE TABLE policy_sections (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  sort     INTEGER NOT NULL DEFAULT 0,
  title_en TEXT NOT NULL,
  title_am TEXT NOT NULL DEFAULT '',
  body_en  TEXT NOT NULL,
  body_am  TEXT NOT NULL DEFAULT '',
  active   INTEGER NOT NULL DEFAULT 1
);

-- Support tickets: a thread between one customer and the team.
CREATE TABLE tickets (
  id         TEXT PRIMARY KEY,                     -- TK-XXXXXX
  user_id    INTEGER NOT NULL REFERENCES users(id),
  category   TEXT    NOT NULL CHECK (category IN ('failed_order', 'not_received', 'other', 'feedback')),
  order_id   TEXT    REFERENCES orders(id),
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tickets_user ON tickets (user_id, updated_at DESC);
CREATE INDEX tickets_status ON tickets (status, updated_at DESC);

CREATE TABLE ticket_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id    TEXT    NOT NULL REFERENCES tickets(id),
  sender       TEXT    NOT NULL CHECK (sender IN ('user', 'admin')),
  admin_id     INTEGER,
  body         TEXT    NOT NULL DEFAULT '',
  r2_key       TEXT,
  content_type TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX ticket_messages_ticket ON ticket_messages (ticket_id, id);

-- Where each person is inside a guided chat conversation (the chat mode of the bot).
CREATE TABLE chat_sessions (
  user_id    INTEGER PRIMARY KEY,
  flow       TEXT    NOT NULL,                     -- buy | sell | service | ticket | ...
  step       TEXT    NOT NULL,
  data       TEXT    NOT NULL DEFAULT '{}',        -- JSON: what has been chosen so far
  message_id INTEGER,                              -- the one message we keep editing
  updated_at INTEGER NOT NULL
);
