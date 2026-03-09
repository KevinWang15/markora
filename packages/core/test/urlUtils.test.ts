import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_PROTOCOLS, DEFAULT_LINK_PROTOCOLS, getSafeOpenUrl, sanitizeStoredUrl } from '../src/urlUtils';

describe('urlUtils', () => {
  it('allows configured protocols and normalizes relative URLs', () => {
    expect(sanitizeStoredUrl(' https://example.com/docs ', DEFAULT_LINK_PROTOCOLS)).toBe('https://example.com/docs');
    expect(sanitizeStoredUrl('/images/pic.png', DEFAULT_IMAGE_PROTOCOLS)).toBe('http://localhost:3000/images/pic.png');
    expect(getSafeOpenUrl('mailto:test@example.com', DEFAULT_LINK_PROTOCOLS)).toBe('mailto:test@example.com');
  });

  it('rejects disallowed or malformed URLs', () => {
    expect(sanitizeStoredUrl('javascript:alert(1)', DEFAULT_LINK_PROTOCOLS)).toBeNull();
    expect(sanitizeStoredUrl('blob:https://example.com/id', DEFAULT_IMAGE_PROTOCOLS)).toBeNull();
    expect(getSafeOpenUrl('http://[', DEFAULT_LINK_PROTOCOLS)).toBeNull();
  });
});
