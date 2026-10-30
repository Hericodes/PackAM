"use client";

import { Icon } from "../ui/Icon";
import { usePwa } from "./PwaProvider";

/** "Install the app" for the account menus. Shown only when this browser can install PackAM right now. */
export function InstallAppMenuItem({ onSelect, className = "" }: { onSelect?: () => void; className?: string }) {
  const { canInstall, install } = usePwa();
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={() => { onSelect?.(); void install(); }}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-black/75 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-black ${className}`}
    >
      <Icon name="smartphone" className="h-[18px] w-[18px]" />
      <span className="flex-1">Install the PackAM app</span>
    </button>
  );
}
