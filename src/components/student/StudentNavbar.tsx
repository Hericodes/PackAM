import Link from "next/link";
import { auth } from "../../auth";
import { NotificationBell } from "../notifications/NotificationBell";
import { PackAMLogo } from "../brand/PackAMLogo";
import { Icon } from "../ui/Icon";
import { navItemsFor, type NavRole } from "./nav-items";
import { StudentCartButton } from "./StudentCartButton";
import { StudentMobileMenu } from "./StudentMobileMenu";
import { StudentNavLinks } from "./StudentNavLinks";
import { StudentProfileMenu } from "./StudentProfileMenu";

const ROLE_LABELS = { STUDENT: "Student account", RUNNER: "Runner account", ADMIN: "Operations" } as const;

type SessionUser = { name?: string | null; email?: string | null; role?: NavRole } | undefined;

/** Shared by every header that shows the profile / mobile menus, so they label the user the same way. */
export function menuUserFor(user: SessionUser) {
  if (!user) return null;
  const displayName = user.name?.trim() || user.email?.trim() || "Student";
  return { displayName, initial: displayName.charAt(0).toUpperCase(), roleLabel: user.role ? ROLE_LABELS[user.role] : "Signed in" };
}

export async function StudentNavbar() {
  const session = await auth();
  const user = session?.user;
  const role: NavRole = user?.role ?? null;
  const { primary, secondary } = navItemsFor(role);
  const menuUser = menuUserFor(user);

  return (
    <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[#fffdf7]/85 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_6px_24px_-18px_rgba(135,90,0,0.35)] backdrop-blur-md">
      <div className="packam-container flex h-14 items-center justify-between gap-2 sm:h-16 sm:gap-4 md:h-[72px]">
        <Link
          href="/"
          aria-label="PackAM home"
          className="shrink-0 rounded-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
        >
          <PackAMLogo width={76} priority className="max-sm:w-[68px] md:w-[84px]" />
        </Link>

        <StudentNavLinks items={primary} />

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <form action="/search" role="search" className="relative hidden xl:block">
            <label htmlFor="nav-search" className="sr-only">Search PackAM</label>
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/45" />
            <input id="nav-search" name="q" type="search" placeholder="Search PackAM" className="h-11 w-52 rounded-full border border-black/10 bg-white/80 pl-10 pr-4 text-sm outline-none transition placeholder:text-black/50 focus:w-64 focus:border-black focus:bg-white focus:shadow-[0_0_0_3px_rgba(254,184,10,0.45)]" />
          </form>
          <Link
            href="/search"
            data-tip="Search"
            aria-label="Search"
            className="pk-tip inline-flex h-11 w-11 items-center justify-center rounded-full text-black/75 transition hover:bg-[#fff4c7] hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black xl:hidden"
          >
            <Icon name="search" />
          </Link>
          {user && <NotificationBell />}
          {role === "STUDENT" && <StudentCartButton />}
          {!user && (
            <div className="hidden items-center gap-1.5 md:flex">
              <Link href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-bold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
                <Icon name="user" className="h-[18px] w-[18px]" />
                Log in
              </Link>
              <Link href="/register" className="inline-flex min-h-11 items-center rounded-full bg-[#feb80a] px-4 text-sm font-black text-black shadow-[0_4px_14px_-6px_rgba(229,165,0,0.8)] transition hover:bg-[#e5a500] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">Sign up</Link>
            </div>
          )}
          {menuUser && <StudentProfileMenu displayName={menuUser.displayName} initial={menuUser.initial} roleLabel={menuUser.roleLabel} items={secondary} />}
          <StudentMobileMenu user={menuUser} primary={primary} secondary={secondary} />
        </div>
      </div>
    </header>
  );
}
