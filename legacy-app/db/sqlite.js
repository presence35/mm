const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class SQLiteStatement {
  constructor(stmt) {
    this.stmt = stmt;
  }

  async get(...params) {
    return this.stmt.get(...params);
  }

  async all(...params) {
    return this.stmt.all(...params);
  }

  async run(...params) {
    const info = this.stmt.run(...params);
    return {
      lastInsertRowid: info.lastInsertRowid,
      changes: info.changes
    };
  }
}

class SQLiteDatabase {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    this.db.exec(schema);
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    // Normalize SQL for SQLite
    let normalized = sql
      .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO')
      .replace(/\bREPLACE\s+INTO\b/gi, 'INSERT OR REPLACE INTO')
      .replace(/\bNOW\(\)/gi, "datetime('now')");

    const stmt = this.db.prepare(normalized);
    return new SQLiteStatement(stmt);
  }

  async close() {
    this.db.close();
  }

  getPool() {
    // For export endpoint compatibility
    return {
      query: async (sql, params) => {
        let normalized = sql
          .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO')
          .replace(/\bREPLACE\s+INTO\b/gi, 'INSERT OR REPLACE INTO')
          .replace(/\bNOW\(\)/gi, "datetime('now')");

        const stmt = this.db.prepare(normalized);
        const rows = params ? stmt.all(...params) : stmt.all();
        return [rows];
      }
    };
  }
}

module.exports = async function createSQLite(dbPath) {
  const resolvedPath = dbPath || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'local.db');
  return new SQLiteDatabase(resolvedPath);
};
