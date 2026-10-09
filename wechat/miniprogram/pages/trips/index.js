const api = require("../../utils/api");
const core = require("../../utils/format");
Page({
  data: {
    demo: api.demo(),
    loading: true,
    saving: false,
    error: "",
    archived: false,
    trips: [],
    shown: [],
    creating: false,
    currencies: Object.keys(core.CURRENCIES),
    currencyLabels: Object.entries(core.CURRENCIES).map(
      ([k, v]) => `${k} · ${v.label}`,
    ),
    currencyIndex: 0,
    form: {
      name: "",
      destination: "",
      startDate: core.today(),
      endDate: core.today(),
    },
  },
  onShow() {
    this.refresh();
  },
  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },
  async refresh() {
    try {
      const trips = await api.request("trips");
      this.setData({
        trips: trips.map((t) =>
          Object.assign({}, t, { totalText: core.money(t.total, t.currency) }),
        ),
        loading: false,
        error: "",
      });
      this.filter();
    } catch (e) {
      api.error(this, e);
    }
  },
  filter() {
    this.setData({
      shown: this.data.trips.filter((t) => t.archived === this.data.archived),
    });
  },
  tab(e) {
    this.setData({
      archived:
        e.currentTarget.dataset.archived === true ||
        e.currentTarget.dataset.archived === "true",
    });
    this.filter();
  },
  open(e) {
    wx.navigateTo({
      url:
        "/pages/trip/index?id=" +
        encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
  create() {
    this.setData({ creating: !this.data.creating, error: "" });
  },
  field(e) {
    this.setData({ ["form." + e.currentTarget.dataset.field]: e.detail.value });
  },
  currency(e) {
    this.setData({ currencyIndex: Number(e.detail.value) });
  },
  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      const f = this.data.form;
      if (!f.name.trim() || !f.destination.trim())
        throw new Error("请填写旅行名称和目的地");
      if (f.endDate < f.startDate) throw new Error("结束日期不能早于开始日期");
      const r = await api.request(
        "trips",
        "POST",
        Object.assign({}, f, {
          currency: this.data.currencies[this.data.currencyIndex],
        }),
      );
      this.setData({
        saving: false,
        creating: false,
        form: {
          name: "",
          destination: "",
          startDate: core.today(),
          endDate: core.today(),
        },
      });
      wx.navigateTo({ url: "/pages/trip/index?id=" + r.id });
    } catch (e) {
      api.error(this, e);
    }
  },
});
