import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_DATA_MIME_TYPES,
  DEFAULT_IMAGE_PROTOCOLS,
  DEFAULT_LINK_PROTOCOLS,
  DEFAULT_MAX_DATA_URL_BYTES,
  normalizeMarkdownEditorResources,
  resolveResourceUrl,
  sanitizeResourceUrl,
} from '../src/resourcePolicy';
import { sanitizeStoredUrl } from '../src/urlUtils';

describe('resourcePolicy', () => {
  it('uses secure, immutable defaults for links and images', () => {
    const resources = normalizeMarkdownEditorResources(undefined);

    expect(resources.links).toMatchObject({
      allowCredentials: false,
      allowedDataMimeTypes: [],
      allowedProtocols: DEFAULT_LINK_PROTOCOLS,
      allowRelative: true,
      maxDataUrlBytes: DEFAULT_MAX_DATA_URL_BYTES,
    });
    expect(resources.images).toMatchObject({
      allowCredentials: false,
      allowedDataMimeTypes: DEFAULT_IMAGE_DATA_MIME_TYPES,
      allowedProtocols: DEFAULT_IMAGE_PROTOCOLS,
      allowRelative: true,
      crossOrigin: null,
      maxDataUrlBytes: DEFAULT_MAX_DATA_URL_BYTES,
      referrerPolicy: 'no-referrer',
    });
    expect(resources.assets).toBeNull();
    expect(Object.isFrozen(resources)).toBe(true);
    expect(Object.isFrozen(resources.links)).toBe(true);
    expect(Object.isFrozen(resources.links.allowedProtocols)).toBe(true);
    expect(Object.isFrozen(resources.images)).toBe(true);
    expect(Object.isFrozen(resources.images.allowedDataMimeTypes)).toBe(true);

    expect(sanitizeResourceUrl(resources, 'link', '/guide')).toBe('/guide');
    expect(sanitizeResourceUrl(resources, 'link', 'https://example.com/guide')).toBe(
      'https://example.com/guide',
    );
    expect(sanitizeResourceUrl(resources, 'link', 'data:text/plain,hello')).toBeNull();
    expect(sanitizeResourceUrl(resources, 'image', 'data:image/png;base64,AA==')).toBe(
      'data:image/png;base64,AA==',
    );
    expect(sanitizeResourceUrl(resources, 'image', 'data:image/svg+xml,%3Csvg%2F%3E')).toBeNull();
  });

  it('normalizes explicitly allowed custom protocols without weakening forbidden schemes', () => {
    const resources = normalizeMarkdownEditorResources({
      images: {
        allowedDataMimeTypes: [],
        allowedProtocols: [' ASSET:', 'asset:'],
        allowRelative: false,
      },
      links: {
        allowedProtocols: [' ACME:', 'https:', 'acme:'],
        allowRelative: false,
      },
    });

    expect(resources.links.allowedProtocols).toEqual(['acme:', 'https:']);
    expect(resources.images.allowedProtocols).toEqual(['asset:']);
    expect(sanitizeResourceUrl(resources, 'link', 'acme:document/42')).toBe('acme:document/42');
    expect(sanitizeResourceUrl(resources, 'link', 'document/42')).toBeNull();
    expect(sanitizeResourceUrl(resources, 'image', 'asset:images/hero.png')).toBe(
      'asset:images/hero.png',
    );
    expect(sanitizeResourceUrl(resources, 'image', 'https://example.com/hero.png')).toBeNull();

    expect(() => normalizeMarkdownEditorResources({
      links: { allowedProtocols: ['javascript:'] },
    })).toThrow(RangeError);
    expect(() => normalizeMarkdownEditorResources({
      links: { allowedProtocols: ['vbscript:'] },
    })).toThrow(RangeError);
  });

  it('lets the resolver decline and gives it immutable request context', () => {
    let received: unknown;
    const resources = normalizeMarkdownEditorResources({
      resolveUrl(request) {
        received = request;
        return null;
      },
    });

    expect(resolveResourceUrl(resources, 'image', 'load', './hero.png')).toBeNull();
    expect(received).toEqual({
      kind: 'image',
      purpose: 'load',
      url: './hero.png',
    });
    expect(Object.isFrozen(received)).toBe(true);
  });

  it('reapplies policy to resolver output and rejects invalid return shapes', () => {
    const scriptResources = normalizeMarkdownEditorResources({
      resolveUrl: () => 'javascript:alert(1)',
    });
    const credentialResources = normalizeMarkdownEditorResources({
      resolveUrl: () => 'https://user:secret@example.com/private',
    });
    const invalidResources = normalizeMarkdownEditorResources({
      resolveUrl: () => 42 as never,
    });

    expect(resolveResourceUrl(scriptResources, 'link', 'open', '/safe')).toBeNull();
    expect(resolveResourceUrl(credentialResources, 'link', 'open', '/safe')).toBeNull();
    expect(() => resolveResourceUrl(invalidResources, 'link', 'open', '/safe')).toThrow(
      new TypeError('resources.resolveUrl must return a string or null.'),
    );
  });
});

