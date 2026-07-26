import { describe, expect, it } from "vitest";
import { isSafeExternalURL, isTrustedRendererURL } from "../electron/security-policy";

describe("Electron renderer security policy", () => {
  it("trusts only the exact packaged app document while allowing hash changes", () => {
    const policy = {
      documentURL: "file:///Applications/Revember.app/Contents/Resources/app.asar/out/renderer/index.html",
      allowDevelopmentOrigin: false
    };

    expect(isTrustedRendererURL(policy.documentURL, policy)).toBe(true);
    expect(isTrustedRendererURL(`${policy.documentURL}#notes`, policy)).toBe(true);
    expect(isTrustedRendererURL("file:///tmp/index.html", policy)).toBe(false);
    expect(isTrustedRendererURL("file:///Applications/Revember.app/Contents/Resources/app.asar/out/renderer/other.html", policy)).toBe(false);
    expect(isTrustedRendererURL(`${policy.documentURL}?untrusted=1`, policy)).toBe(false);
  });

  it("allows the configured development server origin without trusting other origins", () => {
    const policy = {
      documentURL: "http://127.0.0.1:5173/",
      allowDevelopmentOrigin: true
    };

    expect(isTrustedRendererURL("http://127.0.0.1:5173/src/hmr", policy)).toBe(true);
    expect(isTrustedRendererURL("http://localhost:5173/", policy)).toBe(false);
    expect(isTrustedRendererURL("https://127.0.0.1:5173/", policy)).toBe(false);
    expect(isTrustedRendererURL("file:///tmp/index.html", policy)).toBe(false);
  });

  it("opens only HTTP(S) destinations externally", () => {
    expect(isSafeExternalURL("https://example.com/docs")).toBe(true);
    expect(isSafeExternalURL("http://127.0.0.1:3000/path")).toBe(true);
    expect(isSafeExternalURL("file:///Users/example/.ssh/id_ed25519")).toBe(false);
    expect(isSafeExternalURL("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalURL("revember://topic/bits")).toBe(false);
    expect(isSafeExternalURL("not a URL")).toBe(false);
  });
});
