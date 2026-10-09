const cloud = require("wx-server-sdk");
const crypto = require("node:crypto");
const https = require("node:https");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
exports.main = async (event) => {
  const { OPENID, APPID } = cloud.getWXContext();
  // Identity always comes from CloudBase. Ignore event.openId, event.appId and any client token.
  if (!OPENID || !APPID)
    return { status: 401, data: { error: "请从已关联的微信小程序发起请求" } };
  const secret = process.env.LEDGER_GATEWAY_SECRET;
  const origin = process.env.LEDGER_API_ORIGIN;
  if (!secret || !origin)
    return { status: 503, data: { error: "云函数尚未配置共享后端" } };
  let endpoint;
  try {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    )
      throw new Error();
    endpoint = new URL("/api/mini", url.origin);
  } catch {
    return { status: 503, data: { error: "共享后端地址配置无效" } };
  }
  const raw = JSON.stringify({
    appId: APPID,
    openId: OPENID,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
    path: event.path,
    method: event.method || "GET",
    body: event.body || {},
  });
  if (Buffer.byteLength(raw) > 65536)
    return { status: 413, data: { error: "请求内容过大" } };
  const signature = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex");
  try {
    return await new Promise((resolve, reject) => {
      const request = https.request(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(raw),
            "X-Mini-Signature": signature,
          },
          timeout: 15000,
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => {
            text += chunk;
            if (text.length > 4 * 1024 * 1024)
              request.destroy(new Error("response too large"));
          });
          response.on("end", () => {
            try {
              resolve({ status: response.statusCode, data: JSON.parse(text) });
            } catch {
              reject(new Error("invalid response"));
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", reject);
      request.end(raw);
    });
  } catch {
    return { status: 502, data: { error: "暂时无法连接共享账本，请稍后重试" } };
  }
};
