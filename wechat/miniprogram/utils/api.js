const config = require("../config");
function request(path, method = "GET", body = {}) {
  if (config.mode === "demo")
    return require("./demo").request(path, method, body);
  if (!config.cloudEnv || !wx.cloud)
    return Promise.reject(new Error("请先配置微信云环境，或切换到演示模式"));
  return wx.cloud
    .callFunction({ name: config.functionName, data: { path, method, body } })
    .then((response) => {
      const result = response.result;
      if (!result || typeof result.status !== "number")
        throw new Error("云函数响应无效");
      if (result.status >= 400) {
        const error = new Error(result.data.error || "请求失败");
        error.status = result.status;
        throw error;
      }
      return result.data;
    })
    .catch((error) => {
      if (error.status) throw error;
      throw new Error(error.message || "网络连接失败，请重试");
    });
}
function requestId() {
  return `mini-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function error(page, err) {
  page.setData({
    error: err.message || "操作失败，请重试",
    loading: false,
    saving: false,
  });
}
function demo() {
  return config.mode === "demo";
}
module.exports = { request, requestId, error, demo };
