/**
 * Public origin of this instance. GitHub needs a URL it can redirect a browser
 * back to, so PUBLIC_URL wins when set; otherwise we trust the proxy headers.
 */
export function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const headers = req.headers;
  const forwardedHost = headers.get('x-forwarded-host') || headers.get('host');
  const forwardedProto =
    headers.get('x-forwarded-proto') || (forwardedHost?.startsWith('localhost') ? 'http' : 'https');
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return new URL(req.url).origin;
}
