import Link from "next/link";
import { PackAMLogo } from "../brand/PackAMLogo";
import { auth } from "../../auth";
import { NotificationBell } from "../notifications/NotificationBell";

export async function StudentNavbar() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-[#fffdf7]/90 backdrop-blur-xl">
      <div className="packam-container flex h-[72px] items-center justify-between gap-4">
        {/* LOGO */}
        <Link
          href="/"
          aria-label="PackAM home"
          className="shrink-0 transition-transform hover:scale-[1.02]"
        >
          <PackAMLogo width={108} priority />
        </Link>

        {/* DESKTOP NAV */}
        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="/search"
            className="rounded-full px-4 py-2.5 text-sm font-bold text-black/60 transition hover:bg-black/5 hover:text-black"
          >
            Search
          </Link>

          <Link
            href="/orders"
            className="rounded-full px-4 py-2.5 text-sm font-bold text-black/60 transition hover:bg-black/5 hover:text-black"
          >
            Orders
          </Link>
        </nav>

        {/* RIGHT SIDE */}
        <div className="flex items-center gap-2">
          {session?.user && (
            <div className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-black/5">
              <NotificationBell />
            </div>
          )}

          {/* CART / CHECKOUT PLACEHOLDER */}
          <Link
            href="/checkout"
            className="hidden items-center gap-2 rounded-full bg-[#feb80a] px-5 py-3 text-sm font-black text-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:flex"
          >
            <span>🛒</span>
            <span>Checkout</span>
          </Link>

          {/* PROFILE */}
          {session?.user && (
            <Link
              href="/account"
              aria-label="Your account"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-sm font-black transition hover:border-black/20 hover:bg-black/[0.02]"
            >
              {session.user.name?.charAt(0).toUpperCase() ?? "👤"}
            </Link>
          )}
        </div>
      </div>

      {/* MOBILE NAV */}
      <div className="border-t border-black/5 md:hidden">
        <div className="packam-container flex items-center justify-between py-2">
          <Link
            href="/search"
            className="flex-1 py-2 text-center text-sm font-black text-black/60"
          >
            🔍 Search
          </Link>

          <Link
            href="/orders"
            className="flex-1 border-l border-black/5 py-2 text-center text-sm font-black text-black/60"
          >
            📦 Orders
          </Link>

          <Link
            href="/product-requests"
            className="flex-1 border-l border-black/5 py-2 text-center text-sm font-black text-black/60"
          >
            🙏 Requests
          </Link>
        </div>
      </div>
    </header>
  );
}