import Link from "next/link";
import { auth } from "../../auth";
import { PackAMLogo } from "../brand/PackAMLogo";
import { Icon } from "../ui/Icon";
import { navItemsFor, type NavRole } from "./nav-items";
import { menuUserFor } from "./StudentNavbar";
import { StudentMobileMenu } from "./StudentMobileMenu";
import { StudentProfileMenu } from "./StudentProfileMenu";

/** Services are chosen from the gateway cards themselves, so the header leaves them out. */
const SERVICE_HREFS = new Set(["/search", "/printing"]);

/**
 * Minimal header for the service-selection homepage: logo plus account access only.
 * Signed-in users keep their account destinations (orders, runner hub, operations) via the existing menus.
 */
export async function GatewayHeader() {
  const session = await auth();
  const user = session?.user;
  const role: NavRole = user?.role ?? null;
  const { primary, secondary } = navItemsFor(role);
  const accountPrimary = primary.filter((item) => !SERVICE_HREFS.has(item.href));
  const menuUser = menuUserFor(user);

  return (
    <header className="border-b border-black/[0.06] bg-[#fffdf7]/85 backdrop-blur-md">
      <div className="packam-container flex h-16 items-center justify-between gap-2 md:h-[72px]">
        <Link
          href="/"
          aria-label="PackAM home"
          className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
        >
          <PackAMLogo width={76} priority className="md:w-[84px]" />
        </Link>

        {menuUser ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <StudentProfileMenu
              displayName={menuUser.displayName}
              initial={menuUser.initial}
              roleLabel={menuUser.roleLabel}
              items={[...accountPrimary, ...secondary]}
            />
            <StudentMobileMenu user={menuUser} primary={accountPrimary} secondary={secondary} />
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <Link href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-bold transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:px-3.5">
              <Icon name="user" className="hidden h-[18px] w-[18px] sm:block" />
              Log in
            </Link>
            <Link href="/register" className="inline-flex min-h-11 items-center rounded-full bg-[#feb80a] px-4 text-sm font-black text-black shadow-[0_4px_14px_-6px_rgba(229,165,0,0.8)] transition hover:bg-[#e5a500] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
