export const CURRENCIES = {
  CNY: { label: "人民币", symbol: "¥", digits: 2 },
  HKD: { label: "港币", symbol: "HK$", digits: 2 },
  USD: { label: "美元", symbol: "$", digits: 2 },
  EUR: { label: "欧元", symbol: "€", digits: 2 },
  JPY: { label: "日元", symbol: "¥", digits: 0 },
} as const;
export type Currency = keyof typeof CURRENCIES;
export const CATEGORIES = [
  "餐饮",
  "交通",
  "住宿",
  "门票",
  "购物",
  "其他",
] as const;
export const MAX_AMOUNT = 1_000_000_000;
export function parseAmount(value: string, currency: Currency): number {
  const digits = CURRENCIES[currency].digits;
  if (
    !new RegExp(`^\\d{1,10}${digits ? `(\\.\\d{1,${digits}})?` : ""}$`).test(
      value.trim(),
    )
  )
    throw new Error(`请输入有效金额，最多 ${digits} 位小数`);
  const [whole, part = ""] = value.trim().split(".");
  const amount =
    Number(whole) * 10 ** digits + Number(part.padEnd(digits, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT)
    throw new Error("金额必须大于零且不超过支持的上限");
  return amount;
}
export function money(amount: number, currency: Currency): string {
  return `${CURRENCIES[currency].symbol}${(amount / 10 ** CURRENCIES[currency].digits).toLocaleString("zh-CN", { minimumFractionDigits: CURRENCIES[currency].digits, maximumFractionDigits: CURRENCIES[currency].digits })}`;
}
export function amountInput(amount: number, currency: Currency): string {
  return (amount / 10 ** CURRENCIES[currency].digits).toFixed(
    CURRENCIES[currency].digits,
  );
}
export function splitEqually(amount: number, userIds: string[]) {
  const ids = [...new Set(userIds)].sort();
  if (
    !ids.length ||
    ids.length !== userIds.length ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  )
    throw new Error("分摊成员或金额无效");
  return ids.map((userId, i) => ({
    userId,
    amount: Math.floor(amount / ids.length) + (i < amount % ids.length ? 1 : 0),
  }));
}
export type Member = {
  id: string;
  name: string;
  paid: number;
  owed: number;
  balance: number;
};
export type Expense = {
  id: string;
  title: string;
  amount: number;
  date: string;
  category: string;
  payerId: string;
  createdBy: string;
  shares: { userId: string; amount: number }[];
};
export type Repayment = {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  date: string;
  createdBy: string;
};
export type Transfer = { fromId: string; toId: string; amount: number };
export type Trip = {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  currency: Currency;
  ownerId: string;
  archived: boolean;
  currencyLocked: boolean;
  version: number;
  total: number;
  memberCount: number;
};
export type Snapshot = {
  trip: Trip;
  members: Member[];
  expenses: Expense[];
  repayments: Repayment[];
  transfers: Transfer[];
};
export function calculate(
  memberInfo: { id: string; name: string }[],
  expenses: Expense[],
  repayments: Repayment[],
) {
  const members: Member[] = memberInfo.map((m) => ({
    ...m,
    paid: 0,
    owed: 0,
    balance: 0,
  }));
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const e of expenses) {
    byId.get(e.payerId)!.paid += e.amount;
    for (const s of e.shares) byId.get(s.userId)!.owed += s.amount;
  }
  for (const m of members) m.balance = m.paid - m.owed;
  for (const r of repayments) {
    byId.get(r.fromId)!.balance += r.amount;
    byId.get(r.toId)!.balance -= r.amount;
  }
  const debts = members
    .filter((m) => m.balance < 0)
    .map((m) => ({ id: m.id, amount: -m.balance }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const credits = members
    .filter((m) => m.balance > 0)
    .map((m) => ({ id: m.id, amount: m.balance }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const transfers: Transfer[] = [];
  let i = 0,
    j = 0;
  while (i < debts.length && j < credits.length) {
    const amount = Math.min(debts[i].amount, credits[j].amount);
    transfers.push({ fromId: debts[i].id, toId: credits[j].id, amount });
    debts[i].amount -= amount;
    credits[j].amount -= amount;
    if (!debts[i].amount) i++;
    if (!credits[j].amount) j++;
  }
  return { members, transfers };
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
