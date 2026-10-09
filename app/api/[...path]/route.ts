import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ApiError, LedgerService } from "../../../lib/service";
import { dispatchLedger } from "../../../lib/dispatch";
import { WechatAccounts } from "../../../lib/wechat";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const url = new URL(request.url),
      path = url.pathname
        .replace(/^\/api\//, "")
        .split("/")
        .map(decodeURIComponent);
    const user = await getChatGPTUser();
    if (path[0] === "me" && path.length === 1 && request.method === "GET")
      return reply(user);
    if (!user) throw new ApiError(401, "请先登录");
    if (!env.DB) throw new ApiError(503, "数据库暂时不可用，请稍后重试");
    const service = new LedgerService(env.DB, user);
    await service.rememberUser();
    const method = request.method;
    let body: Record<string, any> = {};
    if (method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        throw new ApiError(403, "请求来源无效");
      try {
        body = await request.json();
      } catch {
        throw new ApiError(400, "请求格式无效");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new ApiError(400, "请求格式无效");
    }
    if (path.join("/") === "account/link-code" && method === "POST")
      return reply(await new WechatAccounts(env.DB).createCode(user.userId));
    if (path.join("/") === "account/wechat" && method === "GET") {
      const result = await env.DB.prepare(
        "SELECT COUNT(*) count FROM wechat_accounts WHERE user_id=?",
      )
        .bind(user.userId)
        .first<{ count: number }>();
      return reply({
        boundCount: result?.count || 0,
        gatewayConfigured: Boolean(
          env.WECHAT_APP_ID && env.WECHAT_GATEWAY_SECRET,
        ),
      });
    }
    const result = await dispatchLedger(service, method, path, body);
    return reply(result.data, result.status);
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error("Ledger request failed", error);
    return reply(
      { error: known ? error.message : "服务暂时不可用，请稍后重试" },
      known ? error.status : 500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
