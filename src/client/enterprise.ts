/**
 * Gemini Enterprise routing.
 *
 * Consumer prompts stay on cloudcode-pa. A regional enterprise license (error
 * #3501) must not fall back there: Google documents separate Business AI Code
 * hosts, and a consumer URL both fails the license check and leaves the
 * configured region. Inference is sent only to the host for the selected
 * location, using the enterprise generate path:
 *   /v1beta/projects/{project}/locations/{location}:streamGenerateContent
 * The body keeps the Gemini request fields and names the license tier. Unknown
 * consumer envelope fields are dropped because the enterprise API rejects them.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AntigravityGenerateRequest } from "../types/types.js";
import { antigravityEnv, isRecord } from "../utils/util.js";

const LOCATIONS = ["global", "us", "eu"] as const;
export type EnterpriseLocation = (typeof LOCATIONS)[number];

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const USER_TIER = /^[a-z0-9][a-z0-9._-]{0,80}$/;

export type EnterpriseTarget = {
  location: EnterpriseLocation;
  projectId: string;
  userTier: string;
  host: string;
};

export function enterpriseHost(location: EnterpriseLocation): string {
  if (location === "global") return "https://businessaicode.googleapis.com";
  return `https://businessaicode.${location}.rep.googleapis.com`;
}

export function enterpriseStreamUrl(target: EnterpriseTarget): string {
  const project = encodeURIComponent(target.projectId);
  return `${target.host}/v1beta/projects/${project}/locations/${target.location}:streamGenerateContent?alt=sse`;
}

function truthy(value: string | undefined): boolean {
  return !!value && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function stringField(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readCliSettings(): Record<string, unknown> | undefined {
  const path = join(homedir(), ".gemini", "antigravity-cli", "settings.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Enterprise config from Pi settings, so it syncs with ~/.pi:
 *   { "antigravity": { "enterprise": { "enabled": true, "project": "my-proj",
 *                                      "location": "us", "userTier": "gcp-ge-plus-tier" } } }
 * Precedence: ANTIGRAVITY_* env > Pi settings > agy CLI settings.
 */
function readPiEnterpriseSettings(): Record<string, unknown> | undefined {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const path = join(agentDir, "settings.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const section = isRecord(parsed) ? parsed.antigravity : undefined;
    const enterprise = isRecord(section) ? section.enterprise : undefined;
    return isRecord(enterprise) ? enterprise : undefined;
  } catch {
    return undefined;
  }
}

function licenseRecord(
  settings: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const license = settings?.selectedLicense ?? settings?.license;
  return isRecord(license) ? license : undefined;
}

/**
 * Resolve an explicit enterprise target, or undefined for the consumer path.
 * `eu` / `us` (and `ANTIGRAVITY_ENTERPRISE=1`) never silently use cloudcode-pa.
 */
export function resolveEnterpriseTarget(): EnterpriseTarget | undefined {
  const settings = readCliSettings();
  const license = licenseRecord(settings);
  const pi = readPiEnterpriseSettings();
  const envForced = antigravityEnv("ENTERPRISE");
  const forced =
    envForced !== undefined ? truthy(envForced) : pi?.enabled === true || pi?.enabled === "1";
  const locationRaw = (
    antigravityEnv("LOCATION") ||
    stringField(pi, "location") ||
    stringField(settings, "location") ||
    stringField(license, "location") ||
    (forced ? process.env.GOOGLE_CLOUD_LOCATION || "global" : "")
  )
    .trim()
    .toLowerCase();

  if (locationRaw && !LOCATIONS.includes(locationRaw as EnterpriseLocation)) {
    throw new Error("ANTIGRAVITY_LOCATION must be global, us, or eu. The prompt was not sent.");
  }

  const regional = locationRaw === "eu" || locationRaw === "us";
  if (!regional && !forced) return undefined;

  const location = (locationRaw || "global") as EnterpriseLocation;
  const projectId =
    antigravityEnv("ENTERPRISE_PROJECT")?.trim() ||
    stringField(pi, "project") ||
    stringField(settings, "project") ||
    stringField(settings, "projectId") ||
    stringField(settings, "licenseProject") ||
    stringField(license, "project") ||
    stringField(license, "projectId");
  const userTier =
    antigravityEnv("USER_TIER")?.trim() ||
    stringField(pi, "userTier") ||
    stringField(settings, "userTier") ||
    stringField(settings, "entitlementTier") ||
    stringField(license, "userTier") ||
    stringField(license, "tier");

  if (!PROJECT_ID.test(projectId)) {
    throw new Error(
      "Gemini Enterprise routing needs ANTIGRAVITY_ENTERPRISE_PROJECT set to the license's Google Cloud project id. Refusing to send this prompt to the consumer endpoint.",
    );
  }
  if (!USER_TIER.test(userTier)) {
    throw new Error(
      "Gemini Enterprise routing needs ANTIGRAVITY_USER_TIER from the selected license (for example the tier id shown by agy). Refusing to send this prompt to the consumer endpoint.",
    );
  }

  return { location, projectId, userTier, host: enterpriseHost(location) };
}

