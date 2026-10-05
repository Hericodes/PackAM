"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { LocationSelector, type DeliveryLocation } from "../checkout/LocationSelector";
import { PRINTING_LIMITS } from "../../lib/printing/limits";
import { parsePageSelection } from "../../lib/printing/page-selection";
import { MAX_PRINT_DOCUMENT_BYTES, validatePrintFile } from "../../lib/printing/upload-validation";

type PrintDocument = {
  originalFileName: string;
  fileSize: number;
  pageCount: number;
};

type InitialPrintJob = {
  id: string;
  status: string;
  replacesPrintJobId: string | null;
  paperSize: "A4";
  colorMode: "BLACK_AND_WHITE" | "COLOR" | null;
  sides: "SINGLE" | "DOUBLE" | null;
  copies: number;
  pageSelection: string;
  instructions: string | null;
  deliveryLocationId: string | null;
  pendingUploadJobId?: string | null;
  pendingReplacementForJobId?: string | null;
  document: PrintDocument | null;
};

type Configuration = {
  paperSize: "A4";
  colorMode: "BLACK_AND_WHITE" | "COLOR";
  sides: "SINGLE" | "DOUBLE";
  copies: number;
  pageSelection: string;
  instructions: string;
};

type PrintQuote = {
  currency: string;
  pricingVersion: string;
  ratePerPage: number;
  selectedPageCount: number;
  copies: number;
  printSubtotal: number;
  deliveryFee: number;
  total: number;
  originalPageCount: number;
  pageSelection: string;
};

type UploadCredentials = {
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  resourceType: "raw";
  signature: string;
  timestamp: number;
  type: "authenticated";
};

type UploadedCloudinaryAsset = {
  assetId: string;
  version: number;
};

type PrintStudioProps = {
  locations: DeliveryLocation[];
  initialJob: InitialPrintJob | null;
};

