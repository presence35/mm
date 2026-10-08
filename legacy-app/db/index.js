const path = require('path');

module.exports = async function createDatabase() {
  if (process.env.DB_HOST) {
    console.log('  Using MySQL database:', process.env.DB_HOST);
    const createMySQL = require('./mysql');
    return createMySQL({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
  } else {
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'local.db');
    console.log('  Using SQLite database:', dbPath);
    const createSQLite = require('./sqlite');
    return createSQLite(dbPath);
  }
};
