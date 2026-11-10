import type { Metadata } from "next";
import Link from "next/link";
import { PackAMLogo } from "../../../components/brand/PackAMLogo";
import { UnsubscribeActions } from "../../../components/account/UnsubscribeActions";
import { EMAIL_SCOPE_LABELS } from "../../../lib/email/campaign-rules";
import { verifyUnsubscribeToken } from "../../../lib/email/unsubscribe";

export const metadata: Metadata = { title: "Email settings", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ t?: string | string[] }> };

/** Where an automated email's "Stop …" link lands. No sign-in: the signed link names the student and the kind. */
export default async function UnsubscribePage({ searchParams }: Props) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";
  const verified = verifyUnsubscribeToken(process.env.AUTH_SECRET, token);
  const noun = verified ? EMAIL_SCOPE_LABELS[verified.scope].noun : null;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto flex min-h-[80svh] max-w-md flex-col justify-center">
        <Link href="/" aria-label="PackAM home" className="mb-8 self-start"><PackAMLogo width={84} /></Link>
        {verified && noun ? (
          <section className="pk-card p-6">
            <h1 className="text-2xl font-black tracking-tight">Stop {noun}?</h1>
            <p className="mt-2 text-sm leading-6 text-black/65">You can stop just these, or every email PackAM sends you automatically. Emails about your account’s security, like password resets, still come when you ask for them.</p>
            <UnsubscribeActions token={token} noun={noun} />
          </section>
        ) : (
          <section className="pk-card p-6">
            <h1 className="text-2xl font-black tracking-tight">This link doesn’t work</h1>
            <p className="mt-2 text-sm leading-6 text-black/65">It may be incomplete or old. Sign in and choose which emails you get in Settings.</p>
            <Link href="/settings#emails" className="pk-btn pk-btn-primary mt-5">Open email settings</Link>
          </section>
        )}
      </div>
    </main>
  );
}
