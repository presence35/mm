const mysql = require('mysql2/promise');

class MySQLDatabase {
  constructor(pool) {
    this.pool = pool;
  }

  async exec(sql) {
    await this.pool.query(sql);
  }

  prepare(sql) {
    const pool = this.pool;
    return {
      async get(...params) {
        const [rows] = await pool.query(sql, params);
        return rows[0] || undefined;
      },
      async all(...params) {
        const [rows] = await pool.query(sql, params);
        return rows;
      },
      async run(...params) {
        const [result] = await pool.query(sql, params);
        return {
          lastInsertRowid: result.insertId,
          changes: result.affectedRows
        };
      }
    };
  }

  async close() {
    await this.pool.end();
  }

  getPool() {
    return this.pool;
  }
}

module.exports = async function createMySQL(config) {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
  });

  return new MySQLDatabase(pool);
};
