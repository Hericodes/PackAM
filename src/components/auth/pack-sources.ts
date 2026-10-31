import type { PackSource } from "./AuthSuccess";

/**
 * Where the form sits on screen at the moment sign-in or sign-up succeeds, for <AuthSuccess>: what the
 * person can see of it flies into the parcel. Measure once, when success happens, and keep the result
 * (AuthSuccess restarts if its props change). Reads the DOM but changes nothing.
 */

type Box = Omit<PackSource, "kind">;
type Viewport = Pick<Window, "innerWidth" | "innerHeight"> | null;

/** Input types that don't look like a field on screen: hidden ones and the button kinds. */
const NOT_A_FIELD = new Set(["hidden", "button", "reset", "submit", "image"]);

function kindOf(element: Element): PackSource["kind"] | null {
  switch (element.tagName) {
    case "TEXTAREA":
    case "SELECT":
      return "field";
    case "BUTTON":
      // A <button> with no type attribute submits too; its .type says so.
      return (element as HTMLButtonElement).type === "submit" ? "button" : null;
    case "INPUT": {
      const type = (element as HTMLInputElement).type;
      if (type === "submit" || type === "image") return "button";
      return NOT_A_FIELD.has(type) ? null : "field";
    }
    default:
      return null;
  }
}

/** The element's box, or null when the person can't see it: not rendered, visually hidden, transparent or off screen. */
function visibleBox(element: Element, viewport: Viewport): Box | null {
  const { left, top, width, height } = element.getBoundingClientRect();
  // display:none and detached elements measure 0; screen-reader-only ones 1px.
  if (!(width > 1 && height > 1)) return null;
  if (viewport && (top + height <= 0 || left + width <= 0 || top >= viewport.innerHeight || left >= viewport.innerWidth)) return null;
  // visibility:hidden or opacity:0 still take up space; browsers without checkVisibility skip this check.
  if (typeof element.checkVisibility === "function" && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
  return { left, top, width, height };
}

/**
 * Every visible input, textarea and select of the form as a "field", in page order, then its submit button
 * (the first visible one) as the "button". Other buttons, such as a password field's eye, stay behind.
 */
export function measurePackSources(form: HTMLFormElement): PackSource[] {
  const viewport = form.ownerDocument.defaultView;
  const fields: PackSource[] = [];
  let button: PackSource | null = null;
  for (const element of Array.from(form.elements)) {
    const kind = kindOf(element);
    if (!kind || (kind === "button" && button)) continue;
    const box = visibleBox(element, viewport);
    if (!box) continue;
    if (kind === "button") button = { ...box, kind };
    else fields.push({ ...box, kind });
  }
  return button ? [...fields, button] : fields;
}

/**
 * The page logo's box (AuthShell marks it with data-auth-logo), so the success animation can glide it from
 * there to the centre. Null when it isn't on screen; the animation then lets the logo settle in instead.
 */
export function measureAuthLogo(root: Pick<Document, "querySelector" | "defaultView"> = document): PackSource | null {
  const logo = root.querySelector("[data-auth-logo]");
  const box = logo ? visibleBox(logo, root.defaultView) : null;
  // AuthSuccess reads only the box for the logo; the kind is there because the shape is shared with sources.
  return box ? { ...box, kind: "field" } : null;
}
