export interface RendererDocumentPolicy {
  documentURL: string;
  allowDevelopmentOrigin: boolean;
}

/** Only web links may leave Revember for the user's default browser. */
export function isSafeExternalURL(rawURL: string): boolean {
  try {
    const protocol = new URL(rawURL).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Packaged renderers trust one exact local document. The development server
 * may navigate within its own HTTP(S) origin so Vite's development flow keeps
 * working.
 */
export function isTrustedRendererURL(rawURL: string, policy: RendererDocumentPolicy): boolean {
  try {
    const candidate = new URL(rawURL);
    const trusted = new URL(policy.documentURL);
    if (
      policy.allowDevelopmentOrigin
      && (trusted.protocol === "http:" || trusted.protocol === "https:")
    ) {
      return candidate.origin === trusted.origin;
    }
    candidate.hash = "";
    trusted.hash = "";
    return candidate.href === trusted.href;
  } catch {
    return false;
  }
}
