import { neon } from '@neondatabase/serverless';

let _fn: ReturnType<typeof neon> | undefined;

function getInstance(): ReturnType<typeof neon> {
  if (!_fn) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurato');
    _fn = neon(process.env.DATABASE_URL);
  }
  return _fn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sql = (strings: TemplateStringsArray, ...values: any[]): Promise<Record<string, any>[]> =>
  getInstance()(strings, ...values) as unknown as Promise<Record<string, any>[]>;

export default sql;