export function describeEnterpriseRouting(): string {
  try {
    const target = resolveEnterpriseTarget();
    if (!target) return "consumer";
    return `enterprise location=${target.location} host=${target.host} project=${target.projectId}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid enterprise configuration";
    return `enterprise misconfigured (${message})`;
  }
}

/**
 * LOCAL PATCH: enterprise model catalog.
 * The consumer fetchAvailableModels catalog does not reflect the enterprise
 * license (e.g. Gemini 4 Neon / Argon). agy reads the license's experiences from
 * GET /v1beta/projects/{p}/locations/{l}:fetchConfig. Convert them into the
 * consumer `models` dict shape so the existing grouping logic works unchanged.
 */
export async function fetchEnterpriseModelsCatalog(
  token: string,
  target: EnterpriseTarget,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ endpoint: string; status: number; data: Record<string, unknown> }> {
  const project = encodeURIComponent(target.projectId);
  const query = new URLSearchParams({ "entitlement.userTier": target.userTier });
  const url = `${target.host}/v1beta/projects/${project}/locations/${target.location}:fetchConfig?${query}`;
  const { "Content-Type": _omit, ...getHeaders } = headers;
  const res = await fetch(url, {
    method: "GET",
    headers: { ...getHeaders, Authorization: `Bearer ${token}` },
    signal,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`Enterprise fetchConfig failed (${res.status}): ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as unknown;
  const experiences =
    isRecord(parsed) && Array.isArray(parsed.availableExperiences)
      ? parsed.availableExperiences
      : [];
  const models: Record<string, Record<string, unknown>> = {};
  for (const exp of experiences) {
    if (!isRecord(exp) || typeof exp.name !== "string") continue;
    const model = isRecord(exp.model) ? exp.model : {};
    const surface = isRecord(exp.surfaceConfig) ? exp.surfaceConfig : {};
    const features = Array.isArray(model.supportedFeatures) ? model.supportedFeatures : [];
    const provider = typeof model.modelProvider === "string" ? model.modelProvider : "GOOGLE";
    models[exp.name] = {
      displayName: model.displayName,
      maxTokens: model.inputTokenLimit,
      maxOutputTokens: model.outputTokenLimit,
      supportsThinking: features.includes("THINKING"),
      supportsImages: features.includes("IMAGE_INPUT"),
      recommended: true,
      model: surface.clientModelEnumName,
      apiProvider:
        provider === "GOOGLE" ? "API_PROVIDER_GOOGLE_GEMINI" : `API_PROVIDER_${provider}`,
      modelProvider: `MODEL_PROVIDER_${provider}`,
    };
  }
  if (Object.keys(models).length === 0) {
    throw new Error("Enterprise fetchConfig returned no available experiences");
  }
  const agy = isRecord(parsed) && isRecord(parsed.agySurfaceConfig) ? parsed.agySurfaceConfig : {};
  const agent = isRecord(agy.agentExperiences) ? agy.agentExperiences : {};
  const agentIds = Array.isArray(agent.experienceNames)
    ? agent.experienceNames.filter((id): id is string => typeof id === "string")
    : [];
  return {
    endpoint: target.host,
    status: res.status,
    data: {
      models,
      defaultAgentModelId: agent.defaultExperience,
      agentModelSorts: agentIds.length
        ? [{ displayName: "Recommended", groups: [{ modelIds: agentIds }] }]
        : undefined,
    },
  };
}

/** Allowlisted enterprise generate body. Drops the consumer envelope. */
export function toEnterpriseGenerateBody(
  payload: AntigravityGenerateRequest,
  target: EnterpriseTarget,
): Record<string, unknown> {
  const request = payload.request;
  const body: Record<string, unknown> = {
    contents: request.contents,
    aicode: { experience: payload.model },
    entitlement: { userTier: target.userTier },
  };
  if (request.systemInstruction) body.systemInstruction = request.systemInstruction;
  if (request.tools) body.tools = request.tools;
  if (request.toolConfig) body.toolConfig = request.toolConfig;
  if (request.generationConfig) body.generationConfig = request.generationConfig;
  // enterprise label values must match [\p{Ll}\p{Lo}\p{N}_-]{0,63};
  // consumer labels like model_enum=MODEL_PLACEHOLDER_M318 are rejected.
  if (request.labels) {
    const labels = Object.fromEntries(
      Object.entries(request.labels).filter(([, v]) => /^[\p{Ll}\p{Lo}\p{N}_-]{0,63}$/u.test(v)),
    );
    if (Object.keys(labels).length) body.labels = labels;
  }
  return body;
}
