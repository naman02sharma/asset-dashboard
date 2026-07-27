// PostgreSQL connection pool — imported by every route/service that needs data.
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool, types } = pg;

// node-postgres parses DATE columns (OID 1082) into JS Date objects by
// default. Two real bugs come from that, both fixed by returning the
// raw 'YYYY-MM-DD' text Postgres already sends instead:
//
// 1. Serialization: a Date built at local midnight, then sent to the
//    frontend via res.json(), gets converted with .toISOString() —
//    which reports UTC. On any server not running in the UTC
//    timezone, that silently shifts the date by a day.
// 2. Comparison: backend code that compares a DB date against a plain
//    string (e.g. `returnedAt < holding.started_at`, where returnedAt
//    is a 'YYYY-MM-DD' string from a request body) doesn't get a
//    chronological comparison — JS coerces the Date to a string via
//    its default toString() ("Wed Jul 01 2026...") and compares THAT
//    lexicographically against "2026-07-01", which does not sort the
//    same way as the actual dates.
//
// Fixing the parser here, once, means every controller can safely
// treat a DATE column as a plain comparable/serializable string
// without each call site needing to know to guard against either bug.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // Idle client errors (e.g. dropped connections) should not crash the server.
  console.error('Unexpected error on idle PostgreSQL client', err);
});

export default pool;
