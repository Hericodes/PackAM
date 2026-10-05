import { PrintColorMode, PrintPaperSize, PrintSides } from "@prisma/client";
import { PRINTING_LIMITS } from "./pricing";
import type { PrintConfiguration } from "./service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePrintConfiguration(value: unknown): PrintConfiguration {
  if (!isRecord(value)) throw new Error("Choose valid print settings.");
  const { paperSize, colorMode, sides, copies, pageSelection, instructions } = value;
  if (typeof paperSize !== "string" || !Object.values(PrintPaperSize).includes(paperSize as PrintPaperSize)) {
    throw new Error("Choose a supported paper size.");
  }
  if (typeof colorMode !== "string" || !Object.values(PrintColorMode).includes(colorMode as PrintColorMode)) {
    throw new Error("Choose black-and-white or color printing.");
  }
  if (typeof sides !== "string" || !Object.values(PrintSides).includes(sides as PrintSides)) {
    throw new Error("Choose single-sided or double-sided printing.");
  }
  if (typeof copies !== "number" || !Number.isSafeInteger(copies) || copies < 1 || copies > PRINTING_LIMITS.copies) {
    throw new Error(`Choose between 1 and ${PRINTING_LIMITS.copies} copies.`);
  }
  if (typeof pageSelection !== "string" || !pageSelection.trim() || pageSelection.length > 1000) {
    throw new Error("Enter ALL or a valid page list such as 1-5, 8, 10-12.");
  }
  if (instructions !== undefined && instructions !== null && typeof instructions !== "string") {
    throw new Error("Print instructions must be text.");
  }
  if (typeof instructions === "string" && instructions.length > PRINTING_LIMITS.instructionsCharacters) {
    throw new Error(`Print instructions must be ${PRINTING_LIMITS.instructionsCharacters} characters or fewer.`);
  }
  return {
    paperSize: paperSize as PrintPaperSize,
    colorMode: colorMode as PrintColorMode,
    sides: sides as PrintSides,
    copies,
    pageSelection,
    instructions: typeof instructions === "string" ? instructions : null,
  };
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
