import assert from "node:assert/strict";
import { test } from "node:test";
import { photoFit } from "./photo-fit";

const CARD = 4 / 3;

test("photos shaped like the frame fill it edge to edge", () => {
  assert.equal(photoFit(1600, 1200, CARD), "cover"); // 4:3
  assert.equal(photoFit(1500, 1000, CARD), "cover"); // 3:2 food shot crops only a thin edge
  assert.equal(photoFit(1300, 1000, CARD), "cover");
});

test("photos with a different shape stay whole so products are never cut off", () => {
  assert.equal(photoFit(600, 1400, CARD), "contain"); // tall bottle
  assert.equal(photoFit(1000, 1000, CARD), "contain"); // square packshot
  assert.equal(photoFit(1920, 1080, CARD), "contain"); // wide 16:9
  assert.equal(photoFit(384, 768, CARD), "contain"); // portrait phone photo
});

test("the frame shape matters: a square photo fills a square frame", () => {
  assert.equal(photoFit(1000, 1000, 1), "cover");
  assert.equal(photoFit(1600, 1200, 1), "contain");
});

test("missing or broken dimensions fall back to showing the whole image", () => {
  assert.equal(photoFit(0, 0, CARD), "contain");
  assert.equal(photoFit(800, 600, 0), "contain");
  assert.equal(photoFit(Number.NaN, 600, CARD), "contain");
});
