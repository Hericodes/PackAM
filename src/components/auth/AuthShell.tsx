import Link from "next/link";
import type { ReactNode } from "react";
import { PackAMLogo } from "../brand/PackAMLogo";

type AuthShellProps = {
  /** The page's one heading (h1). */
  title: ReactNode;
  subtitle?: ReactNode;
  /** A short line above the title, e.g. "Account recovery". */
  eyebrow?: ReactNode;
  /** The form or message, shown on a white card. */
  children: ReactNode;
  /** A line or two under the card, e.g. "Don’t have an account? Create one". Style links with authLinkClass. */
  footer?: ReactNode;
};

/** Text links on auth pages: bold, underlined, with a 44px-tall tap area. */
export const authLinkClass = "inline-flex min-h-11 items-center font-bold text-black underline decoration-black/30 underline-offset-4 transition-colors hover:decoration-black";

/**
 * The frame every sign-in, sign-up, recovery and verification page shares: the PackAM logo (a link home), a
 * short heading, the content on a white card, and an optional footer. Mobile-first: one centred column with
 * 16px gutters that stay clear of a notch, vertically centred when it fits on screen. Works in server and
 * client components.
 *
 * pk-theme-auth on <main> switches the page background to the auth glow (globals.css). The logo box is a
 * square marked data-auth-logo, so the success animation can measure it and glide the same logo to the
 * centre (pack-sources.ts).
 */
export function AuthShell({ title, subtitle, eyebrow, children, footer }: AuthShellProps) {
  return (
    <main className="pk-theme-auth pk-safe-x flex min-h-svh flex-col pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:pt-12 sm:pb-12">
      <div className="mx-auto my-auto w-full max-w-md">
        <header className="flex flex-col items-center text-center">
          <Link href="/" aria-label="PackAM home" className="rounded-[18px]">
            {/* PackAMLogo hard-codes h-auto w-auto; h-full w-full win in the cascade and fill this 1:1 box. */}
            <span data-auth-logo className="block aspect-square w-[104px] sm:w-[120px]">
              <PackAMLogo width={120} priority className="h-full w-full" />
            </span>
          </Link>
          {/* The logo's artwork has transparent space below it, so the text sits close. */}
          <div className="mt-1">
            {eyebrow && <p className="pk-eyebrow mb-1.5">{eyebrow}</p>}
            <h1 className="text-balance text-[1.75rem] font-black leading-[1.15] tracking-[-0.03em] sm:text-[2rem]">{title}</h1>
            {subtitle && <p className="mx-auto mt-2 max-w-[24rem] text-pretty text-[0.9375rem] leading-6 text-black/70">{subtitle}</p>}
          </div>
        </header>

        <div className="pk-card mt-6 p-5 shadow-[0_1px_2px_rgba(8,8,8,0.04),0_18px_40px_-24px_rgba(8,8,8,0.18)] sm:mt-7 sm:p-7">
          {children}
        </div>

        {footer && <div className="mt-5 text-center text-sm leading-6 text-black/70">{footer}</div>}
      </div>
    </main>
  );
}
