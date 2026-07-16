export const DEFAULT_LINK_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"] as const;
export const DEFAULT_IMAGE_PROTOCOLS = ["http:", "https:", "data:"] as const;

const SCHEME_NAME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*$/;

export type StoredUrlPolicy = Readonly<{
  allowCredentials: boolean;
  allowedDataMimeTypes: readonly string[];
  allowedProtocols: readonly string[];
  allowRelative: boolean;
  maxDataUrlBytes: number;
  maxDataUrlCharacters: number;
}>;

function isProtocolList(value: readonly string[] | StoredUrlPolicy): value is readonly string[] {
  return Array.isArray(value);
}

function getSchemeCandidate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === ":") {
      return value.slice(0, index);
    }

    if (char === "/" || char === "?" || char === "#") {
      return null;
    }
  }

  return null;
}

function getDataUrlByteLength(payload: string, base64: boolean) {
  if (base64) {
    const compact = payload.replace(/\s/gu, "");

    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(compact)) {
      return null;
    }

    const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
    return (compact.length / 4) * 3 - padding;
  }

  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  } catch {
    return null;
  }
}

function dataUrlMatchesPolicy(url: string, policy: StoredUrlPolicy) {
  if (url.length > policy.maxDataUrlCharacters || /\s/u.test(url)) {
    return false;
  }

  const match = url.match(/^data:([^,]*),(.*)$/isu);

  if (!match) {
    return false;
  }

  const metadata = match[1].split(";");
  const mimeType = (metadata.shift() || "text/plain").trim().toLowerCase();
  if (metadata.some((entry) => entry.toLowerCase() !== "base64") || metadata.length > 1) {
    return false;
  }
  const base64 = metadata[0]?.toLowerCase() === "base64";
  const byteLength = getDataUrlByteLength(match[2], base64);

  return policy.allowedDataMimeTypes.includes(mimeType)
    && byteLength !== null
    && byteLength <= policy.maxDataUrlBytes;
}

export function sanitizeStoredUrl(
  rawUrl: string | null,
  allowedProtocolsOrPolicy: readonly string[] | StoredUrlPolicy,
) {
  if (!rawUrl) {
    return null;
  }

  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl || /[\\\s\u0000-\u001f\u007f]/u.test(trimmedUrl)) {
    return null;
  }

  if (trimmedUrl.startsWith("//")) {
    return null;
  }

  const schemeCandidate = getSchemeCandidate(trimmedUrl);

  if (schemeCandidate === null) {
    return isProtocolList(allowedProtocolsOrPolicy) || allowedProtocolsOrPolicy.allowRelative
      ? trimmedUrl
      : null;
  }

  if (!SCHEME_NAME_PATTERN.test(schemeCandidate)) {
    return null;
  }

  try {
    const parsed = new URL(trimmedUrl);
    const allowedProtocols = isProtocolList(allowedProtocolsOrPolicy)
      ? allowedProtocolsOrPolicy
      : allowedProtocolsOrPolicy.allowedProtocols;

    if (!allowedProtocols.includes(parsed.protocol)) {
      return null;
    }

    if (
      !isProtocolList(allowedProtocolsOrPolicy)
      && !allowedProtocolsOrPolicy.allowCredentials
      && (parsed.username || parsed.password)
    ) {
      return null;
    }

    if (
      parsed.protocol === "data:"
      && !isProtocolList(allowedProtocolsOrPolicy)
      && !dataUrlMatchesPolicy(trimmedUrl, allowedProtocolsOrPolicy)
    ) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

export function getSafeOpenUrl(
  rawUrl: string | null,
  allowedProtocolsOrPolicy: readonly string[] | StoredUrlPolicy,
) {
  return sanitizeStoredUrl(rawUrl, allowedProtocolsOrPolicy);
}
