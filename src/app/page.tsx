import Link from "next/link";
import { GatewayHeader } from "../components/student/GatewayHeader";
import { Icon, type IconName } from "../components/ui/Icon";

type Service = {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  /** Live services link into their existing flow; a service without an href is shown as coming soon. */
  href?: string;
  featured?: boolean;
};

const SERVICES: Service[] = [
  { id: "order", icon: "shop", title: "Order Stuff", body: "Food, drinks, essentials and more.", href: "/search", featured: true },
  { id: "verification", icon: "shieldCheck", title: "Student Verification", body: "Your student verification needs." },
  { id: "printing", icon: "printer", title: "Printing", body: "Print documents without the stress.", href: "/printing" },
];

function ServiceCard({ service }: { service: Service }) {
  const titleId = `service-${service.id}`;
  const content = (
    <>
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-14 sm:w-14 ${
          service.featured ? "bg-black text-[#feb80a]" : "bg-[#fff4c7] text-[#875a00]"
        }`}
      >
        <Icon name={service.icon} className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-lg font-black tracking-[-0.01em] sm:text-xl">{service.title}</h2>
        <p className={`mt-0.5 text-sm leading-6 sm:text-[0.9375rem] ${service.featured ? "text-black/75" : "text-black/60"}`}>{service.body}</p>
        {!service.href && (
          <p id={`${titleId}-status`} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#fff4c7] px-2.5 py-1 text-[0.6875rem] font-black uppercase tracking-[0.1em] text-[#875a00]">
            <Icon name="clock" className="h-3.5 w-3.5" strokeWidth={2.2} /> Coming soon
          </p>
        )}
      </div>
      {service.href && (
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${
            service.featured ? "bg-black/10" : "bg-black/5"
          }`}
        >
          <Icon name="arrowUpRight" className="h-5 w-5" />
        </span>
      )}
    </>
  );

  const base = "flex items-center gap-4 rounded-[22px] p-4 sm:gap-5 sm:p-5";

  if (!service.href) {
    // Informational only: no link, button or form, so nobody can enter an unfinished workflow.
    return (
      <div aria-labelledby={titleId} aria-describedby={`${titleId}-status`} className={`${base} border border-black/8 bg-white/70`}>
        {content}
      </div>
    );
  }

  return (
    <Link
      href={service.href}
      aria-labelledby={titleId}
      className={`group ${base} transition-[box-shadow,border-color] duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-black ${
        service.featured
          ? "bg-[#feb80a] shadow-[0_18px_40px_-26px_rgba(135,90,0,0.8)] hover:shadow-[0_22px_44px_-22px_rgba(135,90,0,0.9)]"
          : "border border-black/8 bg-white shadow-[0_1px_2px_rgba(8,8,8,0.04)] hover:border-black/20 hover:shadow-(--shadow-soft)"
      }`}
    >
      {content}
    </Link>
  );
}

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col text-black">
      <GatewayHeader />

      <main className="packam-container flex flex-1 flex-col justify-center py-10 sm:py-14">
        <div className="mx-auto w-full max-w-2xl">
          <div className="text-center">
            <h1 className="text-balance text-[clamp(1.75rem,6vw,2.5rem)] font-black leading-[1.1] tracking-[-0.03em]">Wetin dey sup? <span aria-hidden="true">👀</span></h1>
            <p className="pk-muted mt-2 text-base sm:text-lg">Pick wetin you need — we go handle the waka.</p>
          </div>

          <ul className="mt-8 grid gap-3 sm:mt-10 sm:gap-4" aria-label="PackAM services">
            {SERVICES.map((service) => (
              <li key={service.id}>
                <ServiceCard service={service} />
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
