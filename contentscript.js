// Remove URL Trackers - Ultimate Version
// Combines features from: ClipboardButler, TracklessURL, dont-track-me-google, uBlock Origin

// ========== TRACKER DATABASE ==========

const TRACKER_PARAMS = new Set([
  'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
  'utm_id','utm_name','utm_placement',
  'fbclid','gclid','msclkid','twclid','igshid','igsh','mc_cid','mc_eid',
  'mkt_tok','_gl','gad','gad_source','wbraid','gbraid','epik','clickid',
  'ref_src','ref_url','fb_action_ids','fb_action_types','fb_source','fbadid',
  'trackingid','trk','sk','feature','ref_',
]);

// Per-domain extra params — pre-merged with TRACKER_PARAMS into ready-to-use Sets
// so cleanUrl never rebuilds a Set at runtime.
const DOMAIN_PARAMS_RAW = new Map([
  ['youtube.com',    ['si','ab_channel','pp']],
  ['youtu.be',       ['si']],
  ['google.com',     ['ved','usg','sa','oq']],
  ['amazon.com',     ['ref','ref_','content-id','dib','dib_tag','keywords','sp_csd','crid','sprefix','social_share',
                      'smid','tag','creativeASIN','linkCode','linkId',
                      'pf_rd_p','pf_rd_r','pf_rd_t','pf_rd_i','pf_rd_m',
                      'pd_rd_r','pd_rd_w','pd_rd_wg','pd_rd_i','pd_rd_p','pd_rd_d','qid','sr']],
  ['twitter.com',    ['t','s','ref_src','ref_url']],
  ['x.com',          ['t','s','ref_src','ref_url']],
  ['reddit.com',     ['share','rdt']],                          // removed: context (shows parent comments), sort (functional)
  ['spotify.com',    ['si','sp_cid']],
  ['facebook.com',   ['fbclid','fb_action_ids','fb_action_types','fb_source','rdid','share_url']],
  ['linkedin.com',   ['trackingId','trk','trkInfo','lipi','licu']],
  ['pinterest.com',  ['rwa_pos','epik','clickId']],
  ['tiktok.com',     ['sec_user_id']],
  ['instagram.com',  ['igshid','igsh']],
  ['twitch.tv',      ['tt']],
  ['medium.com',     ['sk']],
  ['github.com',     ['cid']],
  ['calendly.com',   []],                                        // removed: back/month/date/session_type_id all control the UI
  ['mastodon.social',['s']],
  ['ebay.com',       ['mkevt','mkcid','mkrid','campid','toolid','customid','amdata',
                      'stype','widget_ver','media','_trkparms','_trksid']],  // removed: hash (anchor), ul_noapp (visual)
  ['etsy.com',       ['ref','frs','ga_order','ga_search_type','ga_view_type','ga_search_query','organic_search_click']], // removed: listing_id (functional), sts (uncertain), from_page
  ['snapchat.com',   ['sc_channel','sc_source','sc_medium','sc_campaign','sc_content','sc_clickid','sc_country']],
]);

// Pre-merge: each domain gets TRACKER_PARAMS ∪ its own extras, built once at load
const DOMAIN_PARAMS = new Map(
  [...DOMAIN_PARAMS_RAW].map(([domain, extras]) => [
    domain,
    new Set([...TRACKER_PARAMS, ...extras]),
  ])
);

const REDIRECT_UNWRAPPERS = [
  { pattern: /^https:\/\/www\.google\.[^/]+\/url/, param: 'q' },
  { pattern: /^https:\/\/[a-z0-9-]+\.linkedin\.com\/redir/, param: 'url' },
];
const AWS_PATTERN = /\.awstrack\.me/;

// ========== URL CLEANING ENGINE ==========

function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

function unwrapRedirect(urlString) {
  for (const { pattern, param } of REDIRECT_UNWRAPPERS) {
    if (pattern.test(urlString)) {
      try {
        const real = new URL(urlString).searchParams.get(param);
        if (real && isValidUrl(real)) return decodeURIComponent(real);
      } catch { /* fall through */ }
    }
  }
  if (AWS_PATTERN.test(urlString)) {
    try {
      const parts = new URL(urlString).pathname.split('/');
      if (parts[3]) {
        const decoded = decodeURIComponent(parts[3]);
        if (isValidUrl(decoded)) return decoded;
      }
    } catch { /* fall through */ }
  }
  return null;
}