describe('sanitizeStoredUrl policy', () => {
  it('rejects credentials, backslashes, and embedded control characters by default', () => {
    const policy = normalizeMarkdownEditorResources(undefined).links;

    expect(sanitizeStoredUrl('https://user:secret@example.com/private', policy)).toBeNull();
    expect(sanitizeStoredUrl('https://example.com\\@evil.example/path', policy)).toBeNull();
    expect(sanitizeStoredUrl('\\\\evil.example\\share', policy)).toBeNull();
    expect(sanitizeStoredUrl('/images\\hero.png', policy)).toBeNull();
    expect(sanitizeStoredUrl('https://exa\nmple.com', policy)).toBeNull();
    expect(sanitizeStoredUrl('/safe\u0000unsafe', policy)).toBeNull();
    expect(sanitizeStoredUrl('/safe\u001funsafe', policy)).toBeNull();
    expect(sanitizeStoredUrl('/safe\u007funsafe', policy)).toBeNull();
  });

  it('allows credentials only through an explicit policy opt-in', () => {
    const policy = normalizeMarkdownEditorResources({
      links: { allowCredentials: true },
    }).links;

    expect(sanitizeStoredUrl('https://user:secret@example.com/private', policy)).toBe(
      'https://user:secret@example.com/private',
    );
  });

  it('enforces exact decoded byte limits for base64 data URLs', () => {
    const policy = normalizeMarkdownEditorResources({
      images: { maxDataUrlBytes: 3 },
    }).images;

    expect(sanitizeStoredUrl('data:image/png;base64,QUJD', policy)).toBe(
      'data:image/png;base64,QUJD',
    );
    expect(sanitizeStoredUrl('data:image/png;base64,QUJDRA==', policy)).toBeNull();
    expect(sanitizeStoredUrl('data:image/png;base64,not-base64', policy)).toBeNull();
  });

  it('counts decoded UTF-8 bytes for percent-encoded data URLs', () => {
    const policy = normalizeMarkdownEditorResources({
      images: { maxDataUrlBytes: 4 },
    }).images;

    expect(sanitizeStoredUrl('data:image/png,A%E2%82%AC', policy)).toBe(
      'data:image/png,A%E2%82%AC',
    );
    expect(sanitizeStoredUrl('data:image/png,AB%E2%82%AC', policy)).toBeNull();
    expect(sanitizeStoredUrl('data:image/png,%E2%82', policy)).toBeNull();
  });

  it('enforces the encoded character limit and rejects whitespace-obfuscated data', () => {
    const dataUrl = 'data:image/png;base64,AA==';
    const exactPolicy = normalizeMarkdownEditorResources({
      images: { maxDataUrlBytes: 1, maxDataUrlCharacters: dataUrl.length },
    }).images;
    const shortPolicy = normalizeMarkdownEditorResources({
      images: { maxDataUrlBytes: 1, maxDataUrlCharacters: dataUrl.length - 1 },
    }).images;

    expect(sanitizeStoredUrl(dataUrl, exactPolicy)).toBe(dataUrl);
    expect(sanitizeStoredUrl(dataUrl, shortPolicy)).toBeNull();
    expect(sanitizeStoredUrl('data:image/png;base64,A A==', exactPolicy)).toBeNull();
  });

  it('rejects raw whitespace in relative and absolute destinations', () => {
    const policy = normalizeMarkdownEditorResources(undefined).links;

    expect(sanitizeStoredUrl('/path with spaces', policy)).toBeNull();
    expect(sanitizeStoredUrl('https://example.com/a b', policy)).toBeNull();
    expect(sanitizeStoredUrl('/path%20with%20spaces', policy)).toBe('/path%20with%20spaces');
  });
});
