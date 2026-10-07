import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { LedgerService, ApiError } from "../lib/service.ts";
import { splitEqually, parseAmount, calculate } from "../lib/core.ts";

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
class TestD1 {
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
const tripFields = {
  name: "青岛四日游",
  destination: "青岛",
  startDate: "2026-10-01",
  endDate: "2026-10-04",
  currency: "CNY",
};
async function fixture() {
  const db = new TestD1();
  const services = ["a", "b", "c", "outsider"].map(
    (id) =>
      new LedgerService(db as unknown as D1Database, {
        userId: id,
        displayName: id.toUpperCase(),
        email: `${id}@test.local`,
      }),
  );
  for (const s of services) await s.rememberUser();
  const [a, b, c, outsider] = services;
  const { id } = await a.createTrip(tripFields);
  const invite = await a.resetInvite(id, {
    version: 0,
    requestId: crypto.randomUUID(),
  });
  await b.join(invite.token);
  await c.join(invite.token);
  const version = (await a.snapshot(id)).trip.version;
  const expense = {
    version,
    requestId: crypto.randomUUID(),
    title: "晚餐",
    amount: 10000,
    date: "2026-10-02",
    category: "餐饮",
    payerId: "a",
    participants: ["c", "b", "a"],
  };
  return { db, a, b, c, outsider, id, expense, invite };
}
async function revision(s: LedgerService, id: string) {
  return {
    version: (await s.snapshot(id)).trip.version,
    requestId: crypto.randomUUID(),
  };
}
function errorStatus(status: number) {
  return (e: unknown) => e instanceof ApiError && e.status === status;
}

test("100 yuan divided three ways conserves cents with stable remainder allocation", () => {
  assert.deepEqual(splitEqually(10000, ["c", "a", "b"]), [
    { userId: "a", amount: 3334 },
    { userId: "b", amount: 3333 },
    { userId: "c", amount: 3333 },
  ]);
  assert.deepEqual(splitEqually(1, ["a", "b"]), [
    { userId: "a", amount: 1 },
    { userId: "b", amount: 0 },
  ]);
});
test("currency input never silently rounds, accepts JPY integer only", () => {
  assert.equal(parseAmount("100.01", "CNY"), 10001);
  assert.equal(parseAmount("12", "JPY"), 12);
  for (const value of ["-1", "0", "1.001", "1e3", "NaN"])
    assert.throws(() => parseAmount(value, "CNY"));
  assert.throws(() => parseAmount("1.5", "JPY"));
});
test("two signed-in identities join, only members see a trip, repeated joins stay unique", async () => {
  const f = await fixture();
  assert.equal((await f.b.snapshot(f.id)).members.length, 3);
  await f.b.join(f.invite.token);
  assert.equal((await f.a.snapshot(f.id)).members.length, 3);
  await assert.rejects(f.outsider.snapshot(f.id), errorStatus(403));
  assert.deepEqual(await f.outsider.listTrips(), []);
  await assert.rejects(
    f.b.resetInvite(f.id, await revision(f.b, f.id)),
    errorStatus(403),
  );
});
test("expenses persist portions and any member can edit or delete", async () => {
  const f = await fixture();
  const { id: eid } = await f.a.saveExpense(f.id, f.expense);
  let s = await f.b.snapshot(f.id);
  assert.equal(s.trip.total, 10000);
  assert.equal(s.members.find((m) => m.id === "a")!.balance, 6666);
  assert.equal(
    s.members.reduce((n, m) => n + m.balance, 0),
    0,
  );
  await f.b.saveExpense(
    f.id,
    {
      ...f.expense,
      ...(await revision(f.b, f.id)),
      amount: 6000,
      participants: ["b", "c"],
    },
    eid,
  );
  s = await f.a.snapshot(f.id);
  assert.equal(s.members.find((m) => m.id === "a")!.owed, 0);
  assert.equal(s.members.find((m) => m.id === "a")!.paid, 6000);
  await f.c.remove(f.id, await revision(f.c, f.id), "expenses", eid);
  s = await f.a.snapshot(f.id);
  assert.equal(s.trip.total, 0);
  assert.equal(s.transfers.length, 0);
  assert.equal(
    f.db.sqlite.prepare("SELECT COUNT(*) n FROM shares").get()!.n,
    0,
  );
});
test("single-member and partial participation are supported", async () => {
  const f = await fixture();
  await f.a.saveExpense(f.id, { ...f.expense, participants: ["a"] });
  const s = await f.a.snapshot(f.id);
  assert.equal(s.transfers.length, 0);
  assert.equal(s.members.find((m) => m.id === "b")!.owed, 0);
});
test("duplicate and simultaneous expense submissions are idempotent", async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([
    f.a.saveExpense(f.id, f.expense),
    f.a.saveExpense(f.id, f.expense),
  ]);
  assert.equal(first.id, second.id);
  assert.equal((await f.a.snapshot(f.id)).expenses.length, 1);
  await assert.rejects(
    f.a.saveExpense(f.id, { ...f.expense, amount: 20000 }),
    errorStatus(409),
  );
});
test("stale edits cannot change any expense or share row", async () => {
  const f = await fixture();
  const r = await f.a.saveExpense(f.id, f.expense);
  const rev = await revision(f.a, f.id);
  await f.b.saveExpense(f.id, { ...f.expense, ...rev, amount: 15000 }, r.id);
  await assert.rejects(
    f.c.saveExpense(
      f.id,
      { ...f.expense, ...rev, requestId: crypto.randomUUID(), amount: 20000 },
      r.id,
    ),
    errorStatus(409),
  );
  const s = await f.a.snapshot(f.id);
  assert.equal(s.expenses[0].amount, 15000);
  assert.equal(
    s.expenses[0].shares.reduce((n, x) => n + x.amount, 0),
    15000,
  );
});
test("simultaneous different creates accept one and reject the stale request", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    f.a.saveExpense(f.id, f.expense),
    f.b.saveExpense(f.id, {
      ...f.expense,
      requestId: crypto.randomUUID(),
      title: "另一笔",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await f.a.snapshot(f.id)).expenses.length, 1);
});
test("partial repayments, editing, full settlement and reversal recalculate correctly", async () => {
  const f = await fixture();
  await f.a.saveExpense(f.id, f.expense);
  const body = {
    ...(await revision(f.b, f.id)),
    amount: 1000,
    date: "2026-10-03",
    fromId: "b",
    toId: "a",
  };
  const r = await f.b.saveRepayment(f.id, body);
  const again = await f.b.saveRepayment(f.id, body);
  assert.equal(r.id, again.id);
  let s = await f.a.snapshot(f.id);
  assert.equal(s.members.find((m) => m.id === "b")!.balance, -2333);
  await f.c.saveRepayment(
    f.id,
    { ...body, ...(await revision(f.c, f.id)), amount: 3333 },
    r.id,
  );
  s = await f.a.snapshot(f.id);
  assert.equal(s.members.find((m) => m.id === "b")!.balance, 0);
  await f.b.saveRepayment(f.id, {
    ...body,
    ...(await revision(f.b, f.id)),
    amount: 3333,
    fromId: "c",
  });
  s = await f.a.snapshot(f.id);
  assert.equal(s.transfers.length, 0);
  await f.c.remove(f.id, await revision(f.c, f.id), "repayments", r.id);
  s = await f.a.snapshot(f.id);
  assert.equal(s.members.find((m) => m.id === "b")!.balance, -3333);
  assert.equal(
    s.members.reduce((n, m) => n + m.balance, 0),
    0,
  );
});
test("archive is read only, owner can restore and currency stays locked after deletion", async () => {
  const f = await fixture();
  const e = await f.a.saveExpense(f.id, f.expense);
  await f.a.updateTrip(f.id, {
    ...(await revision(f.a, f.id)),
    archived: true,
  });
  await assert.rejects(
    f.b.saveExpense(f.id, { ...f.expense, ...(await revision(f.b, f.id)) }),
    errorStatus(409),
  );
  await assert.rejects(
    f.b.updateTrip(f.id, { ...(await revision(f.b, f.id)), archived: false }),
    errorStatus(403),
  );
  await f.a.updateTrip(f.id, {
    ...(await revision(f.a, f.id)),
    archived: false,
  });
  await f.a.remove(f.id, await revision(f.a, f.id), "expenses", e.id);
  await assert.rejects(
    f.a.updateTrip(f.id, {
      ...tripFields,
      ...(await revision(f.a, f.id)),
      currency: "USD",
    }),
    errorStatus(400),
  );
});
test("invites expire, reset invalidates old link, anonymous membership is not implicit", async () => {
  const f = await fixture();
  const newInvite = await f.a.resetInvite(f.id, await revision(f.a, f.id));
  await assert.rejects(f.outsider.join(f.invite.token), errorStatus(404));
  assert.equal(
    (await f.outsider.inviteInfo(newInvite.token)).name,
    tripFields.name,
  );
  await assert.rejects(f.outsider.snapshot(f.id), errorStatus(403));
  f.db.sqlite
    .prepare("UPDATE invites SET expires_at=? WHERE trip_id=?")
    .run("2000-01-01T00:00:00.000Z", f.id);
  await assert.rejects(f.outsider.join(newInvite.token), errorStatus(404));
});
test("validation rejects outsiders in shares, duplicates, zero amount and bad dates", async () => {
  const f = await fixture();
  for (const fields of [
    { participants: ["outsider"] },
    { participants: [] },
    { participants: ["a", "a"] },
    { payerId: "outsider" },
    { amount: 0 },
    { amount: 1.2 },
    { date: "2026-02-30" },
    { category: "bad" },
  ])
    await assert.rejects(
      f.a.saveExpense(f.id, { ...f.expense, ...fields }),
      errorStatus(400),
    );
  assert.equal((await f.a.snapshot(f.id)).expenses.length, 0);
});
test("repayment validation and cross-trip records cannot be edited", async () => {
  const f = await fixture();
  const eid = (await f.a.saveExpense(f.id, f.expense)).id;
  const other = await f.a.createTrip(tripFields);
  await assert.rejects(
    f.a.saveExpense(
      other.id,
      { ...f.expense, version: 0, participants: ["a"] },
      eid,
    ),
    errorStatus(404),
  );
  await assert.rejects(
    f.b.saveRepayment(f.id, {
      ...(await revision(f.b, f.id)),
      amount: 100,
      date: "2026-10-03",
      fromId: "b",
      toId: "b",
    }),
    errorStatus(400),
  );
});
test("transaction failure rolls back expense, shares and version", async () => {
  const f = await fixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER fail_share BEFORE INSERT ON shares BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  await assert.rejects(f.a.saveExpense(f.id, f.expense));
  const s = await f.a.snapshot(f.id);
  assert.equal(s.expenses.length, 0);
  assert.equal(s.trip.version, f.expense.version);
});
test("settlement has at most N-1 transfers and all balances sum to zero across many ledgers", () => {
  for (let k = 1; k <= 40; k++) {
    const ids = ["a", "b", "c", "d", "e"];
    const expenses = Array.from({ length: k }, (_, i) => ({
      id: String(i),
      title: "",
      date: "",
      category: "",
      createdBy: ids[0],
      payerId: ids[i % 5],
      amount: 101 + i * 19,
      shares: splitEqually(101 + i * 19, ids.slice(i % 3)),
    }));
    const { members, transfers } = calculate(
      ids.map((id) => ({ id, name: id })),
      expenses,
      [],
    );
    assert.equal(
      members.reduce((s, m) => s + m.balance, 0),
      0,
    );
    assert.ok(transfers.length <= ids.length - 1);
    const result = calculate(
      ids.map((id) => ({ id, name: id })),
      expenses,
      transfers.map((t, i) => ({
        ...t,
        id: String(i),
        date: "",
        createdBy: "a",
      })),
    );
    assert.ok(result.members.every((m) => m.balance === 0));
  }
});
