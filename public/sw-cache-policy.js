/* Which responses the service worker may keep in (or serve from) its shell
 * cache. A classic script, not a module: the SW loads it with importScripts,
 * and the Node test loads it after pointing `self` at globalThis.
 *
 * Why this exists: wrangler.jsonc uses `not_found_handling:
 * "single-page-application"`, so Cloudflare answers a request for ANY missing
 * file — including a hashed bundle from an earlier build, e.g.
 * /assets/index-OLD.js — with index.html and a 200. When a stale copy of the
 * page asked for its long-gone bundle, the cache-first route stored that HTML
 * under the bundle's URL. The browser refuses to run HTML as a module script,
 * so the page rendered nothing (a blank screen), and because the entry was
 * cached, it stayed blank on every launch of that stale page. `ok` alone
 * can't catch this; the content type can. */
self.TemperaturaCachePolicy = {
  // A static asset response worth caching: a real success, and not an HTML
  // page masquerading as something else. Navigations never come through
  // here (they're network-first), so HTML is never a legitimate asset.
  isCacheableAsset(response) {
    if (!response || !response.ok) return false;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    return !type.startsWith("text/html");
  },

  // Whether a navigation is to the app itself (the SPA shell) rather than to
  // one of the standalone pages beside it (privacy.html, terms.html, the
  // OAuth popup's oauth-callback.html). The document route stores whatever a
  // navigation returns as THE cached shell, so letting a standalone page
  // through would make an offline launch open the privacy policy instead of
  // the app. The OAuth popup is in this worker's scope, so it would do the
  // same thing on every Connect. SPA routes never end in ".html", so an .html
  // path other than index.html is always a standalone page.
  isAppShellNavigation(pathname, base) {
    if (pathname === base || pathname === base + "index.html") return true;
    return !pathname.toLowerCase().endsWith(".html");
  },
};
