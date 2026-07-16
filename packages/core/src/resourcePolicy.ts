import type {
  MarkdownEditorAssetUploadOptions,
  MarkdownEditorImageLoadResult,
  MarkdownEditorImagePolicy,
  MarkdownEditorResourceKind,
  MarkdownEditorResourceOptions,
  MarkdownEditorResourcePurpose,
  MarkdownEditorUrlPolicy,
} from "./resourceApi";
import { sanitizeStoredUrl } from "./urlUtils";

export const DEFAULT_LINK_PROTOCOLS = Object.freeze(["http:", "https:", "mailto:", "tel:"] as const);
export const DEFAULT_IMAGE_PROTOCOLS = Object.freeze(["http:", "https:", "data:"] as const);
export const DEFAULT_IMAGE_DATA_MIME_TYPES = Object.freeze([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const);
export const DEFAULT_ASSET_MIME_TYPES = DEFAULT_IMAGE_DATA_MIME_TYPES;
export const DEFAULT_MAX_DATA_URL_BYTES = 1024 * 1024;
export const DEFAULT_MAX_DATA_URL_CHARACTERS = Math.ceil(DEFAULT_MAX_DATA_URL_BYTES * 4 / 3) + 256;
export const DEFAULT_MAX_ASSET_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_ASSET_FILES = 10;

const PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*:$/u;
const MIME_PATTERN = /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/u;
const MIME_WILDCARD_PATTERN = /^(?:\*\/\*|[a-z\d!#$&^_.+-]+\/\*)$/u;
const FORBIDDEN_PROTOCOLS = new Set(["javascript:", "vbscript:"]);
const REFERRER_POLICIES = new Set<ReferrerPolicy>([
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
]);

export type NormalizedMarkdownEditorUrlPolicy = Readonly<{
  allowCredentials: boolean;
  allowedDataMimeTypes: readonly string[];
  allowedProtocols: readonly string[];
  allowRelative: boolean;
  maxDataUrlBytes: number;
  maxDataUrlCharacters: number;
}>;

export type NormalizedMarkdownEditorImagePolicy = NormalizedMarkdownEditorUrlPolicy & Readonly<{
  crossOrigin: "anonymous" | "use-credentials" | null;
  referrerPolicy: ReferrerPolicy;
}>;

export type NormalizedMarkdownEditorAssetOptions = Readonly<{
  allowedMimeTypes: readonly string[];
  maxFileBytes: number;
  maxFiles: number;
  upload: MarkdownEditorAssetUploadOptions["upload"];
}>;

export type NormalizedMarkdownEditorResources = Readonly<{
  assets: NormalizedMarkdownEditorAssetOptions | null;
  images: NormalizedMarkdownEditorImagePolicy;
  links: NormalizedMarkdownEditorUrlPolicy;
  loadImage: MarkdownEditorResourceOptions["loadImage"];
  openUrl: MarkdownEditorResourceOptions["openUrl"];
  resolveUrl: MarkdownEditorResourceOptions["resolveUrl"];
}>;

function assertOptionsObject(value: unknown, name: string) {
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
    throw new TypeError(`${name} must be an object.`);
  }
}

function assertBoolean(value: unknown, name: string) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
  return value;
}

function assertPositiveSafeInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value as number;
}

function normalizeProtocols(value: unknown, fallback: readonly string[], name: string) {
  const protocols = value === undefined ? fallback : value;

  if (!Array.isArray(protocols)) {
    throw new TypeError(`${name} must be an array of protocol strings.`);
  }

  const normalized: string[] = [];
  for (const entry of protocols) {
    if (typeof entry !== "string") {
      throw new TypeError(`${name} entries must be strings.`);
    }

    const protocol = entry.trim().toLowerCase();
    if (!PROTOCOL_PATTERN.test(protocol) || FORBIDDEN_PROTOCOLS.has(protocol)) {
      throw new RangeError(`${JSON.stringify(entry)} is not a supported protocol policy value.`);
    }

    if (!normalized.includes(protocol)) {
      normalized.push(protocol);
    }
  }

  return Object.freeze(normalized);
}

