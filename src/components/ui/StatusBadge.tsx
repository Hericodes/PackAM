import type { StatusTone } from "../../lib/ops-status";

const TONES: Record<StatusTone, string> = {
  neutral: "bg-black/6 text-black/70",
  info: "bg-[#e8f3fb] text-[#1769aa]",
  progress: "bg-[#fff4c7] text-[#6b4700]",
  success: "bg-[#e9f8ee] text-[#16803c]",
  warning: "bg-[#fff3d6] text-[#a15c00]",
  danger: "bg-[#ffe9e7] text-[#c92d24]",
};

/** Small status pill for operations lists. The label carries the meaning; colour only supports it. */
export function StatusBadge({ label, tone = "neutral", className = "" }: { label: string; tone?: StatusTone; className?: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-black ${TONES[tone]} ${className}`}>{label}</span>;
}
