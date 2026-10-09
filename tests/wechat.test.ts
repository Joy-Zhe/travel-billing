import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import * as cryptoNode from "node:crypto";
import { TestD1 } from "./d1-adapter.ts";
import { LedgerService, ApiError } from "../lib/service.ts";
import { WechatAccounts, signGateway } from "../lib/wechat.ts";
import { handleMiniRequest } from "../lib/mini-gateway.ts";
import { splitEqually, calculate, parseAmount } from "../lib/core.ts";
const appId = "wx-test-appid",
  openId = "test-openid-alice";
// Deliberately non-production fixture; no real gateway credential is stored in the repository.
const config = { appId, secret: "test-fixture-only-not-a-production-secret" };
const tripFields = {
  name: "两端共用账本",
  destination: "青岛",
  startDate: "2026-10-09",
  endDate: "2026-10-12",
  currency: "CNY",
};
test("signed WeChat join works and retired identities cannot create or rejoin after binding", async () => {
  const db = makeDb(),
    s = await web(db),
    accounts = new WechatAccounts(d1(db));
  const trip = await s.createTrip(tripFields),
    invite = await s.resetInvite(trip.id, {
      version: 0,
      requestId: crypto.randomUUID(),
    });
  const stale = new LedgerService(
    d1(db),
    await accounts.identity(appId, openId),
  );
  assert.equal(
    (await gateway(db, { path: "invites/" + invite.token, method: "POST" }))
      .status,
    200,
  );
  const code = await accounts.createCode("web-alice");
  await accounts.bindAccount(appId, openId, code.code);
  await assert.rejects(
    stale.createTrip(tripFields),
    (e) => e instanceof ApiError && e.status === 409,
  );
  await assert.rejects(
    stale.join(invite.token),
    (e) => e instanceof ApiError && e.status === 403,
  );
  assert.equal((await s.snapshot(trip.id)).members.length, 1);
  assert.equal((await s.listTrips()).length, 1);
});
test("mini record controllers load shared portions, save expenses and validate repayment members", async () => {
  const require = createRequire(import.meta.url),
    storage = new Map();
  let navigated = 0;
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: any) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    showToast() {},
    navigateBack() {
      navigated++;
    },
    switchTab() {},
  };
  try {
    const factory = require("../wechat/miniprogram/utils/record-page.js"),
      demo = require("../wechat/miniprogram/utils/demo.js");
    demo.reset();
    const controller = (kind: string) => {
      const c = factory(kind);
      c.data = JSON.parse(JSON.stringify(c.data));
      c.setData = (value: any) => Object.assign(c.data, value);
      c.options = { tripId: "demo-trip" };
      return c;
    };
    const expense = controller("expenses");
    await expense.load(false);
    expense.field({
      currentTarget: { dataset: { field: "title" } },
      detail: { value: "页面控制器记账" },
    });
    expense.field({
      currentTarget: { dataset: { field: "amount" } },
      detail: { value: "100" },
    });
    assert.equal(expense.data.preview.length, 3);
    await expense.save();
    assert.equal(navigated, 1);
    let snapshot = await demo.request("trips/demo-trip");
    assert.ok(snapshot.expenses.some((e: any) => e.title === "页面控制器记账"));
    const repayment = controller("repayments");
    await repayment.load(false);
    repayment.data.amount = "10";
    repayment.data.fromIndex = 0;
    repayment.data.toIndex = 0;
    await repayment.save();
    assert.match(repayment.data.error, /不能相同/);
    assert.equal(navigated, 1);
    repayment.data.toIndex = 1;
    await repayment.save();
    assert.equal(navigated, 2);
    snapshot = await demo.request("trips/demo-trip");
    assert.equal(snapshot.repayments.length, 1);
  } finally {
    delete (globalThis as any).wx;
  }
});
function makeDb() {
  return new TestD1();
}
function d1(db: TestD1) {
  return db as unknown as D1Database;
}
async function web(db: TestD1, id = "web-alice") {
  const s = new LedgerService(d1(db), {
    userId: id,
    displayName: id,
    email: `${id}@test.invalid`,
  });
  await s.rememberUser();
  return s;
}
async function revision(s: LedgerService, id: string) {
  return {
    version: (await s.snapshot(id)).trip.version,
    requestId: crypto.randomUUID(),
  };
}
async function gateway(
  db: TestD1,
  fields: Record<string, any> = {},
  options: { signature?: string; raw?: string; nonce?: string } = {},
) {
  const raw =
    options.raw ||
    JSON.stringify({
      appId,
      openId,
      timestamp: Date.now(),
      nonce: options.nonce || crypto.randomUUID(),
      path: "me",
      ...fields,
    });
  return handleMiniRequest(
    new Request("https://ledger.test/api/mini", {
      method: "POST",
      headers: {
        "X-Mini-Signature":
          options.signature || (await signGateway(config.secret, raw)),
      },
      body: raw,
    }),
    d1(db),
    config,
  );
}
test("gateway fails closed when not configured and rejects unsigned, spoofed and expired identities", async () => {
  const db = makeDb();
  assert.equal(
    (
      await handleMiniRequest(
        new Request("https://ledger.test/api/mini", {
          method: "POST",
          body: "{}",
        }),
        d1(db),
        {},
      )
    ).status,
    503,
  );
  assert.equal(
    (await gateway(db, {}, { signature: "0".repeat(64) })).status,
    401,
  );
  assert.equal((await gateway(db, { appId: "wrong-app" })).status, 401);
  assert.equal(
    (await gateway(db, { timestamp: Date.now() - 61000 })).status,
    401,
  );
  assert.equal((await gateway(db, {}, { raw: "null" })).status, 400);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()!.n, 0);
});
test("gateway consumes nonces once and keeps distinct WeChat identities private", async () => {
  const db = makeDb(),
    nonce = crypto.randomUUID();
  assert.equal((await gateway(db, {}, { nonce })).status, 200);
  assert.equal((await gateway(db, {}, { nonce })).status, 401);
  const created = await gateway(db, {
    path: "trips",
    method: "POST",
    body: tripFields,
  });
  assert.equal(created.status, 201);
  const trip = (await created.json()) as { id: string };
  assert.equal(
    (
      await gateway(db, {
        path: "trips/" + trip.id,
        openId: "test-openid-outsider",
      })
    ).status,
    403,
  );
  assert.equal(
    (await gateway(db, { path: "account/link-code", method: "POST" })).status,
    404,
  );
});
test("WeChat account binding exposes the same existing web trip and identity", async () => {
  const db = makeDb(),
    s = await web(db),
    accounts = new WechatAccounts(d1(db));
  const trip = await s.createTrip(tripFields),
    before = await accounts.identity(appId, openId);
  assert.equal(before.isBound, false);
  const code = await accounts.createCode("web-alice");
  const response = await gateway(db, {
    path: "account/bind",
    method: "POST",
    body: { code: code.code },
  });
  assert.equal(response.status, 200);
  const identity = (await response.json()) as {
    userId: string;
    isBound: boolean;
  };
  assert.equal(identity.userId, "web-alice");
  assert.equal(identity.isBound, true);
  const snapshot = await gateway(db, { path: "trips/" + trip.id });
  assert.equal(snapshot.status, 200);
  assert.equal(((await snapshot.json()) as any).members.length, 1);
  assert.equal(
    (await accounts.bindAccount(appId, openId, code.code)).userId,
    "web-alice",
  );
});
test("binding merges overlapping members, exact shares, payments, owners and increments trip version", async () => {
  const db = makeDb(),
    s = await web(db),
    accounts = new WechatAccounts(d1(db));
  const wxIdentity = await accounts.identity(appId, openId),
    wxService = new LedgerService(d1(db), wxIdentity);
  const shared = await wxService.createTrip(tripFields);
  const invite = await wxService.resetInvite(shared.id, {
    version: 0,
    requestId: crypto.randomUUID(),
  });
  await s.join(invite.token);
  const friend = await web(db, "web-friend");
  await friend.join(invite.token);
  await wxService.saveExpense(shared.id, {
    ...(await revision(wxService, shared.id)),
    title: "午餐",
    date: "2026-10-09",
    amount: 10000,
    category: "餐饮",
    payerId: wxIdentity.userId,
    participants: [wxIdentity.userId, "web-alice", "web-friend"],
  });
  await s.saveRepayment(shared.id, {
    ...(await revision(s, shared.id)),
    fromId: "web-alice",
    toId: wxIdentity.userId,
    date: "2026-10-09",
    amount: 500,
  });
  const before = await s.snapshot(shared.id),
    originalTotal = before.members
      .filter((m) => m.id !== "web-friend")
      .reduce((sum, m) => sum + m.balance, 0);
  const code = await accounts.createCode("web-alice");
  await accounts.bindAccount(appId, openId, code.code);
  const after = await s.snapshot(shared.id);
  assert.equal(after.members.length, 2);
  assert.equal(after.trip.ownerId, "web-alice");
  assert.equal(after.trip.version, before.trip.version + 1);
  assert.equal(after.expenses[0].payerId, "web-alice");
  assert.equal(after.expenses[0].createdBy, "web-alice");
  assert.equal(
    after.expenses[0].shares.reduce((sum, p) => sum + p.amount, 0),
    10000,
  );
  assert.equal(
    after.members.find((m) => m.id === "web-alice")!.balance,
    originalTotal,
  );
  assert.equal(
    after.members.reduce((sum, m) => sum + m.balance, 0),
    0,
  );
  assert.equal(after.repayments[0].fromId, after.repayments[0].toId);
  assert.deepEqual(await wxService.listTrips(), []);
  assert.equal(
    db.sqlite
      .prepare("SELECT COUNT(*) n FROM shares WHERE user_id=?")
      .get(wxIdentity.userId)!.n,
    0,
  );
});
test("binding invalidates pending financial edits rather than silently overwriting merged shares", async () => {
  const db = makeDb(),
    s = await web(db),
    accounts = new WechatAccounts(d1(db)),
    identity = await accounts.identity(appId, openId);
  const wxService = new LedgerService(d1(db), identity),
    trip = await wxService.createTrip(tripFields);
  const invite = await wxService.resetInvite(trip.id, {
    version: 0,
    requestId: crypto.randomUUID(),
  });
  await s.join(invite.token);
  const revisionBefore = await revision(s, trip.id);
  const code = await accounts.createCode("web-alice");
  await accounts.bindAccount(appId, openId, code.code);
  await assert.rejects(
    s.saveExpense(trip.id, {
      ...revisionBefore,
      title: "旧草稿",
      date: "2026-10-09",
      amount: 100,
      category: "餐饮",
      payerId: "web-alice",
      participants: ["web-alice"],
    }),
    (e) => e instanceof ApiError && e.status === 409,
  );
  assert.equal((await s.snapshot(trip.id)).expenses.length, 0);
});
test("binding codes are resettable, expiring, one-use and cannot switch a bound account", async () => {
  const db = makeDb(),
    accounts = new WechatAccounts(d1(db));
  await web(db);
  await web(db, "web-bob");
  const old = await accounts.createCode("web-alice"),
    fresh = await accounts.createCode("web-alice");
  await assert.rejects(
    accounts.bindAccount(appId, openId, old.code),
    (e) => e instanceof ApiError && e.status === 404,
  );
  await accounts.bindAccount(appId, openId, fresh.code);
  await assert.rejects(
    accounts.bindAccount(appId, "test-openid-other", fresh.code),
    (e) => e instanceof ApiError && e.status === 409,
  );
  const bob = await accounts.createCode("web-bob");
  await assert.rejects(
    accounts.bindAccount(appId, openId, bob.code),
    (e) => e instanceof ApiError && e.status === 409,
  );
  db.sqlite.exec(
    "UPDATE account_link_codes SET expires_at='2000-01-01T00:00:00.000Z'",
  );
  await assert.rejects(
    accounts.bindAccount(appId, "test-openid-new", bob.code),
    (e) => e instanceof ApiError && e.status === 404,
  );
});
test("simultaneous binding claims produce exactly one winner without mixing trips", async () => {
  const db = makeDb(),
    accounts = new WechatAccounts(d1(db));
  await web(db);
  await web(db, "web-bob");
  await accounts.identity(appId, openId);
  const a = await accounts.createCode("web-alice"),
    b = await accounts.createCode("web-bob");
  const results = await Promise.allSettled([
    accounts.bindAccount(appId, openId, a.code),
    accounts.bindAccount(appId, openId, b.code),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM account_link_codes WHERE claimed_by IS NOT NULL",
      )
      .get()!.n,
    1,
  );
});
test("binding migration is atomic, including one-use claim, even on SQL failure", async () => {
  const db = makeDb(),
    accounts = new WechatAccounts(d1(db));
  await web(db);
  const identity = await accounts.identity(appId, openId),
    service = new LedgerService(d1(db), identity),
    trip = await service.createTrip(tripFields);
  const code = await accounts.createCode("web-alice");
  db.sqlite.exec(
    "CREATE TRIGGER fail_bind BEFORE UPDATE ON wechat_accounts BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
  );
  await assert.rejects(accounts.bindAccount(appId, openId, code.code));
  assert.equal(
    (await accounts.identity(appId, openId)).userId,
    identity.userId,
  );
  assert.equal((await service.snapshot(trip.id)).trip.version, 0);
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM account_link_codes WHERE claimed_by IS NOT NULL",
      )
      .get()!.n,
    0,
  );
});
test("mini and web writes are idempotent and visible in both clients after binding", async () => {
  const db = makeDb(),
    s = await web(db),
    accounts = new WechatAccounts(d1(db)),
    trip = await s.createTrip(tripFields);
  const code = await accounts.createCode("web-alice");
  await accounts.bindAccount(appId, openId, code.code);
  const body = {
    version: 0,
    requestId: crypto.randomUUID(),
    title: "微信记账",
    date: "2026-10-09",
    amount: 999,
    category: "餐饮",
    payerId: "web-alice",
    participants: ["web-alice"],
  };
  assert.equal(
    (
      await gateway(db, {
        path: `trips/${trip.id}/expenses`,
        method: "POST",
        body,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await gateway(db, {
        path: `trips/${trip.id}/expenses`,
        method: "POST",
        body,
      })
    ).status,
    200,
  );
  const snapshot = await s.snapshot(trip.id);
  assert.equal(snapshot.expenses.length, 1);
  assert.equal(snapshot.trip.total, 999);
});
test("shared core generated for mini has exactly the same monetary results as web", () => {
  const require = createRequire(import.meta.url),
    mini = require("../wechat/miniprogram/utils/core.js");
  for (const amount of [1, 10000, 33333, 10000000])
    assert.deepEqual(
      mini.splitEqually(amount, ["c", "b", "a"]),
      splitEqually(amount, ["c", "b", "a"]),
    );
  assert.equal(mini.parseAmount("12.34", "CNY"), parseAmount("12.34", "CNY"));
  const expenses = [
    {
      id: "x",
      title: "",
      date: "",
      category: "",
      payerId: "a",
      createdBy: "a",
      amount: 10000,
      shares: splitEqually(10000, ["a", "b"]),
    },
  ];
  assert.deepEqual(
    mini.calculate(
      [
        { id: "a", name: "a" },
        { id: "b", name: "b" },
      ],
      expenses,
      [],
    ),
    calculate(
      [
        { id: "a", name: "a" },
        { id: "b", name: "b" },
      ],
      expenses,
      [],
    ),
  );
});
test("demo mode supports persisted add/edit/delete and cannot bind a real account", async () => {
  const require = createRequire(import.meta.url);
  const storage = new Map();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: any) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  };
  try {
    const demo = require("../wechat/miniprogram/utils/demo.js");
    demo.reset();
    let s = await demo.request("trips/demo-trip");
    const body = {
      version: s.trip.version,
      requestId: "demo-test",
      amount: 10000,
      title: "演示午餐",
      category: "餐饮",
      date: "2026-10-09",
      payerId: "demo-a",
      participants: ["demo-a", "demo-b", "demo-c"],
    };
    const r = await demo.request("trips/demo-trip/expenses", "POST", body);
    await demo.request("trips/demo-trip/expenses", "POST", body);
    s = await demo.request("trips/demo-trip");
    assert.equal(s.expenses.filter((e: any) => e.id === r.id).length, 1);
    await demo.request("trips/demo-trip/expenses/" + r.id, "PATCH", {
      ...body,
      version: s.trip.version,
      requestId: "demo-edit",
      amount: 15000,
    });
    s = await demo.request("trips/demo-trip");
    assert.equal(s.expenses.find((e: any) => e.id === r.id).amount, 15000);
    await demo.request("trips/demo-trip/expenses/" + r.id, "DELETE", {
      version: s.trip.version,
      requestId: "demo-delete",
    });
    s = await demo.request("trips/demo-trip");
    assert.equal(s.expenses.filter((e: any) => e.id === r.id).length, 0);
    await assert.rejects(
      demo.request("account/bind", "POST", { code: "ABCD2345EF" }),
    );
  } finally {
    delete (globalThis as any).wx;
  }
});
test("CloudBase bridge ignores client-supplied identities and signs only trusted WXContext", async () => {
  const code = readFileSync(
      "wechat/cloudfunctions/travelLedger/index.js",
      "utf8",
    ),
    exported: { main?: (event: any) => Promise<any> } = {};
  let captured: any;
  const sdk = {
    init() {},
    DYNAMIC_CURRENT_ENV: "fixture",
    getWXContext: () => ({ OPENID: openId, APPID: appId }),
  };
  const https = {
    request: (_url: URL, options: any, callback: (r: EventEmitter) => void) => {
      const request: any = new EventEmitter();
      request.end = (raw: string) => {
        captured = { raw, options };
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        callback(response);
        queueMicrotask(() => {
          response.emit("data", '{"ok":true}');
          response.emit("end");
        });
      };
      request.destroy = () => {};
      return request;
    },
  };
  runInNewContext(code, {
    exports: exported,
    require: (id: string) =>
      id === "wx-server-sdk" ? sdk : id === "node:crypto" ? cryptoNode : https,
    process: {
      env: {
        LEDGER_GATEWAY_SECRET: config.secret,
        LEDGER_API_ORIGIN: "https://ledger.test",
      },
    },
    URL,
    Buffer,
    queueMicrotask,
  });
  const result = await exported.main!({
    appId: "spoof-app",
    openId: "spoof-user",
    path: "me",
  });
  assert.equal(result.status, 200);
  const envelope = JSON.parse(captured.raw);
  assert.equal(envelope.openId, openId);
  assert.equal(envelope.appId, appId);
  assert.equal(
    captured.options.headers["X-Mini-Signature"],
    await signGateway(config.secret, captured.raw),
  );
});
