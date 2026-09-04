// Private HF Space auth: the hub iframe URL carries a ?__sign JWT, but
// subresource requests normally rely on a *.static.hf.space cookie that
// browsers often block inside the iframe (third-party cookie blocking),
// which 401s every same-origin fetch. Appending the JWT to each request
// authenticates them regardless of cookie policy. No-op locally.
//
// Only ASSET requests (meshes, policies, XML, audio, images) go through
// this now: application code ships in the Vite bundle, which the page load
// itself already authenticated.
const HF_SIGN = new URLSearchParams(location.search).get("__sign");

export const signed = (url) =>
  HF_SIGN ? `${url}${url.includes("?") ? "&" : "?"}__sign=${encodeURIComponent(HF_SIGN)}` : url;
