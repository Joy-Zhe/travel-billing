const api = require("../../utils/api");
const core = require("../../utils/format");
Page({
  data: {
    demo: api.demo(),
    loading: true,
    saving: false,
    error: "",
    tab: "expenses",
    snapshot: null,
    shownExpenses: [],
    categories: ["全部分类"].concat(core.CATEGORIES),
    categoryIndex: 0,
    memberIndex: 0,
    filterDate: "",
    memberLabels: ["全部成员"],
    inviteToken: "",
    inviteExpires: "",
    editing: false,
    currencies: Object.keys(core.CURRENCIES),
    currencyLabels: Object.entries(core.CURRENCIES).map(
      ([k, v]) => `${k} · ${v.label}`,
    ),
    currencyIndex: 0,
    form: {},
  },
  onLoad(options) {
    this.id = options.id;
  },
  onShow() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 15000);
  },
  onHide() {
    clearInterval(this.timer);
  },
  onUnload() {
    clearInterval(this.timer);
  },
  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },
  async refresh() {
    const sequence = (this.sequence = (this.sequence || 0) + 1);
    try {
      const [s, user] = await Promise.all([
        api.request("trips/" + this.id),
        api.request("me"),
      ]);
      if (sequence !== this.sequence) return;
      const money = (n) => core.money(n, s.trip.currency),
        names = Object.fromEntries(s.members.map((m) => [m.id, m.name]));
      const me = s.members.find((m) => m.id === user.userId);
      s.trip.totalText = money(s.trip.total);
      s.members = s.members.map((m) =>
        Object.assign({}, m, {
          initial: m.name.slice(0, 1),
          paidText: money(m.paid),
          owedText: money(m.owed),
          balanceText:
            (m.balance > 0 ? "+" : m.balance < 0 ? "−" : "") +
            money(Math.abs(m.balance)),
          mine: m.id === user.userId,
        }),
      );
      s.expenses = s.expenses.map((e) =>
        Object.assign({}, e, {
          amountText: money(e.amount),
          payerName: names[e.payerId],
          shares: e.shares.map((p) =>
            Object.assign({}, p, {
              name: names[p.userId],
              amountText: money(p.amount),
            }),
          ),
        }),
      );
      s.repayments = s.repayments.map((r) =>
        Object.assign({}, r, {
          amountText: money(r.amount),
          fromName: names[r.fromId],
          toName: names[r.toId],
        }),
      );
      s.transfers = s.transfers.map((t) =>
        Object.assign({}, t, {
          key: t.fromId + "-" + t.toId,
          amountText: money(t.amount),
          fromName: names[t.fromId],
          toName: names[t.toId],
        }),
      );
      this.setData({
        snapshot: s,
        loading: false,
        error: "",
        owner: s.trip.ownerId === user.userId,
        userId: user.userId,
        paidText: money(me ? me.paid : 0),
        owedText: money(me ? me.owed : 0),
        balanceText: money(Math.abs(me ? me.balance : 0)),
        balanceLabel: me && me.balance < 0 ? "我待支付" : "我待收回",
        memberLabels: ["全部成员"].concat(s.members.map((m) => m.name)),
      });
      this.filter();
    } catch (e) {
      if (sequence === this.sequence) api.error(this, e);
    }
  },
  tab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },
  pickCategory(e) {
    this.setData({ categoryIndex: Number(e.detail.value) });
    this.filter();
  },
  pickMember(e) {
    this.setData({ memberIndex: Number(e.detail.value) });
    this.filter();
  },
  pickDate(e) {
    this.setData({ filterDate: e.detail.value });
    this.filter();
  },
  clearFilters() {
    this.setData({ categoryIndex: 0, memberIndex: 0, filterDate: "" });
    this.filter();
  },
  filter() {
    const s = this.data.snapshot;
    if (!s) return;
    const m = this.data.memberIndex
      ? s.members[this.data.memberIndex - 1]
      : null;
    this.setData({
      shownExpenses: s.expenses.filter(
        (e) =>
          (!this.data.categoryIndex ||
            e.category === this.data.categories[this.data.categoryIndex]) &&
          (!this.data.filterDate || e.date === this.data.filterDate) &&
          (!m || e.payerId === m.id || e.shares.some((x) => x.userId === m.id)),
      ),
    });
  },
  toggleShares(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({
      [`shownExpenses[${index}].expanded`]:
        !this.data.shownExpenses[index].expanded,
    });
  },
  addExpense() {
    wx.navigateTo({ url: "/pages/expense/index?tripId=" + this.id });
  },
  editExpense(e) {
    wx.navigateTo({
      url: `/pages/expense/index?tripId=${this.id}&id=${e.currentTarget.dataset.id}`,
    });
  },
  addRepayment() {
    wx.navigateTo({ url: "/pages/repayment/index?tripId=" + this.id });
  },
  recordTransfer(e) {
    const t = this.data.snapshot.transfers[e.currentTarget.dataset.index];
    wx.navigateTo({
      url: `/pages/repayment/index?tripId=${this.id}&fromId=${encodeURIComponent(t.fromId)}&toId=${encodeURIComponent(t.toId)}&amount=${t.amount}`,
    });
  },
  editRepayment(e) {
    wx.navigateTo({
      url: `/pages/repayment/index?tripId=${this.id}&id=${e.currentTarget.dataset.id}`,
    });
  },
  async mutate(path, method, body, version) {
    const signature = JSON.stringify([path, method, body, version]);
    if (!this.pending || this.pending.signature !== signature)
      this.pending = { signature, id: api.requestId() };
    const r = await api.request(
      path,
      method,
      Object.assign({}, body, { version, requestId: this.pending.id }),
    );
    this.pending = null;
    return r;
  },
  async remove(e) {
    if (this.data.saving) return;
    const version = this.data.snapshot.trip.version;
    const confirm = await wx.showModal({
      title:
        e.currentTarget.dataset.kind === "expenses"
          ? "删除这笔支出？"
          : "撤销这笔还款？",
      content: "操作后会重新计算所有成员余额。",
      confirmColor: "#188675",
    });
    if (!confirm.confirm || this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      await this.mutate(
        `trips/${this.id}/${e.currentTarget.dataset.kind}/${e.currentTarget.dataset.id}`,
        "DELETE",
        {},
        version,
      );
      await this.refresh();
      this.setData({ saving: false });
      wx.showToast({ title: "已更新账本" });
    } catch (err) {
      api.error(this, err);
    }
  },
  async invite() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      const result = await this.mutate(
        `trips/${this.id}/invite`,
        "POST",
        {},
        this.data.snapshot.trip.version,
      );
      this.setData({
        inviteToken: result.token,
        inviteExpires: result.expiresAt.slice(0, 10),
        saving: false,
      });
      await this.refresh();
    } catch (e) {
      api.error(this, e);
    }
  },
  onShareAppMessage() {
    return this.data.inviteToken && this.data.owner
      ? {
          title: "和我一起加入「" + this.data.snapshot.trip.name + "」",
          path:
            "/pages/join/index?token=" +
            encodeURIComponent(this.data.inviteToken),
        }
      : { title: "同行账本 · 让旅行轻松一点", path: "/pages/trips/index" };
  },
  settings() {
    const t = this.data.snapshot.trip;
    this.editVersion = t.version;
    this.setData({
      editing: !this.data.editing,
      form: {
        name: t.name,
        destination: t.destination,
        startDate: t.startDate,
        endDate: t.endDate,
      },
      currencyIndex: this.data.currencies.indexOf(t.currency),
    });
  },
  field(e) {
    this.setData({ ["form." + e.currentTarget.dataset.field]: e.detail.value });
  },
  currency(e) {
    this.setData({ currencyIndex: Number(e.detail.value) });
  },
  async saveSettings() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      await this.mutate(
        "trips/" + this.id,
        "PATCH",
        Object.assign({}, this.data.form, {
          currency: this.data.currencies[this.data.currencyIndex],
        }),
        this.editVersion,
      );
      this.setData({ editing: false, saving: false });
      await this.refresh();
    } catch (e) {
      api.error(this, e);
    }
  },
  async archive() {
    if (this.data.saving) return;
    const t = this.data.snapshot.trip;
    const result = await wx.showModal({
      title: t.archived ? "恢复旅行？" : "归档旅行？",
      content: t.archived
        ? "恢复后可继续记账和登记还款。"
        : "归档后所有成员仍可查看，账本将变为只读。",
      confirmColor: "#188675",
    });
    if (!result.confirm || this.data.saving) return;
    this.setData({ saving: true, error: "" });
    try {
      await this.mutate(
        "trips/" + this.id,
        "PATCH",
        { archived: !t.archived },
        t.version,
      );
      this.setData({ saving: false });
      await this.refresh();
    } catch (e) {
      api.error(this, e);
    }
  },
});
