"use client";

import { Icon } from "../ui/Icon";
import { usePwa } from "./PwaProvider";

/**
 * The app button in the top bar, shown in the browser (never inside the installed app). Not installed: "Install"
 * opens the browser's install prompt or the iPhone guide. Already installed on this device: "Open app" explains
 * how to open it from the home screen (no web page can launch an installed app), so nobody installs it twice.
 * When the browser can't say either way, it explains the browser's own install menu. In the busier marketplace bar,
 * phones show the icon alone so the bar never overflows.
 */
export function InstallAppButton({ labelOnPhones = false }: { /** Show the label on phones too (the homepage bar has room). */ labelOnPhones?: boolean }) {
  const { appButton, openAppButton } = usePwa();
  if (!appButton) return null;
  const installed = appButton === "installed";
  const short = installed ? "Open app" : "Install";
  return (
    <button
      type="button"
      onClick={openAppButton}
      aria-label={installed ? "PackAM is installed: how to open the app" : "Install the PackAM app"}
      data-tip={installed ? "Open the PackAM app" : "Install the app"}
      className={`pk-tip inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border px-2.5 text-sm font-black text-black shadow-[0_1px_2px_rgba(8,8,8,0.05)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:px-3.5 ${installed ? "border-[#16803c]/25 bg-[#e9f8ee] hover:border-[#16803c]/50" : "border-black/10 bg-white hover:border-black/25 hover:bg-[#fff4c7]"}`}
    >
      <Icon name={installed ? "check" : "smartphone"} className="h-[18px] w-[18px]" />
      <span className={labelOnPhones ? "sm:hidden" : "hidden"}>{short}</span>
      <span className="hidden sm:inline">{installed ? "Open app" : "Install app"}</span>
    </button>
  );
}
