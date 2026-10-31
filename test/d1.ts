/// <reference types="node" />
// テスト用の D1：Node の SQLite（node:sqlite）に migrations を当て、API が使う形（prepare・bind・first・all・run・batch）だけをまねる。
// D1 も中身は SQLite なので、SQL の動きは同じ
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));

  const exec = (sql: string, params: SQLInputValue[]) => {
    const s = db.prepare(sql);
    // 行を返す文（SELECT・RETURNING）は all、それ以外は run で変わった行の数を取る
    if (s.columns().length) return { results: s.all(...params) as Record<string, unknown>[], changes: 0 };
    return { results: [], changes: Number(s.run(...params).changes) };
  };
  const result = (r: ReturnType<typeof exec>) => ({ results: r.results, success: true, meta: { changes: r.changes } });

  class Statement {
    constructor(readonly sql: string, readonly params: SQLInputValue[] = []) {}
    bind(...params: SQLInputValue[]) { return new Statement(this.sql, params); }
    async first() { return exec(this.sql, this.params).results[0] ?? null; }
    async all() { return result(exec(this.sql, this.params)); }
    async run() { return result(exec(this.sql, this.params)); }
  }

  const d1 = {
    prepare: (sql: string) => new Statement(sql),
    // D1 の batch は1つのトランザクション
    async batch(stmts: Statement[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => result(exec(s.sql, s.params)));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, db };
}
