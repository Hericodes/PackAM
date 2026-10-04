"use client";

import Link from "next/link";
import { useCartExperience } from "../cart/CartExperience";

export function StudentCartButton() {
  const { count, subtotal } = useCartExperience();

  if (count < 1) return null;

  const formattedSubtotal = subtotal.toLocaleString();

  return (
    <Link
      href="/checkout"
      aria-label={`Checkout, ${count} ${count === 1 ? "item" : "items"}, subtotal ₦${formattedSubtotal}`}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#feb80a] text-sm font-bold text-black shadow-sm transition hover:-translate-y-0.5 hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto sm:gap-2 sm:px-3.5"
    >
      <span aria-hidden="true">🛒</span>
      <span className="hidden sm:inline">Checkout · ₦{formattedSubtotal}</span>
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1 text-xs font-bold leading-none text-white sm:static sm:h-5 sm:min-w-5 sm:bg-black/10 sm:text-black">
        {count}
      </span>
    </Link>
  );
}