function cleanUrl(urlString) {
  try {
    const url = new URL(urlString);
    const original = url.toString();

    // Amazon embeds trackers in path segments like /ref=sr_1_2_sspa
    // eBay does the same with /_trkparms and /hash=
    if (url.hostname.includes('amazon.')) {
      url.pathname = url.pathname.replace(/\/(ref|pf_rd_[a-z]+|pd_rd_[a-z]+|smid|tag|crid)=[^/]*/gi, '');
    }
    if (url.hostname.includes('ebay.')) {
      url.pathname = url.pathname.replace(/\/(_trkparms|hash)=[^/]*/gi, '');
    }

    // Use pre-merged Set for this domain, or fall back to base TRACKER_PARAMS
    let toRemove = TRACKER_PARAMS;
    for (const [domain, paramSet] of DOMAIN_PARAMS) {
      if (url.hostname.includes(domain)) { toRemove = paramSet; break; }
    }

    const keysToDelete = [];
    url.searchParams.forEach((_, key) => {
      if (toRemove.has(key) || key.startsWith('utm_') || key.startsWith('fb_'))
        keysToDelete.push(key);
    });
    keysToDelete.forEach(k => url.searchParams.delete(k));

    const cleaned = url.toString();
    return { url: cleaned, wasModified: original !== cleaned };
  } catch {
    return { url: urlString, wasModified: false };
  }
}

function extractAndClean(urlString) {
  const unwrapped = unwrapRedirect(urlString);
  return cleanUrl(unwrapped ?? urlString).url;
}

// ========== LINK CLEANING ==========

const cleanedLinks = new WeakSet();

function cleanLink(link) {
  if (cleanedLinks.has(link)) return;
  cleanedLinks.add(link);
  const unwrapped = unwrapRedirect(link.href);
  if (unwrapped) {
    link.href = cleanUrl(unwrapped).url;
  } else {
    const result = cleanUrl(link.href);
    if (result.wasModified) link.href = result.url;
  }
}

function cleanLinksIn(root) {
  if (root.tagName === 'A') { cleanLink(root); return; }
  root.querySelectorAll?.('a[href]').forEach(cleanLink);
}

// ========== HISTORY API INTERCEPTION ==========
// Intercept history.pushState and history.replaceState so any URL the page
// sets programmatically (e.g. Amazon restoring tracker params after load)
// gets cleaned before it reaches the address bar.

function interceptHistory(method) {
  const original = history[method].bind(history);
  history[method] = function(state, title, url) {
    if (url) {
      try {
        const abs = url.startsWith('http') ? url : new URL(url, location.href).href;
        const unwrapped = unwrapRedirect(abs);
        const result = cleanUrl(unwrapped ?? abs);
        if (result.wasModified) url = result.url;
      } catch { /* leave url unchanged */ }
    }
    return original(state, title, url);
  };
}

interceptHistory('pushState');
interceptHistory('replaceState');

// ========== PAGE LOAD ==========

// Clean the address bar URL immediately on page load.
function cleanAddressBar() {
  const unwrapped = unwrapRedirect(location.href);
  const result = cleanUrl(unwrapped ?? location.href);
  if (result.wasModified) {
    history.replaceState(history.state, '', result.url);
  }
}

// Run address bar cleaning as early as possible — don't wait for DOMContentLoaded
// since Amazon may set its own replaceState shortly after
cleanAddressBar();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => cleanLinksIn(document));
} else {
  cleanLinksIn(document);
}

// ========== LINK CLICKS ==========

function handleLinkClick(e) {
  let el = e.target;
  while (el && el.tagName !== 'A') el = el.parentElement;
  if (el?.href) cleanLink(el);
}
document.addEventListener('mousedown', handleLinkClick, true);
document.addEventListener('touchstart', handleLinkClick, true);
document.addEventListener('click',      handleLinkClick, true);

// ========== PASTE HANDLER ==========

