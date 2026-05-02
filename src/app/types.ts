import type { Dispatch, SetStateAction } from "react";
import type { AppSettings, PersistedLlmSettings } from "../lib/deploymentConfig";
import type {
  CatalogRow,
  EntryId,
  LangpackProjectPatch,
  LocaleCode,
  ModScanResult,
  SourcePackScanResult,
} from "../lib/types";

export type StatusTone = "idle" | "ok" | "warn" | "error";
export type PageId = "project" | "sources" | "settings" | `namespace:${string}`;
export type ProjectMode = AppSettings["projectMode"];
export type SourcePackMode = AppSettings["sourcePackMode"];

export interface StatusMessage {
  tone: StatusTone;
  text: string;
}

export type TableItem =
  | { kind: "divider"; id: string; prefix: string }
  | { kind: "entry"; row: CatalogRow; displayKey: string };

export type DiffSegment = { text: string; kind: "same" | "added" };
export type TranslationJobStatus = "running" | "paused" | "stopping";

export interface LlmLiveOutput {
  id: EntryId;
  text: string;
  updatedAt: number;
}

export interface TranslationProgress {
  label: string;
  status: TranslationJobStatus;
  total: number;
  completed: number;
  startedAt: number;
  updatedAt: number;
  warningCount: number;
  liveOutputs: LlmLiveOutput[];
  showPanel: boolean;
}

export interface TranslationControl {
  paused: boolean;
  stopped: boolean;
  abortControllers: Set<AbortController>;
}

export interface BrowserDraftState {
  schemaVersion: 1;
  modScan: ModScanResult;
  sourcePacks: SourcePackScanResult[];
  project: LangpackProjectPatch;
  activeLocale: LocaleCode;
  activePage: PageId;
  settings: AppSettings;
  referenceLocale: string;
  referenceFallbackLocale: string;
  selectedKey: string;
  query: string;
  manualDraft: string;
  manualDraftEntryId: EntryId | "";
  inlineDrafts: Record<EntryId, string>;
  llmSettings: PersistedLlmSettings;
  llmWarnings: string[];
}

export type StateSetter<T> = Dispatch<SetStateAction<T>>;
