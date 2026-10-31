import assert from "node:assert/strict";
import { test } from "node:test";
import { measureAuthLogo, measurePackSources } from "./pack-sources";

/** A phone-sized viewport; elements are stand-ins with just what the helpers read. */
const viewport = { innerWidth: 400, innerHeight: 800 };

type Fake = { tag: string; type?: string; box: [left: number, top: number, width: number, height: number]; seen?: boolean };

function fakeElement({ tag, type, box: [left, top, width, height], seen }: Fake) {
  return {
    tagName: tag,
    type,
    getBoundingClientRect: () => ({ left, top, width, height }),
    // Leaving checkVisibility out is how older browsers look.
    ...(seen === undefined ? {} : { checkVisibility: () => seen }),
  };
}

function fakeForm(fakes: Fake[], view: typeof viewport | null = viewport) {
  return { elements: fakes.map(fakeElement), ownerDocument: { defaultView: view } } as unknown as HTMLFormElement;
}

test("pack sources: fields in page order, then the submit button; hidden inputs and other buttons stay behind", () => {
  const sources = measurePackSources(fakeForm([
    { tag: "INPUT", type: "hidden", box: [0, 0, 0, 0] },
    { tag: "INPUT", type: "email", box: [20, 100, 360, 48] },
    { tag: "BUTTON", type: "submit", box: [20, 400, 360, 52] },
    { tag: "INPUT", type: "password", box: [20, 180, 360, 48] },
    { tag: "BUTTON", type: "button", box: [334, 182, 44, 44] }, // the eye toggle
    { tag: "SELECT", box: [20, 250, 360, 48] },
    { tag: "TEXTAREA", box: [20, 320, 360, 60] },
    { tag: "FIELDSET", box: [10, 90, 380, 300] },
    { tag: "INPUT", type: "submit", box: [20, 470, 360, 52] }, // a second submit control: only the first counts
  ]));
  assert.deepEqual(sources, [
    { left: 20, top: 100, width: 360, height: 48, kind: "field" },
    { left: 20, top: 180, width: 360, height: 48, kind: "field" },
    { left: 20, top: 250, width: 360, height: 48, kind: "field" },
    { left: 20, top: 320, width: 360, height: 60, kind: "field" },
    { left: 20, top: 400, width: 360, height: 52, kind: "button" },
  ]);
});

test("pack sources: only what the person can see flies", () => {
  const sources = measurePackSources(fakeForm([
    { tag: "INPUT", type: "text", box: [0, 0, 0, 0] }, // display: none
    { tag: "INPUT", type: "text", box: [0, 0, 1, 1] }, // screen-reader-only
    { tag: "INPUT", type: "text", box: [20, -200, 360, 48] }, // scrolled above the screen
    { tag: "INPUT", type: "text", box: [20, 900, 360, 48] }, // below it
    { tag: "INPUT", type: "text", box: [420, 100, 360, 48] }, // off to the side
    { tag: "INPUT", type: "text", box: [20, 120, 360, 48], seen: false }, // visibility: hidden or opacity: 0
    { tag: "INPUT", type: "text", box: [20, -20, 360, 48] }, // half visible: still flies
    { tag: "INPUT", type: "tel", box: [20, 200, 360, 48], seen: true },
    { tag: "BUTTON", type: "submit", box: [20, 820, 360, 52] }, // the button is off screen too
  ]));
  assert.deepEqual(sources, [
    { left: 20, top: -20, width: 360, height: 48, kind: "field" },
    { left: 20, top: 200, width: 360, height: 48, kind: "field" },
  ]);
  // A hidden first submit button doesn't stop a visible one from being used.
  assert.deepEqual(measurePackSources(fakeForm([
    { tag: "BUTTON", type: "submit", box: [0, 0, 0, 0] },
    { tag: "BUTTON", type: "submit", box: [20, 300, 360, 52] },
  ])), [{ left: 20, top: 300, width: 360, height: 52, kind: "button" }]);
  // Without a window there is no screen to clip to.
  assert.equal(measurePackSources(fakeForm([{ tag: "INPUT", type: "text", box: [20, 2000, 360, 48] }], null)).length, 1);
  assert.deepEqual(measurePackSources(fakeForm([])), []);
});

test("auth logo: its box while it's on screen, otherwise null so the animation settles the logo in", () => {
  const page = (box: Fake["box"] | null) => ({
    querySelector: (selector: string) => (selector === "[data-auth-logo]" && box ? fakeElement({ tag: "SPAN", box }) : null),
    defaultView: viewport,
  }) as unknown as Document;
  assert.deepEqual(measureAuthLogo(page([156, 40, 88, 88])), { left: 156, top: 40, width: 88, height: 88, kind: "field" });
  assert.equal(measureAuthLogo(page(null)), null);
  assert.equal(measureAuthLogo(page([156, -300, 88, 88])), null, "scrolled away");
  assert.equal(measureAuthLogo(page([0, 0, 0, 0])), null, "not rendered");
});