document.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text/plain');
  if (!text || !isValidUrl(text)) return;

  const cleaned = extractAndClean(text);
  if (cleaned === text) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  const target = e.target;

  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    const { selectionStart: s, selectionEnd: end, value } = target;
    target.value = value.slice(0, s) + cleaned + value.slice(end);
    target.selectionStart = target.selectionEnd = s + cleaned.length;
    target.dispatchEvent(new Event('input',  { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const isEditable = v => v === 'true' || v === 'plaintext-only';
    const editor = isEditable(target.contentEditable)
      ? target
      : target.closest('[contenteditable="true"],[contenteditable="plaintext-only"]');
    if (!editor) return;
    // execCommand replaces the current selection and triggers the host app's
    // input handling — works for both contenteditable="true" and "plaintext-only"
    document.execCommand('insertText', false, cleaned);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, true);

// ========== SITE FLAGS ==========

const IS_REDDIT  = location.hostname.includes('reddit.com');
const IS_TWITTER = location.hostname.includes('x.com') || location.hostname.includes('twitter.com');
const IS_YOUTUBE = location.hostname.includes('youtube.com');

// ========== NATIVE SETTERS (React controlled inputs) ==========

const _nativeTASetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
const _nativeINSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,    'value')?.set;

function setNativeValue(el, value) {
  (el instanceof HTMLTextAreaElement ? _nativeTASetter : _nativeINSetter)?.call(el, value)
    ?? (el.value = value);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ========== UNIFIED EDITABLE FIELD SWEEP ==========
// Reddit, Twitter, and YouTube all need "find tracked URLs in a text box and
// replace them". The only difference is *how* the replacement is written back.
// This single helper handles all three cases.

const URL_RE = /https?:\/\/[^\s\n\]]+/g;

function sweepEditableFields(selector, rewrite) {
  document.querySelectorAll(selector).forEach(editor => {
    const matches = editor.textContent.match(URL_RE);
    if (!matches) return;
    matches.forEach(raw => {
      const cleaned = extractAndClean(raw);
      if (cleaned !== raw) rewrite(editor, raw, cleaned);
    });
  });
}

function sweepRedditFields() {
  // Plain input / textarea share boxes
  document.querySelectorAll('textarea,input[type="text"],input:not([type])').forEach(field => {
    const val = field.value;
    if (!val) return;
    const matches = val.match(URL_RE);
    if (!matches) return;
    let newVal = val;
    matches.forEach(m => { const c = extractAndClean(m); if (c !== m) newVal = newVal.replace(m, c); });
    if (newVal !== val) { setNativeValue(field, newVal); field.select?.(); }
  });

  // Contenteditable comment / reply boxes
  // FIX: previous code had `!editor.getAttribute('role') === 'textbox'` which is
  // always true (boolean coercion). Correct check is below.
  sweepEditableFields('[contenteditable="true"]', (editor, raw, cleaned) => {
    if (editor.getAttribute('role') !== 'textbox' &&
        !editor.closest('.md-editor') &&
        !editor.closest('[class*="editor"]')) return;
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = editor.innerHTML.replace(new RegExp(esc, 'g'), cleaned);
    if (next !== editor.innerHTML) {
      editor.innerHTML = next;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Preview links
  document.querySelectorAll('a[href*="utm_"]').forEach(cleanLink);
}

function sweepTwitterFields() {
  sweepEditableFields('[contenteditable="true"][role="textbox"]', (editor, raw, cleaned) => {
    const next = editor.innerHTML.replace(raw, cleaned);
    if (next !== editor.innerHTML) {
      editor.innerHTML = next;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

function sweepYouTubeFields() {
  const sel = [
    '#contenteditable-root[contenteditable]',
    'ytd-commentbox [contenteditable]',
    'ytd-comment-simplebox-renderer [contenteditable]',
    'ytd-backstage-post-dialog-renderer [contenteditable]',
    'yt-formatted-string[contenteditable]',
    '#placeholder-area[contenteditable]',
  ].join(',');

  sweepEditableFields(sel, (editor, raw, cleaned) => {
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const walk = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const idx = node.textContent.indexOf(raw);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + raw.length);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, cleaned);
        break;
      }
    }
  });
}

// ========== COPY CLEAN LINK BUTTON (Reddit) ==========

const RUT_STYLE = `
  .rut-copy-btn{display:inline-flex;align-items:center;gap:4px;padding:6px 8px;
    border:none;background:transparent;color:var(--color-neutral-content-weak,#878a8c);
    font-size:12px;font-weight:700;font-family:inherit;border-radius:2px;cursor:pointer;
    white-space:nowrap;line-height:18px;transition:background .1s,color .1s}
  .rut-copy-btn:hover{background:var(--color-neutral-background-hover,rgba(26,26,27,.1));
    color:var(--color-neutral-content,#1c1c1c)}
  .rut-copy-btn.rut-ok{color:#46d160}
  .rut-copy-btn svg{flex-shrink:0}
`;
const ICON_LINK  = `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5z"/><path d="M7.414 15.414a2 2 0 01-2.828-2.828l3-3a2 2 0 012.828 0 1 1 0 001.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 005.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5z"/></svg>`;
const ICON_CHECK = `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`;

// Inject style once — called at init, not on every sweep
function ensureStyle() {
  if (document.getElementById('rut-styles')) return;
  const s = document.createElement('style');
  s.id = 'rut-styles';
  s.textContent = RUT_STYLE;
  (document.head || document.documentElement).appendChild(s);
}

function getPostUrl(el) {
  const post = el.closest('shreddit-post,[data-testid="post-container"],[data-fullname],article');
  if (post) {
    const permalink = post.getAttribute('permalink') || post.getAttribute('content-href');
    if (permalink) {
      const abs = permalink.startsWith('http') ? permalink : 'https://www.reddit.com' + permalink;
      return cleanUrl(abs).url;
    }
    const titleLink = post.querySelector('a[data-click-id="body"],a[data-click-id="title"],h1 a,h2 a,h3 a');
    if (titleLink?.href) return cleanUrl(titleLink.href).url;
  }
  return cleanUrl(location.href).url;
}

function makeCopyBtn(anchor) {
  const btn = document.createElement('button');
  btn.className = 'rut-copy-btn';
  btn.setAttribute('aria-label', 'Copy clean link');
  btn.innerHTML = ICON_LINK + ' Copy Clean Link';
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    navigator.clipboard.writeText(getPostUrl(anchor)).then(() => {
      btn.classList.add('rut-ok');
      btn.innerHTML = ICON_CHECK + ' Copied!';
      setTimeout(() => { btn.classList.remove('rut-ok'); btn.innerHTML = ICON_LINK + ' Copy Clean Link'; }, 2000);
    });
  });
  return btn;
}

function injectCopyButtons() {
  const inject = btn => {
    if (btn.dataset.rutDone) return;
    btn.dataset.rutDone = '1';
    btn.insertAdjacentElement('afterend', makeCopyBtn(btn));
  };
  document.querySelectorAll('button[aria-label="share" i]:not([data-rut-done])').forEach(inject);
  document.querySelectorAll('shreddit-post,[data-testid="post-container"]').forEach(post =>
    post.querySelectorAll('button:not([data-rut-done])').forEach(btn => {
      if (btn.textContent.trim().toLowerCase() === 'share') inject(btn);
    })
  );
  document.querySelectorAll('shreddit-share-button:not([data-rut-done])').forEach(inject);
}

// ========== UNIFIED OBSERVER ==========

let rafId = null;

function scheduleSweep() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (IS_REDDIT)  { sweepRedditFields(); injectCopyButtons(); }
    if (IS_TWITTER) sweepTwitterFields();
    if (IS_YOUTUBE) sweepYouTubeFields();
  });
}

const unifiedObserver = new MutationObserver((mutations) => {
  mutations.forEach(m => m.addedNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) cleanLinksIn(node);
  }));
  scheduleSweep();
});

function startObserver() {
  if (IS_REDDIT) ensureStyle(); // inject once at startup, not on every sweep
  const root = document.documentElement || document.body;
  unifiedObserver.observe(root, {
    childList: true,
    subtree: true,
    characterData: IS_REDDIT || IS_TWITTER || IS_YOUTUBE,
  });
  scheduleSweep();
}

if (document.body) {
  startObserver();
} else {
  document.addEventListener('DOMContentLoaded', startObserver);
}
