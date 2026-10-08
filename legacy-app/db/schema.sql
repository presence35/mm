CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'mechanic',
  initials TEXT,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS customers (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   name TEXT NOT NULL,
   address TEXT,
   city TEXT,
   postal_code TEXT,
   phone TEXT,
   email TEXT,
   created_at TEXT DEFAULT (datetime('now')),
   deleted_at TEXT NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS boats (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   customer_id INTEGER NOT NULL,
   name TEXT,
   motor_type TEXT,
   model TEXT,
   licence TEXT,
   trailer_licence TEXT,
   rate_type TEXT DEFAULT 'SW',
   length_ft REAL,
   created_at TEXT DEFAULT (datetime('now')),
   deleted_at TEXT NULL DEFAULT NULL,
   FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS boat_serials (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   boat_id INTEGER NOT NULL,
   type TEXT NOT NULL,
   serial_number TEXT NOT NULL,
   notes TEXT,
   created_at TEXT DEFAULT (datetime('now')),
   FOREIGN KEY (boat_id) REFERENCES boats(id)
);

CREATE INDEX IF NOT EXISTS idx_boat_serials_boat ON boat_serials(boat_id);

CREATE TABLE IF NOT EXISTS service_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boat_id INTEGER NOT NULL,
  season_year INTEGER,
  work_order_no TEXT,
  storage_type TEXT,
  storage_location TEXT,
  storage_building TEXT,
  storage_row TEXT,
  storage_col TEXT,
  boathouse_no INTEGER,
  slip_no INTEGER,
  wrap_required INTEGER DEFAULT 0,
  unwrap_done INTEGER DEFAULT 0,
  remarks TEXT,
  other_work TEXT,
  date_in TEXT,
  date_out TEXT,
  invoice_number TEXT,
  invoice_status TEXT,
  tax_rate REAL DEFAULT 0,
  status TEXT DEFAULT 'intake',
  created_by INTEGER,
  customer_token TEXT UNIQUE,
  pickup_delivery TEXT,
  is_fake INTEGER DEFAULT 0,
  is_scanned INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (boat_id) REFERENCES boats(id),
  FOREIGN KEY (created_by) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS received_items (
  card_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  present INTEGER DEFAULT 0,
  notes TEXT,
  PRIMARY KEY (card_id, item),
  FOREIGN KEY (card_id) REFERENCES service_cards(id)
);

CREATE TABLE IF NOT EXISTS authorized_work (
  card_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  authorized INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  notes TEXT,
  completed_by INTEGER,
  completed_at TEXT,
  products_used TEXT DEFAULT '[]',
  PRIMARY KEY (card_id, service_type),
  FOREIGN KEY (card_id) REFERENCES service_cards(id)
);

CREATE TABLE IF NOT EXISTS condition_assessment (
  card_id INTEGER NOT NULL,
  area TEXT NOT NULL,
  rating INTEGER,
  notes TEXT,
  PRIMARY KEY (card_id, area),
  FOREIGN KEY (card_id) REFERENCES service_cards(id)
);

CREATE TABLE IF NOT EXISTS work_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  log_date TEXT,
  description TEXT,
  transcription TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES service_cards(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS parts_used (
  work_log_id INTEGER NOT NULL,
  part_number TEXT,
  description TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  FOREIGN KEY (work_log_id) REFERENCES work_logs(id)
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  work_log_id INTEGER,
  filename TEXT NOT NULL,
  photo_type TEXT DEFAULT 'general',
  caption TEXT,
  uploaded_by INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now')),
  gps_lat REAL,
  gps_lng REAL,
  FOREIGN KEY (card_id) REFERENCES service_cards(id),
  FOREIGN KEY (work_log_id) REFERENCES work_logs(id),
  FOREIGN KEY (uploaded_by) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS checklist_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  checklist_type TEXT NOT NULL,
  employee_id INTEGER NOT NULL,
  items_json TEXT DEFAULT '{}',
  completed_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES service_cards(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  employee_id INTEGER,
  changed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES service_cards(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS service_item_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  cleaning_cat TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  unit_price REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  part_number TEXT,
  unit TEXT,
  category TEXT,
  unit_price REAL DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  total REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (card_id) REFERENCES service_cards(id)
);

CREATE TABLE IF NOT EXISTS boat_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boat_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  assigned_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(boat_id, employee_id),
  FOREIGN KEY (boat_id) REFERENCES boats(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (assigned_by) REFERENCES employees(id)
);
