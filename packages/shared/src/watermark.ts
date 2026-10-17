const LICENSE_RE = /^\/\/ trenchmart-license:.*(?:\r?\n)?/m;
const JSON_FIELD_RE = /^\{\s*"_trenchmart"\s*:\s*\{[^}]*\}\s*,/;

export function licenseLine(orderId: string, wallet: string, sha256: string): string {
  return `// trenchmart-license: ${orderId} ${wallet} ${sha256}`;
}

export function watermarkUserJs(source: string, orderId: string, wallet: string, sha256: string): string {
  const line = licenseLine(orderId, wallet, sha256);
  const marker = '// ==/UserScript==';
  const at = source.indexOf(marker);
  if (at === -1) return `${line}\n${source}`;
  const insertAt = at + marker.length;
  const nl = source[insertAt] === '\r' ? '' : '\n';
  return source.slice(0, insertAt) + '\n' + line + nl + source.slice(insertAt);
}

export function watermarkJsonObject(source: string, orderId: string, wallet: string, sha256: string): string {
  const trimmed = source.trimStart();
  const lead = source.slice(0, source.length - trimmed.length);
  if (!trimmed.startsWith('{')) {
    return `${licenseLine(orderId, wallet, sha256)}\n${source}`;
  }
  const field = `"_trenchmart":${JSON.stringify({ order: orderId, wallet, sha256 })},`;
  return lead + '{' + field + trimmed.slice(1);
}

export function watermarkText(source: string, orderId: string, wallet: string, sha256: string, fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.user.js') || lower.endsWith('.js')) {
    return watermarkUserJs(source, orderId, wallet, sha256);
  }
  const trim = source.trimStart();
  if (trim.startsWith('{')) return watermarkJsonObject(source, orderId, wallet, sha256);
  return `${licenseLine(orderId, wallet, sha256)}\n${source}`;
}

/** Reverse a watermark back to the original bytes when the format allows it. */
export function stripWatermark(source: string): string {
  if (JSON_FIELD_RE.test(source.trimStart())) {
    const leadLen = source.length - source.trimStart().length;
    const body = source.trimStart().replace(JSON_FIELD_RE, '{');
    return source.slice(0, leadLen) + body;
  }
  if (LICENSE_RE.test(source)) return source.replace(LICENSE_RE, '');
  return source;
}

export const ZIP_LICENSE_NAME = 'LICENSE-trenchmart.txt';

export function zipLicenseText(orderId: string, wallet: string, sha256: string): string {
  return `trenchmart-license\norder: ${orderId}\nwallet: ${wallet}\nsha256: ${sha256}\n`;
}
