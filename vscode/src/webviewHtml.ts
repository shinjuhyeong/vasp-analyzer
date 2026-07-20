import { randomBytes } from "node:crypto";

export interface StringUri {
  toString(): string;
}

export interface WebviewUriProvider {
  readonly cspSource: string;
  asWebviewUri(uri: StringUri): StringUri;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function webviewHtml(
  webview: WebviewUriProvider,
  bundleUri: StringUri,
  stylesheetUri: StringUri,
): string {
  const nonce = randomBytes(18).toString("base64url");
  const source = escapeAttribute(webview.asWebviewUri(bundleUri).toString());
  const stylesheet = escapeAttribute(webview.asWebviewUri(stylesheetUri).toString());
  const cspSource = escapeAttribute(webview.cspSource);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource}; script-src 'nonce-${nonce}'; connect-src 'none';">
  <title>VASP Analyzer</title>
  <link rel="stylesheet" href="${stylesheet}">
</head>
<body>
  <main id="app" aria-live="polite">Loading VASP calculation…</main>
  <script nonce="${nonce}" src="${source}"></script>
</body>
</html>`;
}
