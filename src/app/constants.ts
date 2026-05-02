import type { ModScanResult } from "../lib/types";

export const EMPTY_SCAN: ModScanResult = {
  fingerprints: [],
  translations: {},
  warnings: [],
};

export const BROWSER_DRAFT_SCHEMA_VERSION = 1;
export const DRAFT_AUTOSAVE_DELAY_MS = 700;
