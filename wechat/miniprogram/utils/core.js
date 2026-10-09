// Generated from lib/core.ts by npm run mini:build. Do not edit.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AMOUNT = exports.CATEGORIES = exports.CURRENCIES = void 0;
exports.parseAmount = parseAmount;
exports.money = money;
exports.amountInput = amountInput;
exports.splitEqually = splitEqually;
exports.calculate = calculate;
exports.today = today;
exports.CURRENCIES = {
    CNY: { label: "人民币", symbol: "¥", digits: 2 },
    HKD: { label: "港币", symbol: "HK$", digits: 2 },
    USD: { label: "美元", symbol: "$", digits: 2 },
    EUR: { label: "欧元", symbol: "€", digits: 2 },
    JPY: { label: "日元", symbol: "¥", digits: 0 },
};
exports.CATEGORIES = [
    "餐饮",
    "交通",
    "住宿",
    "门票",
    "购物",
    "其他",
];
exports.MAX_AMOUNT = 1000000000;
function parseAmount(value, currency) {
    const digits = exports.CURRENCIES[currency].digits;
    if (!new RegExp(`^\\d{1,10}${digits ? `(\\.\\d{1,${digits}})?` : ""}$`).test(value.trim()))
        throw new Error(`请输入有效金额，最多 ${digits} 位小数`);
    const [whole, part = ""] = value.trim().split(".");
    const amount = Number(whole) * 10 ** digits + Number(part.padEnd(digits, "0"));
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > exports.MAX_AMOUNT)
        throw new Error("金额必须大于零且不超过支持的上限");
    return amount;
}
function money(amount, currency) {
    return `${exports.CURRENCIES[currency].symbol}${(amount / 10 ** exports.CURRENCIES[currency].digits).toLocaleString("zh-CN", { minimumFractionDigits: exports.CURRENCIES[currency].digits, maximumFractionDigits: exports.CURRENCIES[currency].digits })}`;
}
function amountInput(amount, currency) {
    return (amount / 10 ** exports.CURRENCIES[currency].digits).toFixed(exports.CURRENCIES[currency].digits);
}
function splitEqually(amount, userIds) {
    const ids = [...new Set(userIds)].sort();
    if (!ids.length ||
        ids.length !== userIds.length ||
        !Number.isSafeInteger(amount) ||
        amount <= 0)
        throw new Error("分摊成员或金额无效");
    return ids.map((userId, i) => ({
        userId,
        amount: Math.floor(amount / ids.length) + (i < amount % ids.length ? 1 : 0),
    }));
}
function calculate(memberInfo, expenses, repayments) {
    const members = memberInfo.map((m) => ({
        ...m,
        paid: 0,
        owed: 0,
        balance: 0,
    }));
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const e of expenses) {
        byId.get(e.payerId).paid += e.amount;
        for (const s of e.shares)
            byId.get(s.userId).owed += s.amount;
    }
    for (const m of members)
        m.balance = m.paid - m.owed;
    for (const r of repayments) {
        byId.get(r.fromId).balance += r.amount;
        byId.get(r.toId).balance -= r.amount;
    }
    const debts = members
        .filter((m) => m.balance < 0)
        .map((m) => ({ id: m.id, amount: -m.balance }))
        .sort((a, b) => a.id.localeCompare(b.id));
    const credits = members
        .filter((m) => m.balance > 0)
        .map((m) => ({ id: m.id, amount: m.balance }))
        .sort((a, b) => a.id.localeCompare(b.id));
    const transfers = [];
    let i = 0, j = 0;
    while (i < debts.length && j < credits.length) {
        const amount = Math.min(debts[i].amount, credits[j].amount);
        transfers.push({ fromId: debts[i].id, toId: credits[j].id, amount });
        debts[i].amount -= amount;
        credits[j].amount -= amount;
        if (!debts[i].amount)
            i++;
        if (!credits[j].amount)
            j++;
    }
    return { members, transfers };
}
function today() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}
