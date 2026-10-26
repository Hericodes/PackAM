"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, importTemplate, type ImportRow } from "../../lib/products/bulk-import";
import { formatNaira, parseNairaInput } from "../../lib/products/product-form";
import type { ImportResult } from "../../lib/products/bulk-import-server";
import { Icon } from "../ui/Icon";

type Preview = { rows: ImportRow[]; warnings: string[]; summary: { total: number; ready: number; errors: number; duplicates: number; existing: number }; fileHash: string };
type Done = Extract<ImportResult, { ok: true }>;

type State =
  | { step: "choose"; error?: string }
  | { step: "checking"; fileName: string }
  | { step: "preview"; fileName: string; csv: string; preview: Preview; error?: string }
  | { step: "importing"; fileName: string; csv: string; preview: Preview }
  | { step: "done"; fileName: string; result: Done };

const OUTCOME: Record<ImportRow["outcome"], { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-[#e9f8ee] text-[#16803c]" },
  error: { label: "Fix needed", className: "bg-[#ffe9e7] text-[#c92d24]" },
  "duplicate-in-file": { label: "Duplicate in file", className: "bg-[#fff3d6] text-[#a15c00]" },
  exists: { label: "Already exists", className: "bg-black/6 text-black/70" },
};

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([importTemplate()], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "packam-products-template.csv" });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function rowDetail(row: ImportRow) {
  if (row.outcome === "error") return row.errors.join(" ");
  if (row.outcome === "duplicate-in-file") return `Same name as row ${row.duplicateOfRow}; only the first is imported.`;
  if (row.outcome === "exists") return `Skipped: “${row.existing!.name}” is already in ${row.existing!.category}. It won’t be changed.`;
  return row.product!.status === "ACTIVE" ? "Will be visible to students." : "Will be added hidden.";
}

