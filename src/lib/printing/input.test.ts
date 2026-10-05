import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePrintConfiguration } from "./input";

const validConfiguration = {
  paperSize: "A4",
  colorMode: "BLACK_AND_WHITE",
  sides: "DOUBLE",
  copies: 20,
  pageSelection: "1-5, 8",
  instructions: "Staple on the left.",
};

test("print configuration accepts supported options and the maximum copies", () => {
  assert.deepEqual(parsePrintConfiguration(validConfiguration), validConfiguration);
});

test("print configuration rejects invalid copy limits, modes, pages, and instructions", () => {
  for (const copies of [0, 21, 1.5]) {
    assert.throws(() => parsePrintConfiguration({ ...validConfiguration, copies }));
  }
  assert.throws(() => parsePrintConfiguration({ ...validConfiguration, colorMode: "MONOCHROME" }));
  assert.throws(() => parsePrintConfiguration({ ...validConfiguration, sides: "DUPLEX" }));
  assert.throws(() => parsePrintConfiguration({ ...validConfiguration, paperSize: "A3" }));
  assert.throws(() => parsePrintConfiguration({ ...validConfiguration, pageSelection: "" }));
  assert.throws(() => parsePrintConfiguration({ ...validConfiguration, instructions: "x".repeat(501) }));
});
