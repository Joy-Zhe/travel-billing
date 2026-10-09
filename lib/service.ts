import {
  CURRENCIES,
  CATEGORIES,
  MAX_AMOUNT,
  calculate,
  splitEqually,
} from "./core.ts";
import type { Currency, Expense, Repayment, Trip, Snapshot } from "./core.ts";
export type Identity = {
  userId: string;
  displayName: string;
  email: string;
  wechatAccountId?: string;
};
type Row = Record<string, any>;
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function check(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new ApiError(status, message);
}
function text(value: unknown, max = 100) {
  check(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    "请填写有效的文本",
  );
  return value.trim();
}
function date(value: unknown) {
  check(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(new Date(value).getTime()) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "日期无效",
  );
  return value;
}
function amount(value: unknown) {
  check(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= MAX_AMOUNT,
    "金额无效",
  );
  return value;
}
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function tripRow(r: Row): Trip {
  return {
    id: r.id,
    name: r.name,
    destination: r.destination,
    startDate: r.start_date,
    endDate: r.end_date,
    currency: r.currency,
    ownerId: r.owner_id,
    archived: Boolean(r.archived),
    currencyLocked: Boolean(r.currency_locked),
    version: r.version,
    total: r.total || 0,
    memberCount: r.member_count || 0,
  };
}
export class LedgerService {
  private db: D1Database;
  private user: Identity;
  constructor(db: D1Database, user: Identity) {
    this.db = db;
    this.user = user;
  }
  private stmt(sql: string, ...values: any[]) {
    return this.db.prepare(sql).bind(...values);
  }
  private async all(sql: string, ...values: any[]): Promise<Row[]> {
    return (await this.stmt(sql, ...values).all<Row>()).results;
  }
  async rememberUser() {
    await this.stmt(
      "INSERT INTO users (id,name,email) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
      this.user.userId,
      this.user.displayName,
      this.user.email,
    ).run();
  }
  private async trip(id: string, writable = false, owner = false) {
    const trip = await this.stmt(
      "SELECT t.* FROM trips t JOIN members m ON m.trip_id=t.id WHERE t.id=? AND m.user_id=?",
      id,
      this.user.userId,
    ).first<Row>();
    check(trip, "你没有权限访问这个旅行", 403);
    if (writable) check(!trip.archived, "旅行已归档，请先恢复", 409);
    if (owner)
      check(
        trip.owner_id === this.user.userId,
        "仅旅行创建者可以执行此操作",
        403,
      );
    return trip;
  }
  async listTrips() {
    return (
      await this.all(
        "SELECT t.*, (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE trip_id=t.id) total, (SELECT COUNT(*) FROM members WHERE trip_id=t.id) member_count FROM trips t JOIN members m ON t.id=m.trip_id WHERE m.user_id=? ORDER BY t.created_at DESC",
        this.user.userId,
      )
    ).map(tripRow);
  }
  private tripFields(b: Row) {
    const currency = b.currency;
    check(
      Object.prototype.hasOwnProperty.call(CURRENCIES, currency),
      "币种无效",
    );
    const startDate = date(b.startDate),
      endDate = date(b.endDate);
    check(endDate >= startDate, "结束日期不能早于开始日期");
    return {
      name: text(b.name, 60),
      destination: text(b.destination, 60),
      startDate,
      endDate,
      currency: currency as Currency,
    };
  }
  async createTrip(b: Row) {
    const f = this.tripFields(b);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    const accountGate = this.user.wechatAccountId
      ? "WHERE EXISTS (SELECT 1 FROM wechat_accounts WHERE id=? AND user_id=?)"
      : "";
    const accountArgs = this.user.wechatAccountId
      ? [this.user.wechatAccountId, this.user.userId]
      : [];
    const result = await this.db.batch([
      this.stmt(
        `INSERT INTO trips (id,name,destination,start_date,end_date,currency,owner_id,created_at) SELECT ?,?,?,?,?,?,?,? ${accountGate}`,
        id,
        f.name,
        f.destination,
        f.startDate,
        f.endDate,
        f.currency,
        this.user.userId,
        now,
        ...accountArgs,
      ),
      this.stmt(
        "INSERT INTO members (trip_id,user_id,joined_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM trips WHERE id=?)",
        id,
        this.user.userId,
        now,
        id,
      ),
    ]);
    check(result[0].meta.changes, "账号绑定状态已更新，请刷新后重试", 409);
    return { id };
  }
  async snapshot(id: string): Promise<Snapshot> {
    await this.trip(id);
    const result = await this.db.batch<Row>([
      this.stmt("SELECT * FROM trips WHERE id=?", id),
      this.stmt(
        "SELECT u.id,u.name FROM members m JOIN users u ON m.user_id=u.id WHERE m.trip_id=? ORDER BY m.joined_at,u.id",
        id,
      ),
      this.stmt(
        "SELECT * FROM expenses WHERE trip_id=? ORDER BY date DESC,created_at DESC",
        id,
      ),
      this.stmt(
        "SELECT s.* FROM shares s JOIN expenses e ON s.expense_id=e.id WHERE e.trip_id=?",
        id,
      ),
      this.stmt(
        "SELECT * FROM repayments WHERE trip_id=? ORDER BY date DESC,created_at DESC",
        id,
      ),
    ]);
    const [trips, info, es, ss, rs] = result.map((r) => r.results);
    const expenses: Expense[] = es.map((e) => ({
      id: e.id,
      title: e.title,
      amount: e.amount,
      date: e.date,
      category: e.category,
      payerId: e.payer_id,
      createdBy: e.created_by,
      shares: ss
        .filter((s) => s.expense_id === e.id)
        .map((s) => ({ userId: s.user_id, amount: s.amount })),
    }));
    const repayments: Repayment[] = rs.map((r) => ({
      id: r.id,
      fromId: r.from_id,
      toId: r.to_id,
      amount: r.amount,
      date: r.date,
      createdBy: r.created_by,
    }));
    const calculated = calculate(
      info.map((m) => ({ id: m.id, name: m.name })),
      expenses,
      repayments,
    );
    return {
      trip: {
        ...tripRow(trips[0]),
        total: expenses.reduce((s, e) => s + e.amount, 0),
        memberCount: info.length,
      },
      ...calculated,
      expenses,
      repayments,
    };
  }
  private async mutate(
    id: string,
    b: Row,
    fingerprint: string,
    build: (op: string) => D1PreparedStatement[],
    result: Row,
    extra = "",
    allowArchived = false,
    observedVersion?: number,
  ) {
    check(Number.isInteger(b.version) && b.version >= 0, "缺少账本版本");
    const requestId = text(b.requestId, 100);
    const existing = await this.stmt(
      "SELECT * FROM operations WHERE trip_id=? AND request_id=?",
      id,
      requestId,
    ).first<Row>();
    if (existing) {
      check(
        existing.fingerprint === fingerprint,
        "请求标识已用于其他操作",
        409,
      );
      return JSON.parse(existing.result);
    }
    if (observedVersion !== undefined && b.version !== observedVersion)
      throw new ApiError(409, "账本已被其他成员更新，请刷新后重试");
    const op = crypto.randomUUID();
    // The unique mutation token gates every statement in this atomic batch, including when CAS fails.
    const response = await this.db.batch([
      this.stmt(
        `UPDATE trips SET version=version+1,last_mutation=? ${extra} WHERE id=? AND version=? ${allowArchived ? "" : "AND archived=0"} AND EXISTS (SELECT 1 FROM members WHERE trip_id=? AND user_id=?)`,
        op,
        id,
        b.version,
        id,
        this.user.userId,
      ),
      ...build(op),
      this.stmt(
        "INSERT INTO operations (id,trip_id,request_id,fingerprint,result) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM trips WHERE id=? AND last_mutation=?)",
        op,
        id,
        requestId,
        fingerprint,
        JSON.stringify(result),
        id,
        op,
      ),
    ]);
    if (!response[0].meta.changes) {
      const retry = await this.stmt(
        "SELECT * FROM operations WHERE trip_id=? AND request_id=?",
        id,
        requestId,
      ).first<Row>();
      if (retry && retry.fingerprint === fingerprint)
        return JSON.parse(retry.result);
      throw new ApiError(409, "账本已被其他成员更新，请刷新后重试");
    }
    return result;
  }
  async updateTrip(id: string, b: Row) {
    const t = await this.trip(id, false, true);
    if (typeof b.archived === "boolean")
      return this.mutate(
        id,
        b,
        JSON.stringify(["archive", b.archived]),
        (op) => [
          this.stmt(
            "UPDATE trips SET archived=? WHERE id=? AND last_mutation=?",
            Number(b.archived),
            id,
            op,
          ),
        ],
        { ok: true },
        "",
        true,
        t.version,
      );
    check(!t.archived, "旅行已归档，请先恢复", 409);
    const f = this.tripFields(b);
    check(
      !t.currency_locked || f.currency === t.currency,
      "录入支出后不能修改币种",
    );
    return this.mutate(
      id,
      b,
      JSON.stringify(["trip", f]),
      (op) => [
        this.stmt(
          "UPDATE trips SET name=?,destination=?,start_date=?,end_date=?,currency=? WHERE id=? AND last_mutation=?",
          f.name,
          f.destination,
          f.startDate,
          f.endDate,
          f.currency,
          id,
          op,
        ),
      ],
      { ok: true },
      "",
      false,
      t.version,
    );
  }
  async resetInvite(id: string, b: Row) {
    const t = await this.trip(id, true, true);
    const token = crypto.randomUUID() + crypto.randomUUID(),
      tokenHash = await hash(token),
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    return this.mutate(
      id,
      b,
      "invite",
      (op) => [
        this.stmt(
          "INSERT INTO invites (trip_id,token_hash,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM trips WHERE id=? AND last_mutation=?) ON CONFLICT(trip_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at",
          id,
          tokenHash,
          expiresAt,
          id,
          op,
        ),
      ],
      { token, expiresAt },
      "",
      false,
      t.version,
    );
  }
  async inviteInfo(token: string) {
    const row = await this.stmt(
      "SELECT t.id,t.name,t.destination,i.expires_at FROM invites i JOIN trips t ON i.trip_id=t.id WHERE i.token_hash=? AND i.expires_at>? AND t.archived=0",
      await hash(token),
      new Date().toISOString(),
    ).first<Row>();
    check(row, "邀请已过期或被重置，请向创建者索取新链接", 404);
    return row;
  }
  async join(token: string) {
    const tokenHash = await hash(token),
      now = new Date().toISOString();
    const invite = await this.inviteInfo(token);
    const accountGate = this.user.wechatAccountId
      ? "AND EXISTS (SELECT 1 FROM wechat_accounts WHERE id=? AND user_id=?)"
      : "";
    const accountArgs = this.user.wechatAccountId
      ? [this.user.wechatAccountId, this.user.userId]
      : [];
    await this.db.batch([
      this.stmt(
        `INSERT INTO members (trip_id,user_id,joined_at) SELECT trip_id,?,? FROM invites i JOIN trips t ON t.id=i.trip_id WHERE token_hash=? AND expires_at>? AND t.archived=0 ${accountGate} ON CONFLICT(trip_id,user_id) DO NOTHING`,
        this.user.userId,
        now,
        tokenHash,
        now,
        ...accountArgs,
      ),
      this.stmt(
        "UPDATE trips SET version=version+1 WHERE id=? AND EXISTS (SELECT 1 FROM members WHERE trip_id=? AND user_id=? AND joined_at=?)",
        invite.id,
        invite.id,
        this.user.userId,
        now,
      ),
    ]);
    await this.trip(invite.id);
    return { id: invite.id };
  }
  async saveExpense(id: string, b: Row, expenseId?: string) {
    const t = await this.trip(id, true);
    const title = text(b.title),
      value = amount(b.amount),
      when = date(b.date),
      payer = text(b.payerId);
    check(CATEGORIES.includes(b.category), "分类无效");
    check(
      Array.isArray(b.participants) &&
        b.participants.length > 0 &&
        b.participants.every((x: unknown) => typeof x === "string"),
      "请选择参与成员",
    );
    const allowed = new Set(
      (await this.all("SELECT user_id FROM members WHERE trip_id=?", id)).map(
        (m) => m.user_id,
      ),
    );
    check(
      allowed.has(payer) && b.participants.every((m: string) => allowed.has(m)),
      "只能选择本旅行的成员",
    );
    check(
      new Set(b.participants).size === b.participants.length,
      "参与成员不能重复",
    );
    const portions = splitEqually(value, b.participants);
    if (expenseId)
      check(
        await this.stmt(
          "SELECT id FROM expenses WHERE id=? AND trip_id=?",
          expenseId,
          id,
        ).first(),
        "支出不存在",
        404,
      );
    const eid = expenseId || crypto.randomUUID();
    const fingerprint = JSON.stringify([
      "expense",
      expenseId || "new",
      title,
      value,
      when,
      payer,
      b.category,
      portions,
    ]);
    return this.mutate(
      id,
      b,
      fingerprint,
      (op) => {
        const gate =
          "EXISTS (SELECT 1 FROM trips WHERE id=? AND last_mutation=?)";
        const statements = expenseId
          ? [
              this.stmt(
                `UPDATE expenses SET title=?,amount=?,date=?,category=?,payer_id=? WHERE id=? AND trip_id=? AND ${gate}`,
                title,
                value,
                when,
                b.category,
                payer,
                eid,
                id,
                id,
                op,
              ),
              this.stmt(
                `DELETE FROM shares WHERE expense_id=? AND ${gate}`,
                eid,
                id,
                op,
              ),
            ]
          : [
              this.stmt(
                `INSERT INTO expenses (id,trip_id,title,amount,date,category,payer_id,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate}`,
                eid,
                id,
                title,
                value,
                when,
                b.category,
                payer,
                this.user.userId,
                new Date().toISOString(),
                id,
                op,
              ),
            ];
        statements.push(
          ...portions.map((s) =>
            this.stmt(
              `INSERT INTO shares (expense_id,user_id,amount) SELECT ?,?,? WHERE ${gate}`,
              eid,
              s.userId,
              s.amount,
              id,
              op,
            ),
          ),
        );
        return statements;
      },
      { id: eid },
      ",currency_locked=1",
      false,
      t.version,
    );
  }
  async saveRepayment(id: string, b: Row, repaymentId?: string) {
    const trip = await this.trip(id, true);
    check(trip.currency_locked, "请先记录支出，再登记还款");
    const value = amount(b.amount),
      when = date(b.date),
      from = text(b.fromId),
      to = text(b.toId);
    check(from !== to, "付款人和收款人不能相同");
    const members = new Set(
      (await this.all("SELECT user_id FROM members WHERE trip_id=?", id)).map(
        (m) => m.user_id,
      ),
    );
    check(members.has(from) && members.has(to), "只能选择本旅行的成员");
    if (repaymentId)
      check(
        await this.stmt(
          "SELECT id FROM repayments WHERE id=? AND trip_id=?",
          repaymentId,
          id,
        ).first(),
        "还款不存在",
        404,
      );
    const rid = repaymentId || crypto.randomUUID();
    return this.mutate(
      id,
      b,
      JSON.stringify([
        "repayment",
        repaymentId || "new",
        value,
        when,
        from,
        to,
      ]),
      (op) => [
        repaymentId
          ? this.stmt(
              "UPDATE repayments SET from_id=?,to_id=?,amount=?,date=? WHERE id=? AND trip_id=? AND EXISTS (SELECT 1 FROM trips WHERE id=? AND last_mutation=?)",
              from,
              to,
              value,
              when,
              rid,
              id,
              id,
              op,
            )
          : this.stmt(
              "INSERT INTO repayments (id,trip_id,from_id,to_id,amount,date,created_by,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM trips WHERE id=? AND last_mutation=?)",
              rid,
              id,
              from,
              to,
              value,
              when,
              this.user.userId,
              new Date().toISOString(),
              id,
              op,
            ),
      ],
      { id: rid },
      "",
      false,
      trip.version,
    );
  }
  async remove(
    id: string,
    b: Row,
    kind: "expenses" | "repayments",
    entityId: string,
  ) {
    const t = await this.trip(id, true);
    check(
      await this.stmt(
        `SELECT id FROM ${kind} WHERE id=? AND trip_id=?`,
        entityId,
        id,
      ).first(),
      "记录不存在",
      404,
    );
    return this.mutate(
      id,
      b,
      JSON.stringify(["delete", kind, entityId]),
      (op) => {
        const gate =
          "EXISTS (SELECT 1 FROM trips WHERE id=? AND last_mutation=?)";
        return [
          ...(kind === "expenses"
            ? [
                this.stmt(
                  `DELETE FROM shares WHERE expense_id=? AND ${gate}`,
                  entityId,
                  id,
                  op,
                ),
              ]
            : []),
          this.stmt(
            `DELETE FROM ${kind} WHERE id=? AND trip_id=? AND ${gate}`,
            entityId,
            id,
            id,
            op,
          ),
        ];
      },
      { ok: true },
      "",
      false,
      t.version,
    );
  }
}
