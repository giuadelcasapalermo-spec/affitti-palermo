import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | undefined;

function getInstance(): ReturnType<typeof neon> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurato');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

const sql = new Proxy(
  (() => {}) as unknown as ReturnType<typeof neon>,
  {
    apply(_t, _this, args: unknown[]) {
      return (getInstance() as unknown as (...a: unknown[]) => unknown)(...args);
    },
    get(_t, prop) {
      return (getInstance() as unknown as Record<string | symbol, unknown>)[prop];
    },
  }
);

export default sql;
