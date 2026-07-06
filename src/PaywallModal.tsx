import { ArrowRight, X } from "lucide-react";

export type PaywallInfo = {
  title: string;
  message: string;
  options?: string[];
  primaryHref?: string;
  primaryLabel?: string;
};

export function paywallFromError(error: unknown): PaywallInfo | null {
  const candidate = error as { status?: number; code?: string; message?: string; details?: unknown };
  if (candidate.status !== 402) return null;
  const details = (candidate.details ?? {}) as Record<string, unknown>;
  return {
    title: candidate.code === "PREMIUM_INTRADAY_REQUIRED" ? "This test needs premium intraday data" : "Upgrade required",
    message: candidate.message ?? "This action is not included in your current plan.",
    options: Array.isArray(details.options) ? details.options.map(String) : ["Upgrade your plan", "Use a smaller/free-data test", "Upload your own data if available"],
    primaryHref: "#/account",
    primaryLabel: "View plans"
  };
}

export function PaywallModal({ info, onClose }: { info: PaywallInfo; onClose: () => void }) {
  return <div className="paywall-backdrop" role="dialog" aria-modal="true" aria-label={info.title} onMouseDown={onClose}>
    <section className="paywall-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="paywall-x" onClick={onClose} aria-label="Close upgrade notice"><X size={15} /></button>
      <p>PLAN GATE</p>
      <h2>{info.title}</h2>
      <span>{info.message}</span>
      {info.options?.length ? <ul>{info.options.map((option) => <li key={option}>{option}</li>)}</ul> : null}
      <div>
        <a href={info.primaryHref ?? "#/account"}>{info.primaryLabel ?? "View plans"} <ArrowRight size={13} /></a>
        <button onClick={onClose}>Keep editing</button>
      </div>
    </section>
  </div>;
}
