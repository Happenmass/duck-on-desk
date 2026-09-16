"use strict";
// pet-market://media/<owner>/<repo>/<revision>/<file> -- a narrow proxy for the
// preview clips and posters of market listings.
//
// The market window keeps a `self`-only CSP: without this the page would have to
// allow https://huggingface.co outright, which would let any script in that
// window reach the whole host. Here the main process resolves a fixed URL shape
// against one origin, at a pinned revision, for media file types only.
const SCHEME = "pet-market";
const ORIGIN = "https://huggingface.co";

// Hub owner and repository names. The Hub itself is stricter than this; the
// point is to exclude separators and traversal, not to re-derive its rules.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const REVISION = /^[a-f0-9]{40}$/;
// Real listings carry names like `media/PXL_20260901_133625139.TS~2.mp4`, so `~`
// belongs here; `/` is handled by matching per segment.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const MEDIA_TYPES = new Map([
  ["mp4", "video/mp4"], ["webm", "video/webm"], ["gif", "image/gif"],
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"],
]);
const MAX_PATH_LENGTH = 512;

function mediaUrl(owner, repo, revision, file) {
  return `${SCHEME}://media/${owner}/${repo}/${revision}/${file}`;
}

// Parses a request URL into the upstream URL it may be served from, or returns
// a status. Pure, so the whole allowlist is testable without Electron.
function resolveMediaRequest(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return { status: 400, reason: "malformed url" }; }
  if (parsed.protocol !== `${SCHEME}:`) return { status: 400, reason: "wrong scheme" };
  if (parsed.host !== "media") return { status: 404, reason: "unknown resource" };
  if (parsed.search || parsed.hash) return { status: 400, reason: "unexpected query" };

  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); } catch { return { status: 400, reason: "malformed path" }; }
  if (pathname.length > MAX_PATH_LENGTH) return { status: 414, reason: "path too long" };
  // A separator that survives decoding would otherwise re-enter the path below.
  if (pathname.includes("\\") || pathname.includes("\0")) return { status: 400, reason: "illegal path" };

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 4) return { status: 404, reason: "incomplete path" };
  const [owner, repo, revision, ...rest] = segments;
  if (!NAME.test(owner) || !NAME.test(repo)) return { status: 400, reason: "bad repository" };
  if (!REVISION.test(revision)) return { status: 400, reason: "bad revision" };
  if (!rest.every((segment) => SEGMENT.test(segment))) return { status: 400, reason: "bad file path" };

  const file = rest.join("/");
  const extension = (file.split(".").pop() || "").toLowerCase();
  const contentType = MEDIA_TYPES.get(extension);
  if (!contentType) return { status: 415, reason: "unsupported media type" };

  return { status: 200, url: `${ORIGIN}/${owner}/${repo}/resolve/${revision}/${file}`, contentType };
}

// Declared here, registered by src/shell/privileged-schemes.js -- every privileged
// scheme in the app must go out in a single registerSchemesAsPrivileged() call.
// `stream` lets <video> receive the ranged responses the handler forwards.
const PRIVILEGED_SCHEME = { scheme: SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} };

function installHandler(protocol, net) {
  protocol.handle(SCHEME, async (request) => {
    const resolved = resolveMediaRequest(request.url);
    if (resolved.status !== 200) return new Response(resolved.reason, { status: resolved.status });
    // Forwarding Range keeps video scrubbing working; nothing else is forwarded,
    // so no cookie or credential from this app can reach the Hub.
    const range = request.headers.get("range");
    try {
      const upstream = await net.fetch(resolved.url, {
        headers: range ? { Range: range } : {},
        signal: AbortSignal.timeout(30000),
      });
      if (!upstream.ok && upstream.status !== 206) {
        return new Response("preview unavailable", { status: upstream.status === 404 ? 404 : 502 });
      }
      const headers = new Headers({ "Content-Type": resolved.contentType, "Cache-Control": "public, max-age=86400" });
      for (const header of ["content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(header);
        if (value) headers.set(header, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      return new Response("preview unavailable", { status: 502 });
    }
  });
}

module.exports = { SCHEME, ORIGIN, MEDIA_TYPES, PRIVILEGED_SCHEME, mediaUrl, resolveMediaRequest, installHandler };
