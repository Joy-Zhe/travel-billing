"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Compass,
  Copy,
  CreditCard,
  Ellipsis,
  Globe2,
  History,
  LayoutGrid,
  Link2,
  LogOut,
  MapPin,
  Menu,
  Pencil,
  Plane,
  Plus,
  Receipt,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  Users,
  Utensils,
  Wallet,
  X,
  BedDouble,
  ShoppingBag,
  Car,
} from "lucide-react";
import {
  CURRENCIES,
  CATEGORIES,
  amountInput,
  money,
  parseAmount,
  splitEqually,
  today,
} from "../lib/core";
import type {
  Currency,
  Expense,
  Repayment,
  Snapshot,
  Transfer,
  Trip,
} from "../lib/core";
type User = { userId: string; displayName: string; email: string };
type View = "trips" | "expenses" | "settlement" | "members";
type ModalState = {
  type: "trip" | "expense" | "repayment" | "invite" | "confirm";
  version: number;
  item?: Expense | Repayment | Transfer;
  editTrip?: boolean;
  action?: () => Promise<void>;
  title?: string;
  description?: string;
};
const catIcons = {
  餐饮: Utensils,
  交通: Car,
  住宿: BedDouble,
  门票: Ticket,
  购物: ShoppingBag,
  其他: Receipt,
};
const DEMO: Snapshot = (() => {
  const ids = ["demo-a", "demo-b", "demo-c", "demo-d"];
  const expenses: Expense[] = [
    {
      id: "1",
      title: "海边民宿 · 两晚",
      amount: 128000,
      date: "2026-10-03",
      category: "住宿",
      payerId: ids[0],
      createdBy: ids[0],
      shares: splitEqually(128000, ids),
    },
    {
      id: "2",
      title: "日落海鲜大餐",
      amount: 48600,
      date: "2026-10-03",
      category: "餐饮",
      payerId: ids[1],
      createdBy: ids[1],
      shares: splitEqually(48600, ids),
    },
    {
      id: "3",
      title: "沿海自驾租车",
      amount: 36000,
      date: "2026-10-02",
      category: "交通",
      payerId: ids[2],
      createdBy: ids[2],
      shares: splitEqually(36000, ids),
    },
    {
      id: "4",
      title: "崂山风景区门票",
      amount: 36000,
      date: "2026-10-02",
      category: "门票",
      payerId: ids[3],
      createdBy: ids[3],
      shares: splitEqually(36000, ids),
    },
    {
      id: "5",
      title: "街角咖啡和小点心",
      amount: 16800,
      date: "2026-10-01",
      category: "餐饮",
      payerId: ids[0],
      createdBy: ids[0],
      shares: splitEqually(16800, ids),
    },
  ];
  const info = ["小林", "阿晴", "小周", "阿泽"].map((name, i) => ({
    id: ids[i],
    name,
    paid: expenses
      .filter((e) => e.payerId === ids[i])
      .reduce((s, e) => s + e.amount, 0),
    owed: expenses.reduce(
      (s, e) => s + e.shares.find((a) => a.userId === ids[i])!.amount,
      0,
    ),
    balance: 0,
  }));
  info.forEach((m) => (m.balance = m.paid - m.owed));
  return {
    trip: {
      id: "demo",
      name: "青岛 · 去海边放个假",
      destination: "山东 · 青岛",
      startDate: "2026-10-01",
      endDate: "2026-10-04",
      currency: "CNY",
      ownerId: ids[0],
      archived: false,
      currencyLocked: true,
      version: 0,
      total: expenses.reduce((s, e) => s + e.amount, 0),
      memberCount: 4,
    },
    members: info,
    expenses,
    repayments: [],
    transfers: info
      .slice(1)
      .map((m) => ({ fromId: m.id, toId: ids[0], amount: -m.balance })),
  };
})();
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "请求失败，请重试");
  return value;
}
function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string;
  index?: number;
  small?: boolean;
}) {
  return (
    <span
      aria-label={name}
      className={`avatar color-${index % 5} ${small ? "small" : ""}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Compass size={30} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  close,
  busy,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const elements = () => [
      ...(container.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea",
      ) || []),
    ];
    (elements().find((x) => x.tagName === "INPUT") || elements()[0])?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
      if (e.key === "Tab") {
        const els = elements();
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = original;
      previous?.focus();
    };
  }, [busy, close]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        ref={container}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">同行账本 / TOGETHER</span>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function LedgerApp() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [trips, setTrips] = useState<Trip[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<View>("trips");
  const [demo, setDemo] = useState(false),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [modal, setModal] = useState<ModalState | null>(null),
    [modalError, setModalError] = useState("");
  const [invite, setInvite] = useState<{
      id: string;
      name: string;
      destination: string;
      expires_at: string;
    } | null>(null),
    [joinToken, setJoinToken] = useState("");
  const [inviteLink, setInviteLink] = useState(""),
    [inviteExpiry, setInviteExpiry] = useState(""),
    [category, setCategory] = useState("全部"),
    [memberFilter, setMemberFilter] = useState(""),
    [dateFilter, setDateFilter] = useState("");
  const sequence = useRef(0),
    submitting = useRef(false),
    retryRequest = useRef<{ signature: string; id: string } | null>(null);
  const modalVersion = useRef(0);
  useEffect(() => {
    if (modal) modalVersion.current = modal.version;
  }, [modal]);
  const refresh = useCallback(async (id: string, list = true) => {
    const seq = ++sequence.current;
    const [newTrips, detail] = await Promise.all([
      list ? api<Trip[]>("trips") : Promise.resolve(null),
      id ? api<Snapshot>(`trips/${id}`) : Promise.resolve(null),
    ]);
    if (seq !== sequence.current) return;
    if (newTrips) setTrips(newTrips);
    if (detail) setSnapshot(detail);
  }, []);
  useEffect(() => {
    let active = true;
    const token = window.location.pathname.startsWith("/join/")
      ? window.location.pathname.split("/")[2]
      : "";
    setJoinToken(token);
    (async () => {
      try {
        const me = await api<User | null>("me");
        if (!active) return;
        setUser(me);
        if (me) {
          await refresh("");
          if (token) {
            const info = await api<typeof invite>(`invites/${token}`);
            if (active) setInvite(info);
          }
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!user || demo || !selected) return;
    const reload = () => {
      if (document.visibilityState === "visible")
        refresh(selected, false)
          .then(() => setError(""))
          .catch((e) => setError(e.message));
    };
    const timer = setInterval(reload, 15000);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, [user, demo, selected, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const closeModal = useCallback(() => {
    if (!submitting.current) {
      setModal(null);
      setModalError("");
    }
  }, []);
  const data = demo ? DEMO : snapshot,
    currency = data?.trip.currency || "CNY";
  const me = data?.members.find(
    (m) => m.id === (demo ? "demo-a" : user?.userId),
  );
  const nameOf = (id: string) =>
    data?.members.find((m) => m.id === id)?.name || "成员";
  const owner = Boolean(!demo && user && data?.trip.ownerId === user.userId);
  const readOnly = demo || Boolean(data?.trip.archived);
  function openModal(
    type: ModalState["type"],
    options: Partial<ModalState> = {},
  ) {
    if (demo || !user) {
      setToast("示例仅供预览，登录后创建你的旅行");
      return;
    }
    retryRequest.current = null;
    setModalError("");
    setModal({ type, version: data?.trip.version || 0, ...options });
  }
  async function chooseTrip(trip: Trip) {
    setDemo(false);
    setSelected(trip.id);
    setSnapshot(null);
    setView("expenses");
    setError("");
    setCategory("全部");
    setMemberFilter("");
    setDateFilter("");
    setLoading(true);
    try {
      await refresh(trip.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function showDemo() {
    setDemo(true);
    setView("expenses");
    setCategory("全部");
    setMemberFilter("");
    setDateFilter("");
  }
  function showTrips() {
    sequence.current++;
    setDemo(false);
    setSelected("");
    setSnapshot(null);
    setView("trips");
    if (user) refresh("").catch((e) => setError(e.message));
  }
  async function mutation(
    path: string,
    method: string,
    fields: Record<string, unknown>,
  ) {
    const signature = JSON.stringify([path, method, fields]);
    if (retryRequest.current?.signature !== signature)
      retryRequest.current = { signature, id: crypto.randomUUID() };
    return api<Record<string, any>>(path, method, {
      ...fields,
      version: modalVersion.current,
      requestId: retryRequest.current.id,
    });
  }
  async function run(action: () => Promise<void>, inModal = true) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setModalError("");
    setError("");
    try {
      await action();
      setModal(null);
      retryRequest.current = null;
    } catch (e) {
      if (inModal) setModalError((e as Error).message);
      else setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function saveForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      if (modal?.type === "trip") {
        const fields = {
          name: form.get("name"),
          destination: form.get("destination"),
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
          currency: form.get("currency") || data?.trip.currency,
        };
        if (modal.editTrip) {
          await mutation(`trips/${selected}`, "PATCH", fields);
          await refresh(selected);
        } else {
          const trip = await api<{ id: string }>("trips", "POST", fields);
          setSelected(trip.id);
          setView("expenses");
          await refresh(trip.id);
        }
      }
      if (modal?.type === "expense") {
        const item = modal.item as Expense | undefined;
        await mutation(
          `trips/${selected}/expenses${item ? `/${item.id}` : ""}`,
          item ? "PATCH" : "POST",
          {
            title: form.get("title"),
            amount: parseAmount(String(form.get("amount")), currency),
            date: form.get("date"),
            category: form.get("category"),
            payerId: form.get("payerId"),
            participants: form.getAll("participants"),
          },
        );
        await refresh(selected);
      }
      if (modal?.type === "repayment") {
        const item = modal.item as Repayment | undefined;
        const editing = item && "id" in item;
        await mutation(
          `trips/${selected}/repayments${editing ? `/${item.id}` : ""}`,
          editing ? "PATCH" : "POST",
          {
            amount: parseAmount(String(form.get("amount")), currency),
            date: form.get("date"),
            fromId: form.get("fromId"),
            toId: form.get("toId"),
          },
        );
        await refresh(selected);
      }
      setToast("已保存，同行成员可同步查看");
    });
  }
  async function deleteRecord(kind: "expenses" | "repayments", id: string) {
    await mutation(`trips/${selected}/${kind}/${id}`, "DELETE", {});
    await refresh(selected);
    setToast(
      kind === "expenses" ? "支出已删除，分账已更新" : "还款已撤销，分账已更新",
    );
  }
  function confirmDelete(kind: "expenses" | "repayments", id: string) {
    openModal("confirm", {
      title: kind === "expenses" ? "删除这笔支出？" : "撤销这笔还款？",
      description:
        "操作后将重新计算所有成员的余额，请确认这条记录确实需要移除。",
      action: () => deleteRecord(kind, id),
    });
  }
  const filteredExpenses =
    data?.expenses.filter(
      (e) =>
        (category === "全部" || e.category === category) &&
        (!dateFilter || e.date === dateFilter) &&
        (!memberFilter ||
          e.payerId === memberFilter ||
          e.shares.some((s) => s.userId === memberFilter)),
    ) || [];
  const filteredTrips = trips.filter((t) => t.archived === archived);
  const categories = CATEGORIES.map((label) => ({
    label,
    amount:
      data?.expenses
        .filter((e) => e.category === label)
        .reduce((s, e) => s + e.amount, 0) || 0,
  })).filter((c) => c.amount);
  const formExpense =
    modal?.type === "expense" ? (modal.item as Expense | undefined) : undefined;
  const formRepayment =
    modal?.type === "repayment"
      ? (modal.item as Repayment | Transfer | undefined)
      : undefined;
  const tripEdit = modal?.editTrip ? data?.trip : undefined;
  const signin = `/signin-with-chatgpt?return_to=${encodeURIComponent(joinToken ? `/join/${joinToken}` : "/")}`;
  const nav = [
    { id: "expenses" as View, label: "账单明细", icon: Receipt },
    { id: "settlement" as View, label: "分账结算", icon: CreditCard },
    { id: "members" as View, label: "同行成员", icon: Users },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="同行账本首页">
          <span className="brand-icon">
            <Wallet size={23} />
          </span>
          <span>
            同行账本<small>TOGETHER, GO FURTHER.</small>
          </span>
        </a>
        <div className="workspace-label">
          旅行空间 <span>PERSONAL</span>
        </div>
        <button
          className={`nav-item ${view === "trips" ? "active" : ""}`}
          onClick={showTrips}
        >
          <LayoutGrid size={19} />
          我的旅行
          <span className="nav-count">
            {trips.filter((t) => !t.archived).length || "·"}
          </span>
        </button>
        <div className="nav-divider" />
        <div className="sidebar-section">
          {data && view !== "trips" ? "当前旅行" : "一起出发"}
        </div>
        {data && view !== "trips" ? (
          <>
            <div className="current-trip">
              <span className="trip-dot" />
              {data.trip.name}
            </div>
            {nav.map((n) => (
              <button
                key={n.id}
                className={`nav-item ${view === n.id ? "active" : ""}`}
                onClick={() => setView(n.id)}
              >
                <n.icon size={19} />
                {n.label}
              </button>
            ))}
          </>
        ) : (
          <div className="sidebar-description">
            <Plane size={20} />
            <p>
              从一段新旅程开始，
              <br />
              让每笔花费都有着落。
            </p>
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="travel-note">
            <span>
              <Sparkles size={17} /> 少一点算计，多一点风景
            </span>
            <p>
              账本我们记，
              <br />
              回忆你们留。
            </p>
            <div className="note-line" />
          </div>
          <div className="user-panel">
            <Avatar name={user?.displayName || "旅"} />
            <div>
              <strong>{user?.displayName || "准备好出发了吗？"}</strong>
              <small>
                {user ? "你的私人旅行空间" : "登录，开启你的第一段旅程"}
              </small>
            </div>
            {user ? (
              <a
                aria-label="退出登录"
                className="icon-button"
                href="/signout-with-chatgpt?return_to=/"
                target="_top"
              >
                <LogOut size={16} />
              </a>
            ) : (
              <a
                className="icon-button"
                href={signin}
                target="_top"
                aria-label="登录"
              >
                <ArrowRight size={17} />
              </a>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Wallet size={22} />
            </span>
            <span>旅行空间</span>
            <span className="slash">/</span>
            <strong>
              {view === "trips" ? "我的旅行" : data?.trip.name || "旅行账本"}
            </strong>
            {demo && <span className="demo-pill">示例预览</span>}
          </div>
          <div className="topbar-actions">
            <span className="secure-label">
              <ShieldCheck size={15} /> 成员私密共享
            </span>
            {user ? (
              <button
                className="button primary compact"
                onClick={() => openModal("trip")}
              >
                <Plus size={17} />
                创建旅行
              </button>
            ) : (
              <a className="button primary compact" href={signin} target="_top">
                登录 / 开始记账
                <ArrowUpRight size={16} />
              </a>
            )}
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="alert" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() =>
                  user
                    ? refresh(selected)
                        .then(() => setError(""))
                        .catch((e) => setError(e.message))
                    : window.location.reload()
                }
              >
                <RefreshCw size={15} />
                重新加载
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <span className="spinner" />
              <p>正在整理你的旅行账本…</p>
            </div>
          ) : invite && view === "trips" ? (
            <section className="join-card">
              <span className="empty-icon">
                <Users size={32} />
              </span>
              <span className="eyebrow">好朋友，一起出发</span>
              <h1>加入「{invite.name}」</h1>
              <p>
                <MapPin size={17} />
                {invite.destination}
              </p>
              <div className="info-strip">
                <ShieldCheck size={19} />
                加入后，你可以查看、录入和管理这次旅行的所有支出与还款。
              </div>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api<{ id: string }>(
                      `invites/${joinToken}`,
                      "POST",
                      {},
                    );
                    setInvite(null);
                    window.history.replaceState(null, "", "/");
                    setSelected(r.id);
                    setView("expenses");
                    await refresh(r.id);
                  }, false)
                }
              >
                {busy ? "正在加入…" : "确认加入旅行"}
                <ArrowRight size={18} />
              </button>
            </section>
          ) : view === "trips" ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">EVERY JOURNEY COUNTS</span>
                  <h1>
                    {user ? "下一站，一起去哪里？" : "把账算清，把快乐留下。"}
                    <span className="heading-dot">◦</span>
                  </h1>
                  <p>
                    {user
                      ? "在这里，记录每段旅程，也记下每一份同行的心意。"
                      : "多人旅行，一起记账、公平分摊。从出发到结算，都轻轻松松。"}
                  </p>
                </div>
                <span className="heading-stamp">
                  <Plane size={25} />
                  <small>LET’S GO!</small>
                </span>
              </div>
              <section className="welcome-banner">
                <div className="welcome-content">
                  <span className="label-pill">
                    <Sparkles size={13} /> 美好旅程，从轻松记账开始
                  </span>
                  <h2>
                    一起看世界，
                    <br />
                    也一起分担。
                  </h2>
                  <p>
                    谁垫付了晚餐，谁预订了民宿？
                    <br />
                    记下来，剩下的交给同行账本。
                  </p>
                  <div className="row-actions">
                    {user ? (
                      <button
                        className="button primary"
                        onClick={() => openModal("trip")}
                      >
                        <Plus size={18} />
                        创建新旅行
                      </button>
                    ) : (
                      <a className="button primary" href={signin} target="_top">
                        开启我的旅行
                        <ArrowRight size={17} />
                      </a>
                    )}
                    <button className="button ghost" onClick={showDemo}>
                      看看示例账本
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="banner-caption">
                  <MapPin size={13} /> 下一站，值得期待
                </div>
              </section>
              <div className="section-heading">
                <div className="tab-group">
                  <button
                    className={!archived ? "selected" : ""}
                    onClick={() => setArchived(false)}
                  >
                    进行中的旅行{" "}
                    <span>{trips.filter((t) => !t.archived).length}</span>
                  </button>
                  <button
                    className={archived ? "selected" : ""}
                    onClick={() => setArchived(true)}
                  >
                    已归档 <span>{trips.filter((t) => t.archived).length}</span>
                  </button>
                </div>
                <span className="muted tiny">每段同行，都值得好好记录</span>
              </div>
              {filteredTrips.length ? (
                <div className="trip-grid">
                  {filteredTrips.map((t, i) => (
                    <button
                      className={`trip-card theme-${i % 3}`}
                      key={t.id}
                      onClick={() => chooseTrip(t)}
                    >
                      <div className="trip-art">
                        <span className="label-pill">
                          {t.archived ? "已归档" : "一起旅行中"}
                        </span>
                        <Compass
                          className="trip-art-icon"
                          size={75}
                          strokeWidth={1}
                        />
                        <span className="trip-art-place">{t.destination}</span>
                      </div>
                      <div className="trip-card-body">
                        <h3>
                          {t.name}
                          <ArrowUpRight size={19} />
                        </h3>
                        <p>
                          <CalendarDays size={14} />
                          {t.startDate} — {t.endDate}
                        </p>
                        <div className="trip-card-footer">
                          <span>
                            <Users size={15} />
                            {t.memberCount} 位同行
                          </span>
                          <strong>
                            {money(t.total, t.currency)}
                            <small>总支出</small>
                          </strong>
                        </div>
                      </div>
                    </button>
                  ))}
                  <button
                    className="new-trip-card"
                    onClick={() => openModal("trip")}
                  >
                    <span>
                      <Plus size={25} />
                    </span>
                    <strong>计划下一段旅程</strong>
                    <p>新目的地，新故事</p>
                  </button>
                </div>
              ) : (
                <div className="first-trip-grid">
                  <div className="empty-trip">
                    <Empty
                      title={
                        archived
                          ? "还没有归档的旅行"
                          : "你的第一段旅程，从这里开始"
                      }
                      detail={
                        archived
                          ? "已完成的旅程，可以归档保存。"
                          : "创建一个旅行，邀请朋友加入，再记下第一笔共同花费。"
                      }
                      action={
                        user && !archived ? (
                          <button
                            className="button secondary"
                            onClick={() => openModal("trip")}
                          >
                            <Plus size={17} />
                            创建旅行
                          </button>
                        ) : !user ? (
                          <a
                            className="button secondary"
                            href={signin}
                            target="_top"
                          >
                            使用 ChatGPT 登录
                            <ArrowRight size={16} />
                          </a>
                        ) : undefined
                      }
                    />
                  </div>
                  <button className="example-card" onClick={showDemo}>
                    <span className="eyebrow">一点旅行灵感</span>
                    <h3>
                      去海边，
                      <br />
                      给生活放个假。
                    </h3>
                    <div className="example-card-bottom">
                      <span>青岛 · 四人旅行示例</span>
                      <span className="round-arrow">
                        <ArrowUpRight size={21} />
                      </span>
                    </div>
                    <span className="example-mark">只读示例</span>
                  </button>
                </div>
              )}
              <div className="feature-row">
                {[
                  {
                    icon: Receipt,
                    title: "随手记下每一笔",
                    detail: "餐饮、交通、住宿，一目了然",
                  },
                  {
                    icon: Users,
                    title: "好友一起参与",
                    detail: "登录加入，共享同一本账",
                  },
                  {
                    icon: CheckCheck,
                    title: "分账不再费心",
                    detail: "自动均分，算清谁该付给谁",
                  },
                ].map((f) => (
                  <div key={f.title}>
                    <span className="feature-icon">
                      <f.icon size={21} />
                    </span>
                    <div>
                      <strong>{f.title}</strong>
                      <p>{f.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : data ? (
            <>
              <div className="trip-title-row">
                <button className="text-button back-button" onClick={showTrips}>
                  <ChevronLeft size={16} />
                  我的旅行
                </button>
                <div className="row-actions">
                  {demo ? (
                    <span className="muted tiny">
                      示例数据 · 不会保存任何修改
                    </span>
                  ) : (
                    <span className="sync-status">
                      <span />每 15 秒同步
                    </span>
                  )}
                  {owner && (
                    <button
                      className="icon-button"
                      aria-label="旅行设置"
                      onClick={() => openModal("trip", { editTrip: true })}
                    >
                      <Settings2 size={18} />
                    </button>
                  )}
                </div>
              </div>
              <section className="trip-banner">
                <div>
                  <div className="row-actions">
                    <span className="label-pill">
                      <Plane size={13} />
                      {data.trip.archived ? "已归档 · 只读" : "一起旅行中"}
                    </span>
                    <span className="tiny muted">
                      {CURRENCIES[currency].label}结算
                    </span>
                  </div>
                  <h1>{data.trip.name}</h1>
                  <p>
                    <MapPin size={15} />
                    {data.trip.destination}
                    <span className="dot-separator">·</span>
                    <CalendarDays size={15} />
                    {data.trip.startDate} — {data.trip.endDate}
                  </p>
                  <div className="trip-people">
                    <div className="avatar-stack">
                      {data.members.slice(0, 5).map((m, i) => (
                        <Avatar key={m.id} name={m.name} index={i} small />
                      ))}
                    </div>
                    <span>{data.members.length} 位同行，一路好风景</span>
                  </div>
                </div>
                {owner && !readOnly && (
                  <button
                    className="button white"
                    onClick={() => {
                      setInviteLink("");
                      openModal("invite");
                    }}
                  >
                    <Link2 size={17} />
                    邀请同行
                  </button>
                )}
              </section>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">
                    旅行总支出
                    <span className="stat-icon">
                      <Wallet size={17} />
                    </span>
                  </div>
                  <strong>{money(data.trip.total, currency)}</strong>
                  <p>
                    {data.expenses.length} 笔支出<span>一起花，一起记</span>
                  </p>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    我的垫付
                    <span className="stat-icon lavender">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                  <strong>{money(me?.paid || 0, currency)}</strong>
                  <p>你为同行垫付的费用</p>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    我的分摊
                    <span className="stat-icon apricot">
                      <Users size={17} />
                    </span>
                  </div>
                  <strong>{money(me?.owed || 0, currency)}</strong>
                  <p>你参与消费应承担的金额</p>
                </div>
                <div className="stat-card balance-card">
                  <div className="stat-label">
                    {(me?.balance || 0) >= 0 ? "我待收回" : "我待支付"}
                    <span className="stat-icon mint">
                      <CreditCard size={17} />
                    </span>
                  </div>
                  <strong>{money(Math.abs(me?.balance || 0), currency)}</strong>
                  <p>
                    {me?.balance
                      ? "已计入实际还款"
                      : "目前已结清，轻松继续旅行"}
                    <ArrowUpRight size={15} />
                  </p>
                </div>
              </div>
              <div className="section-heading dashboard-tabs">
                <div className="tab-group">
                  {nav.map((n) => (
                    <button
                      key={n.id}
                      className={view === n.id ? "selected" : ""}
                      onClick={() => setView(n.id)}
                    >
                      <n.icon size={16} />
                      {n.label}
                      {n.id === "expenses" && (
                        <span>{data.expenses.length}</span>
                      )}
                    </button>
                  ))}
                </div>
                {view === "expenses" && (
                  <button
                    className="button primary compact"
                    disabled={readOnly}
                    onClick={() => openModal("expense")}
                  >
                    <Plus size={17} />
                    记一笔
                  </button>
                )}
                {view === "settlement" && (
                  <button
                    className="button primary compact"
                    disabled={
                      readOnly ||
                      data.members.length < 2 ||
                      !data.expenses.length
                    }
                    onClick={() => openModal("repayment")}
                  >
                    <Plus size={17} />
                    登记还款
                  </button>
                )}
              </div>
              {view === "expenses" ? (
                <div className="ledger-columns">
                  <section className="panel expense-panel">
                    <div className="panel-title">
                      <div>
                        <h2>旅行账单</h2>
                        <p>每一笔，都是旅途中的小事</p>
                      </div>
                      <span className="muted tiny">均分记账</span>
                    </div>
                    <div className="filters">
                      <label className="sr-only" htmlFor="category-filter">
                        按分类筛选
                      </label>
                      <select
                        id="category-filter"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option>全部</option>
                        {CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor="member-filter">
                        按成员筛选
                      </label>
                      <select
                        id="member-filter"
                        value={memberFilter}
                        onChange={(e) => setMemberFilter(e.target.value)}
                      >
                        <option value="">全部成员</option>
                        {data.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor="date-filter">
                        按日期筛选
                      </label>
                      <input
                        id="date-filter"
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                      />
                      {(category !== "全部" || memberFilter || dateFilter) && (
                        <button
                          className="icon-button"
                          aria-label="清除筛选"
                          onClick={() => {
                            setCategory("全部");
                            setMemberFilter("");
                            setDateFilter("");
                          }}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                    {filteredExpenses.length ? (
                      <div>
                        {[...new Set(filteredExpenses.map((e) => e.date))].map(
                          (day) => (
                            <div key={day}>
                              <div className="date-group">
                                <span>
                                  {day.slice(5).replace("-", " 月 ")} 日
                                </span>
                                <span>
                                  {money(
                                    filteredExpenses
                                      .filter((e) => e.date === day)
                                      .reduce((s, e) => s + e.amount, 0),
                                    currency,
                                  )}
                                </span>
                              </div>
                              {filteredExpenses
                                .filter((e) => e.date === day)
                                .map((e) => {
                                  const Icon =
                                    catIcons[
                                      e.category as keyof typeof catIcons
                                    ] || Receipt;
                                  return (
                                    <div className="expense-row" key={e.id}>
                                      <span
                                        className={`category-icon category-${CATEGORIES.indexOf(e.category as (typeof CATEGORIES)[number])}`}
                                      >
                                        <Icon size={21} />
                                      </span>
                                      <div className="expense-info">
                                        <h3>{e.title}</h3>
                                        <p>
                                          {nameOf(e.payerId)} 垫付<span>·</span>
                                          {e.shares.length} 人均分
                                          <span className="expense-category">
                                            {e.category}
                                          </span>
                                        </p>
                                        <details>
                                          <summary>查看每人分摊</summary>
                                          <div className="share-detail">
                                            {e.shares.map((s) => (
                                              <span key={s.userId}>
                                                {nameOf(s.userId)}
                                                <strong>
                                                  {money(s.amount, currency)}
                                                </strong>
                                              </span>
                                            ))}
                                          </div>
                                        </details>
                                      </div>
                                      <div className="expense-amount">
                                        <strong>
                                          {money(e.amount, currency)}
                                        </strong>
                                        <div className="record-actions">
                                          {!readOnly && (
                                            <>
                                              <button
                                                aria-label={`编辑${e.title}`}
                                                className="icon-button"
                                                onClick={() =>
                                                  openModal("expense", {
                                                    item: e,
                                                  })
                                                }
                                              >
                                                <Pencil size={14} />
                                              </button>
                                              <button
                                                aria-label={`删除${e.title}`}
                                                className="icon-button danger-text"
                                                onClick={() =>
                                                  confirmDelete(
                                                    "expenses",
                                                    e.id,
                                                  )
                                                }
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          ),
                        )}
                      </div>
                    ) : (
                      <Empty
                        title={
                          data.expenses.length
                            ? "没有符合筛选的账单"
                            : "记下旅程的第一笔花费"
                        }
                        detail={
                          data.expenses.length
                            ? "试试其他分类、成员或日期。"
                            : "先邀请同行成员，再记录大家一起消费的支出。"
                        }
                        action={
                          !readOnly && (
                            <button
                              className="button secondary"
                              onClick={() => openModal("expense")}
                            >
                              <Plus size={16} />
                              记一笔
                            </button>
                          )
                        }
                      />
                    )}
                  </section>
                  <aside className="insights">
                    <section className="panel">
                      <div className="panel-title">
                        <h2>钱都花在哪儿了？</h2>
                        <span className="tiny muted">分类占比</span>
                      </div>
                      {categories.length ? (
                        <>
                          <div className="spending-bar">
                            {categories.map((c) => (
                              <span
                                key={c.label}
                                className={`category-fill-${CATEGORIES.indexOf(c.label)}`}
                                style={{
                                  width: `${(c.amount / data.trip.total) * 100}%`,
                                }}
                              />
                            ))}
                          </div>
                          <div className="category-list">
                            {categories.map((c) => (
                              <div key={c.label}>
                                <span>
                                  <i
                                    className={`category-fill-${CATEGORIES.indexOf(c.label)}`}
                                  />
                                  {c.label}
                                </span>
                                <strong>
                                  {money(c.amount, currency)}
                                  <small>
                                    {Math.round(
                                      (c.amount / data.trip.total) * 100,
                                    )}
                                    %
                                  </small>
                                </strong>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="muted panel-note">
                          记账后，在这里查看旅行花费构成。
                        </p>
                      )}
                    </section>
                    <section className="panel member-summary">
                      <div className="panel-title">
                        <h2>同行的我们</h2>
                        <button
                          className="icon-button"
                          onClick={() => setView("members")}
                          aria-label="查看同行成员"
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </div>
                      {data.members.map((m, i) => (
                        <div className="member-mini" key={m.id}>
                          <Avatar name={m.name} index={i} small />
                          <span>
                            {m.name}
                            {m.id === me?.id && <small>我</small>}
                          </span>
                          <strong>
                            {money(m.paid, currency)}
                            <small>已垫付</small>
                          </strong>
                        </div>
                      ))}
                    </section>
                    <div className="tip-card">
                      <BookOpen size={21} />
                      <div>
                        <strong>旅行小贴士</strong>
                        <p>
                          不是每笔花费都需要全员参与。记账时，勾选实际消费的同行者就好。
                        </p>
                      </div>
                    </div>
                  </aside>
                </div>
              ) : view === "settlement" ? (
                <div className="ledger-columns">
                  <section className="panel">
                    <div className="panel-title">
                      <div>
                        <h2>这样转账，就算清了</h2>
                        <p>根据垫付、分摊和实际还款自动计算</p>
                      </div>
                      <ShieldCheck size={21} className="teal" />
                    </div>
                    {data.transfers.length ? (
                      <div className="transfer-list">
                        {data.transfers.map((t, i) => (
                          <div
                            className="transfer-row"
                            key={`${t.fromId}-${t.toId}`}
                          >
                            <div className="transfer-people">
                              <Avatar name={nameOf(t.fromId)} index={i + 1} />
                              <strong>{nameOf(t.fromId)}</strong>
                              <ArrowRight size={19} className="muted" />
                              <Avatar name={nameOf(t.toId)} />
                              <strong>{nameOf(t.toId)}</strong>
                            </div>
                            <div className="transfer-payment">
                              <strong>{money(t.amount, currency)}</strong>
                              <button
                                className="button secondary compact"
                                disabled={readOnly}
                                onClick={() =>
                                  openModal("repayment", { item: t })
                                }
                              >
                                登记还款
                                <Check size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="大家的账，已经算清了"
                        detail="余额为零，剩下的就是享受旅程。"
                      />
                    )}
                    <div className="info-strip">
                      <CircleHelp size={17} />
                      这是转账建议。完成实际转账后再登记还款，账本会重新计算。
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-title">
                      <h2>还款记录</h2>
                      <History size={18} className="muted" />
                    </div>
                    {data.repayments.length ? (
                      data.repayments.map((r) => (
                        <div className="repayment-row" key={r.id}>
                          <span className="category-icon category-0">
                            <CheckCheck size={20} />
                          </span>
                          <div>
                            <h3>
                              {nameOf(r.fromId)} → {nameOf(r.toId)}
                            </h3>
                            <p>{r.date}</p>
                          </div>
                          <div className="repayment-amount">
                            <strong>{money(r.amount, currency)}</strong>
                            {!readOnly && (
                              <div className="record-actions">
                                <button
                                  className="icon-button"
                                  aria-label="修改还款"
                                  onClick={() =>
                                    openModal("repayment", { item: r })
                                  }
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  className="icon-button danger-text"
                                  aria-label="撤销还款"
                                  onClick={() =>
                                    confirmDelete("repayments", r.id)
                                  }
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="small-empty">
                        <CreditCard size={26} />
                        <p>还没有实际还款记录</p>
                        <small>每一次结清，都在这里留个记录。</small>
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <section className="panel">
                  <div className="panel-title">
                    <div>
                      <h2>同行的我们</h2>
                      <p>全体成员共享管理账单与还款，余额正数表示待收款。</p>
                    </div>
                    {owner && !readOnly && (
                      <button
                        className="button secondary compact"
                        onClick={() => {
                          setInviteLink("");
                          openModal("invite");
                        }}
                      >
                        <Link2 size={17} />
                        邀请同行
                      </button>
                    )}
                  </div>
                  <div className="member-table">
                    <div className="member-table-head">
                      <span>同行成员</span>
                      <span>已垫付</span>
                      <span>应分摊</span>
                      <span>当前余额</span>
                    </div>
                    {data.members.map((m, i) => (
                      <div className="member-table-row" key={m.id}>
                        <div>
                          <Avatar name={m.name} index={i} />
                          <strong>
                            {m.name}
                            <small>
                              {m.id === data.trip.ownerId
                                ? "创建者"
                                : "同行成员"}
                              {m.id === me?.id ? " · 我" : ""}
                            </small>
                          </strong>
                        </div>
                        <span>{money(m.paid, currency)}</span>
                        <span>{money(m.owed, currency)}</span>
                        <strong
                          className={
                            m.balance > 0
                              ? "teal"
                              : m.balance < 0
                                ? "orange"
                                : "muted"
                          }
                        >
                          {m.balance > 0 ? "+" : m.balance < 0 ? "−" : ""}
                          {money(Math.abs(m.balance), currency)}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div className="info-strip">
                    <ShieldCheck size={18} />
                    只有已加入的成员能访问此账本。邀请链接仅用于加入，不会公开账单。
                  </div>
                </section>
              )}
              {demo && (
                <div className="demo-cta">
                  <div>
                    <Sparkles size={20} />
                    <span>现在，为你们的旅程开一本账。</span>
                  </div>
                  {user ? (
                    <button
                      className="button primary compact"
                      onClick={() => {
                        setDemo(false);
                        setModalError("");
                        setModal({ type: "trip", version: 0 });
                      }}
                    >
                      创建我的旅行
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <a
                      className="button primary compact"
                      href={signin}
                      target="_top"
                    >
                      登录并创建旅行
                      <ArrowRight size={16} />
                    </a>
                  )}
                </div>
              )}
            </>
          ) : !error ? (
            <Empty
              title="选择一个旅行"
              detail="返回我的旅行，打开你的账本。"
              action={
                <button className="button secondary" onClick={showTrips}>
                  我的旅行
                </button>
              }
            />
          ) : null}
          <footer className="footer">
            <span>
              <Wallet size={13} />
              同行账本
            </span>
            <span>
              让每一段同行，都轻松一点。<span className="footer-spark">✧</span>
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="手机导航">
        <button
          className={view === "trips" ? "active" : ""}
          onClick={showTrips}
        >
          <LayoutGrid size={20} />
          旅行
        </button>
        {data && view !== "trips" ? (
          <>
            <button
              className={view === "expenses" ? "active" : ""}
              onClick={() => setView("expenses")}
            >
              <Receipt size={20} />
              账单
            </button>
            <button
              className="mobile-add"
              disabled={readOnly}
              onClick={() => openModal("expense")}
              aria-label="记一笔"
            >
              <Plus size={24} />
            </button>
            <button
              className={view === "settlement" ? "active" : ""}
              onClick={() => setView("settlement")}
            >
              <CreditCard size={20} />
              结算
            </button>
            <button
              className={view === "members" ? "active" : ""}
              onClick={() => setView("members")}
            >
              <Users size={20} />
              成员
            </button>
          </>
        ) : (
          <>
            <button onClick={showDemo}>
              <BookOpen size={20} />
              示例
            </button>
            {user ? (
              <button onClick={() => openModal("trip")}>
                <Plus size={20} />
                新旅行
              </button>
            ) : (
              <a href={signin} target="_top">
                <Users size={20} />
                登录
              </a>
            )}
          </>
        )}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {toast}
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal.type === "trip"
              ? modal.editTrip
                ? "旅行设置"
                : "开启一段新旅程"
              : modal.type === "expense"
                ? formExpense
                  ? "编辑这笔支出"
                  : "记下这笔花费"
                : modal.type === "repayment"
                  ? formRepayment && "id" in formRepayment
                    ? "修改还款记录"
                    : "登记实际还款"
                  : modal.type === "invite"
                    ? "邀请朋友，一起记账"
                    : modal.title || "确认操作"
          }
          close={closeModal}
          busy={busy}
        >
          {modalError && (
            <div className="alert modal-alert" role="alert">
              {modalError}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  try {
                    const latest = await api<Snapshot>("trips/" + selected);
                    setSnapshot(latest);
                    setModal((m) =>
                      m ? { ...m, version: latest.trip.version } : null,
                    );
                    retryRequest.current = null;
                    setModalError("");
                  } catch (e) {
                    setModalError((e as Error).message);
                  }
                }}
              >
                刷新账本
              </button>
            </div>
          )}
          {(modal.type === "trip" ||
            modal.type === "expense" ||
            modal.type === "repayment") && (
            <form onSubmit={saveForm}>
              {modal.type === "trip" ? (
                <>
                  <p className="form-intro">
                    给这段旅程一个名字，其他的我们一起慢慢记。
                  </p>
                  <label>
                    旅行名称
                    <input
                      name="name"
                      maxLength={60}
                      required
                      placeholder="例如：去大理，过几天慢生活"
                      defaultValue={tripEdit?.name}
                    />
                  </label>
                  <label>
                    目的地
                    <input
                      name="destination"
                      required
                      maxLength={60}
                      placeholder="例如：云南 · 大理"
                      defaultValue={tripEdit?.destination}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      开始日期
                      <input
                        name="startDate"
                        type="date"
                        required
                        defaultValue={tripEdit?.startDate || today()}
                      />
                    </label>
                    <label>
                      结束日期
                      <input
                        name="endDate"
                        type="date"
                        required
                        defaultValue={tripEdit?.endDate || today()}
                      />
                    </label>
                  </div>
                  <label>
                    结算币种
                    <select
                      name="currency"
                      defaultValue={tripEdit?.currency || "CNY"}
                      disabled={tripEdit?.currencyLocked}
                    >
                      {Object.entries(CURRENCIES).map(([id, c]) => (
                        <option value={id} key={id}>
                          {id} · {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="form-hint">
                    {tripEdit?.currencyLocked
                      ? "已录入支出，币种已锁定。"
                      : "每趟旅行使用一种币种，录入首笔支出后锁定。"}
                  </p>
                  {tripEdit && owner && (
                    <button
                      type="button"
                      disabled={busy}
                      className="archive-button"
                      onClick={() => {
                        const version = modal.version;
                        setModal({
                          type: "confirm",
                          version,
                          title: tripEdit.archived
                            ? "恢复这段旅行？"
                            : "归档这段旅行？",
                          description: tripEdit.archived
                            ? "恢复后，所有成员可以继续记账和登记还款。"
                            : "归档后，所有成员仍可查看账本，但不能修改。你可以随时恢复。",
                          action: async () => {
                            await mutation(`trips/${selected}`, "PATCH", {
                              archived: !tripEdit.archived,
                            });
                            await refresh(selected);
                            setToast(
                              tripEdit.archived ? "旅行已恢复" : "旅行已归档",
                            );
                          },
                        });
                      }}
                    >
                      <History size={16} />
                      {tripEdit.archived ? "恢复旅行" : "归档旅行"}
                    </button>
                  )}
                </>
              ) : modal.type === "expense" ? (
                <>
                  <label className="amount-label">
                    支出金额 · {currency}
                    <div className="amount-field">
                      <span>{CURRENCIES[currency].symbol}</span>
                      <input
                        name="amount"
                        inputMode={
                          CURRENCIES[currency].digits ? "decimal" : "numeric"
                        }
                        required
                        placeholder="0"
                        autoComplete="off"
                        defaultValue={
                          formExpense
                            ? amountInput(formExpense.amount, currency)
                            : ""
                        }
                      />
                    </div>
                  </label>
                  <label>
                    这笔钱花在哪儿？
                    <input
                      name="title"
                      maxLength={100}
                      required
                      placeholder="例如：海边的第一顿晚餐"
                      defaultValue={formExpense?.title}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      消费日期
                      <input
                        name="date"
                        type="date"
                        required
                        defaultValue={formExpense?.date || today()}
                      />
                    </label>
                    <label>
                      分类
                      <select
                        name="category"
                        defaultValue={formExpense?.category || "餐饮"}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    谁垫付了？
                    <select
                      name="payerId"
                      defaultValue={formExpense?.payerId || user?.userId}
                    >
                      {data?.members.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name}
                          {m.id === user?.userId ? "（我）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="participant-field">
                    <legend>
                      谁参与均分？<span>只勾选实际参与消费的成员</span>
                    </legend>
                    <div className="participant-options">
                      {data?.members.map((m, i) => (
                        <label key={m.id}>
                          <input
                            type="checkbox"
                            name="participants"
                            value={m.id}
                            defaultChecked={
                              formExpense
                                ? formExpense.shares.some(
                                    (s) => s.userId === m.id,
                                  )
                                : true
                            }
                          />
                          <Avatar name={m.name} index={i} small />
                          <span>{m.name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="form-hint">
                    均分尾差会分配到成员，保存后可查看每人精确金额。
                  </p>
                </>
              ) : (
                <>
                  <div className="info-strip">
                    <CircleHelp size={17} />
                    请在实际转账完成后登记，不会自动扣款。
                  </div>
                  <div className="form-grid">
                    <label>
                      付款人
                      <select
                        name="fromId"
                        defaultValue={formRepayment?.fromId || user?.userId}
                      >
                        {data?.members.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      收款人
                      <select
                        name="toId"
                        defaultValue={
                          formRepayment?.toId ||
                          data?.members.find((m) => m.id !== user?.userId)?.id
                        }
                      >
                        {data?.members.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="amount-label">
                    还款金额 · {currency}
                    <div className="amount-field">
                      <span>{CURRENCIES[currency].symbol}</span>
                      <input
                        name="amount"
                        inputMode="decimal"
                        required
                        placeholder="0"
                        defaultValue={
                          formRepayment
                            ? amountInput(formRepayment.amount, currency)
                            : ""
                        }
                      />
                    </div>
                  </label>
                  <label>
                    还款日期
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={
                        formRepayment && "date" in formRepayment
                          ? String(formRepayment.date)
                          : today()
                      }
                    />
                  </label>
                </>
              )}
              <div className="modal-footer">
                <button
                  type="button"
                  className="button ghost"
                  disabled={busy}
                  onClick={closeModal}
                >
                  取消
                </button>
                <button
                  className="button primary"
                  type="submit"
                  disabled={
                    busy || Boolean(modal.editTrip && tripEdit?.archived)
                  }
                >
                  {busy
                    ? "正在保存…"
                    : modal.type === "trip" && !modal.editTrip
                      ? "创建旅行"
                      : "保存记录"}
                  {!busy && <Check size={17} />}
                </button>
              </div>
            </form>
          )}
          {modal.type === "invite" && (
            <>
              <p className="form-intro">
                把链接发给朋友。对方使用 ChatGPT
                登录并确认加入后，就可以一起记账了。
              </p>
              <div className="invite-illustration">
                <Avatar name="你" />
                <Link2 size={26} />
                <Avatar name="友" index={1} />
                <Avatar name="伴" index={2} />
              </div>
              {inviteLink ? (
                <>
                  <label>
                    邀请链接
                    <input
                      readOnly
                      value={inviteLink}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <p className="form-hint">
                    有效期至{" "}
                    {new Date(inviteExpiry).toLocaleString("zh-CN", {
                      timeZone: "Asia/Hong_Kong",
                    })}
                    。新链接生成后，旧链接失效。
                  </p>
                  <button
                    className="button primary full-width"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(inviteLink)
                        .then(() => setToast("邀请链接已复制"))
                        .catch(() =>
                          setModalError("无法自动复制，请选中链接手动复制"),
                        )
                    }
                  >
                    <Copy size={17} />
                    复制邀请链接
                  </button>
                </>
              ) : (
                <div className="info-strip">
                  <ShieldCheck size={18} />
                  链接仅用于加入旅行，有效期七天。生成新链接会使旧链接失效。
                </div>
              )}
              <div className="modal-footer">
                <button
                  className="button ghost"
                  onClick={closeModal}
                  disabled={busy}
                >
                  关闭
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (submitting.current) return;
                    submitting.current = true;
                    setBusy(true);
                    setModalError("");
                    try {
                      const r = await mutation(
                        `trips/${selected}/invite`,
                        "POST",
                        {},
                      );
                      setInviteLink(
                        `${window.location.origin}/join/${r.token}`,
                      );
                      setInviteExpiry(r.expiresAt);
                      await refresh(selected);
                      const latest = await api<Snapshot>("trips/" + selected);
                      setModal((m) =>
                        m ? { ...m, version: latest.trip.version } : null,
                      );
                      retryRequest.current = null;
                    } catch (e) {
                      setModalError((e as Error).message);
                    } finally {
                      submitting.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? "正在生成…"
                    : inviteLink
                      ? "重置邀请链接"
                      : "生成邀请链接"}
                  <Link2 size={17} />
                </button>
              </div>
            </>
          )}
          {modal.type === "confirm" && (
            <>
              <p className="form-intro">{modal.description}</p>
              <div className="modal-footer">
                <button
                  className="button ghost"
                  onClick={closeModal}
                  disabled={busy}
                >
                  取消
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await modal.action?.();
                    })
                  }
                >
                  {busy ? "正在处理…" : "确认"}
                  <Check size={17} />
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