function normalizeMimeTypes(
  value: unknown,
  fallback: readonly string[],
  name: string,
  allowWildcards: boolean,
) {
  const mimeTypes = value === undefined ? fallback : value;

  if (!Array.isArray(mimeTypes)) {
    throw new TypeError(`${name} must be an array of MIME type strings.`);
  }

  const normalized: string[] = [];
  for (const entry of mimeTypes) {
    if (typeof entry !== "string") {
      throw new TypeError(`${name} entries must be strings.`);
    }

    const mimeType = entry.trim().toLowerCase();
    if (!MIME_PATTERN.test(mimeType) && !(allowWildcards && MIME_WILDCARD_PATTERN.test(mimeType))) {
      throw new RangeError(`${JSON.stringify(entry)} is not a supported MIME type policy value.`);
    }

    if (!normalized.includes(mimeType)) {
      normalized.push(mimeType);
    }
  }

  return Object.freeze(normalized);
}

function normalizeUrlPolicy(
  value: MarkdownEditorUrlPolicy | undefined,
  defaults: {
    allowedDataMimeTypes: readonly string[];
    allowedProtocols: readonly string[];
  },
  name: string,
): NormalizedMarkdownEditorUrlPolicy {
  assertOptionsObject(value, name);
  return Object.freeze({
    allowCredentials: value?.allowCredentials === undefined
      ? false
      : assertBoolean(value.allowCredentials, `${name}.allowCredentials`),
    allowedDataMimeTypes: normalizeMimeTypes(
      value?.allowedDataMimeTypes,
      defaults.allowedDataMimeTypes,
      `${name}.allowedDataMimeTypes`,
      false,
    ),
    allowedProtocols: normalizeProtocols(
      value?.allowedProtocols,
      defaults.allowedProtocols,
      `${name}.allowedProtocols`,
    ),
    allowRelative: value?.allowRelative === undefined
      ? true
      : assertBoolean(value.allowRelative, `${name}.allowRelative`),
    maxDataUrlBytes: value?.maxDataUrlBytes === undefined
      ? DEFAULT_MAX_DATA_URL_BYTES
      : assertPositiveSafeInteger(value.maxDataUrlBytes, `${name}.maxDataUrlBytes`),
    maxDataUrlCharacters: value?.maxDataUrlCharacters === undefined
      ? DEFAULT_MAX_DATA_URL_CHARACTERS
      : assertPositiveSafeInteger(value.maxDataUrlCharacters, `${name}.maxDataUrlCharacters`),
  });
}

function normalizeImagePolicy(value: MarkdownEditorImagePolicy | undefined) {
  const urlPolicy = normalizeUrlPolicy(value, {
    allowedDataMimeTypes: DEFAULT_IMAGE_DATA_MIME_TYPES,
    allowedProtocols: DEFAULT_IMAGE_PROTOCOLS,
  }, "resources.images");
  const crossOrigin = value?.crossOrigin ?? null;
  const referrerPolicy = value?.referrerPolicy ?? "no-referrer";

  if (crossOrigin !== null && crossOrigin !== "anonymous" && crossOrigin !== "use-credentials") {
    throw new RangeError('resources.images.crossOrigin must be "anonymous", "use-credentials", or null.');
  }

  if (typeof referrerPolicy !== "string" || !REFERRER_POLICIES.has(referrerPolicy)) {
    throw new RangeError("resources.images.referrerPolicy is not a supported referrer policy.");
  }

  return Object.freeze({ ...urlPolicy, crossOrigin, referrerPolicy });
}

function normalizeAssetOptions(value: MarkdownEditorAssetUploadOptions | undefined) {
  if (value === undefined) {
    return null;
  }

  assertOptionsObject(value, "resources.assets");
  if (typeof value.upload !== "function") {
    throw new TypeError("resources.assets.upload must be a function.");
  }

  return Object.freeze({
    allowedMimeTypes: normalizeMimeTypes(
      value.allowedMimeTypes,
      DEFAULT_ASSET_MIME_TYPES,
      "resources.assets.allowedMimeTypes",
      true,
    ),
    maxFileBytes: value.maxFileBytes === undefined
      ? DEFAULT_MAX_ASSET_FILE_BYTES
      : assertPositiveSafeInteger(value.maxFileBytes, "resources.assets.maxFileBytes"),
    maxFiles: value.maxFiles === undefined
      ? DEFAULT_MAX_ASSET_FILES
      : assertPositiveSafeInteger(value.maxFiles, "resources.assets.maxFiles", 100),
    upload: value.upload,
  });
}

