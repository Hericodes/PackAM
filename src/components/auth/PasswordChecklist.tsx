import { PASSWORD_MAX_BYTES, PASSWORD_MIN, passwordRules, passwordStrength, utf8Length } from "../../lib/account/password-policy";
import { Icon } from "../ui/Icon";

type Personal = { email?: string; names?: string[] };
type Item = { id: string; label: string; met: boolean };

/**
 * Red only while a rule is unmet (the password can't be used yet). Once every rule is met the meter just rates
 * it: amber for Weak or Fair, green for Good or Strong. The label beside it says the same thing in words.
 */
function meterTone(password: string, usable: boolean, score: number) {
  if (!password) return { bar: "", text: "" };
  if (!usable) return { bar: "bg-packam-error", text: "text-packam-error" };
  if (score <= 2) return { bar: "bg-packam-yellow-dark", text: "text-packam-warning" };
  return { bar: score === 3 ? "bg-packam-success/70" : "bg-packam-success", text: "text-packam-success" };
}

/**
 * The visible rules plus the two checks passwordProblem() adds on top (at most 72 bytes, no spaces at either
 * end), so a full set of ticks means the server will accept the password too.
 */
function checklist(password: string, personal: Personal): Item[] {
  const tooLong = utf8Length(password) > PASSWORD_MAX_BYTES;
  const items: Item[] = passwordRules(password, personal).map((rule) => (
    rule.id === "length" && tooLong ? { ...rule, label: `Between ${PASSWORD_MIN} and ${PASSWORD_MAX_BYTES} characters` } : rule
  ));
  if (password.trim() !== password) items.push({ id: "spaces", label: "No spaces at the start or end", met: false });
  return items;
}

/**
 * Live password rules and a 4-step strength meter for choosing a new password (sign-up, reset, change).
 * Each rule shows a tick or an empty circle and says "done" or "not yet" to screen readers; the meter always
 * has a word next to it. Give it an id and pass that as the password field's aria-describedby so the rules are
 * read with the field. A polite live region announces the strength and how many rules are met as they change.
 * `personal` (the person's names and email) powers the "doesn't contain your name or email" rule.
 */
export function PasswordChecklist({ password, personal = {}, id, className = "" }: { password: string; personal?: Personal; id?: string; className?: string }) {
  const items = checklist(password, personal);
  const met = items.filter((item) => item.met).length;
  const usable = met === items.length;
  // passwordStrength holds a password down to Weak while one of its rules is unmet; the two extra checks do too.
  const { score, label } = password && !usable ? { score: 1, label: "Weak" } : passwordStrength(password, personal);
  const tone = meterTone(password, usable, score);
  const summary = password ? `Password strength: ${label}. ${met} of ${items.length} rules met.` : "";

  return (
    <div className={className}>
      <div id={id}>
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="grid flex-1 grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map((step) => (
              <span key={step} className={`h-1.5 rounded-full transition-colors duration-200 ${step <= score ? tone.bar : "bg-black/10"}`} />
            ))}
          </div>
          <p className={`min-w-14 text-right text-xs font-bold ${tone.text}`}>
            {label && <><span className="sr-only">Strength: </span>{label}</>}
          </p>
        </div>
        <ul className="mt-3 space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className={`flex items-start gap-2 text-[0.8125rem] leading-5 ${item.met ? "text-black/80" : "text-black/60"}`}>
              <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${item.met ? "bg-packam-success text-white" : "border-[1.5px] border-black/25"}`}>
                {item.met && <Icon name="check" className="h-2.5 w-2.5" strokeWidth={3.5} />}
              </span>
              <span>{item.label}<span className="sr-only">{item.met ? " (done)" : " (not yet)"}</span></span>
            </li>
          ))}
        </ul>
      </div>
      <p aria-live="polite" className="sr-only">{summary}</p>
    </div>
  );
}
