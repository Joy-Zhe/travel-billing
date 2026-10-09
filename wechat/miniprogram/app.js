const config = require("./config");
App({
  globalData: { mode: config.mode, user: null },
  onLaunch() {
    if (config.mode === "cloud" && config.cloudEnv && wx.cloud)
      wx.cloud.init({ env: config.cloudEnv });
  },
});
