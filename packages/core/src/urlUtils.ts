export const DEFAULT_LINK_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"] as const;
export const DEFAULT_IMAGE_PROTOCOLS = ["http:", "https:", "data:"] as const;

export function sanitizeStoredUrl(rawUrl: string | null, allowedProtocols: readonly string[]) {
  if (!rawUrl) {
    return null;
  }

  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl) {
    return null;
  }

  try {
    const parsed = new URL(trimmedUrl, window.location.href);
    const hasExplicitScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmedUrl);

    if (!hasExplicitScheme && !trimmedUrl.startsWith("//")) {
      return parsed.href;
    }

    return allowedProtocols.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function getSafeOpenUrl(rawUrl: string | null, allowedProtocols: readonly string[]) {
  return sanitizeStoredUrl(rawUrl, allowedProtocols);
}
