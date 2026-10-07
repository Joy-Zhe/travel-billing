import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ApiError, LedgerService } from "../../../lib/service";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const url = new URL(request.url),
      path = url.pathname
        .replace(/^\/api\//, "")
        .split("/")
        .map(decodeURIComponent);
    const user = await getChatGPTUser();
    const reply = (data: unknown, status = 200) =>
      Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
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
    if (path[0] === "invites" && path.length === 2) {
      if (method === "GET") return reply(await service.inviteInfo(path[1]));
      if (method === "POST") return reply(await service.join(path[1]));
    }
    if (path[0] === "trips") {
      if (path.length === 1) {
        if (method === "GET") return reply(await service.listTrips());
        if (method === "POST")
          return reply(await service.createTrip(body), 201);
      }
      const id = path[1],
        entity = path[2],
        entityId = path[3];
      if (path.length === 2) {
        if (method === "GET") return reply(await service.snapshot(id));
        if (method === "PATCH")
          return reply(await service.updateTrip(id, body));
      }
      if (entity === "settlement" && path.length === 3 && method === "GET") {
        const s = await service.snapshot(id);
        return reply({
          members: s.members,
          transfers: s.transfers,
          repayments: s.repayments,
          version: s.trip.version,
        });
      }
      if (entity === "invite" && path.length === 3 && method === "POST")
        return reply(await service.resetInvite(id, body));
      if (entity === "expenses" || entity === "repayments") {
        if (
          (method === "POST" && path.length === 3) ||
          (method === "PATCH" && path.length === 4)
        )
          return reply(
            entity === "expenses"
              ? await service.saveExpense(id, body, entityId)
              : await service.saveRepayment(id, body, entityId),
          );
        if (method === "DELETE" && path.length === 4)
          return reply(await service.remove(id, body, entity, entityId));
      }
    }
    throw new ApiError(404, "接口不存在");
  } catch (error) {
    const known = error instanceof ApiError;
    if (!known) console.error("Ledger request failed", error);
    return Response.json(
      { error: known ? error.message : "服务暂时不可用，请稍后重试" },
      {
        status: known ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
