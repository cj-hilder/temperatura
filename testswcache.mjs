// sw-cache-policy.js is a classic script the service worker importScripts;
// it attaches itself to `self`, so point that at globalThis before loading it.
globalThis.self = globalThis;
await import('./public/sw-cache-policy.js');
const { isCacheableAsset } = self.TemperaturaCachePolicy;

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
