"use client";

import { openingPhrase, orderingHoursLabel, type OrderingClock } from "../../lib/ordering-hours";
import { Icon } from "../ui/Icon";
import { useOrderingStatus } from "./useOrderingStatus";

/**
 * A slim strip under the header while ordering is closed (evenings, early mornings and weekends). It says
 * students can keep browsing and filling their cart, and when ordering opens. Renders nothing while open.
 */
export function OrderingHoursNotice({ clock }: { clock: OrderingClock }) {
  const status = useOrderingStatus(clock);
  if (status.open) return null;
  return (
    <div role="status" className="border-b border-[#e8c238]/50 bg-[#fff8df]">
      <div className="packam-container flex items-start gap-2.5 py-2.5 text-sm leading-5 sm:items-center">
        <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-[#875a00] sm:mt-0" />
        <p>
          <span className="font-black">Ordering is closed right now.</span>{" "}
          <span className="text-black/70">We take orders {orderingHoursLabel(clock.hours)}. You fit still browse and fill your cart, then order when we open {openingPhrase(status, clock.hours)}.</span>
        </p>
      </div>
    </div>
  );
}
