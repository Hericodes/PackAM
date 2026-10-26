/**
 * RFC 4180 CSV parsing: quoted fields may contain commas, line breaks and doubled quotes ("").
 * Accepts \r\n, \n or \r line endings and the byte-order mark Excel adds. Pure and dependency-free.
 */

export type CsvParseResult = { ok: true; rows: string[][] } | { ok: false; error: string };

export function parseCsv(text: string): CsvParseResult {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let quoteStartLine = 1;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; }
        else {
          inQuotes = false;
          const next = input[i + 1];
          if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") {
            return { ok: false, error: `Line ${line}: a closing quote must be followed by a comma or a new line.` };
          }
        }
      } else {
        if (char === "\n" || (char === "\r" && input[i + 1] !== "\n")) line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field.trim() !== "") return { ok: false, error: `Line ${line}: a quote can only start a field. Wrap the whole value in quotes and double any quotes inside it ("").` };
      field = "";
      inQuotes = true;
      quoteStartLine = line;
    } else if (char === ",") {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
    } else {
      field += char;
    }
  }
  if (inQuotes) return { ok: false, error: `Line ${quoteStartLine}: a quoted value is never closed. Check for a missing quote (").` };
  if (field !== "" || row.length) endRow();
  return { ok: true, rows };
}

/** One CSV value, quoted when it needs to be. */
export function csvCell(value: string) {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replaceAll('"', '""')}"` : value;
}
