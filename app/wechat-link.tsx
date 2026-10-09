"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCheck, Copy, Link2, Smartphone, X } from "lucide-react";
export default function WechatLink() {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [status, setStatus] = useState<{
    boundCount: number;
    gatewayConfigured: boolean;
  } | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(
    null,
  );
  const dialog = useRef<HTMLDivElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    setError("");
    setCode(null);
    setStatus(null);
    const refresh = async () => {
      try {
        const response = await fetch("/api/account/wechat", {
          cache: "no-store",
        });
        const data = (await response.json()) as any;
        if (!response.ok) throw new Error(data.error);
        setStatus(data);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input",
      ) || []),
    ];
    focusables()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const elements = focusables(),
          first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
      opener.current?.focus();
    };
  }, [open]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/link-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await response.json()) as any;
      if (!response.ok) throw new Error(data.error);
      setCode(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={opener}
        className="button secondary compact"
        onClick={() => setOpen(true)}
        aria-label="绑定微信小程序"
      >
        <Smartphone size={16} />
        <span className="wechat-button-label">微信同步</span>
      </button>
      {open && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wechat-link-title"
            ref={dialog}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">同一段旅程，同一本账</span>
                <h2 id="wechat-link-title">绑定微信小程序</h2>
              </div>
              <button
                className="icon-button"
                aria-label="关闭微信绑定"
                onClick={() => setOpen(false)}
              >
                <X size={21} />
              </button>
            </div>
            <p className="form-intro">
              在小程序「我的 →
              绑定网页版账号」中输入绑定码，之后就能在微信和网页版继续记同一本账。
            </p>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            {status?.boundCount ? (
              <div className="info-strip">
                <CheckCheck size={20} />
                已绑定 {status.boundCount} 个微信身份，旅行账本已共享。
              </div>
            ) : null}
            {status && !status.gatewayConfigured && (
              <div className="info-strip">
                <Smartphone size={20} />
                微信同步尚未启用，暂时不能绑定。小程序开发版本可以先使用演示模式。
              </div>
            )}
            {code && (
              <>
                <div className="wechat-code">{code.code}</div>
                <p className="form-hint">
                  有效期至{" "}
                  {new Date(code.expiresAt).toLocaleTimeString("zh-CN", {
                    timeZone: "Asia/Hong_Kong",
                  })}
                  ，仅可使用一次。生成新码会使旧码失效。
                </p>
                <div className="info-strip">
                  <Link2 size={19} />
                  绑定后会合并微信账号已有的旅行、成员身份和账单。请只在你自己的微信账号中使用此码。
                </div>
              </>
            )}
            <div className="modal-footer">
              {code && (
                <button
                  className="button secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(code.code)
                      .catch(() => setError("无法自动复制，请手动复制绑定码"))
                  }
                >
                  <Copy size={16} />
                  复制绑定码
                </button>
              )}
              <button
                className="button primary"
                disabled={busy || !status?.gatewayConfigured}
                onClick={generate}
              >
                {busy ? "正在生成…" : code ? "重新生成" : "生成绑定码"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
