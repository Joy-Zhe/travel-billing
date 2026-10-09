const api = require("./api");
const core = require("./format");
module.exports = function recordPage(kind) {
  return {
    data: {
      kind,
      demo: api.demo(),
      loading: true,
      saving: false,
      error: "",
      conflict: false,
      editing: false,
      title: "",
      amount: "",
      date: core.today(),
      categories: core.CATEGORIES,
      categoryIndex: 0,
      members: [],
      names: [],
      payerIndex: 0,
      fromIndex: 0,
      toIndex: 0,
      participants: [],
      preview: [],
    },
    onLoad(options) {
      this.options = options;
      this.load(false);
    },
    async load(preserve) {
      try {
        const [s, me] = await Promise.all([
          api.request("trips/" + this.options.tripId),
          api.request("me"),
        ]);
        if (s.trip.archived) throw new Error("旅行已归档，请先恢复");
        this.version = s.trip.version;
        this.currency = s.trip.currency;
        const item = this.options.id
          ? s[kind].find((x) => x.id === this.options.id)
          : null;
        if (this.options.id && !item) throw new Error("记录已删除，请返回账本");
        const indexOf = (id) =>
          Math.max(
            0,
            s.members.findIndex((m) => m.id === id),
          );
        const base = {
          loading: false,
          error: "",
          conflict: false,
          editing: !!item,
          currency: s.trip.currency,
          symbol: core.CURRENCIES[s.trip.currency].symbol,
          version: s.trip.version,
        };
        if (!preserve) {
          const participants =
            item && kind === "expenses"
              ? item.shares.map((p) => p.userId)
              : s.members.map((m) => m.id);
          Object.assign(base, {
            title: item ? item.title || "" : "",
            amount: item
              ? core.amountInput(item.amount, this.currency)
              : this.options.amount
                ? core.amountInput(Number(this.options.amount), this.currency)
                : "",
            date: item ? item.date : core.today(),
            categoryIndex: item
              ? Math.max(0, core.CATEGORIES.indexOf(item.category))
              : 0,
            payerIndex: indexOf(item ? item.payerId : me.userId),
            fromIndex: indexOf(
              item ? item.fromId : this.options.fromId || me.userId,
            ),
            toIndex: indexOf(
              item
                ? item.toId
                : this.options.toId ||
                    s.members.find((m) => m.id !== me.userId)?.id,
            ),
            participants,
            members: s.members.map((m) =>
              Object.assign({}, m, {
                checked: participants.includes(m.id),
                initial: m.name.slice(0, 1),
              }),
            ),
            names: s.members.map((m) => m.name),
          });
        } else {
          const previous = this.data.members;
          Object.assign(base, {
            payerIndex: indexOf(previous[this.data.payerIndex]?.id),
            fromIndex: indexOf(previous[this.data.fromIndex]?.id),
            toIndex: indexOf(previous[this.data.toIndex]?.id),
            participants: this.data.participants.filter((id) =>
              s.members.some((m) => m.id === id),
            ),
            members: s.members.map((m) =>
              Object.assign({}, m, {
                checked: this.data.participants.includes(m.id),
                initial: m.name.slice(0, 1),
              }),
            ),
            names: s.members.map((m) => m.name),
          });
          this.pending = null;
        }
        this.setData(base);
        this.preview();
      } catch (e) {
        api.error(this, e);
      }
    },
    field(e) {
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
      this.preview();
    },
    pick(e) {
      this.setData({ [e.currentTarget.dataset.field]: Number(e.detail.value) });
    },
    participants(e) {
      this.setData({
        participants: e.detail.value,
        members: this.data.members.map((m) =>
          Object.assign({}, m, { checked: e.detail.value.includes(m.id) }),
        ),
      });
      this.preview();
    },
    preview() {
      if (kind !== "expenses") return;
      try {
        const n = core.parseAmount(this.data.amount, this.currency);
        const portions = core
          .splitEqually(n, this.data.participants)
          .map((p) => ({
            id: p.userId,
            name: this.data.members.find((m) => m.id === p.userId).name,
            amount: core.money(p.amount, this.currency),
          }));
        this.setData({ preview: portions });
      } catch {
        this.setData({ preview: [] });
      }
    },
    refreshVersion() {
      this.load(true);
    },
    async save() {
      if (this.data.saving || this.data.loading) return;
      this.setData({ saving: true, error: "", conflict: false });
      try {
        const d = this.data,
          amount = core.parseAmount(d.amount, this.currency);
        let fields;
        if (kind === "expenses") {
          if (!d.title.trim()) throw new Error("请填写支出用途");
          if (!d.participants.length) throw new Error("请选择参与均分的成员");
          fields = {
            title: d.title.trim(),
            amount,
            date: d.date,
            category: core.CATEGORIES[d.categoryIndex],
            payerId: d.members[d.payerIndex].id,
            participants: d.participants,
          };
        } else {
          const fromId = d.members[d.fromIndex].id,
            toId = d.members[d.toIndex].id;
          if (fromId === toId) throw new Error("付款人和收款人不能相同");
          fields = { amount, date: d.date, fromId, toId };
        }
        const signature = JSON.stringify([fields, this.version]);
        if (!this.pending || this.pending.signature !== signature)
          this.pending = { signature, id: api.requestId() };
        await api.request(
          `trips/${this.options.tripId}/${kind}${this.options.id ? "/" + this.options.id : ""}`,
          this.options.id ? "PATCH" : "POST",
          Object.assign({}, fields, {
            version: this.version,
            requestId: this.pending.id,
          }),
        );
        this.pending = null;
        this.setData({ saving: false });
        wx.showToast({ title: "已保存账本" });
        wx.navigateBack({
          delta: 1,
          fail: () => wx.switchTab({ url: "/pages/trips/index" }),
        });
      } catch (e) {
        api.error(this, e);
        this.setData({
          conflict: e.status === 409 || e.message.includes("已更新"),
        });
      }
    },
  };
};
