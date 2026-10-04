import Link from "next/link";
import { auth } from "../../auth";
import { NotificationBell } from "../notifications/NotificationBell";
import { PackAMLogo } from "../brand/PackAMLogo";
import { StudentCartButton } from "./StudentCartButton";
import { StudentProfileMenu } from "./StudentProfileMenu";

export async function StudentNavbar() {
  const session = await auth();
  const user = session?.user;
  const displayName = user?.name?.trim() || user?.email?.trim() || "Student";

  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-[#fffdf7]/95 backdrop-blur-md">
      <div className="packam-container flex h-[72px] items-center justify-between gap-2 sm:gap-4">
        <Link
          href="/"
          aria-label="PackAM home"
          className="shrink-0 rounded-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
        >
          <PackAMLogo width={84} priority />
        </Link>

        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-1 md:flex"
        >
          <Link
            href="/search"
            className="inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-black/70 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Search
          </Link>
          <Link
            href="/orders"
            className="inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-black/70 transition hover:bg-black/5 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Orders
          </Link>
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {user && <NotificationBell />}
          <StudentCartButton />
          {user && (
            <StudentProfileMenu
              displayName={displayName}
              initial={displayName.charAt(0).toUpperCase()}
            />
          )}
        </div>
      </div>
    </header>
  );
}
