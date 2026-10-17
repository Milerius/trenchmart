// ==UserScript==
// @name         Trojan Trenches Intel (Animal + Reuse + OG + Bag Guard)
// @namespace    milerius.trojan.intel
// @version      1.4.0
// @description  Labels unnamed-animal coins, shows reused name / image / migrated history, finds the OG and alerts when a copy is moving
// @match        https://trojan.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ───────────────────────── CONFIG ─────────────────────────
  const API = 'https://data-gateway.api.trojan.com/v1';
  const CACHE_TTL_MS = 60_000;      // re-check a coin after 60s (new copies appear fast)
  const MAX_CONCURRENT = 3;
  const SETTINGS_KEY = 'tti_settings_v1';
  const DEFAULTS = {
    columns: { 'New Tokens': true, 'About to Migrate': false, 'Migrated': false },
    animalLabels: true,       // 🐾 labels
    showNamedAnimal: false,   // also tag "named" animals (grey)
    reuseBadges: true,        // ♻ / 🖼 / 🎓 badges
    dimReusedName: false,     // dim cards whose name was used before
    dimIfMigratedCopy: false, // dim only if an older copy already migrated
    imageMinCount: 1,
    // OG
    ogMinMc: 10000,           // an un-migrated older copy must have at least this MC to count as OG
    // "copy is moving" alerts
    alerts: true,
    alertPct: 50,             // MC up at least this % ...
    alertWindowSec: 60,       // ... within this many seconds
    alertMinMc: 8000,         // and current MC at least this
    alertSound: true,
    // 🛡 Bag Guard (watches what YOU hold, on every Trojan page)
    bagGuard: true,
    bagMinUsd: 5,             // ignore dust bags
    vampAlerts: true,
    bagPollSec: 30,           // how often each bag is re-checked
    vampMinMc: 15000,         // a copy must be at least this MC ...
    vampRatio: 0.3,           // ... and either >= this fraction of your coin's MC
    vampPct: 50,              // ... or up this % since first seen (within 10 min)
    vampMaxAgeH: 24,          // only copies created in the last N hours (or newer than your coin)
    exitAlerts: true,         // tracked / KOL wallets selling your bag
    rotationAlerts: true,     // where those sellers go next
    rotationWatchMin: 30,     // follow a seller for N minutes after they sell
    clusterAlerts: true,      // N tracked wallets buying the same coin
    clusterN: 3,
    clusterMin: 10,
    // 📡 Cohort widget on the coin page
    cohortWidget: true,
    cohortWindowMin: 60,      // copies launched within ±N min of this coin
    cohortRefreshSec: 10,
    cohortMovePct: 30,        // also show any copy up this % in 5 min, whenever it launched
    cohortMinMc: 5000,        // hide dead copies below this MC (unless OG / moving)
    quickBuyAmount: '0.1',    // must match one of your Buy preset buttons in Trojan's instant-trade panel
    quickSellPct: '25',       // must match one of your Sell preset buttons
    rotateSellPct: '100',     // ⇄ rotate sells this % of the coin you're on, then buys the other
    tradeConfirm: true,       // ask before ⚡ / ⇄ / sell
  };
  const settings = loadSettings();

  // Bonding-curve venues. Anything else (PumpSwap, Raydium*, MeteoraDAMM, Orca…) = migrated.
  const BONDING_DEX = /^(pumpfun|launchlab|meteoradbc|moonshot|boop|bonk|believe|heaven|jupstudio)/i;

  // ───────────────────────── ANIMAL LOGIC ─────────────────────────
  const ANIMALS = new Set((
    'dog doge dogs doggo doggy pup puppy puppies pupper hound shiba inu corgi pug poodle husky chihuahua dachshund retriever labrador beagle bulldog terrier ' +
    'cat cats kitty kitten kittens kitteh catto meow tabby lion lioness lions tiger tigers leopard cheetah jaguar panther puma cougar lynx ' +
    'frog frogs toad bear bears panda pandas koala polar grizzly wolf wolves fox foxes coyote jackal ' +
    'monkey monkeys ape apes gorilla chimp chimpanzee orangutan baboon lemur sloth ' +
    'bird birds parrot penguin owl owls eagle hawk falcon crow raven duck ducks duckling goose geese swan chicken chick hen rooster pigeon dove flamingo peacock pelican toucan ostrich emu turkey ' +
    'fish shark sharks whale whales dolphin octopus squid crab lobster shrimp prawn jellyfish seal walrus otter beaver platypus turtle tortoise ' +
    'snake snakes cobra python viper lizard gecko iguana chameleon croc crocodile alligator gator dino dinosaur trex raptor dragon ' +
    'horse horses pony donkey mule zebra giraffe elephant hippo rhino camel llama alpaca goat goats sheep lamb cow cows bull ox yak bison buffalo pig pigs piggy hog boar deer moose elk reindeer antelope gazelle kangaroo ' +
    'rabbit rabbits bunny bunnies hare hamster hamsters mouse mice rat rats squirrel chipmunk hedgehog porcupine raccoon skunk badger mole ferret weasel capybara possum opossum armadillo bat bats ' +
    'bee bees ant ants spider butterfly ladybug beetle snail slug worm caterpillar cricket mosquito fly'
  ).split(/\s+/));
  // CJK / other-script animal words (substring match)
  const CJK_ANIMALS = ['猫', '狗', '犬', '熊', '熊猫', '蛙', '青蛙', '狼', '狐', '虎', '狮', '猴', '兔', '鼠', '猪', '牛', '马', '羊', '鸡', '鸭', '鹅', '鸟', '鱼', '龙', '蛇', '龟', '象', '鹿', '豹'];
  // Famous meme characters = already "named" even though the word looks generic
  const NAMED_MEMES = new Set('pepe doge bonk wif popcat pnut moodeng chillguy brett andy landwolf mog michi giga goat neiro kabosu fwog mew hippo myro wen bome slerf retardio ponke mumu pengu'.split(' '));
  // Words that are not a "name": filler, adjectives, colors, crypto noise
  const FILLER = new Set((
    'the a an of on in to and or for with my your our his her its this that is are be le la el de da ' +
    'coin coins token tokens sol solana pump fun meme memes official real og first only original classic ai bot dao inu fi cto ca ' +
    'baby babies lil little big fat cute angry sad happy giant tiny smol small chubby based dancing crying sleepy lazy wild crazy mad funny ' +
    'evil good bad old young super mega ultra king queen lord mr mrs ms sir lady boy girl man guy bro chad degen ' +
    'white black red blue green yellow pink purple orange golden gold silver brown grey gray rainbow ' +
    'one two three 1 2 3 x v2 v3 jr sr pet pets animal animals'
  ).split(/\s+/));

  function words(str) {
    return String(str || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9À-ɏ]+/)
      .filter(Boolean);
  }
  function singular(w) {
    if (ANIMALS.has(w)) return w;
    if (w.endsWith('ies') && ANIMALS.has(w.slice(0, -3) + 'y')) return w.slice(0, -3) + 'y';
    if (w.endsWith('es') && ANIMALS.has(w.slice(0, -2))) return w.slice(0, -2);
    if (w.endsWith('s') && ANIMALS.has(w.slice(0, -1))) return w.slice(0, -1);
    return null;
  }
  // compound tickers like "CATCOIN", "BABYDOGE", "PIGGYSOL"
  function compoundAnimal(w) {
    for (const a of ANIMALS) {
      if (a.length < 3 || !w.includes(a)) continue;
      const rest = w.replace(a, '');
      if (!rest || FILLER.has(rest) || rest.length <= 1) return a;
    }
    return null;
  }

  /** @returns {{kind:'unnamed'|'named'|null, animal?:string, why?:string}} */
  function classifyAnimal(name, symbol, description) {
    const nameWords = words(name);
    const symWords = words(symbol);
    const all = [...new Set([...nameWords, ...symWords])];

    if (all.some(w => NAMED_MEMES.has(w))) {
      const meme = all.find(w => NAMED_MEMES.has(w));
      return { kind: 'named', animal: meme, why: 'known meme character' };
    }

    // CJK name handling
    const cjkName = String(name || '') + String(symbol || '');
    const cjkHit = CJK_ANIMALS.find(c => cjkName.includes(c));
    if (cjkHit) {
      const stripped = cjkName.replace(/[a-z0-9\s$]/gi, '').replace(new RegExp(CJK_ANIMALS.join('|'), 'g'), '');
      return stripped.length <= 1 ? { kind: 'unnamed', animal: cjkHit, why: 'name is just the animal' }
                                  : { kind: 'named', animal: cjkHit, why: 'animal + other words' };
    }

    let animal = null;
    const rest = [];
    for (const w of nameWords.length ? nameWords : symWords) {
      const a = singular(w) || compoundAnimal(w);
      if (a) { animal = animal || a; continue; }
      if (!FILLER.has(w)) rest.push(w);
    }
    if (!animal) {
      for (const w of symWords) { const a = singular(w) || compoundAnimal(w); if (a) { animal = a; break; } }
    }
    if (animal) {
      return rest.length === 0
        ? { kind: 'unnamed', animal, why: 'name is just the animal' }
        : { kind: 'named', animal, why: 'name: ' + rest.join(' ') };
    }

    // Animal only in description → the ticker is the animal's proper name
    const d = words(description).slice(0, 80);
    const dHit = d.map(singular).find(Boolean);
    if (dHit) return { kind: 'named', animal: dHit, why: 'animal in description, name is a proper name' };
    return { kind: null };
  }

  // ───────────────────────── API ─────────────────────────
  const cache = new Map(); // mint -> {t, data}
  const inflight = new Map();
  let active = 0;
  const waiters = [];
  async function slot() {
    if (active < MAX_CONCURRENT) { active++; return; }
    await new Promise(r => waiters.push(r));
    active++;
  }
  function release() { active--; const n = waiters.shift(); if (n) n(); }

  async function getJSON(url) {
    await slot();
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; } finally { release(); }
  }

  function summarize(list, mint) {
    const byAddr = new Map();
    for (const t of list || []) {
      const cur = byAddr.get(t.address);
      const migrated = /-migrated$/i.test(t.variant || '') || !BONDING_DEX.test(t.dex || '');
      const pump = isPump(t);
      if (!cur) byAddr.set(t.address, { ...t, migrated, pump });
      else {
        cur.migrated = cur.migrated || migrated;
        cur.marketCap = Math.max(cur.marketCap || 0, t.marketCap || 0);
        if (migrated) { cur.dex = t.dex; cur.poolAddress = t.poolAddress; }
      }
    }
    const self = byAddr.get(mint);
    byAddr.delete(mint);
    const selfTime = self ? Date.parse(self.createdAt) : Date.now();
    const others = [...byAddr.values()];
    const older = others.filter(t => Date.parse(t.createdAt) < selfTime);
    const migrated = others.filter(t => t.migrated);
    const bestMc = others.reduce((m, t) => Math.max(m, t.marketCap || 0), 0);
    others.sort((a, b) => (b.migrated - a.migrated) || (b.marketCap || 0) - (a.marketCap || 0));
    const og = pickOG(older);
    return { total: others.length, older: older.length, migrated: migrated.length, bestMc, list: others, og,
             selfMc: self?.marketCap || 0, selfCreated: selfTime };
  }

  // Only pump.fun launches count as OG / vamp (Meteora, Launchlab, Moonshot… are ignored).
  // `variant` is the launchpad the coin was born on; `dex` is where it trades now (PumpSwap after migration).
  function isPump(t) {
    if (t.variant) return /^pumpfun/i.test(t.variant);          // PumpFun, PumpFun-Mayhem, PumpFun-Migrated
    return /^pumpfun/i.test(t.dex || '') || /pump$/.test(t.address || ''); // e.g. no variant but trades on PumpFunAMM
  }

  // OG = older copy that migrated (highest MC wins); else the oldest older copy with real MC.
  function pickOG(olderAll) {
    const older = olderAll.filter(t => t.pump);
    const mig = older.filter(t => t.migrated).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
    if (mig.length) return mig[0];
    const alive = older.filter(t => (t.marketCap || 0) >= settings.ogMinMc)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return alive[0] || null;
  }

  async function analyze(mint, pool, maxAge = CACHE_TTL_MS) {
    const c = cache.get(mint);
    if (c && Date.now() - c.t < maxAge) return c.data;
    if (inflight.has(mint)) return inflight.get(mint);
    const p = (async () => {
      const [byName, byImg, info] = await Promise.all([
        getJSON(`${API}/tokens/similar/${mint}?chain=solana&method=name`),
        getJSON(`${API}/tokens/similar/${mint}?chain=solana&method=image`),
        pool ? getJSON(`${API}/tokens/pools/${pool}?chain=solana`) : null,
      ]);
      const data = {
        name: summarize(byName?.data?.tokens, mint),
        image: summarize(byImg?.data?.tokens, mint),
        info: info?.data || null,
      };
      // OG: prefer same name, fall back to same image
      data.og = data.name.og ? { ...data.name.og, via: 'name' } : data.image.og ? { ...data.image.og, via: 'image' } : null;
      cache.set(mint, { t: Date.now(), data });
      return data;
    })().finally(() => inflight.delete(mint));
    inflight.set(mint, p);
    return p;
  }

  // ───────────────────────── UI ─────────────────────────
  const css = `
  .tti-wrap{position:absolute;left:6px;right:6px;bottom:1px;z-index:5;display:flex;gap:3px;justify-content:center;overflow:hidden;pointer-events:auto;font:600 9px/1 ui-sans-serif,system-ui,sans-serif}
  .tti-b{padding:1px 5px;border-radius:4px;cursor:pointer;white-space:nowrap;border:1px solid rgba(0,0,0,.55)}
  .tti-ok{background:#166534;color:#dcfce7}
  .tti-warn{background:#854d0e;color:#fef9c3}
  .tti-bad{background:#991b1b;color:#fee2e2}
  .tti-img{background:#1e40af;color:#dbeafe}
  .tti-ani{background:#f97316;color:#111}
  .tti-named{background:#475569;color:#f1f5f9}
  .tti-load{background:#334155;color:#cbd5e1}
  .tti-dim{opacity:.35;filter:grayscale(.7)}
  .tti-ring{box-shadow:inset 0 0 0 2px rgba(249,115,22,.85);border-radius:8px}
  #tti-pop{position:fixed;z-index:99999;max-width:440px;max-height:60vh;overflow:auto;background:#0f1115;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:10px;padding:8px;font:12px/1.35 ui-sans-serif,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6)}
  #tti-pop h4{margin:4px 0 6px;font-size:12px;color:#9ca3af;font-weight:600}
  #tti-pop a{color:#e5e7eb;text-decoration:none;display:flex;justify-content:space-between;gap:8px;padding:3px 4px;border-radius:6px}
  #tti-pop a:hover{background:#1c2029}
  #tti-pop .m{color:#c084fc;font-weight:700}
  #tti-pop .s{color:#9ca3af}
  #tti-gear{position:fixed;right:12px;bottom:48px;z-index:99998;background:#151821;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:8px;padding:5px 8px;cursor:pointer;font:600 11px ui-sans-serif,system-ui}
  #tti-panel{position:fixed;right:12px;bottom:80px;z-index:99998;background:#0f1115;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:10px;padding:10px 12px;font:12px ui-sans-serif,system-ui;display:none;min-width:240px}
  #tti-panel label{display:flex;gap:6px;align-items:center;margin:4px 0;cursor:pointer}
  #tti-panel b{display:block;margin:8px 0 2px;color:#9ca3af;font-size:11px}
  #tti-panel input[type=number]{width:70px;background:#151821;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:5px;padding:2px 4px}
  .tti-og{background:#eab308;color:#111}
  #tti-pop .og{border:1px solid rgba(234,179,8,.6);background:rgba(234,179,8,.08);margin-bottom:6px}
  #tti-toasts{position:fixed;left:12px;bottom:48px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:360px}
  .tti-toast{background:#0f1115;color:#e5e7eb;border:1px solid rgba(234,179,8,.7);border-radius:10px;padding:10px 12px;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6);animation:tti-in .2s ease-out}
  .tti-toast .t{font-weight:700;font-size:13px;margin-bottom:4px}
  .tti-toast .s{color:#9ca3af}
  .tti-toast .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
  .tti-toast button{background:#1c2029;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:6px;padding:4px 8px;cursor:pointer;font:600 11px ui-sans-serif,system-ui}
  .tti-toast button.buy{background:#16a34a;border-color:#16a34a;color:#04130a}
  .tti-toast button.og{background:#eab308;border-color:#eab308;color:#111}
  @keyframes tti-in{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}
  .tti-buyring{outline:3px solid #eab308 !important;outline-offset:2px;border-radius:8px}
  #tti-ogbar{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;background:#eab308;color:#111;font:700 12px ui-sans-serif,system-ui;padding:6px 12px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.5);cursor:pointer}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const fmtUsd = n => !n ? '$0' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n);
  const ago = iso => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function badge(cls, text, title, onClick) {
    const b = document.createElement('span');
    b.className = 'tti-b ' + cls;
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick && onClick(e); }, true);
    b.addEventListener('mousedown', e => e.stopPropagation(), true);
    return b;
  }

  function closePop() { document.getElementById('tti-pop')?.remove(); }
  document.addEventListener('click', e => { if (!e.target.closest?.('#tti-pop')) closePop(); });

  // Same-tab navigation through Trojan's router (no reload). Ctrl/Cmd-click still opens a new tab on links.
  function go(url) {
    try {
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      setTimeout(armBuyPanel, 600);
    } catch { location.assign(url); }
  }
  // intercept plain clicks on our own links (popups, widget rows) → same tab
  document.addEventListener('click', e => {
    const a = e.target.closest?.('#tti-pop a, #tti-cw a.r[href]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    closePop?.();
    go(a.getAttribute('href'));
  }, true);

  const termUrl = (t, hash = '') => `/terminal?token=${encodeURIComponent(t.address)}&pool=${encodeURIComponent(t.poolAddress || '')}${hash}`;
  const ogLine = og => `${og.migrated ? '🎓 migrated' : 'bonding'} · ${esc(og.dex)} · MC ${fmtUsd(og.marketCap)} · ${ago(og.createdAt)} old`;

  function openPop(e, title, summary) {
    closePop();
    const pop = document.createElement('div');
    pop.id = 'tti-pop';
    const og = summary.og;
    const ogHtml = og ? `<a class="og" href="${termUrl(og)}"><span>👑 <b>OG</b> ${esc(og.name)} <span class="s">$${esc(og.symbol)}</span></span><span class="s">${ogLine(og)}</span></a>` : '';
    const rows = summary.list.slice(0, 40).map(t => `
      <a href="/terminal?token=${esc(t.address)}&pool=${esc(t.poolAddress)}">
        <span style="${t.pump ? '' : 'opacity:.45'}">${t.migrated ? '<span class="m">🎓</span> ' : ''}${esc(t.name)} <span class="s">$${esc(t.symbol)}</span></span>
        <span class="s">${esc(t.dex)} · ${ago(t.createdAt)} · MC ${fmtUsd(t.marketCap)}</span>
      </a>`).join('');
    pop.innerHTML = `<h4>${esc(title)} — ${summary.total} other (${summary.older} older, ${summary.migrated} migrated, best MC ${fmtUsd(summary.bestMc)})</h4>${ogHtml}${rows || '<div class="s">none</div>'}`;
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
    pop.style.top = Math.min(e.clientY + 10, innerHeight - r.height - 8) + 'px';
  }

  // ───────────────────────── CARD SCANNING ─────────────────────────
  const COLS = ['New Tokens', 'About to Migrate', 'Migrated'];

  function columnOf(card) {
    let c = card;
    for (let i = 0; i < 12 && c; i++) {
      c = c.parentElement;
      if (!c) break;
      const ps = c.querySelectorAll('p');
      for (const p of ps) {
        const t = p.textContent.trim();
        if (p.childElementCount === 0 && COLS.includes(t) && !card.contains(p)) return t;
      }
    }
    return null;
  }

  function cardText(card) {
    const name = card.querySelector('p.label-sm.text-text-primary')?.textContent.trim() || '';
    const sub = card.querySelector('p.label-2xs.text-text-secondary')?.textContent.trim() || '';
    return { symbol: name, name: sub };
  }

  async function processCard(card) {
    let url;
    try { url = new URL(card.getAttribute('href'), location.origin); } catch { return; }
    const mint = url.searchParams.get('token');
    const pool = url.searchParams.get('pool');
    if (!mint) return;
    if (card.dataset.ttiMint === mint && card._ttiWrap?.isConnected) return;

    const col = card.dataset.ttiCol || columnOf(card);
    if (!col) return;
    card.dataset.ttiCol = col;
    if (!settings.columns[col]) { cleanup(card); return; }

    card.dataset.ttiMint = mint;
    cleanup(card);
    // Slim strip along the card's bottom edge, under the % pills (the list clips anything outside the card).
    const host = card.firstElementChild || card;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const wrap = document.createElement('div');
    wrap.className = 'tti-wrap';
    host.appendChild(wrap);
    card._ttiWrap = wrap;

    // Instant animal label from the card text
    const txt = cardText(card);
    let animal = classifyAnimal(txt.name, txt.symbol, '');
    renderAnimal(card, wrap, animal);

    if (!settings.reuseBadges && animal.kind) return;
    wrap.appendChild(badge('tti-load', '…'));

    const data = await analyze(mint, pool);
    if (card.dataset.ttiMint !== mint) return; // card was recycled meanwhile
    wrap.querySelector('.tti-load')?.remove();

    // Refine animal label using full name + description
    if (data.info) {
      const a2 = classifyAnimal(data.info.name || txt.name, data.info.symbol || txt.symbol, data.info.description);
      if (a2.kind !== animal.kind) { animal = a2; renderAnimal(card, wrap, animal); }
    }

    if (!settings.reuseBadges) return;
    const n = data.name, im = data.image;
    if (n.total === 0) {
      wrap.appendChild(badge('tti-ok', '✨ new name', 'No other token with this name'));
    } else {
      const cls = n.migrated ? 'tti-bad' : 'tti-warn';
      wrap.appendChild(badge(cls, `♻ ${n.older}/${n.total}`,
        `Reused name: ${n.older} older, ${n.total} total copies · best MC ${fmtUsd(n.bestMc)} — click for list`,
        e => openPop(e, 'Reused name', n)));
      if (n.migrated) wrap.appendChild(badge('tti-bad', `🎓 ${n.migrated}`,
        `${n.migrated} token(s) with this name already migrated — click for list`,
        e => openPop(e, 'Reused name', n)));
    }
    if (im.total >= settings.imageMinCount) {
      wrap.appendChild(badge(im.migrated ? 'tti-bad' : 'tti-img', `🖼 ${im.total}${im.migrated ? ' 🎓' + im.migrated : ''}`,
        `Reused / similar image: ${im.total} (${im.older} older, ${im.migrated} migrated) — click for list`,
        e => openPop(e, 'Reused image', im)));
    }

    if (data.og) {
      const og = data.og;
      wrap.appendChild(badge('tti-og', `👑 ${og.migrated ? '🎓 ' : ''}${fmtUsd(og.marketCap)}`,
        `OG (same ${og.via}): ${og.name} $${og.symbol} — ${og.migrated ? 'migrated' : 'bonding'}, ${ago(og.createdAt)} old. Click to see it`,
        e => openPop(e, `Reused ${og.via}`, og.via === 'name' ? n : im)));
    }

    const dim = (settings.dimReusedName && n.older > 0) || (settings.dimIfMigratedCopy && n.migrated > 0);
    card.classList.toggle('tti-dim', !!dim);
  }

  // ───────────────────────── "COPY IS MOVING" ALERTS ─────────────────────────
  const mcHist = new Map();     // mint -> [[t, mc], ...]
  const alerted = new Map();    // mint -> last alert time
  const muted = new Set();

  function parseUsd(s) {
    const m = String(s).replace(/[,\s]/g, '').match(/\$?([\d.]+)([KMB])?/i);
    if (!m) return null;
    return parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1);
  }
  function cardMc(card) {
    for (const s of card.querySelectorAll('span')) {
      if (s.childElementCount) continue;
      const par = s.parentElement?.textContent.replace(/\s/g, '') || '';
      if (par.startsWith('MC$') && s.textContent.trim().startsWith('$')) return parseUsd(s.textContent);
    }
    return null;
  }

  function sampleMcs() {
    if (!settings.alerts || !location.pathname.startsWith('/trenches')) return;
    const now = Date.now();
    const winMs = settings.alertWindowSec * 1000;
    document.querySelectorAll('a[data-tti-mint]').forEach(card => {
      const mint = card.dataset.ttiMint;
      if (!settings.columns[card.dataset.ttiCol]) return;
      const mc = cardMc(card);
      if (!mc) return;
      const h = mcHist.get(mint) || [];
      h.push([now, mc]);
      while (h.length && now - h[0][0] > winMs * 2) h.shift();
      mcHist.set(mint, h);

      const c = cache.get(mint);
      if (!c?.data?.og || muted.has(mint)) return;
      if (now - (alerted.get(mint) || 0) < 5 * 60_000) return;
      const base = h.filter(([t]) => now - t <= winMs).reduce((m, [, v]) => Math.min(m, v), Infinity);
      if (!isFinite(base) || h[0][0] > now - 5000) return; // need a few seconds of history
      const pct = (mc / base - 1) * 100;
      if (pct >= settings.alertPct && mc >= settings.alertMinMc) {
        alerted.set(mint, now);
        const url = new URL(card.getAttribute('href'), location.origin);
        showMovingToast({
          mint, pct, mc,
          name: c.data.info?.name || cardText(card).name,
          symbol: c.data.info?.symbol || cardText(card).symbol,
          newUrl: url.pathname + url.search,
          og: c.data.og,
        });
      }
    });
  }
  setInterval(sampleMcs, 3000);

  function toastBox() {
    let b = document.getElementById('tti-toasts');
    if (!b) { b = document.createElement('div'); b.id = 'tti-toasts'; document.body.appendChild(b); }
    return b;
  }
  function beep() {
    if (!settings.alertSound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.06;
      o.connect(g).connect(ctx.destination); o.start();
      o.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
      o.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  function showMovingToast(a) {
    const og = a.og;
    const t = document.createElement('div');
    t.className = 'tti-toast';
    t.innerHTML = `
      <div class="t">🚀 New ${esc(a.symbol || a.name)} is moving <span class="s">(+${Math.round(a.pct)}% · ${fmtUsd(a.mc)})</span></div>
      <div>👑 OG: <b>${esc(og.name)}</b> <span class="s">$${esc(og.symbol)}</span></div>
      <div class="s">${ogLine(og)} · same ${og.via}</div>
      <div class="row">
        <button class="og" data-a="og">Open OG</button>
        <button class="buy" data-a="buy">Buy OG</button>
        <button data-a="new">Open new one</button>
        <button data-a="mute">Mute</button>
        <button data-a="x">✕</button>
      </div>`;
    t.addEventListener('click', e => {
      const act = e.target.closest('button')?.dataset.a;
      if (!act) return;
      if (act === 'og') go(termUrl(og));
      if (act === 'buy') {
        try { localStorage.setItem('tti_buy_pending', JSON.stringify({ mint: og.address, t: Date.now() })); } catch {}
        go(termUrl(og, '#tti-buy'));
      }
      if (act === 'new') go(a.newUrl);
      if (act === 'mute') muted.add(a.mint);
      t.remove();
    });
    toastBox().prepend(t);
    beep();
    setTimeout(() => t.remove(), 30_000);
  }

  /** Generic toast. buttons: [{label, cls, fn}] */
  function notify(html, buttons = [], { border = '#eab308', ttl = 30_000, sound = true } = {}) {
    const t = document.createElement('div');
    t.className = 'tti-toast';
    t.style.borderColor = border;
    t.innerHTML = html + '<div class="row"></div>';
    const row = t.querySelector('.row');
    [...buttons, { label: '✕' }].forEach(b => {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.cls) el.className = b.cls;
      el.onclick = e => { e.stopPropagation(); b.fn && b.fn(); t.remove(); };
      row.appendChild(el);
    });
    toastBox().prepend(t);
    while (toastBox().children.length > 6) toastBox().lastElementChild.remove();
    if (sound) beep();
    setTimeout(() => t.remove(), ttl);
    return t;
  }

  // ───────────────────────── 🛡 BAG GUARD ─────────────────────────
  // Watches your open positions: vamps (copies pumping), tracked/KOL wallets dumping your bag,
  // where those sellers rotate to, and tracked-wallet cluster buys.
  const TA = 'https://trade.api.trojan.com/v1';
  const SKIP_MINTS = new Set([
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qJxkVxZ6pBkdPZ5LZcTUQeEFk', // USDC (typo-safe check below too)
    'EPjFWdd5AufqSSqeM2qJxkVxZ6pBkdPZ5LZcTUQeEFkK',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  ]);
  const shortAddr = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '?';
  const bg = {
    myWallets: [],
    tracked: new Map(),          // address -> name
    bags: new Map(),             // mint -> {mint, pool, symbol, name, usd, firstBuy, status:{}}
    copyHist: new Map(),         // copyMint -> [[t, mc]]
    vampAlerted: new Map(),      // `${bag}|${copy}` -> mc at alert
    seenTx: new Set(),
    lastTxCheck: new Map(),      // bag mint -> timestamp of newest tx we've seen
    sellers: new Map(),          // wallet -> {bagMint, bagSymbol, soldAt, label}
    rotAlerted: new Set(),       // `${wallet}|${mint}`
    rotGroups: new Map(),        // newMint -> {wallets:Set, t, toast}
    clusterBuys: new Map(),      // mint -> Map(wallet -> t)
    clusterAlerted: new Map(),
    lastBagPoll: 0,
  };

  async function postJSON(url, body) {
    await slot();
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.ok ? await r.json() : null;
    } catch { return null; } finally { release(); }
  }

  async function loadWallets() {
    const [mine, tracked] = await Promise.all([
      getJSON(`${TA}/wallets?chain=solana&isArchived=false`),
      getJSON(`${TA}/tracked-wallets?chain=solana`),
    ]);
    if (mine?.data) bg.myWallets = mine.data.map(w => w.address);
    if (tracked?.data) { bg.tracked.clear(); bg.trackedSym = new Map(); tracked.data.forEach(w => { bg.tracked.set(w.address, w.name || shortAddr(w.address)); if (w.symbol) bg.trackedSym.set(w.address, w.symbol); }); }
  }
  const walletLabel = a => bg.tracked.has(a) ? bg.tracked.get(a) : 'KOL ' + shortAddr(a);

  async function pollBags() {
    if (!bg.myWallets.length) return;
    const res = await postJSON(`${API}/tokens/positions-with-tokens`, {
      chain: 'solana', current: true, walletAddress: bg.myWallets, limit: 100, orderLastUpdate: 'desc',
    });
    if (!res?.data) return;
    const agg = new Map(); // sum the same coin across your wallets
    for (const p of res.data) {
      const mint = p.tokenAddress;
      if (SKIP_MINTS.has(mint) || !(p.currentTokenBalance > 0)) continue;
      if (!(p.numBuys > 0 || p.amountUsdSpent > 0)) continue; // skip airdropped spam (never bought)
      if (/^(USDC|USDT|SOL|WSOL)$/i.test(p.token?.symbol || '')) continue;
      const a = agg.get(mint) || { pool: p.poolAddress, symbol: p.token?.symbol, name: p.token?.name, usd: 0, firstBuy: Infinity };
      a.usd += p.usdValue || 0;
      a.firstBuy = Math.min(a.firstBuy, p.firstBuyTimestamp || Date.now());
      agg.set(mint, a);
    }
    for (const [mint, a] of agg) {
      if (a.usd < settings.bagMinUsd) { agg.delete(mint); continue; }
      const b = bg.bags.get(mint) || { mint, status: {} };
      Object.assign(b, a);
      bg.bags.set(mint, b);
    }
    for (const m of [...bg.bags.keys()]) if (!agg.has(m)) bg.bags.delete(m);
    renderBags();
  }

  async function checkBag(b) {
    const now = Date.now();
    // 1) VAMPS: copies (same name or image) that are pumping
    const data = await analyze(b.mint, b.pool, settings.bagPollSec * 1000);
    const myMc = data.name.selfMc || data.image.selfMc || 0;
    const myCreated = data.name.selfCreated || data.image.selfCreated;
    const copies = new Map();
    [...data.name.list.map(t => ({ ...t, via: 'name' })), ...data.image.list.map(t => ({ ...t, via: 'image' }))]
      .forEach(t => { if (!copies.has(t.address)) copies.set(t.address, t); });
    let vamps = 0;
    const firstRun = !b.seeded;
    const seedList = [];
    for (const c of copies.values()) {
      if (!c.pump) continue; // pump.fun copies only
      const created = Date.parse(c.createdAt);
      if (!(created > myCreated || now - created < settings.vampMaxAgeH * 3600_000)) continue;
      const h = bg.copyHist.get(c.address) || [];
      h.push([now, c.marketCap || 0]);
      while (h.length && now - h[0][0] > 10 * 60_000) h.shift();
      bg.copyHist.set(c.address, h);
      const base = Math.min(...h.map(x => x[1]));
      const rise = base > 0 ? (c.marketCap / base - 1) * 100 : 0;
      const big = c.marketCap >= settings.vampMinMc && (c.marketCap >= myMc * settings.vampRatio || (h.length > 1 && rise >= settings.vampPct));
      if (!big) continue;
      vamps++;
      const key = b.mint + '|' + c.address;
      if (firstRun) { bg.vampAlerted.set(key, c.marketCap); seedList.push(c); continue; } // summarize once instead of spamming
      if (!settings.vampAlerts) continue;
      const prev = bg.vampAlerted.get(key);
      if (prev && c.marketCap < prev * 2) continue; // re-alert only if it doubled again
      bg.vampAlerted.set(key, c.marketCap);
      notify(`
        <div class="t">🧛 Your ${esc(b.symbol)} is getting vamped</div>
        <div>${esc(c.name)} <span class="s">$${esc(c.symbol)}</span> · same ${c.via} · ${ago(c.createdAt)} old</div>
        <div class="s">Copy MC ${fmtUsd(c.marketCap)}${h.length > 1 ? ` (+${Math.round(rise)}%)` : ''} vs yours ${fmtUsd(myMc)} · ${esc(c.dex)}${c.migrated ? ' 🎓' : ''}</div>`,
        [
          { label: 'Open copy', cls: 'og', fn: () => go(termUrl(c)) },
          { label: 'Open my bag', fn: () => go(termUrl({ address: b.mint, poolAddress: b.pool })) },
        ], { border: '#a855f7' });
    }
    if (firstRun) {
      b.seeded = true;
      if (seedList.length && settings.vampAlerts) {
        seedList.sort((x, y) => y.marketCap - x.marketCap);
        const top = seedList[0];
        notify(`
          <div class="t">🧛 ${esc(b.symbol)}: ${seedList.length} bigger/fresh cop${seedList.length > 1 ? 'ies' : 'y'} out there</div>
          <div>Top: ${esc(top.name)} <span class="s">$${esc(top.symbol)}</span> · MC ${fmtUsd(top.marketCap)}${top.migrated ? ' 🎓' : ''} · ${ago(top.createdAt)} old</div>
          <div class="s">Yours: MC ${fmtUsd(myMc)} · from now on you'll get an alert per new pumping copy</div>`,
          [{ label: 'Open top copy', cls: 'og', fn: () => go(termUrl(top)) },
           { label: 'See all', fn: () => { const fake = { clientX: innerWidth / 2 - 200, clientY: 120 }; setTimeout(() => openPop(fake, `Copies of ${b.symbol}`, { ...data.name, list: seedList, total: seedList.length, older: 0, migrated: seedList.filter(x => x.migrated).length, bestMc: top.marketCap, og: null }), 0); } }],
          { border: '#a855f7', sound: false });
      }
    }
    b.status.vamps = vamps;
    b.status.myMc = myMc;

    // 2) SMART MONEY EXITS on your bag (tracked + Trojan KOL list)
    if (settings.exitAlerts || settings.rotationAlerts) {
      const body = { chain: 'solana', limit: 100, order: 'desc', tokenAddress: b.mint, includeUserWallets: false };
      const [tr, kol] = await Promise.all([
        postJSON(`${API}/tokens/transactions`, { ...body, includeTrackedWallets: true }),
        postJSON(`${API}/tokens/transactions`, { ...body, includeKolWallets: true }),
      ]);
      const txs = [...(tr?.data || []), ...(kol?.data || [])]
        .filter(x => (x.type === 'buy' || x.type === 'sell') && !bg.myWallets.includes(x.walletAddress));
      const since = bg.lastTxCheck.get(b.mint);
      const holders = new Map(); // wallet -> net (buys - sells) count for status
      const newSells = [];
      for (const x of txs) {
        const id = x.transactionHash + ':' + x.ixIndex;
        const t = Date.parse(x.createdAt);
        holders.set(x.walletAddress, (holders.get(x.walletAddress) || 0) + (x.type === 'buy' ? 1 : x.type === 'sell' ? -1 : 0));
        if (bg.seenTx.has(id)) continue;
        bg.seenTx.add(id);
        if (since && t > since && x.type === 'sell') newSells.push(x);
      }
      bg.lastTxCheck.set(b.mint, Math.max(since || 0, ...txs.map(x => Date.parse(x.createdAt)), now - 60_000));
      b.status.smart = [...holders.keys()].length;
      b.status.smartSelling = [...holders.values()].filter(v => v < 0).length;

      if (newSells.length) {
        const wallets = [...new Set(newSells.map(x => x.walletAddress))];
        const usd = newSells.reduce((s, x) => s + (x.tokenUsdValue || 0), 0);
        wallets.forEach(w => bg.sellers.set(w, { bagMint: b.mint, bagSymbol: b.symbol, soldAt: now - 5_000, label: walletLabel(w) }));
        if (settings.exitAlerts) {
          notify(`
            <div class="t">🏃 Smart money selling your ${esc(b.symbol)}</div>
            <div>${wallets.slice(0, 4).map(w => esc(walletLabel(w))).join(', ')}${wallets.length > 4 ? ` +${wallets.length - 4}` : ''}</div>
            <div class="s">${newSells.length} sell(s) · ~${fmtUsd(usd)} · watching where they rotate…</div>`,
            [{ label: 'Open my bag', cls: 'og', fn: () => go(termUrl({ address: b.mint, poolAddress: b.pool })) }],
            { border: '#ef4444' });
        }
      }
    }
    renderBags();
  }

  // 3) ROTATION: what sellers of your bag buy next (positions poll, covers KOLs + tracked)
  async function pollRotation() {
    if (!settings.rotationAlerts) return;
    const now = Date.now();
    for (const [w, s] of bg.sellers) if (now - s.soldAt > settings.rotationWatchMin * 60_000) bg.sellers.delete(w);
    if (!bg.sellers.size) return;
    const res = await postJSON(`${API}/tokens/positions-with-tokens`, {
      chain: 'solana', walletAddress: [...bg.sellers.keys()], limit: 100, orderLastUpdate: 'desc',
    });
    for (const p of res?.data || []) {
      const s = bg.sellers.get(p.walletAddress);
      if (!s || p.tokenAddress === s.bagMint || SKIP_MINTS.has(p.tokenAddress)) continue;
      if (/^(USDC|USDT|SOL|WSOL)$/i.test(p.token?.symbol || '')) continue;
      if (!(p.lastBuyTimestamp > s.soldAt)) continue;
      rotation(p.walletAddress, s, { address: p.tokenAddress, poolAddress: p.poolAddress, symbol: p.token?.symbol, name: p.token?.name, usd: p.amountUsdSpent });
    }
  }

  function rotation(wallet, s, tok) {
    const key = wallet + '|' + tok.address;
    if (bg.rotAlerted.has(key)) return;
    bg.rotAlerted.add(key);
    // group several sellers landing on the same coin into one toast
    const g = bg.rotGroups.get(tok.address) || { wallets: new Set(), t: Date.now(), toast: null };
    g.wallets.add(wallet);
    bg.rotGroups.set(tok.address, g);
    g.toast?.remove();
    const cachedOg = cache.get(tok.address)?.data;
    const isCopy = cachedOg && [...cachedOg.name.list, ...cachedOg.image.list].some(x => x.address === s.bagMint);
    const names = [...g.wallets].map(walletLabel);
    g.toast = notify(`
      <div class="t">🔄 Rotation: ${esc(s.bagSymbol)} → ${esc(tok.symbol || shortAddr(tok.address))}${isCopy ? ' 🧛' : ''}</div>
      <div>${names.slice(0, 4).map(esc).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''} sold your ${esc(s.bagSymbol)} and bought ${esc(tok.name || tok.symbol || '')}</div>
      <div class="s">${g.wallets.size} wallet(s)${isCopy ? ' · this is a copy of your coin' : ''}</div>`,
      [{ label: 'Open new coin', cls: 'buy', fn: () => go(termUrl(tok)) }],
      { border: '#22c55e' });
  }

  // 4) LIVE FEED: Trojan pushes tracked-wallet trades over its websocket ("alert" messages).
  //    We read them passively by wrapping MessageEvent.data — nothing is sent.
  (function hookWs() {
    const desc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
    if (!desc?.get || window.__ttiWsHooked) return;
    window.__ttiWsHooked = true;
    Object.defineProperty(MessageEvent.prototype, 'data', {
      configurable: true,
      get() {
        const v = desc.get.call(this);
        try {
          if (typeof v === 'string' && v.length < 20000 && v.indexOf('"type":"alert"') > -1) onLiveAlert(v);
        } catch {}
        return v;
      },
    });
  })();

  function onLiveAlert(raw) {
    const msg = JSON.parse(raw);
    const ti = msg?.data?.tokenInteraction;
    if (!ti || ti.interactionType !== 'buy') return;
    const id = ti.txHash + ':' + ti.ixIndex;
    if (bg.seenTx.has('ws' + id)) return;
    bg.seenTx.add('ws' + id);
    const wallet = msg.data.targetWalletAddress || ti.walletAddress;
    const meta = msg.data.tokenMetadata || {};
    const tok = { address: ti.tokenAddress, poolAddress: ti.poolAddress, symbol: meta.symbol, name: meta.name };
    if (SKIP_MINTS.has(tok.address) || /^(USDC|USDT|SOL|WSOL)$/i.test(tok.symbol || '')) return;

    // rotation (instant path for alert-enabled tracked wallets)
    const s = bg.sellers.get(wallet);
    if (settings.rotationAlerts && s && tok.address !== s.bagMint && ti.timestamp > s.soldAt) rotation(wallet, s, tok);

    // cluster buys
    if (!settings.clusterAlerts) return;
    const now = Date.now();
    const m = bg.clusterBuys.get(tok.address) || new Map();
    m.set(wallet, now);
    for (const [w, t] of m) if (now - t > settings.clusterMin * 60_000) m.delete(w);
    bg.clusterBuys.set(tok.address, m);
    const last = bg.clusterAlerted.get(tok.address) || 0;
    if (m.size >= settings.clusterN && (m.size > last)) {
      if (last && m.size < last + 2) return; // re-alert only when 2 more join
      bg.clusterAlerted.set(tok.address, m.size);
      const names = [...m.keys()].map(walletLabel);
      const held = bg.bags.has(tok.address);
      notify(`
        <div class="t">🔥 ${m.size} tracked wallets buying ${esc(tok.symbol || shortAddr(tok.address))}${held ? ' (you hold it)' : ''}</div>
        <div>${names.slice(0, 5).map(esc).join(', ')}${names.length > 5 ? ` +${names.length - 5}` : ''}</div>
        <div class="s">within ${settings.clusterMin} min</div>`,
        [{ label: 'Open', cls: 'buy', fn: () => go(termUrl(tok)) }],
        { border: '#f97316' });
    }
  }

  // Bag list inside the 🐾 panel
  const bagsBox = document.createElement('div');
  function renderBags() {
    if (!bagsBox.isConnected) return;
    if (!bg.bags.size) { bagsBox.innerHTML = '<div style="color:#9ca3af">no open bags</div>'; return; }
    bagsBox.innerHTML = [...bg.bags.values()].sort((a, b) => b.usd - a.usd).map(b => {
      const st = b.status;
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0">
        <a href="${termUrl({ address: b.mint, poolAddress: b.pool })}" style="color:#e5e7eb;text-decoration:none">${esc(b.symbol)} <span style="color:#9ca3af">${fmtUsd(b.usd)}</span></a>
        <span>${st.vamps ? `🧛${st.vamps} ` : ''}${st.smart != null ? `🧠${st.smart}` : '…'}${st.smartSelling ? ` <span style="color:#fca5a5">🏃${st.smartSelling}</span>` : ''}</span></div>`;
    }).join('');
  }

  async function bagLoop() {
    if (!settings.bagGuard) return;
    try {
      if (!bg.myWallets.length || Date.now() - (bg.walletsAt || 0) > 5 * 60_000) { await loadWallets(); bg.walletsAt = Date.now(); }
      await pollBags();
      for (const b of bg.bags.values()) await checkBag(b);
      await pollRotation();
    } catch (e) { console.warn('[tti] bag guard', e); }
  }
  (async function loop() {
    await bagLoop();
    setTimeout(loop, Math.max(10, settings.bagPollSec) * 1000);
  })();
  setInterval(() => { if (settings.bagGuard) pollRotation(); }, 15_000);

  // ───────────────────────── TERMINAL: "Buy OG" landing ─────────────────────────
  function armBuyPanel() {
    if (!location.pathname.startsWith('/terminal')) return;
    // the router may strip the #hash, so also accept a fresh localStorage hand-off
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem('tti_buy_pending')); } catch {}
    const tok = new URLSearchParams(location.search).get('token');
    const viaStore = pending && pending.mint === tok && Date.now() - pending.t < 30_000;
    if (location.hash !== '#tti-buy' && !viaStore) return;
    try { localStorage.removeItem('tti_buy_pending'); } catch {}
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const tx = b.textContent.trim();
        return b.offsetHeight && (/^Buy\b/.test(tx) || /^Buy for/.test(tx));
      });
      if (btns.length || tries > 40) {
        clearInterval(iv);
        btns.forEach(b => b.classList.add('tti-buyring'));
        const main = btns.find(b => /^Buy for/.test(b.textContent.trim())) || btns[0];
        main?.scrollIntoView({ block: 'center' });
        const bar = document.createElement('div');
        bar.id = 'tti-ogbar';
        bar.textContent = '👑 This is the OG — buy panel highlighted, pick your amount and buy (click to dismiss)';
        bar.onclick = () => { bar.remove(); btns.forEach(b => b.classList.remove('tti-buyring')); };
        document.body.appendChild(bar);
        setTimeout(() => bar.remove(), 15_000);
        history.replaceState(null, '', location.pathname + location.search);
      }
    }, 250);
  }
  armBuyPanel();

  function renderAnimal(card, wrap, a) {
    wrap.querySelector('.tti-ani,.tti-named')?.remove();
    card.classList.remove('tti-ring');
    if (!settings.animalLabels || !a.kind) return;
    if (a.kind === 'unnamed') {
      wrap.prepend(badge('tti-ani', `🐾 ${a.animal} · no name`, a.why));
      card.classList.add('tti-ring');
    } else if (settings.showNamedAnimal) {
      wrap.prepend(badge('tti-named', `🐾 ${a.animal}`, a.why));
    }
  }

  function cleanup(card) {
    card._ttiWrap?.remove(); card._ttiWrap = null;
    card.querySelectorAll('.tti-wrap').forEach(w => w.remove());
    card.classList.remove('tti-dim', 'tti-ring');
  }

  function scan() {
    if (!location.pathname.startsWith('/trenches')) return;
    document.querySelectorAll('a[href^="/terminal?token="]').forEach(a => {
      if (a.offsetHeight > 60) processCard(a);
    });
  }

  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(); });
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  setInterval(() => { // refresh New Tokens badges so new copies/migrations show up
    document.querySelectorAll('a[data-tti-mint]').forEach(a => {
      const c = cache.get(a.dataset.ttiMint);
      if (c && Date.now() - c.t > CACHE_TTL_MS) { delete a.dataset.ttiMint; }
    });
    scan();
  }, 15_000);
  scan();


  // ───────────────────────── 📡 COHORT WIDGET (coin page) ─────────────────────────
  // Side panel on /terminal: pump.fun copies (same name / image) launched around the same time as this
  // coin, plus the OG and movers. Live MC / volume / 1m-5m change, holders, your tracked wallets (their
  // Trojan emoji), ⚡ quick buy, ⇄ rotate and sell — which press Trojan's OWN instant-trade buttons.
  const CW_KEY = 'tti_cohort_ui_v2';
  const cw = { mint: null, pool: null, el: null, hist: new Map(), stats: new Map(), smart: new Map(), busy: false, ui: loadCwUi(), confirm: null };
  function loadCwUi() { try { return { mode: 'time', via: 'both', collapsed: false, x: null, y: null, ...JSON.parse(localStorage.getItem(CW_KEY)) }; } catch { return { mode: 'time', via: 'both', collapsed: false }; } }
  function saveCwUi() { try { localStorage.setItem(CW_KEY, JSON.stringify(cw.ui)); } catch {} }

  // Trojan-like palette
  const cwCss = document.createElement('style');
  cwCss.textContent = `
  #tti-cw{position:fixed;z-index:99997;width:460px;max-width:calc(100vw - 24px);background:#1b1d22;color:#e6e7ea;border:1px solid #2c2f35;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.5);font:12px/1.35 ui-sans-serif,system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;max-height:72vh;overflow:hidden}
  #tti-cw .hd{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid #2c2f35;cursor:move;user-select:none}
  #tti-cw .hd b{font-size:14px;font-weight:600}
  #tti-cw .hd .sym{color:#9a9ea6;font-size:13px}
  #tti-cw .live{display:flex;align-items:center;gap:4px;color:#6fcf7a;font-size:11px;margin-left:4px}
  #tti-cw .live i{width:6px;height:6px;border-radius:3px;background:#6fcf7a;display:inline-block}
  #tti-cw .hd button{background:#24272d;color:#e6e7ea;border:1px solid #33363d;border-radius:8px;padding:4px 9px;cursor:pointer;font:500 11px inherit}
  #tti-cw .hd button.x{background:transparent;border:none;color:#9a9ea6;font-size:14px;padding:2px 6px}
  #tti-cw .chips{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #2c2f35;flex-wrap:wrap;font-size:11px}
  #tti-cw .chip{background:#24272d;border:1px solid #33363d;border-radius:8px;padding:3px 8px;color:#9a9ea6}
  #tti-cw .chip.og{background:#2d2a1c;border-color:#5c5126;color:#f2c94c}
  #tti-cw .chip.mv{background:#213325;border-color:#3e6b45;color:#6fcf7a}
  #tti-cw .chip.dead{background:transparent;border-color:transparent;color:#6b6f77;padding:3px 2px}
  #tti-cw .bd{overflow:auto}
  #tti-cw .r{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid #24272d;cursor:pointer}
  #tti-cw .r:hover{background:#21242a}
  #tti-cw .r.me{background:rgba(59,130,246,.10);box-shadow:inset 3px 0 0 #3b82f6;cursor:default}
  #tti-cw .r.og{box-shadow:inset 3px 0 0 #f2c94c}
  #tti-cw .r.hot{background:rgba(111,207,122,.07)}
  #tti-cw .im{position:relative;width:40px;height:40px;flex-shrink:0}
  #tti-cw .im img,#tti-cw .im .ph{width:40px;height:40px;border-radius:8px;object-fit:cover;box-sizing:border-box;border:1.5px solid #3a3d44;background:#2c2f35}
  #tti-cw .r.og .im img{border-color:#f2c94c}#tti-cw .r.hot .im img{border-color:#6fcf7a}
  #tti-cw .im .g{position:absolute;right:-4px;bottom:-4px;font-size:11px}
  #tti-cw .mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
  #tti-cw .l1{display:flex;align-items:center;gap:5px;white-space:nowrap;overflow:hidden}
  #tti-cw .l1 .s{font-weight:600;font-size:13px}
  #tti-cw .l1 .n{color:#9a9ea6;overflow:hidden;text-overflow:ellipsis}
  #tti-cw .tag{font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px}
  #tti-cw .t-og{background:#f2c94c;color:#1b1d22}#tti-cw .t-me{background:#3b82f6;color:#fff}#tti-cw .t-bag{background:#a855f7;color:#fff}
  #tti-cw .l2{display:flex;align-items:center;gap:8px;color:#9a9ea6;font-size:11px;white-space:nowrap;overflow:hidden}
  #tti-cw .em{font-size:12px;letter-spacing:1px;color:#e6e7ea}
  #tti-cw .rt{display:flex;flex-direction:column;align-items:flex-end;gap:3px;white-space:nowrap;font-variant-numeric:tabular-nums}
  #tti-cw .mc{color:#f2c94c;font-size:13px;font-weight:500}
  #tti-cw .k{color:#6b6f77;font-size:10px}
  #tti-cw .up{color:#6fcf7a}#tti-cw .dn{color:#f07070}#tti-cw .z{color:#6b6f77}
  #tti-cw .act{display:flex;flex-direction:column;gap:4px;flex-shrink:0}
  #tti-cw .act button{width:62px;border-radius:8px;padding:4px 0;cursor:pointer;font:500 11px inherit}
  #tti-cw .b-buy{background:#2d4a30;color:#e8f0e8;border:1px solid #4a7a4f}
  #tti-cw .b-buy:hover{background:#36593a}
  #tti-cw .b-rot{background:#24272d;color:#e6e7ea;border:1px solid #33363d;font-size:10px !important}
  #tti-cw .b-sell{background:#4a2a2a;color:#f3e3e3;border:1px solid #7d4545;font-size:10px !important}
  #tti-cw .ft{display:flex;justify-content:space-between;padding:8px 12px;color:#6b6f77;font-size:10px}
  #tti-cw .cf{position:absolute;inset:0;background:rgba(14,15,18,.82);display:flex;align-items:center;justify-content:center;z-index:2}
  #tti-cw .cf>div{background:#1b1d22;border:1px solid #33363d;border-radius:12px;padding:14px;width:80%;display:flex;flex-direction:column;gap:10px}
  #tti-cw .cf .row{display:flex;gap:8px;justify-content:flex-end}
  #tti-cw .cf button{border-radius:8px;padding:6px 12px;cursor:pointer;font:600 12px inherit}
  #tti-cw.min .chips,#tti-cw.min .bd,#tti-cw.min .ft{display:none}
  `;
  document.head.appendChild(cwCss);

  const pctHtml = v => v == null ? '<span class="z">—</span>' : `<span class="${v > 0.5 ? 'up' : v < -0.5 ? 'dn' : 'z'}">${v > 0 ? '+' : ''}${Math.round(v)}%</span>`;
  const fmtN = n => n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n ?? '—');
  function cwPct(h, ms) {
    if (!h || h.length < 2) return null;
    const now = h[h.length - 1];
    let base = null;
    for (const p of h) { if (now[0] - p[0] <= ms) { base = p; break; } }
    if (!base || base === now || !base[1]) return null;
    return (now[1] / base[1] - 1) * 100;
  }
  function titleMc() { // Trojan keeps the live MC in the tab title: "DOG ↓ $48.5K | Trojan"
    const m = document.title.match(/\$([\d.,]+[KMB]?)/i);
    return m ? parseUsd(m[1]) : null;
  }

  // ── Trojan instant-trade panel (we press its buttons; it does the trade with your wallet + preset)
  // Find Trojan's preset grid: the smallest visible group of 8–10 matching buttons (Buy amounts / Sell %).
  function presetGroup(re, min = 8, max = 10) {
    const bs = [...document.querySelectorAll('button')].filter(b => b.offsetParent && !b.closest('#tti-cw')
      && re.test(b.textContent.trim()) && !/^0+(\.0+)?$/.test(b.textContent.trim()));
    let best = null;
    for (const b of bs) {
      let c = b;
      for (let i = 0; i < 6 && c; i++) {
        c = c.parentElement;
        if (!c) break;
        const g = bs.filter(x => c.contains(x));
        if (g.length >= min) { if (g.length <= max && (!best || g.length < best.length)) best = g; break; }
      }
    }
    return best || [];
  }
  const buyPresets = () => presetGroup(/^\d*\.?\d+$/);
  const sellPresets = () => presetGroup(/^\d+(\.\d+)?\s?%$/);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150); } return null; }
  const curToken = () => new URLSearchParams(location.search).get('token');

  async function pressBuy(amount) {
    const btn = (await waitFor(() => buyPresets().length && buyPresets()))?.find(b => b.textContent.trim() === String(amount));
    if (!btn) {
      const have = buyPresets().map(b => b.textContent.trim()).join(', ');
      notify(`<div class="t">⚠️ Can't find a Buy ${esc(amount)} button</div><div class="s">${have ? 'Your Buy presets: ' + esc(have) + ' — set one in 🐾 Intel › Quick buy' : "Open Trojan's instant trade panel (Buy / Sell presets) first"}</div>`, [], { border: '#ef4444' });
      return false;
    }
    btn.click();
    return true;
  }
  async function pressSell(pct) {
    const btn = (await waitFor(() => sellPresets().length && sellPresets()))?.find(b => b.textContent.replace(/\s/g, '') === `${pct}%`);
    if (!btn) {
      const have = sellPresets().map(b => b.textContent.trim()).join(', ');
      notify(`<div class="t">⚠️ Can't find a Sell ${esc(pct)}% button</div><div class="s">${have ? 'Your Sell presets: ' + esc(have) : "Open Trojan's instant trade panel first"}</div>`, [], { border: '#ef4444' });
      return false;
    }
    btn.click();
    return true;
  }
  async function openAndBuy(t) {
    if (curToken() !== t.address) {
      go(termUrl(t));
      await waitFor(() => curToken() === t.address, 5000);
      await sleep(1200); // let Trojan bind its panel to the new coin
    }
    return pressBuy(settings.quickBuyAmount);
  }
  async function runTrade(kind, t) {
    if (kind === 'buy') return openAndBuy(t);
    if (kind === 'sell') return pressSell(settings.quickSellPct);
    if (kind === 'rotate') {
      if (!(await pressSell(settings.rotateSellPct))) return;
      await sleep(1500);
      return openAndBuy(t);
    }
  }
  function askTrade(kind, t, selfSym) {
    const amt = settings.quickBuyAmount;
    const text = kind === 'buy' ? `Buy <b>${esc(amt)} SOL</b> of <b>${esc(t.symbol)}</b>?`
      : kind === 'sell' ? `Sell <b>${esc(settings.quickSellPct)}%</b> of your <b>${esc(selfSym)}</b>?`
      : `Sell <b>${esc(settings.rotateSellPct)}%</b> of <b>${esc(selfSym)}</b> → buy <b>${esc(amt)} SOL</b> of <b>${esc(t.symbol)}</b>?`;
    if (!settings.tradeConfirm) return runTrade(kind, t);
    cw.confirm = { kind, t, text };
    cwRender();
  }

  function cwEnsure() {
    if (cw.el) return cw.el;
    const el = document.createElement('div');
    el.id = 'tti-cw';
    document.body.appendChild(el);
    const place = () => {
      const x = cw.ui.x ?? innerWidth - 472, y = cw.ui.y ?? 110;
      el.style.left = Math.max(4, Math.min(x, innerWidth - 120)) + 'px';
      el.style.top = Math.max(4, Math.min(y, innerHeight - 40)) + 'px';
    };
    place();
    addEventListener('resize', place);
    el.addEventListener('click', e => {
      const btn = e.target.closest('button');
      const k = btn?.dataset.k;
      if (k) {
        e.stopPropagation();
        if (k === 'mode') cw.ui.mode = cw.ui.mode === 'time' ? 'all' : 'time';
        if (k === 'via') cw.ui.via = { both: 'name', name: 'image', image: 'both' }[cw.ui.via];
        if (k === 'min') cw.ui.collapsed = !cw.ui.collapsed;
        if (k === 'ok' && cw.confirm) { const c = cw.confirm; cw.confirm = null; runTrade(c.kind, c.t); }
        if (k === 'no') cw.confirm = null;
        if (['buy', 'sell', 'rotate'].includes(k)) {
          const t = cw.rowsByAddr?.get(btn.dataset.a);
          if (t) askTrade(k, t, cw.data?.info?.symbol || 'this coin');
          return;
        }
        saveCwUi(); cwRender();
        return;
      }
      const row = e.target.closest('.r[data-a]');
      if (row && !row.classList.contains('me')) { const t = cw.rowsByAddr?.get(row.dataset.a); if (t) go(termUrl(t)); }
    });
    el.addEventListener('mousedown', e => {
      if (!e.target.closest('.hd') || e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = ev => { el.style.left = ev.clientX - ox + 'px'; el.style.top = ev.clientY - oy + 'px'; };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); const rr = el.getBoundingClientRect(); cw.ui.x = rr.left; cw.ui.y = rr.top; saveCwUi(); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
    cw.el = el;
    return el;
  }

  // live extras for visible rows: volume + 5m change (pool stats), tracked wallets in the coin
  async function cwExtras(rows) {
    const now = Date.now();
    const top = rows.slice(0, 14);
    await Promise.all(top.map(async r => {
      if (!r.poolAddress) return;
      const s = cw.stats.get(r.poolAddress);
      if (s && now - s.t < 15_000) return;
      cw.stats.set(r.poolAddress, { ...(s || {}), t: now });
      const j = await getJSON(`${API}/pools/${r.poolAddress}/stats?chain=solana`);
      const d = j?.data; if (!d) return;
      const v = x => (x?.volumeBuyUsd || 0) + (x?.volumeSellUsd || 0);
      cw.stats.set(r.poolAddress, { t: now, vol: v(d['1d']), vol5: v(d['5m']), ch5: d['5m']?.priceChange });
    }));
    if (!bg.tracked.size) await loadWallets();
    await Promise.all(top.slice(0, 10).map(async r => {
      const s = cw.smart.get(r.address);
      if (s && now - s.t < 30_000) return;
      cw.smart.set(r.address, { ...(s || { list: [] }), t: now });
      const j = await postJSON(`${API}/tokens/transactions`, { chain: 'solana', limit: 100, order: 'desc', tokenAddress: r.address, includeUserWallets: false, includeTrackedWallets: true });
      const net = new Map();
      for (const x of j?.data || []) {
        if (x.type === 'buy') net.set(x.walletAddress, (net.get(x.walletAddress) || 0) + 1);
        if (x.type === 'sell') net.set(x.walletAddress, (net.get(x.walletAddress) || 0) - 1);
      }
      cw.smart.set(r.address, { t: now, list: [...net].filter(([, n]) => n > 0).map(([w]) => w) });
    }));
  }

  async function cwTick() {
    const onCoin = settings.cohortWidget && location.pathname.startsWith('/terminal');
    const qs = new URLSearchParams(location.search);
    const mint = qs.get('token');
    if (!onCoin || !mint) { if (cw.el) cw.el.style.display = 'none'; return; }
    if (mint !== cw.mint) { cw.mint = mint; cw.pool = qs.get('pool'); cw.data = null; cw.hist.clear(); cw.confirm = null; }
    cwEnsure().style.display = '';
    // self MC from the tab title every second (Trojan's own live number)
    const tm = titleMc();
    if (tm) { const h = cw.hist.get(mint) || []; h.push([Date.now(), tm]); while (h.length > 400) h.shift(); cw.hist.set(mint, h); }
    if (cw.busy) { cwRender(); return; }
    cw.busy = true;
    try {
      const data = await analyze(mint, cw.pool, Math.max(5, settings.cohortRefreshSec) * 1000 - 500);
      if (mint !== cw.mint) return;
      if (data !== cw.data) {
        cw.data = data;
        const now = Date.now();
        [...data.name.list, ...data.image.list].forEach(t => {
          const h = cw.hist.get(t.address) || [];
          if (!h.length || now - h[h.length - 1][0] > 2000) h.push([now, t.marketCap || 0]);
          while (h.length > 200) h.shift();
          cw.hist.set(t.address, h);
        });
      }
      cwRender();
      cwExtras(cw.lastRows || []).then(cwRender).catch(() => {});
    } finally { cw.busy = false; }
  }

  function cwRows() {
    const data = cw.data;
    const selfCreated = data.name.selfCreated || data.image.selfCreated || Date.now();
    const og = data.og;
    const byAddr = new Map();
    const lists = cw.ui.via === 'name' ? [data.name.list] : cw.ui.via === 'image' ? [data.image.list] : [data.name.list, data.image.list];
    lists.forEach((L, i) => L.forEach(t => {
      if (!t.pump) return;
      const via = cw.ui.via === 'both' ? (i === 0 ? 'name' : 'img') : cw.ui.via === 'image' ? 'img' : 'name';
      const cur = byAddr.get(t.address);
      byAddr.set(t.address, cur ? { ...cur, via: cur.via === via ? via : 'both' } : { ...t, via });
    }));
    const win = settings.cohortWindowMin * 60_000;
    let rows = [...byAddr.values()].map(t => {
      const h = cw.hist.get(t.address), st = cw.stats.get(t.poolAddress);
      return { ...t, d1: cwPct(h, 60_000), d5: st?.ch5 != null ? st.ch5 : cwPct(h, 300_000), // pool stats priceChange is already in %
               isOg: !!og && og.address === t.address, dt: Date.parse(t.createdAt) - selfCreated };
    });
    const total = rows.length;
    const moving = r => (r.d5 ?? 0) >= settings.cohortMovePct || (r.d1 ?? 0) >= 15;
    if (cw.ui.mode === 'time') rows = rows.filter(r => Math.abs(r.dt) <= win || r.isOg || moving(r));
    const before = rows.length;
    rows = rows.filter(r => r.isOg || moving(r) || (r.marketCap || 0) >= settings.cohortMinMc);
    const dead = before - rows.length;
    const meH = cw.hist.get(cw.mint), st = cw.stats.get(cw.pool);
    const selfInfo = data.info || {};
    rows.push({ address: cw.mint, poolAddress: cw.pool, name: selfInfo.name || 'this coin', symbol: selfInfo.symbol || '', logoUrl: selfInfo.logoUrl,
                numHolders: selfInfo.numHolders, me: true, marketCap: meH?.length ? meH[meH.length - 1][1] : (data.name.selfMc || data.image.selfMc),
                createdAt: new Date(selfCreated).toISOString(), d1: cwPct(meH, 60_000),
                d5: st?.ch5 != null ? st.ch5 : cwPct(meH, 300_000), dt: 0 });
    rows.sort((a, b) => (b.isOg - a.isOg) || (b.marketCap || 0) - (a.marketCap || 0));
    return { rows, total, dead };
  }

  function cwRender() {
    const el = cw.el, data = cw.data;
    if (!el) return;
    el.classList.toggle('min', !!cw.ui.collapsed);
    const sym = data?.info?.symbol || '';
    const head = `<div class="hd"><b>Cohort</b><span class="sym">$${esc(sym)}</span><span class="live"><i></i>live</span>
      <span style="flex:1"></span>
      <button data-k="mode" title="Same-time cohort (+ OG + movers) / all pump.fun copies">${cw.ui.mode === 'time' ? `±${settings.cohortWindowMin}m` : 'all'}</button>
      <button data-k="via" title="Match by name, image, or both">${{ both: 'name+img', name: 'name', image: 'img' }[cw.ui.via]}</button>
      <button data-k="min" class="x" aria-label="Collapse">${cw.ui.collapsed ? '▢' : '—'}</button></div>`;
    if (!data) { el.innerHTML = head + '<div class="chips"><span class="chip">loading…</span></div>'; cw.lastHtml = null; return; }
    const { rows, total, dead } = cwRows();
    cw.lastRows = rows;
    cw.rowsByAddr = new Map(rows.map(r => [r.address, r]));
    const og = data.og;
    const movers = rows.filter(r => !r.me && ((r.d1 ?? 0) >= 15 || (r.d5 ?? 0) >= settings.cohortMovePct)).length;
    const rel = dt => { const m = Math.round(dt / 60000), a = Math.abs(m), sg = m > 0 ? '+' : '−'; return m === 0 ? 'same' : a < 120 ? sg + a + 'm' : a < 2880 ? sg + Math.round(a / 60) + 'h' : sg + Math.round(a / 1440) + 'd'; };
    const chips = `<div class="chips"><span class="chip">${rows.length - 1} / ${total} copies</span>` +
      (og ? `<span class="chip og">👑 OG ${esc(og.symbol)} · ${fmtUsd(og.marketCap)}${og.migrated ? ' · 🎓' : ''}</span>` : '<span class="chip">no OG</span>') +
      (movers ? `<span class="chip mv">🚀 ${movers} moving</span>` : '') +
      (dead ? `<span class="chip dead">${dead} dead hidden</span>` : '') + '</div>';
    const body = rows.map(r => {
      const st = cw.stats.get(r.poolAddress) || {};
      const sm = cw.smart.get(r.address)?.list || [];
      const emo = sm.slice(0, 4).map(w => bg.trackedSym?.get(w) || '👤').join('');
      const hot = (r.d1 ?? 0) >= 15 || (!r.me && (r.d5 ?? 0) >= settings.cohortMovePct);
      return `<div class="r ${r.me ? 'me' : ''} ${r.isOg ? 'og' : ''} ${hot && !r.me ? 'hot' : ''}" data-a="${esc(r.address)}" title="${esc(r.name)}${r.dex ? ' · ' + esc(r.dex) : ''}${r.via ? ' · same ' + r.via : ''}">
        <div class="im">${r.logoUrl ? `<img src="${esc(r.logoUrl)}" alt="" loading="lazy">` : '<div class="ph"></div>'}${r.migrated ? '<span class="g">🎓</span>' : ''}</div>
        <div class="mid">
          <div class="l1"><span class="s">${esc(r.symbol)}</span><span class="n">${esc(r.name)}</span>${r.isOg ? '<span class="tag t-og">OG</span>' : ''}${r.me ? '<span class="tag t-me">YOU</span>' : ''}${!r.me && bg.bags.has(r.address) ? '<span class="tag t-bag">BAG</span>' : ''}</div>
          <div class="l2"><span>${r.me ? 'this' : rel(r.dt)}</span><span>${ago(r.createdAt)}</span><span>👤 ${fmtN(r.numHolders)}</span>${emo ? `<span class="em" title="${esc(sm.map(walletLabel).join(', '))}">${emo}</span>${sm.length > 4 ? `<span class="z">+${sm.length - 4}</span>` : ''}` : ''}</div>
        </div>
        <div class="rt"><span><span class="k">MC </span><span class="mc">${fmtUsd(r.marketCap)}</span></span>
          <span style="font-size:11px"><span class="k">V </span>${st.vol != null ? fmtUsd(st.vol) : '—'} ${pctHtml(r.d1)} ${pctHtml(r.d5)}</span></div>
        <div class="act"><button class="b-buy" data-k="buy" data-a="${esc(r.address)}">⚡ ${esc(settings.quickBuyAmount)}</button>${r.me
          ? `<button class="b-sell" data-k="sell" data-a="${esc(r.address)}">sell ${esc(settings.quickSellPct)}%</button>`
          : `<button class="b-rot" data-k="rotate" data-a="${esc(r.address)}" title="Sell ${esc(settings.rotateSellPct)}% of ${esc(sym)} and buy this">⇄ rotate</button>`}</div>
      </div>`;
    }).join('');
    const cf = cw.confirm ? `<div class="cf"><div><div style="font-size:13px">${cw.confirm.text}</div><div style="color:#9a9ea6;font-size:11px">Presses Trojan's instant-trade buttons with your current wallet &amp; preset.</div>
      <div class="row"><button data-k="no" style="background:#24272d;color:#e6e7ea;border:1px solid #33363d">Cancel</button><button data-k="ok" style="background:#2d4a30;color:#e8f0e8;border:1px solid #4a7a4f">Confirm</button></div></div></div>` : '';
    const html = head + chips + `<div class="bd">${body}</div>` +
      `<div class="ft"><span>⚡ ${esc(settings.quickBuyAmount)} SOL via your Trojan preset · ⇄ sells ${esc(sym)} → buys that coin</span><span>live</span></div>` + cf;
    if (html === cw.lastHtml) return; // nothing changed → don't touch the DOM (no image flicker)
    cw.lastHtml = html;
    const scroll = el.querySelector('.bd')?.scrollTop || 0;
    el.innerHTML = html;
    const bd = el.querySelector('.bd'); if (bd) bd.scrollTop = scroll;
  }

  setInterval(cwTick, 1000); // analyze() is cached, so the API is hit every cohortRefreshSec
  cwTick();

  // ───────────────────────── SETTINGS PANEL ─────────────────────────
  function loadSettings() {
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); return { ...DEFAULTS, ...s, columns: { ...DEFAULTS.columns, ...(s?.columns || {}) } }; }
    catch { return structuredClone(DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }
  function rescanAll() {
    document.querySelectorAll('a[data-tti-mint]').forEach(a => { delete a.dataset.ttiMint; cleanup(a); });
    scan();
  }

  const gear = document.createElement('button');
  gear.id = 'tti-gear';
  gear.textContent = '🐾 Intel';
  const panel = document.createElement('div');
  panel.id = 'tti-panel';
  const chk = (label, get, set) => {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'checkbox'; i.checked = get();
    i.onchange = () => { set(i.checked); saveSettings(); rescanAll(); };
    l.append(i, document.createTextNode(label));
    return l;
  };
  const h = t => { const b = document.createElement('b'); b.textContent = t; return b; };
  const txt = (label, key) => {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'text'; i.value = settings[key]; i.style.cssText = 'width:52px;background:#151821;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:5px;padding:2px 4px';
    i.onchange = () => { settings[key] = i.value.trim(); saveSettings(); };
    l.append(i, document.createTextNode(' ' + label));
    return l;
  };
  const num = (label, key) => {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'number'; i.value = settings[key];
    i.onchange = () => { const v = parseFloat(i.value); if (isFinite(v)) { settings[key] = v; saveSettings(); cache.clear(); rescanAll(); } };
    l.append(i, document.createTextNode(' ' + label));
    return l;
  };
  panel.append(
    h('Columns to scan'),
    ...COLS.map(c => chk(c, () => settings.columns[c], v => settings.columns[c] = v)),
    h('Labels'),
    chk('🐾 Unnamed-animal label', () => settings.animalLabels, v => settings.animalLabels = v),
    chk('Also tag named animals', () => settings.showNamedAnimal, v => settings.showNamedAnimal = v),
    chk('♻ / 🖼 / 🎓 reuse badges', () => settings.reuseBadges, v => settings.reuseBadges = v),
    h('Filtering'),
    chk('Dim if name was used before', () => settings.dimReusedName, v => settings.dimReusedName = v),
    chk('Dim if an older copy migrated', () => settings.dimIfMigratedCopy, v => settings.dimIfMigratedCopy = v),
    h('👑 OG / 🚀 moving alerts'),
    num('OG min MC if not migrated ($)', 'ogMinMc'),
    chk('Alert when a copy with an OG is moving', () => settings.alerts, v => settings.alerts = v),
    num('MC up at least (%)', 'alertPct'),
    num('within (seconds)', 'alertWindowSec'),
    num('and MC at least ($)', 'alertMinMc'),
    chk('Sound', () => settings.alertSound, v => settings.alertSound = v),
    h('🛡 Bag Guard (your open positions)'),
    chk('Enabled', () => settings.bagGuard, v => settings.bagGuard = v),
    chk('🧛 Vamp alerts (copies pumping)', () => settings.vampAlerts, v => settings.vampAlerts = v),
    num('Vamp: copy MC at least ($)', 'vampMinMc'),
    num('Vamp: copy ≥ this × your MC', 'vampRatio'),
    chk('🏃 Tracked/KOL selling my bag', () => settings.exitAlerts, v => settings.exitAlerts = v),
    chk('🔄 Where they rotate to', () => settings.rotationAlerts, v => settings.rotationAlerts = v),
    chk('🔥 Tracked wallets cluster-buying', () => settings.clusterAlerts, v => settings.clusterAlerts = v),
    num('Cluster: wallets', 'clusterN'),
    num('Cluster: within (min)', 'clusterMin'),
    h('📡 Coin page'),
    chk('Cohort side widget', () => settings.cohortWidget, v => settings.cohortWidget = v),
    num('Cohort window ± (min)', 'cohortWindowMin'),
    num('Cohort: hide dead below ($)', 'cohortMinMc'),
    txt('⚡ Quick buy (SOL, a Buy preset)', 'quickBuyAmount'),
    txt('Sell % on your coin (a Sell preset)', 'quickSellPct'),
    txt('⇄ Rotate sells this %', 'rotateSellPct'),
    chk('Confirm before trading', () => settings.tradeConfirm, v => settings.tradeConfirm = v),
    h('Your bags  (🧛 vamps · 🧠 smart wallets in · 🏃 net sellers)'),
    bagsBox,
  );
  gear.onclick = () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; renderBags(); };
  panel.style.maxHeight = '75vh';
  panel.style.overflow = 'auto';
  document.body.append(gear, panel);
  renderBags();
  setInterval(() => { if (bg.seenTx.size > 20000) bg.seenTx.clear(); }, 60_000);

  // expose for debugging in console
  window.__tti = { buyPresets, sellPresets, cw, classifyAnimal, analyze, settings, cache, showMovingToast, cardMc, notify, bg, checkBag, pollBags, loadWallets, onLiveAlert, rotation };
})();