export function getWebOrigin(value = process.env.WEB_ORIGIN) {
  const configuredOrigin = (value ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")).trim();
  if (!configuredOrigin) throw new Error("WEB_ORIGIN must be configured in production");
  if (/[\u0000-\u001f\u007f]/.test(configuredOrigin)) {
    throw new Error("WEB_ORIGIN must be a single HTTP(S) origin without control characters");
  }

  let url: URL;
  try {
    url = new URL(configuredOrigin);
  } catch {
    throw new Error("WEB_ORIGIN must be a valid HTTP(S) origin, such as https://crm.example.com");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("WEB_ORIGIN must contain only an HTTP(S) scheme and host");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("WEB_ORIGIN must use HTTPS in production");
  }

  return url.origin;
}