const money = (amount: number) => `₦${amount.toLocaleString()}`;
const defaultConfiguration: Configuration = {
  paperSize: "A4",
  colorMode: "BLACK_AND_WHITE",
  sides: "SINGLE",
  copies: 1,
  pageSelection: "ALL",
  instructions: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configurationFromJob(job: InitialPrintJob | null): Configuration {
  if (!job) return defaultConfiguration;
  return {
    paperSize: "A4",
    colorMode: job.colorMode ?? "BLACK_AND_WHITE",
    sides: job.sides ?? "SINGLE",
    copies: job.copies,
    pageSelection: job.pageSelection || "ALL",
    instructions: job.instructions ?? "",
  };
}

function uploadToCloudinary(file: File, credentials: UploadCredentials, onProgress: (progress: number) => void) {
  return new Promise<UploadedCloudinaryAsset>((resolve, reject) => {
    const body = new FormData();
    body.set("api_key", credentials.apiKey);
    body.set("folder", credentials.folder);
    body.set("overwrite", "true");
    body.set("public_id", credentials.publicId);
    body.set("signature", credentials.signature);
    body.set("timestamp", String(credentials.timestamp));
    body.set("type", credentials.type);
    body.set("unique_filename", "false");
    body.set("file", file);

    const request = new XMLHttpRequest();
    request.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/${credentials.resourceType}/upload`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("The PDF could not reach secure storage. Check your connection and try again."));
    request.onabort = () => reject(new Error("The upload was cancelled. Choose the PDF again to retry."));
    request.onload = () => {
      let result: unknown;
      try { result = JSON.parse(request.responseText); } catch { reject(new Error("Secure storage returned an unreadable response. Try again.")); return; }
      if (request.status < 200 || request.status >= 300) {
        const message = isRecord(result) && typeof result.error === "object" && result.error !== null && "message" in result.error
          ? String(result.error.message)
          : "Secure storage could not accept this PDF. Try again.";
        reject(new Error(message));
        return;
      }
      if (
        !isRecord(result) ||
        result.public_id !== `${credentials.folder}/${credentials.publicId}` ||
        result.resource_type !== credentials.resourceType ||
        result.type !== credentials.type ||
        typeof result.asset_id !== "string" ||
        !result.asset_id ||
        typeof result.version !== "number" ||
        !Number.isSafeInteger(result.version) ||
        result.version <= 0
      ) {
        reject(new Error("Secure storage returned a file that could not be verified. Try again."));
        return;
      }
      resolve({ assetId: result.asset_id, version: result.version });
    };
    request.send(body);
  });
}

export function PrintStudio({ locations, initialJob }: PrintStudioProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [jobId, setJobId] = useState(initialJob?.id ?? null);
  const [replacesPrintJobId, setReplacesPrintJobId] = useState(initialJob?.pendingReplacementForJobId ?? initialJob?.replacesPrintJobId ?? null);
  const [document, setDocument] = useState<PrintDocument | null>(initialJob?.document ?? null);
  const [configuration, setConfiguration] = useState(() => configurationFromJob(initialJob));
  const [selectedLocation, setSelectedLocation] = useState<DeliveryLocation | null>(
    locations.find((location) => location.id === initialJob?.deliveryLocationId) ?? locations[0] ?? null,
  );
  const [quoteState, setQuoteState] = useState<{
    requestKey: string;
    status: "loading" | "ready" | "error";
    quote?: PrintQuote;
    error?: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingUploadJobId, setPendingUploadJobId] = useState<string | null>(
    initialJob?.pendingUploadJobId ?? (initialJob && !initialJob.document ? initialJob.id : null),
  );
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState(initialJob?.status === "READY_FOR_PAYMENT");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const quoteRequestKey = document && jobId
    ? JSON.stringify([jobId, document.pageCount, configuration])
    : "";
  let localPageSelectionError = "";
  if (document && configuration.pageSelection !== "ALL") {
    try {
      parsePageSelection(configuration.pageSelection, document.pageCount);
    } catch (cause) {
      localPageSelectionError = cause instanceof Error ? cause.message : "Enter a valid page selection.";
    }
  }
  const quoteMatchesCurrentConfiguration = quoteState?.requestKey === quoteRequestKey;
  const quote = quoteMatchesCurrentConfiguration && quoteState.status === "ready" ? quoteState.quote ?? null : null;
  const quoteLoading = Boolean(quoteRequestKey && !localPageSelectionError && (!quoteMatchesCurrentConfiguration || quoteState.status === "loading"));
  const quoteError = localPageSelectionError || (quoteMatchesCurrentConfiguration && quoteState.status === "error" ? quoteState.error ?? "" : "");

  useEffect(() => {
    if (!quoteRequestKey || !document || !jobId || localPageSelectionError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setQuoteState({ requestKey: quoteRequestKey, status: "loading" });
      try {
        const response = await fetch(`/api/print-jobs/${encodeURIComponent(jobId)}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ configuration }),
          cache: "no-store",
          signal: controller.signal,
        });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(isRecord(result) && typeof result.error === "string" ? result.error : "We couldn't calculate this print price.");
        if (!isRecord(result) || !isRecord(result.quote)) throw new Error("The price response was incomplete. Try again.");
        setQuoteState({ requestKey: quoteRequestKey, status: "ready", quote: result.quote as PrintQuote });
      } catch (cause) {
        if (!controller.signal.aborted) {
          setQuoteState({
            requestKey: quoteRequestKey,
            status: "error",
            error: cause instanceof Error ? cause.message : "We couldn't calculate this print price.",
          });
        }
      }
    }, configuration.pageSelection === "ALL" ? 250 : 550);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [configuration, document, jobId, localPageSelectionError, quoteRequestKey]);

  function updateConfiguration(change: Partial<Configuration>) {
    setConfiguration((current) => ({ ...current, ...change }));
    setPrepared(false);
    setNotice("");
  }

  async function handleUpload(file: File, replacing: boolean) {
    const validationError = validatePrintFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (uploading) return;

    setUploading(true);
    setUploadProgress(0);
    setError("");
    setNotice("");
    try {
      let uploadJobId = pendingUploadJobId;
      let credentials: UploadCredentials | null = null;
      if (!uploadJobId) {
        const draftResponse = await fetch("/api/print-jobs/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(replacing && jobId ? { replacePrintJobId: jobId } : {}),
          cache: "no-store",
        });
        const draftData: unknown = await draftResponse.json();
        if (!draftResponse.ok) throw new Error(isRecord(draftData) && typeof draftData.error === "string" ? draftData.error : "We couldn't start the secure upload.");
        if (!isRecord(draftData) || typeof draftData.printJobId !== "string" || !isRecord(draftData.credentials)) {
          throw new Error("The secure upload could not be prepared. Please try again.");
        }
        uploadJobId = draftData.printJobId;
        credentials = draftData.credentials as UploadCredentials;
        setPendingUploadJobId(uploadJobId);
        setReplacesPrintJobId(replacing ? jobId : null);
      }
      if (!credentials) {
        const draftResponse = await fetch("/api/print-jobs/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pendingUploadJobId
            ? { resumePrintJobId: pendingUploadJobId }
            : replacing && jobId ? { replacePrintJobId: jobId } : {}),
          cache: "no-store",
        });
        const draftData: unknown = await draftResponse.json();
        if (!draftResponse.ok || !isRecord(draftData) || !isRecord(draftData.credentials)) {
          throw new Error(isRecord(draftData) && typeof draftData.error === "string" ? draftData.error : "We couldn't restart the secure upload.");
        }
        uploadJobId = typeof draftData.printJobId === "string" ? draftData.printJobId : uploadJobId;
        credentials = draftData.credentials as UploadCredentials;
      }

      const uploadedAsset = await uploadToCloudinary(file, credentials, setUploadProgress);
      const completeResponse = await fetch(`/api/print-jobs/${encodeURIComponent(uploadJobId)}/upload-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: uploadedAsset.assetId,
          version: uploadedAsset.version,
          ...(replacesPrintJobId ? { replacesPrintJobId } : {}),
        }),
        cache: "no-store",
      });
      const completeData: unknown = await completeResponse.json();
      if (!completeResponse.ok) {
        throw new Error(isRecord(completeData) && typeof completeData.error === "string" ? completeData.error : "We couldn't verify this PDF. Try uploading it again.");
      }
      if (!isRecord(completeData) || !isRecord(completeData.document)) {
        throw new Error("The PDF was uploaded but its document details could not be verified.");
      }
      const verified = completeData.document;
      if (typeof verified.printJobId !== "string" || typeof verified.originalFileName !== "string" ||
        typeof verified.fileSize !== "number" || typeof verified.pageCount !== "number") {
        throw new Error("The PDF was uploaded but its document details could not be verified.");
      }
      setJobId(verified.printJobId);
      setDocument({
        originalFileName: verified.originalFileName,
        fileSize: verified.fileSize,
        pageCount: verified.pageCount,
      });
      setConfiguration((current) => ({ ...current, pageSelection: "ALL" }));
      setPendingUploadJobId(null);
      setReplacesPrintJobId(null);
      setPrepared(false);
      setNotice(typeof completeData.document.cleanupWarning === "string" ? completeData.document.cleanupWarning : "PDF uploaded and checked. Your page count is ready.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PDF could not be uploaded. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>, replacing: boolean) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void handleUpload(file, replacing);
  }

  async function prepareForPayment() {
    if (!jobId || !selectedLocation || !quote || quoteLoading || preparing) return;
    setPreparing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/print-jobs/${encodeURIComponent(jobId)}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configuration, deliveryLocationId: selectedLocation.id }),
        cache: "no-store",
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(isRecord(result) && typeof result.error === "string" ? result.error : "We couldn't save your print settings.");
      setPrepared(true);
      setNotice("Your print settings are saved and ready for payment. Payment checkout will be added in the next phase.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't prepare this print job for payment.");
    } finally {
      setPreparing(false);
    }
  }

  const canPrepare = Boolean(jobId && document && selectedLocation && quote && !quoteLoading && !quoteError && !uploading && !preparing);

  return (
    <div className="mt-7 grid items-start gap-5 lg:mt-9 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
      <div className="space-y-5">
        <section className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#fff4c7] text-xl" aria-hidden="true">📄</span>
            <div>
              <h2 className="text-lg font-black">Your document</h2>
              <p className="mt-1 text-sm leading-5 text-black/55">PDF only · Up to 15 MB · Maximum 500 pages</p>
            </div>
          </div>
          {document ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-[#fffdf7] p-4">
              <div className="min-w-0">
                <p className="break-all text-sm font-black">{document.originalFileName}</p>
                <p className="mt-1 text-sm text-black/55">{document.pageCount} {document.pageCount === 1 ? "page" : "pages"} · {(document.fileSize / 1_000_000).toFixed(1)} MB · Checked ✓</p>
              </div>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="min-h-11 shrink-0 rounded-full border border-black/10 px-4 text-sm font-black transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-50">
                Replace
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="mt-5 flex min-h-14 w-full items-center justify-center rounded-2xl bg-black px-5 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50">
              {uploading ? `Uploading… ${uploadProgress}%` : "Choose a PDF"}
            </button>
          )}
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => onFileChange(event, Boolean(document))}
            aria-label="Choose a PDF to upload"
            disabled={uploading}
          />
          {uploading && (
            <div className="mt-4" role="status" aria-live="polite">
              <div className="flex justify-between text-xs font-semibold text-black/55"><span>{uploadProgress < 100 ? "Uploading securely…" : "Checking your document…"}</span><span>{uploadProgress}%</span></div>
              <progress className="mt-2 h-2 w-full accent-[#feb80a]" max={100} value={uploadProgress} aria-label="PDF upload progress" />
            </div>
          )}
          {!document && !uploading && <p className="mt-3 text-xs leading-5 text-black/50">Maximum size: {(MAX_PRINT_DOCUMENT_BYTES / 1_000_000).toFixed(0)} MB. Your file is stored privately.</p>}
          {pendingUploadJobId && !uploading && <p className="mt-3 text-xs leading-5 text-black/55">Your draft is saved. Choose the PDF again to retry its upload.</p>}
        </section>

        {document && (
          <>
            <section className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="print-settings-title">
              <p className="text-xs font-black uppercase tracking-wider text-black/40">Print settings</p>
              <h2 id="print-settings-title" className="mt-1 text-lg font-black">Make it yours</h2>
              <p className="mt-1 text-sm text-black/55">A4 paper is currently the available size.</p>

              <fieldset className="mt-5">
                <legend className="text-sm font-black">Colour</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {([
                    ["BLACK_AND_WHITE", "Black & white"],
                    ["COLOR", "Colour"],
                  ] as const).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={configuration.colorMode === value} onClick={() => updateConfiguration({ colorMode: value })} className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${configuration.colorMode === value ? "border-black bg-[#fff4c7]" : "border-black/10 hover:bg-black/[0.02]"}`}>
                      {configuration.colorMode === value ? "● " : "○ "}{label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mt-5">
                <legend className="text-sm font-black">Sides</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {([
                    ["SINGLE", "Single-sided"],
                    ["DOUBLE", "Double-sided"],
                  ] as const).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={configuration.sides === value} onClick={() => updateConfiguration({ sides: value })} className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${configuration.sides === value ? "border-black bg-[#fff4c7]" : "border-black/10 hover:bg-black/[0.02]"}`}>
                      {configuration.sides === value ? "● " : "○ "}{label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-black/50">Double-sided printing does not change the per-page price.</p>
              </fieldset>

              <div className="mt-5">
                <label htmlFor="print-copies" className="block text-sm font-black">Copies</label>
                <div className="mt-2 inline-flex min-h-12 items-center rounded-xl border border-black/10 bg-[#fffdf7]">
                  <button type="button" aria-label="Remove one copy" disabled={configuration.copies <= 1} onClick={() => updateConfiguration({ copies: Math.max(1, configuration.copies - 1) })} className="min-h-12 min-w-12 rounded-l-xl text-lg font-black hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black disabled:opacity-40">−</button>
                  <output id="print-copies" className="min-w-12 text-center text-sm font-black">{configuration.copies}</output>
                  <button type="button" aria-label="Add one copy" disabled={configuration.copies >= PRINTING_LIMITS.copies} onClick={() => updateConfiguration({ copies: Math.min(PRINTING_LIMITS.copies, configuration.copies + 1) })} className="min-h-12 min-w-12 rounded-r-xl text-lg font-black hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-black disabled:opacity-40">+</button>
                </div>
                <p className="mt-1 text-xs text-black/50">Choose 1–{PRINTING_LIMITS.copies} copies.</p>
              </div>

              <fieldset className="mt-5">
                <legend className="text-sm font-black">Pages to print</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" aria-pressed={configuration.pageSelection === "ALL"} onClick={() => updateConfiguration({ pageSelection: "ALL" })} className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${configuration.pageSelection === "ALL" ? "border-black bg-[#fff4c7]" : "border-black/10 hover:bg-black/[0.02]"}`}>
                    {configuration.pageSelection === "ALL" ? "● " : "○ "}All pages
                  </button>
                  <button type="button" aria-pressed={configuration.pageSelection !== "ALL"} onClick={() => updateConfiguration({ pageSelection: configuration.pageSelection === "ALL" ? "1" : configuration.pageSelection })} className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${configuration.pageSelection !== "ALL" ? "border-black bg-[#fff4c7]" : "border-black/10 hover:bg-black/[0.02]"}`}>
                    {configuration.pageSelection !== "ALL" ? "● " : "○ "}Selected pages
                  </button>
                </div>
                {configuration.pageSelection !== "ALL" && (
                  <div className="mt-3">
                    <label htmlFor="print-pages" className="block text-sm font-semibold">Page numbers or ranges</label>
                    <input id="print-pages" value={configuration.pageSelection} onChange={(event) => updateConfiguration({ pageSelection: event.target.value })} placeholder="e.g. 1-5, 8, 10-12" inputMode="text" autoComplete="off" aria-describedby="print-pages-help" className="mt-2 min-h-12 w-full rounded-xl border border-black/10 bg-[#fffdf7] px-3 text-sm outline-none focus-visible:border-black/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black" />
                    <p id="print-pages-help" className="mt-1 text-xs leading-5 text-black/50">Document has {document.pageCount} pages. Example: 1-5, 8.</p>
                  </div>
                )}
              </fieldset>

              <div className="mt-5">
                <label htmlFor="print-instructions" className="block text-sm font-black">Printing instructions <span className="font-medium text-black/45">(optional)</span></label>
                <textarea id="print-instructions" value={configuration.instructions} onChange={(event) => updateConfiguration({ instructions: event.target.value.slice(0, 500) })} maxLength={500} rows={3} placeholder="Anything the printer should know?" className="mt-2 min-h-24 w-full resize-y rounded-xl border border-black/10 bg-[#fffdf7] px-3 py-3 text-sm outline-none placeholder:text-black/45 focus-visible:border-black/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black" />
                <p className="mt-1 text-right text-xs text-black/45">{configuration.instructions.length}/500</p>
              </div>
            </section>

            <LocationSelector
              locations={locations}
              selectedLocation={selectedLocation}
              onSelect={(location) => {
                setSelectedLocation(location);
                setPrepared(false);
                setNotice("");
              }}
            />
          </>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-5">
        {document ? (
          <>
            <section className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6" aria-label="Print review">
              <p className="text-xs font-black uppercase tracking-wider text-black/40">Review</p>
              <h2 className="mt-1 text-lg font-black">Your print order</h2>
              <div className="mt-4 border-b border-black/5 pb-4">
                <p className="text-xs font-black uppercase text-black/40">Document</p>
                <p className="mt-1 break-all text-sm font-bold">{document.originalFileName}</p>
              </div>
              <div className="border-b border-black/5 py-4">
                <p className="text-xs font-black uppercase text-black/40">Printing</p>
                <p className="mt-1 text-sm leading-6">
                  A4 · {configuration.colorMode === "COLOR" ? "Colour" : "B&W"} · {configuration.sides === "DOUBLE" ? "Double-sided" : "Single-sided"}<br />
                  {configuration.copies} {configuration.copies === 1 ? "copy" : "copies"} · {configuration.pageSelection === "ALL" ? "All pages" : configuration.pageSelection}
                </p>
                {configuration.instructions.trim() && <p className="mt-2 whitespace-pre-wrap text-sm text-black/60">Instructions: {configuration.instructions.trim()}</p>}
              </div>
              <div className="border-b border-black/5 py-4">
                <p className="text-xs font-black uppercase text-black/40">Delivery</p>
                <p className="mt-1 text-sm font-bold">{selectedLocation?.label ?? "Choose a location"}</p>
                {selectedLocation && <p className="mt-1 break-words text-sm text-black/55">{selectedLocation.address}</p>}
              </div>
              <div className="space-y-2 py-4 text-sm">
                <div className="flex justify-between gap-3"><span className="text-black/55">Printing</span><span className="font-bold">{quote ? money(quote.printSubtotal) : "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-black/55">Delivery</span><span className="font-bold">{quote ? money(quote.deliveryFee) : "—"}</span></div>
                <div className="flex justify-between gap-3 border-t border-black/5 pt-3 text-base font-black"><span>Total</span><span>{quote ? money(quote.total) : "—"}</span></div>
              </div>
              <div className="min-h-5 text-xs" aria-live="polite">
                {quoteLoading && <p className="text-black/55">Calculating your price…</p>}
                {!quoteLoading && quote && <p className="text-black/45">{quote.selectedPageCount} selected {quote.selectedPageCount === 1 ? "page" : "pages"} · ₦{quote.ratePerPage.toLocaleString()} per page · Price confirmed by PackAM</p>}
                {quoteError && <p role="alert" className="text-red-700">{quoteError}</p>}
              </div>
            </section>
            <section className="sticky bottom-3 rounded-2xl border border-black/5 bg-[#fffdf7] p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
              <button type="button" onClick={() => void prepareForPayment()} disabled={!canPrepare} className="flex min-h-12 w-full items-center justify-center rounded-full bg-black px-5 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40">
                {preparing ? "Saving print settings…" : prepared ? "Save changes for payment" : "Continue to payment"}
              </button>
              <p className="mt-2 text-center text-xs leading-5 text-black/50">This saves your job as ready for payment. Payment checkout is not available yet.</p>
            </section>
          </>
        ) : (
          <section className="rounded-3xl border border-black/5 bg-white p-5 text-sm leading-6 text-black/55 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wider text-black/40">Next up</p>
            <p className="mt-2 font-bold text-black">Upload your PDF to start.</p>
            <p className="mt-1">We&apos;ll check the file and pages before showing a price.</p>
          </section>
        )}
      </aside>

      {(error || notice) && (
        <div className="lg:col-span-2">
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p>}
          {notice && <p role="status" className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-900">{notice}</p>}
        </div>
      )}
    </div>
  );
}
