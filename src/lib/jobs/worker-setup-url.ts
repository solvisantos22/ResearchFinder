export function resolveWorkerSetupAppUrl(headerList: Headers) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return parseHttpOrigin(configured, "Configured app URL must be an HTTP(S) origin");

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL or NEXT_PUBLIC_APP_URL is required in production");
  }

  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") || "http";
  return parseHttpOrigin(`${protocol}://${host}`, "Derived app URL must be an HTTP(S) origin");
}

function parseHttpOrigin(value: string, errorMessage: string) {
  try {
    const url = new URL(value);
    const isHttpOrigin = url.protocol === "http:" || url.protocol === "https:";
    const isOriginOnly = url.pathname === "/" && url.search === "" && url.hash === "";

    if (!isHttpOrigin || !isOriginOnly) {
      throw new Error(errorMessage);
    }

    return url.origin;
  } catch {
    throw new Error(errorMessage);
  }
}
