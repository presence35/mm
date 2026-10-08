const fs = require('fs');
const path = require('path');

let backupRanToday = false;

module.exports = async function runBackup(db) {
  const BACKUP_DIR = path.join(__dirname, '..', 'backup');
  const dateStr = new Date().toISOString().split('T')[0];
  const backupFile = path.join(BACKUP_DIR, `${dateStr}.sql`);

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  if (fs.existsSync(backupFile)) {
    const stats = fs.statSync(backupFile);
    if (stats.size > 1024) {
      console.log(`  Daily backup already exists: ${backupFile}`);
      return;
    }
  }

  const pool = db.getPool();
  const [tables] = await pool.query(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
  );

  let dump = `-- Marina Manager backup ${new Date().toISOString()}\n\n`;

  for (const tableRow of tables) {
    const tableName = Object.values(tableRow)[0];

    const [createResult] = await pool.query(
      `SHOW CREATE TABLE \`${tableName}\``
    );
    if (createResult[0]) {
      const createSql = createResult[0]['Create Table'] || Object.values(createResult[0])[1];
      dump += createSql + ';\n\n';
    }

    const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);
    dump += `INSERT INTO \`${tableName}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES\n`;
    const values = rows.map(row => {
      const vals = columns.map(col => {
        if (row[col] === null) return 'NULL';
        if (typeof row[col] === 'number') return String(row[col]);
        if (row[col] instanceof Date) return `'${row[col].toISOString().slice(0, 19).replace('T', ' ')}'`;
        return `'${String(row[col]).replace(/'/g, "''")}'`;
      });
      return `  (${vals.join(', ')})`;
    });
    dump += values.join(',\n') + ';\n\n';
  }

  fs.writeFileSync(backupFile, dump);
  backupRanToday = true;
  console.log(`  Daily backup created: ${backupFile}`);
};

module.exports.getBackupRanToday = () => backupRanToday;
