declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    WECHAT_GATEWAY_SECRET?: string;
    WECHAT_APP_ID?: string;
  }
}
