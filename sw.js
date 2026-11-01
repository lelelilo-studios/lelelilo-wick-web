// Lets the game start with no network once it has been played: the page and this build's files are kept in a cache
// of the build's own, filled when the worker is installed (the page registers it once the game has started), and
// whatever the game fetches later (sprite and sound packs) is kept there too as it arrives.
//
// The page registers `sw.js?v=<build>`: a new build is a new worker, which keeps its own files and then deletes the
// caches of older builds. The page itself is asked of the network first, so a new build shows on the next visit;
// nothing here reloads a page that is open (no surprises mid-game).
//
// The github.io address is shared with every other Lelelilo game, each in a folder of its own: this worker answers
// only for this folder (its scope), and only ever touches caches whose names start with `lelelilo-wick-`.
//
// A preview build (`cargo xtask deploy --preview`) sits in `preview/` inside the published one, so inside its
// worker's scope: the published build's worker leaves that folder alone, and each keeps caches of its own
// (`lelelilo-wick-main-…`, `lelelilo-wick-preview-…`), so neither deletes the other's.

const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const HERE = new URL('./', self.location.href).href;
const PREVIEW = new URL(HERE).pathname.endsWith('/preview/');
const PREFIX = `lelelilo-wick-${PREVIEW ? 'preview' : 'main'}-`;
const CACHE = PREFIX + BUILD;
const at = path => new URL(path, HERE).href;
const PAGE = at('./');
const V = `?v=${encodeURIComponent(BUILD)}`;
// What the game cannot start without, and what is good to have (the intro's still stands in for its video, which is
// never kept)
const NEEDED = [PAGE, at(`pkg/wick.js${V}`), at(`pkg/wick_bg.wasm${V}`)];
const WANTED = [`audio-worklet.js${V}`, `audio.wasm${V}`, 'lelelilo-intro/lelelilo-intro.js', 'lelelilo-intro/lelelilo-intro-still-1024.jpg',
  'favicon.svg', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].map(at);
// Kept as they are first fetched: the game's packs and sounds
const LATER = /^(assets|audio)\/|\.(pack|webm|mp3|ogg|png|jpg|webp|json|bin|wasm|js)$/i;

const fine = res => res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;

/** A file of this exact build an older worker already kept (it fetched it for the page that installed this one). */
async function keptBefore(url) {
  if (!url.includes('?v=')) return null;
  for (const name of await caches.keys()) {
    if (name.startsWith(PREFIX) && name !== CACHE) {
      const res = await (await caches.open(name)).match(url, { ignoreVary: true });
      if (res) return res;
    }
  }
  return null;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const keep = async (url, needed) => {
      // (no-cache: asks the server whether what the browser holds is still current, so nothing stale is kept)
      const res = (await keptBefore(url)) || await fetch(url, { cache: 'no-cache' });
      if (fine(res)) await cache.put(url, res);
      else if (needed) throw new Error(`${url} could not be kept (${res.status})`);
    };
    await Promise.all([...NEEDED.map(u => keep(u, true)), ...WANTED.map(u => keep(u, false).catch(() => {}))]);
    // A new build takes over at once: the page that installed it is already that build
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(HERE)) return;
  // The intro's videos are asked for in ranges (Safari), which a cache cannot answer, and are too big to keep: the
  // browser fetches them as usual, as it does anything asked for in a range
  const path = new URL(req.url).pathname.slice(new URL(HERE).pathname.length);
  if (!PREVIEW && (path === 'preview' || path.startsWith('preview/'))) return;
  if (req.headers.has('range') || (path.startsWith('lelelilo-intro/') && /\.(webm|mp4)$/i.test(path)) || /\.mp4$/i.test(path)) return;
  if (req.mode === 'navigate') event.respondWith(page(event));
  else event.respondWith(file(req, path));
});

/** The page: from the network when it answers within 3 s (a new build shows at once), else as it was kept. */
async function page(event) {
  const cache = await caches.open(CACHE);
  const fresh = fetch(event.request).then(res => {
    if (fine(res)) return cache.put(PAGE, res.clone()).then(() => res, () => res);
    return res;
  });
  event.waitUntil(fresh.catch(() => {}));
  const slow = new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000));
  try {
    return await Promise.race([fresh, slow]);
  } catch (e) {
    return (await cache.match(PAGE, { ignoreVary: true })) || fresh.catch(() => Response.error());
  }
}

/** Any other file of the folder: as it was kept, else from the network (and kept, if it is one of the build's files
 *  or one the game fetches later). Their `?v=<build>` makes each address one build's file, so a kept one never goes
 *  stale. */
async function file(req, path) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(req, { ignoreVary: true });
  if (kept) return kept;
  const res = await fetch(req);
  if (fine(res) && LATER.test(path.split('?')[0])) await cache.put(req, res.clone()).catch(() => {});
  return res;
}
