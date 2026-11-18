// sw-cache-policy.js is a classic script the service worker importScripts;
// it attaches itself to `self`, so point that at globalThis before loading it.
globalThis.self = globalThis;
await import('./public/sw-cache-policy.js');
const { isCacheableAsset, isAppShellNavigation } = self.TemperaturaCachePolicy;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n + '  ' + d)); };

const res = (status, contentType) =>
  new Response(status === 204 ? null : 'x', { status, headers: contentType ? { 'content-type': contentType } : {} });

console.log('\nisCacheableAsset — real assets are cached:');
{
  ok('a JavaScript bundle', isCacheableAsset(res(200, 'text/javascript')));
  ok('application/javascript with a charset', isCacheableAsset(res(200, 'application/javascript; charset=utf-8')));
  ok('a stylesheet', isCacheableAsset(res(200, 'text/css')));
  ok('an icon', isCacheableAsset(res(200, 'image/png')));
  ok('the manifest', isCacheableAsset(res(200, 'application/manifest+json')));
  ok('no content type at all is still a success worth keeping', isCacheableAsset(res(200, null)));
}

console.log('\nisCacheableAsset — the blank-screen case: Cloudflare\'s SPA fallback answering a missing bundle with index.html (200):');
{
  ok('text/html is never cached as an asset', !isCacheableAsset(res(200, 'text/html')));
  ok('text/html with a charset, any case', !isCacheableAsset(res(200, 'Text/HTML; charset=utf-8')));
}

console.log('\nisCacheableAsset — failures are never cached:');
{
  ok('404', !isCacheableAsset(res(404, 'text/javascript')));
  ok('500', !isCacheableAsset(res(500, 'text/javascript')));
  ok('no response at all', !isCacheableAsset(undefined));
}

console.log('\nisAppShellNavigation — only the app is stored as the cached shell:');
{
  ok('the root is the app', isAppShellNavigation('/', '/'));
  ok('index.html is the app', isAppShellNavigation('/index.html', '/'));
  ok('privacy.html is not (an offline launch would open the policy)', !isAppShellNavigation('/privacy.html', '/'));
  ok('terms.html is not', !isAppShellNavigation('/terms.html', '/'));
  ok('the OAuth popup page is not', !isAppShellNavigation('/oauth-callback.html', '/'));
  // Cloudflare redirects /x.html → /x, so the pages also arrive without the
  // extension. This is the case the first version of this rule got wrong.
  ok('/oauth-callback, after Cloudflare drops the .html, is not', !isAppShellNavigation('/oauth-callback', '/'));
  ok('/privacy and /terms without .html are not', !isAppShellNavigation('/privacy', '/') && !isAppShellNavigation('/terms', '/'));
  ok('any other path is not: the app has no path routes', !isAppShellNavigation('/recipe/abc', '/'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