export function ProductImport({ categoryNames }: { categoryNames: string[] }) {
  const [state, setState] = useState<State>({ step: "choose" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const importing = useRef(false);

  async function check(file: File) {
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return setState({ step: "choose", error: `“${file.name}” isn’t a CSV file. In Excel or Google Sheets, use File → Download / Save as → CSV.` });
    if (file.size > IMPORT_MAX_BYTES) return setState({ step: "choose", error: `“${file.name}” is ${(file.size / 1_000_000).toFixed(1)} MB. Import up to 1 MB (${IMPORT_MAX_ROWS} products) at a time.` });
    setState({ step: "checking", fileName: file.name });
    try {
      const csv = await file.text();
      const response = await fetch("/api/admin/products/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview", csv }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The file couldn’t be checked.");
      setState({ step: "preview", fileName: file.name, csv, preview: data as Preview });
    } catch (error) {
      setState({ step: "choose", error: error instanceof TypeError ? "No connection to PackAM. Check your internet and choose the file again." : error instanceof Error ? error.message : "The file couldn’t be checked." });
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) void check(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function runImport() {
    if (state.step !== "preview" || importing.current) return; // one import per click, however many clicks
    importing.current = true;
    const { fileName, csv, preview } = state;
    setState({ step: "importing", fileName, csv, preview });
    try {
      const response = await fetch("/api/admin/products/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "import", csv, fileHash: preview.fileHash }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The import couldn’t be completed. Nothing was imported.");
      setState({ step: "done", fileName, result: data as Done });
    } catch (error) {
      setState({ step: "preview", fileName, csv, preview, error: error instanceof TypeError ? "The connection dropped. Import again: anything already imported will be skipped, not duplicated." : error instanceof Error ? error.message : "The import failed." });
    } finally {
      importing.current = false;
    }
  }

  const reset = () => setState({ step: "choose" });
  const fileInput = <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => pick(event.target.files)} />;

  if (state.step === "done") {
    const { created, skipped, failed } = state.result;
    return (
      <div className="space-y-5">
        <section role="status" className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-black">{created.length ? `Imported ${created.length} ${created.length === 1 ? "product" : "products"}` : "Nothing new to import"}</h2>
          <p className="mt-1 text-sm text-black/60">From {state.fileName}. {skipped.length} skipped, {failed.length} with errors. Existing products weren’t changed.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {created.length > 0 && <Link href="/admin/products?photo=missing" className="pk-btn pk-btn-primary">Add photos to new products</Link>}
            <Link href="/admin/products" className="pk-btn pk-btn-secondary">Back to products</Link>
            <button type="button" onClick={reset} className="pk-btn pk-btn-ghost">Import another file</button>
          </div>
        </section>
        {created.length > 0 && (
          <section className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm">
            <h3 className="font-black">Created — each needs a photo</h3>
            <ul className="mt-3 divide-y divide-black/5">
              {created.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="min-w-0"><span className="text-black/45">Row {item.row} · </span><span className="font-bold">{item.name}</span> <span className="text-black/50">· {item.status === "ACTIVE" ? "visible" : "hidden"}</span></span>
                  <Link href={`/admin/products/${item.id}/edit`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-black/10 px-4 text-xs font-black"><Icon name="image" className="h-4 w-4" /> Add photo</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(skipped.length > 0 || failed.length > 0) && (
          <section className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm">
            <h3 className="font-black">Not imported</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {skipped.map((item) => <li key={`s${item.row}`}><span className="font-bold">Row {item.row} · {item.name}</span> — {item.reason}{item.existingId && <> (<Link href={`/admin/products/${item.existingId}/edit`} className="underline">open it</Link>)</>}</li>)}
              {failed.map((item) => <li key={`f${item.row}`} className="text-[#a3241c]"><span className="font-bold">Row {item.row} · {item.name || "(no name)"}</span> — {item.errors.join(" ")}</li>)}
            </ul>
            {failed.length > 0 && <p className="mt-3 text-xs text-black/55">Fix these rows in your spreadsheet and import the file again — rows already imported will be skipped.</p>}
          </section>
        )}
      </div>
    );
  }

  if (state.step === "preview" || state.step === "importing") {
    const { preview, fileName } = state;
    const busy = state.step === "importing";
    const { summary } = preview;
    return (
      <div className="space-y-4">
        {fileInput}
        <section className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 font-black"><Icon name="file" className="h-5 w-5 shrink-0" /> <span className="truncate">{fileName}</span></p>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="pk-btn pk-btn-secondary pk-btn-sm">Replace file</button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {([["Rows", summary.total, ""], ["Ready", summary.ready, "text-[#16803c]"], ["Need fixing", summary.errors, summary.errors ? "text-[#c92d24]" : ""], ["Duplicates in file", summary.duplicates, summary.duplicates ? "text-[#a15c00]" : ""], ["Already exist", summary.existing, ""]] as const).map(([label, value, tone]) => (
              <div key={label} className="rounded-2xl bg-[#f7f5ee] px-3 py-2"><dt className="text-xs font-semibold text-black/55">{label}</dt><dd className={`text-xl font-black ${tone}`}>{value}</dd></div>
            ))}
          </dl>
          {preview.warnings.length > 0 && <ul className="mt-3 space-y-1 rounded-2xl bg-[#fff3d6] px-4 py-3 text-xs font-semibold text-[#6b4700]">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        </section>

        <section aria-label="Preview" className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="pk-stack-table w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#f7f5ee] text-xs uppercase tracking-wider text-black/50">
                <tr><th className="px-4 py-3">Row</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Result</th></tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {preview.rows.map((row) => {
                  const price = parseNairaInput(row.price);
                  return (
                    <tr key={row.row} className={row.outcome === "error" ? "bg-[#fff8f7]" : undefined}>
                      <td data-label="Row" className="px-4 py-3 font-black text-black/50">{row.row}</td>
                      <td data-label="Name" className="px-4 py-3 font-bold">{row.name || <span className="text-black/40">(empty)</span>}</td>
                      <td data-label="Category" className="px-4 py-3">{row.product?.categoryName ?? (row.category || <span className="text-black/40">(empty)</span>)}</td>
                      <td data-label="Price" className="px-4 py-3 font-black">{typeof price === "number" && price >= 1 ? formatNaira(price) : row.price || <span className="font-normal text-black/40">(empty)</span>}</td>
                      <td data-label="Result" className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${OUTCOME[row.outcome].className}`}>{OUTCOME[row.outcome].label}</span>
                        <p className="mt-1 text-xs leading-5 text-black/60">{rowDetail(row)}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {state.step === "preview" && state.error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
        <div className="flex flex-col gap-2 rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
          <button type="button" onClick={() => void runImport()} disabled={busy || summary.ready === 0} aria-busy={busy} className="pk-btn pk-btn-primary pk-btn-lg">
            {busy ? `Importing ${summary.ready} products…` : summary.ready ? `Import ${summary.ready} ${summary.ready === 1 ? "product" : "products"}` : "Nothing to import"}
          </button>
          <button type="button" onClick={reset} disabled={busy} className="pk-btn pk-btn-secondary pk-btn-lg">Cancel</button>
          <p className="text-xs leading-5 text-black/55 sm:ml-2">
            {summary.ready < summary.total ? `Only ready rows are imported; the other ${summary.total - summary.ready} are skipped. ` : ""}
            All ready rows are saved together, or none are. Nothing is changed until you import.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {fileInput}
      <section
        onDragOver={(event: DragEvent) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); if (state.step === "choose") pick(event.dataTransfer.files); }}
        className={`flex min-h-64 flex-col items-center justify-center rounded-3xl border-2 border-dashed p-6 text-center transition ${dragging ? "border-black bg-[#fff4c7]" : "border-black/15 bg-white"}`}
        aria-live="polite"
      >
        {state.step === "checking" ? (
          <p role="status" className="flex items-center gap-2 font-black"><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" /> Checking {state.fileName}…</p>
        ) : (
          <>
            <Icon name="file" className="h-9 w-9 text-black/40" />
            <p className="mt-3 text-lg font-black">Drag your CSV here</p>
            <p className="mt-1 text-sm text-black/55">or choose it from this device · up to {IMPORT_MAX_ROWS} products, 1 MB</p>
            <button type="button" onClick={() => inputRef.current?.click()} className="pk-btn pk-btn-primary mt-4">Choose CSV file</button>
            {state.error && <p role="alert" className="mt-4 max-w-md rounded-2xl bg-[#ffe9e7] px-4 py-3 text-sm font-semibold text-[#a3241c]">{state.error}</p>}
          </>
        )}
      </section>

      <aside className="rounded-3xl border border-black/5 bg-white p-5 text-sm shadow-sm">
        <h2 className="font-black">CSV columns</h2>
        <dl className="mt-3 space-y-2.5">
          {IMPORT_COLUMNS.map((column) => (
            <div key={column.key}><dt className="font-mono text-xs font-bold">{column.key}</dt><dd className="text-xs leading-5 text-black/60">{column.help}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-5 text-black/60"><span className="font-bold text-black/75">Categories:</span> {categoryNames.join(", ") || "none yet — add one in Admin → Categories"}.</p>
        <p className="mt-2 text-xs leading-5 text-black/60">No photo, stock or vendor columns: upload photos per product after importing.</p>
        <button type="button" onClick={downloadTemplate} className="pk-btn pk-btn-secondary mt-4 w-full">Download template</button>
      </aside>
    </div>
  );
}
