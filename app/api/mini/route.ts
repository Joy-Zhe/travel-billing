import { env } from "cloudflare:workers";
import { handleMiniRequest } from "../../../lib/mini-gateway";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleMiniRequest(request, env.DB, {
    secret: env.WECHAT_GATEWAY_SECRET,
    appId: env.WECHAT_APP_ID,
  });
}
