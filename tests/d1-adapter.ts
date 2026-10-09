import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
// SQLite-backed D1 adapter: the actual service SQL and generated migrations are exercised.
class Statement {
  db: DatabaseSync;
  sql: string;
  values: any[] = [];
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...values: any[]) {
    this.values = values;
    return this;
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.values) || null;
  }
  execute() {
    const s = this.db.prepare(this.sql);
    const results = s.columns().length ? s.all(...this.values) : [];
    const changed = s.columns().length ? 0 : s.run(...this.values).changes;
    return { success: true, results, meta: { changes: Number(changed) } };
  }
  async all() {
    return this.execute();
  }
  async run() {
    return this.execute();
  }
}
export class TestD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys=ON");
    for (const file of readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      this.sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"));
  }
  prepare(sql: string) {
    return new Statement(this.sqlite, sql);
  }
  async batch(statements: Statement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const result = statements.map((s) => s.execute());
      this.sqlite.exec("COMMIT");
      return result;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
}
