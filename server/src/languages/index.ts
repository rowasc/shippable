import path from "node:path";
import { phpLanguage } from "./php.ts";
import { tsLanguage } from "./typescript.ts";
import type { LanguageModule } from "./types.ts";

export const LANGUAGES: readonly LanguageModule[] = [tsLanguage, phpLanguage];

export function languageById(id: string): LanguageModule | null {
  return LANGUAGES.find((m) => m.id === id) ?? null;
}

export function languageForRequestId(requestLanguage: string): LanguageModule | null {
  const normalized = requestLanguage.trim().toLowerCase();
  return LANGUAGES.find((m) => m.languageIds.includes(normalized)) ?? null;
}

export function languageForFile(filePath: string): LanguageModule | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return null;
  return LANGUAGES.find((m) => m.extensions.includes(ext)) ?? null;
}

export function lspLanguageIdFor(module: LanguageModule, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return module.lspLanguageIdByExtension[ext] ?? module.id;
}

export type { LanguageModule } from "./types.ts";
export type { DiscoverySource, DiscoveredBinary, RecommendedSetup } from "./types.ts";
