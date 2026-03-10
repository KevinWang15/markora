export const DEFAULT_LINK_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"] as const;
export const DEFAULT_IMAGE_PROTOCOLS = ["http:", "https:", "data:"] as const;

const SCHEME_NAME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*$/;

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

export function sanitizeStoredUrl(rawUrl: string | null, allowedProtocols: readonly string[]) {
  if (!rawUrl) {
    return null;
  }

  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl) {
    return null;
  }

  if (trimmedUrl.startsWith("//")) {
    return null;
  }

  const schemeCandidate = getSchemeCandidate(trimmedUrl);

  if (schemeCandidate === null) {
    return trimmedUrl;
  }

  if (!SCHEME_NAME_PATTERN.test(schemeCandidate)) {
    return null;
  }

  try {
    const parsed = new URL(trimmedUrl);
    return allowedProtocols.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function getSafeOpenUrl(rawUrl: string | null, allowedProtocols: readonly string[]) {
  return sanitizeStoredUrl(rawUrl, allowedProtocols);
}
