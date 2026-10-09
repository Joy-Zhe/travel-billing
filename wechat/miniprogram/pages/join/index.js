const api = require("../../utils/api");
Page({
  data: {
    demo: api.demo(),
    loading: true,
    saving: false,
    error: "",
    invite: null,
  },
  onLoad(options) {
    this.token = options.token || "";
    this.load();
  },
  async load() {
    try {
      if (!this.token || this.token.length > 100)
        throw new Error("邀请链接无效，请向创建者索取新邀请");
      const invite = await api.request("invites/" + this.token);
      this.setData({ invite, loading: false });
    } catch (e) {
      api.error(this, e);
    }
  },
  async join() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      const r = await api.request("invites/" + this.token, "POST", {});
      this.setData({ saving: false });
      wx.redirectTo({ url: "/pages/trip/index?id=" + r.id });
    } catch (e) {
      api.error(this, e);
    }
  },
  account() {
    wx.switchTab({ url: "/pages/account/index" });
  },
});
