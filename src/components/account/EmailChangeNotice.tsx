"use client";

import { useEffect, useRef } from "react";
import { FormAlert } from "../auth/FormAlert";
import { emailChangeNotice, type EmailChangeStatus } from "./account-requests";

/**
 * The result of opening a "confirm your new email" link: /settings?email=changed|invalid|expired|used|taken. It
 * takes focus when the page opens (that result is why the person is here, so screen readers read it first), and
 * the parameter comes out of the address bar so a refresh or a shared link doesn't repeat it.
 */
export function EmailChangeNotice({ status, email }: { status: EmailChangeStatus; email: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const notice = emailChangeNotice(status, email);

  useEffect(() => {
    ref.current?.focus();
    const url = new URL(window.location.href);
    if (!url.searchParams.has("email")) return;
    url.searchParams.delete("email");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <FormAlert ref={ref} tone={notice.tone} title={notice.title} message={notice.message} className="mt-5">
      {notice.tone === "error" && (
        <a href="#email" className="inline-flex min-h-11 items-center underline decoration-black/30 underline-offset-4 hover:decoration-black">Go to Email settings</a>
      )}
    </FormAlert>
  );
}
