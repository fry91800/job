import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

// Fetches a page from a URL we don't control (a user's offer link, a crawled career site),
// safely:
// * http(s) on the default ports only, no credentials in the URL;
// * the host must resolve to PUBLIC addresses only (no localhost, private networks, cloud
//   metadata 169.254.169.254, IPv6 local ranges…). The check runs in the DNS lookup used
//   for the connection itself, so a host cannot resolve to another address afterwards
//   (DNS rebinding);
// * every redirect is checked the same way; limits on time, size and content type.
// Callers turn failures into their own errors (the API: HTTP errors; the collector: a
// failed site).

const blockedV4 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

const blockedV6 = new net.BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family !== 6) return false;
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms: check the IPv4 part.
  const mapped = /^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[2]);
  if (/^::ffff:/i.test(address)) return false;
  return !blockedV6.check(address, "ipv6");
}

export type SafeFetchOptions = {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  accept: string; // Accept header
  contentTypes: RegExp; // accepted content types of a successful response
  // Private addresses allowed anyway: tests serving pages from a local server only.
  allowedPrivateAddresses?: string[];
  // A POST with this body (a site's own JSON feed, Workday): redirects aren't followed.
  post?: { body: string; contentType: string };
  // Other headers: the public token a career site gives its own pages (Cornerstone).
  headers?: Record<string, string>;
};

export type SafeFetchFailureReason = "invalid_url" | "blocked_address" | "wrong_type" | "too_large" | "too_slow" | "unknown_host" | "unreachable" | "too_many_redirects";

export class SafeFetchError extends Error {
  constructor(
    readonly reason: SafeFetchFailureReason,
    message: string,
  ) {
    super(message);
  }
}

// The final response after redirects. Non-2xx statuses are returned (without body), not
// thrown: a 404 means something to a crawler.
export type SafeFetchResponse = { url: string; status: number; headers: http.IncomingHttpHeaders; contentType: string; text: string };

const allowedFor = (options: SafeFetchOptions) => (address: string) => isPublicAddress(address) || (options.allowedPrivateAddresses ?? []).includes(address);

// DNS lookup that refuses hosts with any non-public address.
export function safeLookupFor(allowed: (address: string) => boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
      if (error) return callback(error, "", 4);
      if (addresses.length === 0 || addresses.some((entry) => !allowed(entry.address))) {
        return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
      }
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function checkUrl(url: URL, options: SafeFetchOptions): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("invalid_url", "Only http(s) addresses can be fetched");
  if (url.username || url.password) throw new SafeFetchError("invalid_url", "Addresses with credentials are not accepted");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const testHost = (options.allowedPrivateAddresses ?? []).includes(host);
  const blocked = new SafeFetchError("blocked_address", "This address cannot be fetched");
  if (url.port && url.port !== "80" && url.port !== "443" && !testHost) throw blocked;
  if (net.isIP(host) && !allowedFor(options)(host)) throw blocked;
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw blocked;
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function request(url: URL, options: SafeFetchOptions, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: options.post ? "POST" : "GET",
        lookup: safeLookupFor(allowedFor(options)),
        signal,
        headers: {
          "User-Agent": options.userAgent,
          Accept: options.accept,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "fr,en;q=0.8",
          ...(options.post && { "Content-Type": options.post.contentType, "Content-Length": String(Buffer.byteLength(options.post.body)) }),
          ...options.headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Redirects and errors: the body is not needed.
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
        }
        const type = String(res.headers["content-type"] ?? "");
        if (!options.contentTypes.test(type)) {
          res.destroy();
          return reject(new SafeFetchError("wrong_type", "not a web page"));
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip()) :
          encoding === "deflate" ? res.pipe(zlib.createInflate()) :
          encoding === "br" ? res.pipe(zlib.createBrotliDecompress()) :
          res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            res.destroy();
            stream.destroy();
            reject(new SafeFetchError("too_large", "page too large"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        stream.on("error", (error) => reject(error));
      },
    );
    req.on("error", reject);
    req.end(options.post?.body);
  });
}

// "text/html; charset=ISO-8859-1", or <meta charset> in the page; UTF-8 by default.
// Gzipped files (a sitemap.xml.gz) are unpacked first.
function decode(body: Buffer, contentType: string): string {
  if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(declared).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export async function safeFetch(input: string, options: SafeFetchOptions): Promise<SafeFetchResponse> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError("invalid_url", "Invalid address");
  }
  const signal = AbortSignal.timeout(options.timeoutMs);

  for (let redirects = 0; ; redirects++) {
    checkUrl(url, options);
    let response: RawResponse;
    try {
      response = await request(url, options, signal);
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EBLOCKED") throw new SafeFetchError("blocked_address", "This address cannot be fetched");
      if (code === "ENOTFOUND") throw new SafeFetchError("unknown_host", "site unreachable (unknown host)");
      if ((error as Error).name === "AbortError" || (error as Error).name === "TimeoutError") throw new SafeFetchError("too_slow", "too slow");
      throw new SafeFetchError("unreachable", "site unreachable");
    }

    if (response.status >= 300 && response.status < 400 && response.headers.location && !options.post) {
      if (redirects >= options.maxRedirects) throw new SafeFetchError("too_many_redirects", "too many redirects");
      url = new URL(response.headers.location, url);
      continue;
    }
    const contentType = String(response.headers["content-type"] ?? "");
    const ok = response.status >= 200 && response.status < 300;
    return { url: url.toString(), status: response.status, headers: response.headers, contentType, text: ok ? decode(response.body, contentType) : "" };
  }
}
