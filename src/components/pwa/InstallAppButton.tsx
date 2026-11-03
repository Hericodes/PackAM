"use client";

import { Icon } from "../ui/Icon";
import { usePwa } from "./PwaProvider";

/**
 * "Install app" in the top bar. Shown only when this browser can install PackAM right now (the browser offered its
 * install prompt, or this is an iPhone/iPad, which gets the Add to Home Screen guide), and never inside the installed
 * app. In the busier marketplace bar, phones show the icon alone so the bar never overflows.
 */
export function InstallAppButton({ labelOnPhones = false }: { /** Show "Install" next to the icon on phones too (the homepage bar has room). */ labelOnPhones?: boolean }) {
  const { canInstall, install } = usePwa();
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={() => void install()}
      aria-label="Install the PackAM app"
      data-tip="Install the app"
      className="pk-tip inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 text-sm font-black text-black shadow-[0_1px_2px_rgba(8,8,8,0.05)] transition hover:border-black/25 hover:bg-[#fff4c7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:px-3.5"
    >
      <Icon name="smartphone" className="h-[18px] w-[18px]" />
      <span className={labelOnPhones ? "sm:hidden" : "hidden"}>Install</span>
      <span className="hidden sm:inline">Install app</span>
    </button>
  );
}
