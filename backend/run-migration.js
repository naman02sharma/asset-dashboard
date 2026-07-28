import { pool } from './config/db.js';
import fs from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node run-migration.js <path-to-sql-file>');
  process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');

try {
  await pool.query(sql);
  console.log(`Migration applied successfully: ${file}`);
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
