/**
 * Browser-like environment evaluated inside the QuickJS isolate before the userscript.
 * Everything the script does that matters for review goes through `record`, a host
 * function captured in this closure. The script cannot reach it, so it cannot erase or
 * forge its own log. The prelude returns a control object only the host holds.
 */
export const SANDBOX_PRELUDE = String.raw`
(function (record, config) {
  'use strict';
  var G = globalThis;
  var SIGNING = ['signTransaction', 'signAllTransactions', 'signAndSendTransaction',
    'sendTransaction', 'signMessage', 'signIn', 'signAndSendAllTransactions'];
  var listeners = [];
  var timers = [];
  var timerSeq = 1;
  var vnow = 0;
  var runs = 0;

  function str(v) { try { return String(v); } catch (e) { return '[unprintable]'; } }
  function hostOf(url) {
    var m = /^([a-z][a-z0-9+.-]*:)?\/\/([^\/?#:]+)/i.exec(str(url));
    if (m) return m[2].toLowerCase();
    return /^[a-z][a-z0-9+.-]*:/i.test(str(url)) ? 'dynamic' : config.host;
  }
  function req(method, url) { record('request', JSON.stringify({ method: method, host: hostOf(url) })); }

  // ---- universal stub: any property, call or construct returns another stub ----
  function stub(label) {
    var fn = function () {};
    return new Proxy(fn, {
      get: function (_t, p) {
        if (p === 'then') return undefined;
        if (p === Symbol.toPrimitive) return function () { return 0; };
        if (p === 'toString' || p === 'valueOf') return function () { return ''; };
        if (p === 'length') return 0;
        return stub(label + '.' + str(p));
      },
      set: function () { return true; },
      apply: function () { return stub(label + '()'); },
      construct: function () { return stub('new ' + label); },
      has: function () { return true; },
    });
  }

  // ---- events ----
  function EventTargetMixin(target) {
    target.addEventListener = function (type, fn) { if (typeof fn === 'function' || (fn && typeof fn.handleEvent === 'function')) listeners.push({ target: target, type: str(type), fn: fn }); };
    target.removeEventListener = function (type, fn) {
      for (var i = listeners.length - 1; i >= 0; i--) if (listeners[i].target === target && listeners[i].type === str(type) && listeners[i].fn === fn) listeners.splice(i, 1);
    };
    target.dispatchEvent = function (ev) { fire(target, ev && ev.type, ev); return true; };
    return target;
  }
  function Event(type, init) { this.type = str(type); this.bubbles = !!(init && init.bubbles); this.defaultPrevented = false; this.target = null; this.detail = init && init.detail; }
  Event.prototype.preventDefault = function () { this.defaultPrevented = true; };
  Event.prototype.stopPropagation = function () {};
  Event.prototype.stopImmediatePropagation = function () {};
  function CustomEvent(type, init) { Event.call(this, type, init); }
  CustomEvent.prototype = Object.create(Event.prototype);
  function fire(target, type, ev) {
    var event = ev || new Event(type);
    if (!event.target) event.target = target;
    var list = listeners.filter(function (l) { return l.target === target && l.type === str(type); });
    list.forEach(function (l) { guard(function () { typeof l.fn === 'function' ? l.fn.call(target, event) : l.fn.handleEvent(event); }); });
    var prop = target['on' + str(type)];
    if (typeof prop === 'function') guard(function () { prop.call(target, event); });
  }
  function guard(fn) {
    try { fn(); } catch (e) { record('error', (e && e.name ? e.name + ': ' : '') + str(e && e.message !== undefined ? e.message : e)); }
  }

  // ---- DOM ----
  function Node() {}
  function Element() {}
  Element.prototype = Object.create(Node.prototype);
  function HTMLElement() {}
  HTMLElement.prototype = Object.create(Element.prototype);
  function classList(el) {
    var set = [];
    return {
      add: function () { for (var i = 0; i < arguments.length; i++) if (set.indexOf(str(arguments[i])) < 0) set.push(str(arguments[i])); el.className = set.join(' '); },
      remove: function () { for (var i = 0; i < arguments.length; i++) { var k = set.indexOf(str(arguments[i])); if (k >= 0) set.splice(k, 1); } el.className = set.join(' '); },
      toggle: function (c, force) { var has = set.indexOf(str(c)) >= 0; var want = force === undefined ? !has : !!force; if (want && !has) this.add(c); if (!want && has) this.remove(c); return want; },
      contains: function (c) { return set.indexOf(str(c)) >= 0; },
      replace: function (a, b) { this.remove(a); this.add(b); },
      get length() { return set.length; },
      forEach: function (fn) { set.forEach(fn); },
    };
  }
  var NETWORK_TAGS = { SCRIPT: 1, IMG: 1, IFRAME: 1, LINK: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1 };
  function el(tag) {
    var node = Object.create(HTMLElement.prototype);
    var name = str(tag).toUpperCase();
    var attrs = {};
    var src = '';
    var html = '';
    node.tagName = name; node.nodeName = name; node.nodeType = 1; node.localName = name.toLowerCase();
    node.children = []; node.childNodes = node.children;
    node.style = new Proxy({}, { get: function (t, p) { if (p === 'setProperty') return function (k, v) { t[k] = v; }; if (p === 'getPropertyValue' || p === 'removeProperty') return function (k) { return t[k] || ''; }; return t[p] === undefined ? '' : t[p]; }, set: function (t, p, v) { t[p] = v; return true; } });
    node.dataset = {}; node.className = ''; node.id = ''; node.textContent = ''; node.innerText = ''; node.value = ''; node.checked = false; node.disabled = false; node.hidden = false;
    node.title = ''; node.href = ''; node.type = ''; node.placeholder = ''; node.scrollTop = 0; node.scrollLeft = 0;
    node.offsetWidth = 0; node.offsetHeight = 0; node.clientWidth = 0; node.clientHeight = 0; node.scrollHeight = 0; node.scrollWidth = 0;
    node.parentNode = null; node.parentElement = null; node.isConnected = false; node.shadowRoot = null; node.ownerDocument = null;
    node.classList = classList(node);
    Object.defineProperty(node, 'innerHTML', { get: function () { return html; }, set: function (v) { html = str(v); if (/<script[\s>]/i.test(html)) record('dom', 'innerHTML <script>'); }, enumerable: true });
    Object.defineProperty(node, 'outerHTML', { get: function () { return '<' + node.localName + '>' + html + '</' + node.localName + '>'; }, set: function () {} });
    Object.defineProperty(node, 'src', { get: function () { return src; }, set: function (v) { src = str(v); if (NETWORK_TAGS[name]) req(name === 'SCRIPT' ? 'SCRIPT' : 'GET', src); }, enumerable: true });
    Object.defineProperty(node, 'firstChild', { get: function () { return node.children[0] || null; } });
    Object.defineProperty(node, 'lastChild', { get: function () { return node.children[node.children.length - 1] || null; } });
    Object.defineProperty(node, 'firstElementChild', { get: function () { return node.children[0] || null; } });
    Object.defineProperty(node, 'lastElementChild', { get: function () { return node.children[node.children.length - 1] || null; } });
    Object.defineProperty(node, 'childElementCount', { get: function () { return node.children.length; } });
    Object.defineProperty(node, 'nextSibling', { get: function () { var p = node.parentNode; if (!p) return null; return p.children[p.children.indexOf(node) + 1] || null; } });
    Object.defineProperty(node, 'previousSibling', { get: function () { var p = node.parentNode; if (!p) return null; return p.children[p.children.indexOf(node) - 1] || null; } });
    node.nextElementSibling = null; node.previousElementSibling = null;
    function adopt(child) {
      if (!child || typeof child !== 'object') return child;
      if (child.parentNode && child.parentNode.children) { var k = child.parentNode.children.indexOf(child); if (k >= 0) child.parentNode.children.splice(k, 1); }
      child.parentNode = node; child.parentElement = node; child.isConnected = true;
      if (child.tagName === 'SCRIPT' && (child.textContent || child.innerHTML)) record('dom', 'inline <script> injected');
      return child;
    }
    node.appendChild = function (c) { adopt(c); node.children.push(c); return c; };
    node.append = function () { for (var i = 0; i < arguments.length; i++) { var c = arguments[i]; if (typeof c === 'object') node.appendChild(c); else node.textContent += str(c); } };
    node.prepend = function () { for (var i = arguments.length - 1; i >= 0; i--) { var c = arguments[i]; if (typeof c === 'object') { adopt(c); node.children.unshift(c); } } };
    node.insertBefore = function (c, ref) { adopt(c); var k = node.children.indexOf(ref); if (k < 0) node.children.push(c); else node.children.splice(k, 0, c); return c; };
    node.insertAdjacentElement = function (_p, c) { return node.appendChild(c); };
    node.insertAdjacentHTML = function (_p, h) { html += str(h); };
    node.insertAdjacentText = function () {};
    node.removeChild = function (c) { var k = node.children.indexOf(c); if (k >= 0) node.children.splice(k, 1); if (c) { c.parentNode = null; c.parentElement = null; } return c; };
    node.replaceChild = function (n, o) { var k = node.children.indexOf(o); if (k >= 0) { adopt(n); node.children[k] = n; } return o; };
    node.replaceChildren = function () { node.children.length = 0; node.append.apply(node, arguments); };
    node.remove = function () { if (node.parentNode && node.parentNode.removeChild) node.parentNode.removeChild(node); };
    node.replaceWith = function (n) { if (node.parentNode) node.parentNode.replaceChild(n, node); };
    node.before = function () {}; node.after = function () {};
    node.setAttribute = function (k, v) { attrs[str(k)] = str(v); if (str(k) === 'src') node.src = v; if (str(k) === 'id') node.id = str(v); if (str(k) === 'class') node.className = str(v); };
    node.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(attrs, str(k)) ? attrs[str(k)] : null; };
    node.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(attrs, str(k)); };
    node.removeAttribute = function (k) { delete attrs[str(k)]; };
    node.toggleAttribute = function (k) { if (node.hasAttribute(k)) { node.removeAttribute(k); return false; } attrs[str(k)] = ''; return true; };
    node.getAttributeNames = function () { return Object.keys(attrs); };
    // A selector can match markup this element received through innerHTML. Return a
    // child node so code like el.innerHTML = '<b class="x">'; el.querySelector('.x') runs.
    function matchesOwnMarkup(sel) {
      var token = /[.#]?([A-Za-z0-9_-]+)/.exec(str(sel));
      return !!(token && html && html.indexOf(token[1]) >= 0);
    }
    node.querySelector = function (sel) { if (matchesOwnMarkup(sel)) { var c = el('div'); adopt(c); return c; } return null; };
    node.querySelectorAll = function (sel) { var out = matchesOwnMarkup(sel) ? [node.querySelector(sel)] : []; out.item = function (i) { return out[i] || null; }; return out; };
    node.getElementsByTagName = function () { return []; };
    node.getElementsByClassName = function () { return []; };
    node.closest = function () { return null; };
    node.matches = function () { return false; };
    node.contains = function (c) { return c === node || node.children.indexOf(c) >= 0; };
    node.cloneNode = function () { var c = el(name); c.innerHTML = html; c.className = node.className; return c; };
    node.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
    node.getClientRects = function () { return []; };
    node.focus = function () {}; node.blur = function () {}; node.click = function () { fire(node, 'click'); };
    node.scrollIntoView = function () {}; node.scrollTo = function () {}; node.scrollBy = function () {};
    node.animate = function () { return { finished: Promise.resolve(), cancel: function () {}, onfinish: null }; };
    node.attachShadow = function () { var r = el('#shadow-root'); node.shadowRoot = r; return r; };
    node.getRootNode = function () { return document; };
    node.select = function () {}; node.setSelectionRange = function () {};
    node.play = function () { return Promise.resolve(); }; node.pause = function () {};
    node.submit = function () { record('dom', 'form submit'); };
    node.showModal = function () {}; node.close = function () {};
    EventTargetMixin(node);
    return node;
  }

  var documentElement = el('html');
  var head = el('head');
  var body = el('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);
  var cookieJar = '';
  var document = EventTargetMixin({
    nodeType: 9,
    documentElement: documentElement, head: head, body: body,
    readyState: 'loading', visibilityState: 'visible', hidden: false,
    title: '', referrer: '', characterSet: 'UTF-8', contentType: 'text/html', domain: config.host,
    createElement: function (t) { var e = el(t); e.ownerDocument = document; return e; },
    createElementNS: function (_ns, t) { var e = el(t); e.ownerDocument = document; return e; },
    createTextNode: function (t) { var n = el('#text'); n.textContent = str(t); n.nodeType = 3; return n; },
    createComment: function () { var n = el('#comment'); n.nodeType = 8; return n; },
    createDocumentFragment: function () { return el('#document-fragment'); },
    createRange: function () { return stub('Range'); },
    createTreeWalker: function () { return { nextNode: function () { return null; }, currentNode: null }; },
    getElementById: function () { return null; },
    getElementsByClassName: function () { return []; },
    getElementsByTagName: function (t) { var n = str(t).toLowerCase(); return n === 'head' ? [head] : n === 'body' ? [body] : n === 'html' ? [documentElement] : []; },
    getElementsByName: function () { return []; },
    querySelector: function (s) { var n = str(s).trim().toLowerCase(); return n === 'head' ? head : n === 'body' ? body : n === 'html' ? documentElement : null; },
    querySelectorAll: function () { var out = []; out.item = function () { return null; }; return out; },
    elementFromPoint: function () { return null; },
    hasFocus: function () { return true; },
    getSelection: function () { return { toString: function () { return ''; }, removeAllRanges: function () {}, addRange: function () {}, rangeCount: 0 }; },
    execCommand: function (cmd) { var c = str(cmd).toLowerCase(); if (c === 'copy') record('clipboard', 'write:execCommand'); if (c === 'paste') record('clipboard', 'read:execCommand'); return true; },
    open: function () {}, write: function () { record('dom', 'document.write'); }, close: function () {},
    fonts: { ready: Promise.resolve(), load: function () { return Promise.resolve([]); }, check: function () { return true; } },
    activeElement: null,
    currentScript: null,
  });
  Object.defineProperty(document, 'cookie', { get: function () { record('storage', 'document.cookie'); return cookieJar; }, set: function (v) { cookieJar = str(v); } });
  documentElement.ownerDocument = document; head.ownerDocument = document; body.ownerDocument = document;

  // ---- URL ----
  function parseUrl(input, base) {
    var s = str(input);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (base === undefined) throw new TypeError("Failed to construct 'URL': Invalid URL");
      var b = parseUrl(base);
      if (s.indexOf('//') === 0) s = b.protocol + s;
      else if (s.charAt(0) === '/') s = b.origin + s;
      else if (s.charAt(0) === '?' ) s = b.origin + b.pathname + s;
      else if (s.charAt(0) === '#') s = b.origin + b.pathname + b.search + s;
      else s = b.origin + b.pathname.replace(/[^\/]*$/, '') + s;
    }
    var m = /^([a-z][a-z0-9+.-]*:)(\/\/(([^:@\/]*)(:([^@\/]*))?@)?([^\/?#:]*)(:(\d+))?)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
    if (!m) throw new TypeError("Failed to construct 'URL': Invalid URL");
    var protocol = m[1].toLowerCase();
    var hostname = (m[7] || '').toLowerCase();
    var port = m[9] || '';
    var pathname = m[10] || (m[2] ? '/' : '');
    return { protocol: protocol, username: m[4] || '', password: m[6] || '', hostname: hostname, port: port,
      host: hostname + (port ? ':' + port : ''), pathname: pathname, search: m[11] && m[11] !== '?' ? m[11] : '', hash: m[12] && m[12] !== '#' ? m[12] : '',
      origin: m[2] ? protocol + '//' + hostname + (port ? ':' + port : '') : 'null' };
  }
  function URLSearchParams(init) {
    var list = [];
    if (typeof init === 'string') {
      init.replace(/^\?/, '').split('&').forEach(function (pair) { if (!pair) return; var i = pair.indexOf('='); var k = i < 0 ? pair : pair.slice(0, i); var v = i < 0 ? '' : pair.slice(i + 1); list.push([decodeURIComponent(k.replace(/\+/g, ' ')), decodeURIComponent(v.replace(/\+/g, ' '))]); });
    } else if (init && typeof init === 'object') {
      if (typeof init.forEach === 'function' && !(init instanceof Array)) init.forEach(function (v, k) { list.push([str(k), str(v)]); });
      else if (init instanceof Array) init.forEach(function (p) { list.push([str(p[0]), str(p[1])]); });
      else Object.keys(init).forEach(function (k) { list.push([k, str(init[k])]); });
    }
    this._l = list;
  }
  URLSearchParams.prototype = {
    append: function (k, v) { this._l.push([str(k), str(v)]); },
    set: function (k, v) { this.delete(k); this._l.push([str(k), str(v)]); },
    get: function (k) { for (var i = 0; i < this._l.length; i++) if (this._l[i][0] === str(k)) return this._l[i][1]; return null; },
    getAll: function (k) { return this._l.filter(function (p) { return p[0] === str(k); }).map(function (p) { return p[1]; }); },
    has: function (k) { return this.get(k) !== null; },
    delete: function (k) { this._l = this._l.filter(function (p) { return p[0] !== str(k); }); },
    forEach: function (fn) { var self = this; this._l.forEach(function (p) { fn(p[1], p[0], self); }); },
    keys: function () { return this._l.map(function (p) { return p[0]; })[Symbol.iterator](); },
    values: function () { return this._l.map(function (p) { return p[1]; })[Symbol.iterator](); },
    entries: function () { return this._l.map(function (p) { return [p[0], p[1]]; })[Symbol.iterator](); },
    toString: function () { return this._l.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&'); },
  };
  URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;
  function URL(input, base) {
    var p = parseUrl(input instanceof URL ? input.href : input, base instanceof URL ? base.href : base);
    for (var k in p) this[k] = p[k];
    this.searchParams = new URLSearchParams(this.search);
  }
  Object.defineProperty(URL.prototype, 'href', { get: function () { var q = this.searchParams ? this.searchParams.toString() : ''; return this.protocol + (this.origin !== 'null' ? '//' + this.host : '') + this.pathname + (q ? '?' + q : '') + this.hash; } });
  URL.prototype.toString = function () { return this.href; };
  URL.prototype.toJSON = function () { return this.href; };
  URL.createObjectURL = function () { return 'blob:' + config.origin + '/sandbox'; };
  URL.revokeObjectURL = function () {};
  URL.canParse = function (u, b) { try { parseUrl(u, b); return true; } catch (e) { return false; } };

  var here = parseUrl(config.href);
  var location = {
    href: config.href, protocol: here.protocol, host: here.host, hostname: here.hostname, port: here.port,
    pathname: here.pathname, search: here.search, hash: here.hash, origin: here.origin,
    assign: function (u) { req('NAVIGATE', u); }, replace: function (u) { req('NAVIGATE', u); }, reload: function () {},
    toString: function () { return config.href; },
  };
  document.location = location; document.URL = config.href; document.baseURI = config.href;

  // ---- storage ----
  function storage(label) {
    var data = {};
    return {
      getItem: function (k) { record('storage', label + ':' + str(k)); return Object.prototype.hasOwnProperty.call(data, str(k)) ? data[str(k)] : null; },
      setItem: function (k, v) { data[str(k)] = str(v); },
      removeItem: function (k) { delete data[str(k)]; },
      clear: function () { data = {}; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; },
    };
  }

  // ---- network (egress is blocked: every call is logged and fails closed) ----
  function Headers(init) { var h = {}; if (init) Object.keys(init).forEach(function (k) { h[k.toLowerCase()] = str(init[k]); }); this._h = h; }
  Headers.prototype = { get: function (k) { return this._h[str(k).toLowerCase()] || null; }, set: function (k, v) { this._h[str(k).toLowerCase()] = str(v); }, append: function (k, v) { this.set(k, v); }, has: function (k) { return str(k).toLowerCase() in this._h; }, delete: function (k) { delete this._h[str(k).toLowerCase()]; }, forEach: function (fn) { var h = this._h; Object.keys(h).forEach(function (k) { fn(h[k], k); }); } };
  function Response(bodyText, init) { this.status = (init && init.status) || 0; this.ok = this.status >= 200 && this.status < 300; this.statusText = ''; this.headers = new Headers(); this._b = bodyText == null ? '' : str(bodyText); this.url = ''; this.redirected = false; this.type = 'basic'; }
  Response.prototype = { text: function () { return Promise.resolve(this._b); }, json: function () { var b = this._b; return new Promise(function (ok, no) { try { ok(JSON.parse(b)); } catch (e) { no(e); } }); }, blob: function () { return Promise.resolve(new Blob([this._b])); }, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(0)); }, clone: function () { return new Response(this._b, { status: this.status }); } };
  function Request(url, init) { this.url = url instanceof URL ? url.href : str(url); this.method = (init && init.method) || 'GET'; this.headers = new Headers(init && init.headers); }
  function fetchStub(input, init) {
    var url = input && typeof input === 'object' && 'url' in input ? input.url : input;
    req(str((init && init.method) || (input && input.method) || 'GET').toUpperCase(), url instanceof URL ? url.href : url);
    return Promise.resolve(new Response('', { status: 0 }));
  }
  function XMLHttpRequest() { this.readyState = 0; this.status = 0; this.responseText = ''; this.response = null; this._m = 'GET'; this._u = ''; EventTargetMixin(this); }
  XMLHttpRequest.prototype.open = function (m, u) { this._m = str(m).toUpperCase(); this._u = u; this.readyState = 1; };
  XMLHttpRequest.prototype.send = function () { req(this._m, this._u); var self = this; setTimeoutImpl(function () { self.readyState = 4; fire(self, 'error'); fire(self, 'loadend'); }, 0, []); };
  XMLHttpRequest.prototype.setRequestHeader = function () {};
  XMLHttpRequest.prototype.abort = function () {};
  XMLHttpRequest.prototype.getAllResponseHeaders = function () { return ''; };
  XMLHttpRequest.prototype.getResponseHeader = function () { return null; };
  XMLHttpRequest.prototype.overrideMimeType = function () {};
  function WebSocket(u) { req('WS', u); this.readyState = 3; this.url = str(u); EventTargetMixin(this); var self = this; setTimeoutImpl(function () { fire(self, 'error'); fire(self, 'close'); }, 0, []); }
  WebSocket.prototype.send = function () {}; WebSocket.prototype.close = function () {};
  WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSING = 2; WebSocket.CLOSED = 3;
  function EventSource(u) { req('SSE', u); this.readyState = 2; EventTargetMixin(this); }
  EventSource.prototype.close = function () {};
  function Image() { var i = el('img'); return i; }
  function Audio(u) { var a = el('audio'); if (u) a.src = u; return a; }
  function Blob(parts, opts) { this.size = 0; this.type = (opts && opts.type) || ''; (parts || []).forEach(function (p) { this.size += str(p).length; }, this); }
  Blob.prototype.text = function () { return Promise.resolve(''); };
  function FormData() { this._d = []; }
  FormData.prototype.append = function (k, v) { this._d.push([k, v]); };
  FormData.prototype.get = function (k) { for (var i = 0; i < this._d.length; i++) if (this._d[i][0] === k) return this._d[i][1]; return null; };
  function AbortController() { this.signal = { aborted: false, addEventListener: function () {}, removeEventListener: function () {}, reason: undefined }; }
  AbortController.prototype.abort = function () { this.signal.aborted = true; };
  var AbortSignal = { timeout: function () { return new AbortController().signal; }, abort: function () { var c = new AbortController(); c.abort(); return c.signal; }, any: function () { return new AbortController().signal; } };

  // ---- timers on a virtual clock ----
  function setTimeoutImpl(fn, ms, args, every) {
    var id = timerSeq++;
    var delay = Math.max(0, Number(ms) || 0);
    timers.push({ id: id, at: vnow + delay, fn: fn, args: args, every: every ? Math.max(delay, 10) : 0 });
    return id;
  }
  function clearTimer(id) { for (var i = timers.length - 1; i >= 0; i--) if (timers[i].id === id) timers.splice(i, 1); }

  // ---- wallets: every signing call is recorded and never resolves to a signature ----
  function walletProvider(name) {
    var target = {
      isPhantom: name === 'phantom', isSolflare: name === 'solflare', isBackpack: name === 'backpack',
      isConnected: false, publicKey: null,
      connect: function () { record('wallet-connect', name + '.connect'); return Promise.resolve({ publicKey: null }); },
      disconnect: function () { return Promise.resolve(); },
      on: function () {}, off: function () {}, removeListener: function () {}, request: function (a) { var m = a && a.method ? str(a.method) : 'request'; if (SIGNING.indexOf(m) >= 0 || /sign|send/i.test(m)) record('wallet', name + '.' + m); return Promise.reject(new Error('sandbox wallet')); },
    };
    return new Proxy(target, {
      get: function (t, p) {
        if (typeof p === 'string' && SIGNING.indexOf(p) >= 0) return function () { record('wallet', name + '.' + p); return Promise.reject(new Error('sandbox wallet')); };
        if (p === 'solana' && name === 'phantom') return wallets.phantomSolana;
        return t[p];
      },
      set: function (t, p) { record('wallet', 'overwrite:' + name + '.' + str(p)); return true; },
      defineProperty: function (t, p) { record('wallet', 'overwrite:' + name + '.' + str(p)); return true; },
    });
  }
  var wallets = { phantomSolana: walletProvider('phantom.solana') };
  wallets.solana = walletProvider('solana');
  wallets.phantom = walletProvider('phantom');
  wallets.solflare = walletProvider('solflare');
  wallets.backpack = walletProvider('backpack');
  ['solana', 'phantom', 'solflare', 'backpack'].forEach(function (k) {
    Object.defineProperty(G, k, { get: function () { return wallets[k]; }, set: function () { record('wallet', 'overwrite:window.' + k); }, configurable: false, enumerable: true });
  });

  // ---- misc browser APIs ----
  var clipboard = {
    readText: function () { record('clipboard', 'read'); return Promise.resolve(''); },
    read: function () { record('clipboard', 'read'); return Promise.resolve([]); },
    writeText: function (t) { record('clipboard', 'write:' + str(t).slice(0, 64)); return Promise.resolve(); },
    write: function () { record('clipboard', 'write:blob'); return Promise.resolve(); },
  };
  var navigator = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 TrenchMartSandbox',
    language: 'en-US', languages: ['en-US', 'en'], platform: 'Linux x86_64', vendor: 'Google Inc.', onLine: true, cookieEnabled: true,
    hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, webdriver: false,
    clipboard: clipboard,
    sendBeacon: function (u) { req('BEACON', u); return true; },
    permissions: { query: function () { return Promise.resolve({ state: 'prompt', addEventListener: function () {} }); } },
    serviceWorker: stub('serviceWorker'), mediaDevices: stub('mediaDevices'), userAgentData: { brands: [], mobile: false, platform: 'Linux' },
    vibrate: function () { return false; },
  };
  function structuredClone(value) {
    var seen = new Map();
    function walk(v) {
      if (v === null || typeof v !== 'object') { if (typeof v === 'function' || typeof v === 'symbol') throw new Error('DataCloneError: value could not be cloned'); return v; }
      if (seen.has(v)) return seen.get(v);
      var out;
      if (v instanceof Date) out = new Date(v.getTime());
      else if (v instanceof RegExp) out = new RegExp(v.source, v.flags);
      else if (v instanceof Map) { out = new Map(); seen.set(v, out); v.forEach(function (val, k) { out.set(walk(k), walk(val)); }); return out; }
      else if (v instanceof Set) { out = new Set(); seen.set(v, out); v.forEach(function (val) { out.add(walk(val)); }); return out; }
      else if (ArrayBuffer.isView(v)) out = v.slice();
      else if (v instanceof ArrayBuffer) out = v.slice(0);
      else if (Array.isArray(v)) { out = []; seen.set(v, out); for (var i = 0; i < v.length; i++) out[i] = walk(v[i]); return out; }
      else { out = {}; seen.set(v, out); Object.keys(v).forEach(function (k) { out[k] = walk(v[k]); }); return out; }
      seen.set(v, out);
      return out;
    }
    return walk(value);
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function btoa(input) {
    var s = str(input), out = '';
    for (var i = 0; i < s.length; i += 3) {
      var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
      if (a > 255 || b > 255 || c > 255) throw new Error('InvalidCharacterError');
      var n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < s.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < s.length ? B64[n & 63] : '=');
    }
    return out;
  }
  function atob(input) {
    var s = str(input).replace(/[\s=]+/g, ''), out = '', bits = 0, buf = 0;
    for (var i = 0; i < s.length; i++) { var v = B64.indexOf(s[i]); if (v < 0) throw new Error('InvalidCharacterError'); buf = (buf << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); } }
    return out;
  }
  function TextEncoder() {}
  TextEncoder.prototype.encode = function (s) { var u = unescape(encodeURIComponent(str(s === undefined ? '' : s))); var a = new Uint8Array(u.length); for (var i = 0; i < u.length; i++) a[i] = u.charCodeAt(i); return a; };
  TextEncoder.prototype.encoding = 'utf-8';
  function TextDecoder() {}
  TextDecoder.prototype.decode = function (b) { if (!b) return ''; var a = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength === undefined ? b.length : b.byteLength); var s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };
  var seed = 0x9e3779b9;
  function rand() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
  var crypto = {
    getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(rand() * 256); return a; },
    randomUUID: function () { var h = '0123456789abcdef', s = ''; for (var i = 0; i < 36; i++) s += (i === 8 || i === 13 || i === 18 || i === 23) ? '-' : i === 14 ? '4' : h[Math.floor(rand() * 16)]; return s; },
    subtle: stub('crypto.subtle'),
  };
  function Observer() { return { observe: function () {}, unobserve: function () {}, disconnect: function () {}, takeRecords: function () { return []; } }; }
  function MutationObserver() { return Observer(); }
  function IntersectionObserver() { return Observer(); }
  function ResizeObserver() { return Observer(); }
  function PerformanceObserver() { return Observer(); }
  var t0 = Date.now();
  var performance = { now: function () { return vnow + (Date.now() - t0); }, mark: function () {}, measure: function () {}, getEntriesByType: function () { return []; }, getEntriesByName: function () { return []; }, timeOrigin: t0 };
  var gmStore = {};
  function gmRequest(d) { req(str((d && d.method) || 'GET').toUpperCase(), d && d.url); var cb = d && d.onerror; if (typeof cb === 'function') setTimeoutImpl(function () { cb({ status: 0 }); }, 0, []); return { abort: function () {} }; }
  var GM = {
    getValue: function (k, d) { return Promise.resolve(k in gmStore ? gmStore[k] : d); },
    setValue: function (k, v) { gmStore[k] = v; return Promise.resolve(); },
    deleteValue: function (k) { delete gmStore[k]; return Promise.resolve(); },
    listValues: function () { return Promise.resolve(Object.keys(gmStore)); },
    xmlHttpRequest: gmRequest,
    setClipboard: function (t) { record('clipboard', 'write:' + str(t).slice(0, 64)); return Promise.resolve(); },
    notification: function () { return Promise.resolve(); },
    openInTab: function (u) { req('NAVIGATE', u); return Promise.resolve({ close: function () {} }); },
    addStyle: function () { return Promise.resolve(el('style')); },
    registerMenuCommand: function () { return Promise.resolve(0); },
    info: { script: { name: config.name, version: config.version }, scriptHandler: 'TrenchMartSandbox', version: '1' },
  };

  var api = {
    window: G, self: G, top: G, parent: G, frames: G, globalThis: G, unsafeWindow: G,
    document: document, location: location, navigator: navigator, history: { length: 1, state: null, pushState: function () {}, replaceState: function () {}, back: function () {}, forward: function () {}, go: function () {} },
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, orientation: { type: 'landscape-primary' } },
    innerWidth: 1920, innerHeight: 1080, outerWidth: 1920, outerHeight: 1080, devicePixelRatio: 1, scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
    localStorage: storage('localStorage'), sessionStorage: storage('sessionStorage'),
    indexedDB: stub('indexedDB'), caches: stub('caches'),
    fetch: fetchStub, XMLHttpRequest: XMLHttpRequest, WebSocket: WebSocket, EventSource: EventSource, Headers: Headers, Response: Response, Request: Request,
    Image: Image, Audio: Audio, Blob: Blob, File: Blob, FormData: FormData, AbortController: AbortController, AbortSignal: AbortSignal,
    URL: URL, URLSearchParams: URLSearchParams, TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    Event: Event, CustomEvent: CustomEvent, KeyboardEvent: Event, MouseEvent: Event, MessageEvent: Event,
    EventTarget: function () { EventTargetMixin(this); },
    Node: Node, Element: Element, HTMLElement: HTMLElement, HTMLDivElement: HTMLElement, HTMLInputElement: HTMLElement, HTMLButtonElement: HTMLElement, HTMLAnchorElement: HTMLElement, HTMLImageElement: HTMLElement, HTMLScriptElement: HTMLElement, SVGElement: HTMLElement, Text: Node, DocumentFragment: Node,
    MutationObserver: MutationObserver, IntersectionObserver: IntersectionObserver, ResizeObserver: ResizeObserver, PerformanceObserver: PerformanceObserver,
    getComputedStyle: function () { return new Proxy({}, { get: function (_t, p) { return p === 'getPropertyValue' ? function () { return ''; } : ''; } }); },
    matchMedia: function (q) { return { matches: false, media: str(q), addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {}, onchange: null }; },
    requestAnimationFrame: function (fn) { return setTimeoutImpl(function () { fn(performance.now()); }, 16, []); },
    cancelAnimationFrame: clearTimer,
    requestIdleCallback: function (fn) { return setTimeoutImpl(function () { fn({ didTimeout: false, timeRemaining: function () { return 10; } }); }, 1, []); },
    cancelIdleCallback: clearTimer,
    setTimeout: function (fn, ms) { if (typeof fn !== 'function') { record('dom', 'setTimeout(string)'); return 0; } return setTimeoutImpl(fn, ms, Array.prototype.slice.call(arguments, 2)); },
    setInterval: function (fn, ms) { if (typeof fn !== 'function') { record('dom', 'setInterval(string)'); return 0; } return setTimeoutImpl(fn, ms, Array.prototype.slice.call(arguments, 2), true); },
    clearTimeout: clearTimer, clearInterval: clearTimer,
    queueMicrotask: function (fn) { Promise.resolve().then(fn); },
    structuredClone: structuredClone, atob: atob, btoa: btoa, crypto: crypto, performance: performance,
    alert: function () {}, confirm: function () { return false; }, prompt: function () { return null; }, print: function () {},
    open: function (u) { req('NAVIGATE', u); return null; }, close: function () {}, focus: function () {}, blur: function () {}, scrollTo: function () {}, scrollBy: function () {}, scroll: function () {},
    postMessage: function () {},
    AudioContext: stub('AudioContext'), webkitAudioContext: stub('AudioContext'), OscillatorNode: stub('OscillatorNode'), Notification: stub('Notification'),
    speechSynthesis: stub('speechSynthesis'), SpeechSynthesisUtterance: stub('SpeechSynthesisUtterance'),
    trustedTypes: undefined, chrome: undefined,
    isSecureContext: true, origin: here.origin, name: '', closed: false, opener: null, frameElement: null,
    GM: GM, GM_info: GM.info,
    GM_getValue: function (k, d) { return k in gmStore ? gmStore[k] : d; },
    GM_setValue: function (k, v) { gmStore[k] = v; }, GM_deleteValue: function (k) { delete gmStore[k]; }, GM_listValues: function () { return Object.keys(gmStore); },
    GM_xmlhttpRequest: gmRequest, GM_setClipboard: GM.setClipboard, GM_notification: function () {}, GM_openInTab: function (u) { req('NAVIGATE', u); },
    GM_addStyle: function (css) { var s = el('style'); s.textContent = str(css); head.appendChild(s); return s; },
    GM_addElement: function (a, b) { var e = el(typeof a === 'string' ? a : b); return e; },
    GM_registerMenuCommand: function () { return 0; }, GM_unregisterMenuCommand: function () {}, GM_log: function () {},
    GM_getResourceText: function () { return ''; }, GM_getResourceURL: function () { return ''; },
  };
  Object.keys(api).forEach(function (k) { try { Object.defineProperty(G, k, { value: api[k], writable: true, configurable: true, enumerable: k !== 'GM_info' }); } catch (e) {} });
  EventTargetMixin(G);
  var con = {};
  ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir'].forEach(function (k) {
    con[k] = function () { var parts = []; for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; try { parts.push(typeof a === 'object' ? JSON.stringify(a) : str(a)); } catch (e) { parts.push(str(a)); } } record('console', (k === 'error' ? 'error ' : '') + parts.join(' ').slice(0, 180)); };
  });
  ['group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'count', 'assert', 'clear'].forEach(function (k) { con[k] = function () {}; });
  G.console = con;

  return {
    ready: function () {
      document.readyState = 'interactive'; fire(document, 'readystatechange'); fire(document, 'DOMContentLoaded'); fire(G, 'DOMContentLoaded');
      document.readyState = 'complete'; fire(document, 'readystatechange'); fire(G, 'load'); fire(G, 'pageshow');
    },
    // Runs the next due timer. Returns false once the queue is empty or the virtual
    // horizon is reached, so a polling interval cannot keep the review busy forever.
    step: function (horizonMs, maxRuns) {
      if (timers.length === 0 || runs >= maxRuns) return false;
      timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
      var next = timers[0];
      if (next.at > horizonMs) return false;
      timers.shift();
      vnow = Math.max(vnow, next.at);
      runs++;
      if (next.every) timers.push({ id: next.id, at: vnow + next.every, fn: next.fn, args: next.args, every: next.every });
      guard(function () { next.fn.apply(G, next.args); });
      return true;
    },
    runs: function () { return runs; },
  };
})
`;