function assertOptionalFunction(value: unknown, name: string) {
  if (value !== undefined && typeof value !== "function") {
    throw new TypeError(`${name} must be a function.`);
  }
}

export function normalizeMarkdownEditorResources(
  value: MarkdownEditorResourceOptions | undefined,
): NormalizedMarkdownEditorResources {
  assertOptionsObject(value, "resources");
  assertOptionalFunction(value?.resolveUrl, "resources.resolveUrl");
  assertOptionalFunction(value?.openUrl, "resources.openUrl");
  assertOptionalFunction(value?.loadImage, "resources.loadImage");

  return Object.freeze({
    assets: normalizeAssetOptions(value?.assets),
    images: normalizeImagePolicy(value?.images),
    links: normalizeUrlPolicy(value?.links, {
      allowedDataMimeTypes: [],
      allowedProtocols: DEFAULT_LINK_PROTOCOLS,
    }, "resources.links"),
    loadImage: value?.loadImage,
    openUrl: value?.openUrl,
    resolveUrl: value?.resolveUrl,
  });
}

export function sanitizeResourceUrl(
  resources: NormalizedMarkdownEditorResources,
  kind: MarkdownEditorResourceKind,
  rawUrl: string | null,
) {
  return sanitizeStoredUrl(rawUrl, kind === "image" ? resources.images : resources.links);
}

export function resolveResourceUrl(
  resources: NormalizedMarkdownEditorResources,
  kind: MarkdownEditorResourceKind,
  purpose: MarkdownEditorResourcePurpose,
  storedUrl: string,
) {
  const resolved = resources.resolveUrl
    ? resources.resolveUrl(Object.freeze({ kind, purpose, url: storedUrl }))
    : storedUrl;

  if (resolved === null) {
    return null;
  }

  if (typeof resolved !== "string") {
    throw new TypeError("resources.resolveUrl must return a string or null.");
  }

  return sanitizeResourceUrl(resources, kind, resolved);
}

export function normalizeImageLoadResult(
  resources: NormalizedMarkdownEditorResources,
  result: MarkdownEditorImageLoadResult,
): MarkdownEditorImageLoadResult {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new TypeError("resources.loadImage must return an image-load result object or null.");
  }

  const src = typeof result.src === "string"
    ? sanitizeResourceUrl(resources, "image", result.src)
    : typeof result.src === "object" && result.src !== null
      ? result.src
      : null;
  if (!src) {
    throw new RangeError("resources.loadImage returned an image source rejected by the image policy.");
  }

  const crossOrigin = result.crossOrigin === undefined
    ? resources.images.crossOrigin
    : result.crossOrigin;
  const referrerPolicy = result.referrerPolicy === undefined
    ? resources.images.referrerPolicy
    : result.referrerPolicy;

  if (crossOrigin !== null && crossOrigin !== "anonymous" && crossOrigin !== "use-credentials") {
    throw new RangeError('Image load crossOrigin must be "anonymous", "use-credentials", or null.');
  }
  if (typeof referrerPolicy !== "string" || !REFERRER_POLICIES.has(referrerPolicy)) {
    throw new RangeError("Image load referrerPolicy is not supported.");
  }
  if (result.cleanup !== undefined && typeof result.cleanup !== "function") {
    throw new TypeError("Image load cleanup must be a function.");
  }

  return Object.freeze({
    ...(result.cleanup ? { cleanup: result.cleanup } : {}),
    crossOrigin,
    referrerPolicy,
    src,
  });
}

export function assetMimeTypeIsAllowed(
  mimeType: string,
  allowedMimeTypes: readonly string[],
) {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const slash = normalized.indexOf("/");
  const wildcard = slash > 0 ? `${normalized.slice(0, slash)}/*` : "";
  return allowedMimeTypes.includes("*/*")
    || allowedMimeTypes.includes(normalized)
    || Boolean(wildcard && allowedMimeTypes.includes(wildcard));
}
