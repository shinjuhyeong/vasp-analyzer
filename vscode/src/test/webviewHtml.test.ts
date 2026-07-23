import { describe, expect, it } from "vitest";

import { webviewHtml, type WebviewUriProvider } from "../webviewHtml.js";

describe("webviewHtml", () => {
  it("uses a nonce CSP and only a converted external bundle source", () => {
    const webview: WebviewUriProvider = {
      cspSource: "vscode-webview://unit-test",
      asWebviewUri: (uri) => ({
        toString: () => uri.toString().endsWith(".css")
          ? "vscode-resource://bundle/index.css"
          : "vscode-resource://bundle/index.js",
      }),
    };
    const html = webviewHtml(
      webview,
      { toString: () => "file:///extension/dist/webview/index.js" },
      { toString: () => "file:///extension/dist/webview/index.css" },
    );

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-");
    expect(html).toContain('src="vscode-resource://bundle/index.js"');
    expect(html).toContain('rel="stylesheet"');
    expect(html).toContain('href="vscode-resource://bundle/index.css"');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toContain("eval(");
  });
});
