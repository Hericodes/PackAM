import { formatCoordinates } from "../../lib/delivery-location";
import { Icon } from "../ui/Icon";

type DeliveryPoint = { latitude: number; longitude: number; mapsUrl: string } | null | undefined;

/** Where the runner is going: the written campus location first, GPS pin second. */
export function DeliveryDestination({ label, address, instructions, point }: { label: string; address?: string; instructions?: string | null; point: DeliveryPoint }) {
  return (
    <section className="mt-4 rounded-2xl border border-[#feb80a]/35 bg-gradient-to-br from-[#fff4c7] to-[#fffaf0] p-4" aria-labelledby="delivery-destination-heading">
      <h2 id="delivery-destination-heading" className="flex items-center gap-2 text-sm font-black">
        <Icon name="mapPin" className="h-4 w-4 text-[#875a00]" /> Deliver to
      </h2>
      <p className="mt-2 text-base font-black leading-6">{label}</p>
      {address && <p className="mt-0.5 break-words text-sm leading-5">{address}</p>}
      {instructions && <p className="mt-2 break-words text-sm leading-5"><strong>Instructions:</strong> {instructions}</p>}
      {point ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-black/5 pt-3">
          <p className="text-xs text-black/65">GPS pin from the student’s phone: <span className="font-mono font-bold text-black">{formatCoordinates(point)}</span></p>
          <a href={point.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-black px-4 text-xs font-black text-white transition hover:bg-[#262626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
            Open in Maps <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </a>
        </div>
      ) : (
        <p className="mt-3 border-t border-black/5 pt-3 text-xs text-black/60">No GPS pin for this order. Use the written location and call the student if needed.</p>
      )}
    </section>
  );
}
