import { ApiError } from "./service.ts";
import type { Identity } from "./service.ts";
type Row = Record<string, any>;
export async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function signGateway(secret: string, text: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export class WechatAccounts {
  private db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async identity(
    appId: string,
    openId: string,
  ): Promise<Identity & { isBound: boolean }> {
    const id = await digest(`${appId}:${openId}`),
      userId = `wx:${id}`;
    const get = () =>
      this.db
        .prepare(
          "SELECT u.id,u.name,u.email FROM wechat_accounts w JOIN users u ON w.user_id=u.id WHERE w.id=?",
        )
        .bind(id)
        .first<Row>();
    let user = await get();
    if (!user) {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO users (id,name,email) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(
            userId,
            `微信旅友·${id.slice(0, 4)}`,
            `wx-${id.slice(0, 20)}@users.invalid`,
          ),
        this.db
          .prepare(
            "INSERT INTO wechat_accounts (id,app_id,open_id,user_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(id, appId, openId, userId, new Date().toISOString()),
      ]);
      user = await get();
    }
    if (!user) throw new ApiError(503, "微信身份暂时不可用");
    return {
      userId: user.id,
      displayName: user.name,
      email: user.email,
      isBound: !user.id.startsWith("wx:"),
      wechatAccountId: id,
    };
  }
  async createCode(userId: string) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
    await this.db.batch([
      this.db
        .prepare(
          "DELETE FROM account_link_codes WHERE user_id=? AND claimed_by IS NULL",
        )
        .bind(userId),
      this.db
        .prepare(
          "INSERT INTO account_link_codes (hash,user_id,expires_at) VALUES (?,?,?)",
        )
        .bind(await digest(code), userId, expiresAt),
    ]);
    return { code, expiresAt };
  }
  async rename(appId: string, openId: string, value: unknown) {
    const identity = await this.identity(appId, openId);
    if (identity.isBound)
      throw new ApiError(409, "已绑定网页版账号，请使用网页版昵称");
    if (typeof value !== "string" || !value.trim() || value.trim().length > 30)
      throw new ApiError(400, "昵称需为 1 至 30 个字符");
    await this.db
      .prepare("UPDATE users SET name=? WHERE id=?")
      .bind(value.trim(), identity.userId)
      .run();
    return this.identity(appId, openId);
  }
  async bindAccount(appId: string, openId: string, value: unknown) {
    if (
      typeof value !== "string" ||
      !/^[A-Z2-9]{10}$/.test(value.trim().toUpperCase())
    )
      throw new ApiError(400, "请输入十位绑定码");
    const codeHash = await digest(value.trim().toUpperCase()),
      wxId = await digest(`${appId}:${openId}`);
    const link = await this.db
      .prepare("SELECT * FROM account_link_codes WHERE hash=? AND expires_at>?")
      .bind(codeHash, new Date().toISOString())
      .first<Row>();
    if (!link) throw new ApiError(404, "绑定码已过期或已被重置");
    const current = await this.identity(appId, openId);
    if (current.userId === link.user_id) return current;
    if (link.claimed_by) throw new ApiError(409, "绑定码已被使用");
    if (current.isBound)
      throw new ApiError(409, "微信账号已绑定其他网页版账号，不支持更换绑定");
    const from = current.userId,
      to = link.user_id,
      operation = crypto.randomUUID();
    const gate =
      "EXISTS (SELECT 1 FROM account_link_codes WHERE hash=? AND claimed_by=?)";
    const stmt = (sql: string, ...args: any[]) =>
      this.db.prepare(sql).bind(...args, codeHash, operation);
    // All affected trips, payments, shares and membership rows move together.
    // The one-use claim and account CAS prevent concurrent binding to different users.
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE account_link_codes SET claimed_by=? WHERE hash=? AND claimed_by IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM wechat_accounts WHERE id=? AND user_id=?)",
        )
        .bind(operation, codeHash, new Date().toISOString(), wxId, from),
      stmt(
        `UPDATE trips SET version=version+1,last_mutation=? WHERE id IN (SELECT trip_id FROM members WHERE user_id=?) AND ${gate}`,
        operation,
        from,
      ),
      stmt(
        `INSERT INTO members (trip_id,user_id,joined_at) SELECT trip_id,?,joined_at FROM members WHERE user_id=? AND ${gate} ON CONFLICT(trip_id,user_id) DO UPDATE SET joined_at=MIN(members.joined_at,excluded.joined_at)`,
        to,
        from,
      ),
      stmt(
        `INSERT INTO shares (expense_id,user_id,amount) SELECT expense_id,?,amount FROM shares WHERE user_id=? AND ${gate} ON CONFLICT(expense_id,user_id) DO UPDATE SET amount=shares.amount+excluded.amount`,
        to,
        from,
      ),
      stmt(`DELETE FROM shares WHERE user_id=? AND ${gate}`, from),
      stmt(
        `UPDATE expenses SET payer_id=CASE WHEN payer_id=? THEN ? ELSE payer_id END,created_by=CASE WHEN created_by=? THEN ? ELSE created_by END WHERE (payer_id=? OR created_by=?) AND ${gate}`,
        from,
        to,
        from,
        to,
        from,
        from,
      ),
      stmt(
        `UPDATE repayments SET from_id=CASE WHEN from_id=? THEN ? ELSE from_id END,to_id=CASE WHEN to_id=? THEN ? ELSE to_id END,created_by=CASE WHEN created_by=? THEN ? ELSE created_by END WHERE (from_id=? OR to_id=? OR created_by=?) AND ${gate}`,
        from,
        to,
        from,
        to,
        from,
        to,
        from,
        from,
        from,
      ),
      stmt(
        `UPDATE trips SET owner_id=? WHERE owner_id=? AND ${gate}`,
        to,
        from,
      ),
      stmt(`DELETE FROM members WHERE user_id=? AND ${gate}`, from),
      stmt(
        `UPDATE wechat_accounts SET user_id=? WHERE id=? AND user_id=? AND ${gate}`,
        to,
        wxId,
        from,
      ),
    ]);
    if (!result[0].meta.changes)
      throw new ApiError(409, "绑定状态已发生变化，请刷新后重试");
    return this.identity(appId, openId);
  }
}
