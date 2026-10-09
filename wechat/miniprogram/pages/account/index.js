const api = require("../../utils/api");
const config = require("../../config");
Page({
  data: {
    demo: api.demo(),
    loading: true,
    saving: false,
    error: "",
    user: null,
    name: "",
    code: "",
    webOrigin: config.webOrigin,
  },
  onShow() {
    this.refresh();
  },
  async refresh() {
    try {
      const user = await api.request("me");
      this.setData({ user, name: user.displayName, loading: false, error: "" });
    } catch (e) {
      api.error(this, e);
    }
  },
  name(e) {
    this.setData({ name: e.detail.value });
  },
  code(e) {
    this.setData({ code: e.detail.value.toUpperCase().replace(/\s/g, "") });
  },
  async rename() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      await api.request("account/profile", "PATCH", { name: this.data.name });
      this.setData({ saving: false });
      await this.refresh();
      wx.showToast({ title: "昵称已更新" });
    } catch (e) {
      api.error(this, e);
    }
  },
  async bind() {
    if (this.data.saving) return;
    const code = this.data.code;
    if (!/^[A-Z2-9]{10}$/.test(code)) {
      this.setData({ error: "请输入网页版生成的十位绑定码" });
      return;
    }
    const confirm = await wx.showModal({
      title: "绑定网页版账号？",
      content:
        "微信已有旅行与账单会合并到生成此码的网页版账号。绑定后不支持更换账号，请确认是你本人。",
      confirmColor: "#188675",
    });
    if (!confirm.confirm || this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      await api.request("account/bind", "POST", { code });
      this.setData({ saving: false, code: "" });
      await this.refresh();
      wx.showToast({ title: "账号已绑定" });
    } catch (e) {
      api.error(this, e);
    }
  },
  copyWeb() {
    wx.setClipboardData({ data: config.webOrigin });
  },
  async resetDemo() {
    const confirm = await wx.showModal({
      title: "重置本机演示数据？",
      content: "只会清理本机演示账本，不影响真实网页版数据。",
      confirmColor: "#188675",
    });
    if (!confirm.confirm) return;
    require("../../utils/demo").reset();
    await this.refresh();
    wx.showToast({ title: "演示已重置" });
  },
});
