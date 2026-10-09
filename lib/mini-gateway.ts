import { ApiError, LedgerService } from "./service.ts";
import { dispatchLedger } from "./dispatch.ts";
import { WechatAccounts, signGateway } from "./wechat.ts";
type Config = { secret?: string; appId?: string };
export async function handleMiniRequest(
  request: Request,
  db: D1Database | undefined,
  config: Config,
) {
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (!config.secret || config.secret.length < 32 || !config.appId || !db)
      throw new ApiError(
        503,
        "微信共享服务尚未配置，请先完成小程序注册和云环境配置",
      );
    if (Number(request.headers.get("Content-Length") || 0) > 65536)
      throw new ApiError(413, "请求内容过大");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65536)
      throw new ApiError(413, "请求内容过大");
    const signature = request.headers.get("X-Mini-Signature") || "";
    if (!/^[a-f0-9]{64}$/.test(signature))
      throw new ApiError(401, "云函数身份验证失败");
    const expected = await signGateway(config.secret, raw);
    let difference = 0;
    for (let i = 0; i < expected.length; i++)
      difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    if (difference) throw new ApiError(401, "云函数身份验证失败");
    let envelope: Record<string, any>;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "请求格式无效");
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
      throw new ApiError(400, "请求格式无效");
    const {
      appId,
      openId,
      timestamp,
      nonce,
      path,
      method = "GET",
      body = {},
    } = envelope;
    if (
      appId !== config.appId ||
      typeof openId !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(openId)
    )
      throw new ApiError(401, "微信身份无效");
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(Date.now() - timestamp) > 60000
    )
      throw new ApiError(401, "请求已过期");
    if (typeof nonce !== "string" || !/^[a-f0-9-]{36}$/.test(nonce))
      throw new ApiError(400, "请求标识无效");
    if (
      typeof path !== "string" ||
      path.length > 500 ||
      !/^[A-Za-z0-9/_-]+$/.test(path) ||
      !["GET", "POST", "PATCH", "DELETE"].includes(method) ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    )
      throw new ApiError(400, "请求参数无效");
    const registered = await db.batch([
      db
        .prepare("DELETE FROM gateway_nonces WHERE expires_at<?")
        .bind(Date.now()),
      db
        .prepare(
          "INSERT INTO gateway_nonces (nonce,expires_at) VALUES (?,?) ON CONFLICT(nonce) DO NOTHING",
        )
        .bind(nonce, Date.now() + 120000),
    ]);
    if (!registered[1].meta.changes)
      throw new ApiError(401, "请求已处理，请重新发起");
    const accounts = new WechatAccounts(db),
      identity = await accounts.identity(appId, openId);
    if (path === "me" && method === "GET") return reply(identity);
    if (path === "account/bind" && method === "POST")
      return reply(await accounts.bindAccount(appId, openId, body.code));
    if (path === "account/profile" && method === "PATCH")
      return reply(await accounts.rename(appId, openId, body.name));
    const service = new LedgerService(db, identity);
    const result = await dispatchLedger(service, method, path.split("/"), body);
    return reply(result.data, result.status);
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error("Mini gateway failed", error);
    return reply(
      { error: known ? error.message : "微信共享服务暂时不可用" },
      known ? error.status : 500,
    );
  }
}
