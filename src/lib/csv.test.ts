import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, parseCsv } from "./csv";

const rows = (text: string) => {
  const result = parseCsv(text);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows;
};

test("quoted values keep commas, doubled quotes and line breaks", () => {
  assert.deepEqual(rows('name,description\r\nPen,"Blue, medium point"\r\n"Book ""A4""","Line one\nLine two"\r\n'), [
    ["name", "description"],
    ["Pen", "Blue, medium point"],
    ['Book "A4"', "Line one\nLine two"],
  ]);
});

test("Excel and Sheets quirks: byte-order mark, \\r\\n, \\n or \\r endings, no final newline, empty cells", () => {
  assert.deepEqual(rows("﻿a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(rows("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(rows("a,b\r1,2\r"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(rows("a,,c\n,,\n"), [["a", "", "c"], ["", "", ""]]);
  assert.deepEqual(rows('"",x'), [["", "x"]]);
  assert.deepEqual(rows(""), []);
});

test("malformed quoting is reported with its line instead of being guessed", () => {
  const unclosed = parseCsv('name\n"Pen, blue\nBook\n');
  assert.ok(!unclosed.ok && /Line 2: a quoted value is never closed/.test(unclosed.error));
  const stray = parseCsv('name\nPen "blue"\n');
  assert.ok(!stray.ok && /Line 2: a quote can only start a field/.test(stray.error));
  const trailing = parseCsv('name\n"Pen" blue\n');
  assert.ok(!trailing.ok && /closing quote must be followed/.test(trailing.error));
});

test("csvCell quotes only when needed and round-trips", () => {
  assert.equal(csvCell("Pen"), "Pen");
  for (const value of ['Blue, medium', 'Book "A4"', "two\nlines", " padded "]) {
    assert.deepEqual(rows(`${csvCell(value)},x`), [[value, "x"]], value);
  }
});
