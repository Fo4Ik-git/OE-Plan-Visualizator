/**
 * OE Plan Creator talks only to a local OE (Rhino / localhost).
 * Remote Portal / DC hosts are rejected on purpose.
 */
export function isLocalOeHost(host: string): boolean {
  const raw = (host || "").trim();
  if (!raw) return false;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : `http://${raw}`;
    const u = new URL(withScheme);
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
      return true;
    }
    if (h === "host.docker.internal" || h === "kubernetes.docker.internal") {
      return true;
    }
    // RFC1918 — local k8s / OrbStack / docker desktop often expose these
    if (
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)
    ) {
      return true;
    }
    if (h.endsWith(".local") || h.endsWith(".localhost")) return true;
    return false;
  } catch {
    return false;
  }
}

export function assertLocalOeHost(host: string): string {
  const h = (host || "").trim();
  if (!isLocalOeHost(h)) {
    throw new Error(
      `Only local OE is allowed (got “${h || "(empty)"}”). Use http://localhost:31880 from settings.`,
    );
  }
  return h.replace(/\/$/, "");
}
