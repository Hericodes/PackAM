"use client";

import Link from "next/link";
import { useCartExperience } from "../cart/CartExperience";
import { Icon } from "../ui/Icon";

/** The single cart entry point in the navbar; /cart sends students to checkout or the shop. */
export function StudentCartButton() {
  const { count } = useCartExperience();

  return (
    <Link
      href="/cart"
      data-tip="Cart"
      aria-label={count ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart, empty"}
      className="pk-tip relative inline-flex h-11 w-11 items-center justify-center rounded-full text-black/75 transition hover:bg-[#fff4c7] hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
    >
      <Icon name="cart" />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#feb80a] px-1 text-[11px] font-black leading-none text-black ring-2 ring-[#fffdf7]">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
