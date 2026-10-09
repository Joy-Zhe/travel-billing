const core = require("./format");
const KEY = "together-mini-demo-v1";
const clone = (value) => JSON.parse(JSON.stringify(value));
function seed() {
  const ids = ["demo-a", "demo-b", "demo-c"];
  const expenses = [
    {
      id: "demo-e1",
      title: "海边民宿 · 两晚",
      amount: 128000,
      date: "2026-10-07",
      category: "住宿",
      payerId: ids[0],
      createdBy: ids[0],
      shares: core.splitEqually(128000, ids),
    },
    {
      id: "demo-e2",
      title: "日落海鲜晚餐",
      amount: 48600,
      date: "2026-10-08",
      category: "餐饮",
      payerId: ids[1],
      createdBy: ids[1],
      shares: core.splitEqually(48600, ids),
    },
  ];
  return {
    user: { userId: "demo-a", displayName: "小林", isBound: false },
    people: [
      { id: ids[0], name: "小林" },
      { id: ids[1], name: "阿晴" },
      { id: ids[2], name: "小周" },
    ],
    operations: {},
    trips: [
      {
        trip: {
          id: "demo-trip",
          name: "青岛 · 去海边放个假",
          destination: "山东 · 青岛",
          startDate: "2026-10-07",
          endDate: "2026-10-10",
          currency: "CNY",
          ownerId: ids[0],
          archived: false,
          currencyLocked: true,
          version: 0,
        },
        members: ids,
        expenses,
        repayments: [],
      },
    ],
  };
}
function load() {
  return wx.getStorageSync(KEY) || seed();
}
function reset() {
  wx.removeStorageSync(KEY);
}
function snapshot(state, item) {
  const members = item.members.map((id) =>
    state.people.find((p) => p.id === id),
  );
  return Object.assign(
    {
      trip: Object.assign({}, item.trip, {
        total: item.expenses.reduce((s, e) => s + e.amount, 0),
        memberCount: item.members.length,
      }),
      expenses: item.expenses,
      repayments: item.repayments,
    },
    core.calculate(members, item.expenses, item.repayments),
  );
}
async function request(path, method = "GET", body = {}) {
  const state = load(),
    segments = path.split("/"),
    id = segments[1],
    entity = segments[2],
    recordId = segments[3];
  let result;
  if (path === "me") return clone(state.user);
  if (path === "account/bind")
    throw new Error("演示模式不能绑定真实账号。注册后配置云环境即可开启共享。");
  if (path === "account/profile" && method === "PATCH") {
    if (!body.name || body.name.length > 30) throw new Error("请输入有效昵称");
    state.user.displayName = body.name;
    state.people[0].name = body.name;
    result = state.user;
  } else if (path === "trips" && method === "GET")
    return clone(state.trips.map((t) => snapshot(state, t).trip));
  else if (path === "trips" && method === "POST") {
    const trip = Object.assign({}, body, {
      id: "demo-" + Date.now(),
      ownerId: state.user.userId,
      archived: false,
      currencyLocked: false,
      version: 0,
    });
    state.trips.unshift({
      trip,
      members: [state.user.userId],
      expenses: [],
      repayments: [],
    });
    result = { id: trip.id };
  } else if (segments[0] === "invites") {
    if (id !== "demo-invite") throw new Error("演示链接不能加入真实旅行");
    result =
      method === "GET"
        ? {
            id: "demo-trip",
            name:
              state.trips.find((t) => t.trip.id === "demo-trip")?.trip.name ||
              "演示旅行",
            destination: "青岛",
          }
        : { id: "demo-trip" };
  } else {
    const item = state.trips.find((t) => t.trip.id === id);
    if (!item) throw new Error("旅行不存在");
    if (method === "GET") return clone(snapshot(state, item));
    const key = `${id}:${body.requestId}`;
    if (body.requestId && state.operations[key])
      return clone(state.operations[key]);
    if (body.version !== item.trip.version)
      throw new Error("账本已更新，请返回账本刷新后重试");
    if (
      item.trip.archived &&
      !(path === `trips/${id}` && typeof body.archived === "boolean")
    )
      throw new Error("旅行已归档，请先恢复");
    if (entity === "invite")
      result = {
        token: "demo-invite",
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    else if (segments.length === 2 && method === "PATCH") {
      if (
        body.currency &&
        item.trip.currencyLocked &&
        body.currency !== item.trip.currency
      )
        throw new Error("币种已锁定");
      const { version, requestId, ...fields } = body;
      Object.assign(item.trip, fields);
      result = { ok: true };
    } else if (entity === "expenses" || entity === "repayments") {
      const records = item[entity],
        index = records.findIndex((r) => r.id === recordId);
      if (method === "DELETE") {
        if (index < 0) throw new Error("记录不存在");
        records.splice(index, 1);
        result = { ok: true };
      } else {
        if (recordId && index < 0) throw new Error("记录不存在");
        const eid = recordId || "demo-record-" + Date.now();
        const record = Object.assign({}, body, {
          id: eid,
          createdBy: state.user.userId,
        });
        if (!Number.isSafeInteger(body.amount) || body.amount <= 0)
          throw new Error("金额无效");
        if (entity === "expenses") {
          if (
            !item.members.includes(body.payerId) ||
            !body.participants.every((id) => item.members.includes(id))
          )
            throw new Error("成员无效");
          record.shares = core.splitEqually(body.amount, body.participants);
          item.trip.currencyLocked = true;
        } else if (
          body.fromId === body.toId ||
          !item.members.includes(body.fromId) ||
          !item.members.includes(body.toId)
        )
          throw new Error("还款成员无效");
        if (index >= 0) records[index] = record;
        else records.unshift(record);
        result = { id: eid };
      }
    } else throw new Error("演示接口不存在");
    item.trip.version++;
    if (body.requestId) state.operations[key] = clone(result);
  }
  wx.setStorageSync(KEY, state);
  return clone(result);
}
module.exports = { request, reset };
