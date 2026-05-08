import { apiUrl } from "./apiUrl";
import { getJson } from "./apiClient";
export {
  findCapabilityForLanguage,
  isProgrammingLanguage,
  type DefinitionCapabilities,
  type DefinitionClickTarget,
  type DefinitionLanguageCapability,
  type DefinitionLocation,
  type DefinitionRecommendedSetup,
  type DefinitionRequest,
  type DefinitionResponse,
} from "./definitionTypes";
import type {
  DefinitionCapabilities,
  DefinitionRequest,
  DefinitionResponse,
} from "./definitionTypes";

export async function fetchDefinitionCapabilities(): Promise<DefinitionCapabilities> {
  return getJson<DefinitionCapabilities>("/api/definition/capabilities");
}

export async function fetchDefinition(
  req: DefinitionRequest,
): Promise<DefinitionResponse> {
  const res = await fetch(await apiUrl("/api/definition"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const json = (await res.json()) as DefinitionResponse | { error: string };
  if (!res.ok && !("status" in json)) {
    throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
  }
  if (!("status" in json)) {
    throw new Error(`invalid definition response (HTTP ${res.status})`);
  }
  return json;
}
