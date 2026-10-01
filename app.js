/* Poll Worker Support (tawk.to) - main page.
 * Flow: PIN gate -> details form (name, polling place, phone) -> tawk.to chat.
 * tawk.to JavaScript API used (https://developer.tawk.to/jsapi/):
 *   Tawk_API.visitor (before the embed loads), onLoad, login (only with a secure-mode hash),
 *   setAttributes, addEvent, addTags, maximize, showWidget, hideWidget, logout, shutdown.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var pinStep = $('pinStep'), detailsStep = $('detailsStep'), live = $('live');
  var pinForm = $('pinForm'), pinEl = $('pin'), pinGo = $('pinGo'), pinMsg = $('pinMsg');
  var detForm = $('detForm'), nameEl = $('name'), loc = $('loc'), locFilter = $('locFilter'),
      locCount = $('locCount'), locAddr = $('locAddr'), phoneEl = $('phone'), go = $('go'), msg = $('msg');
  var where = $('where'), liveMsg = $('liveMsg'), reopen = $('reopen');

  // RELAY_URL (Cloudflare Worker) replaces API_URL entirely when set.
  var API = window.RELAY_URL || window.API_URL || '';
  var localTest = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(API);
  var configured = /^https:\/\/script\.google\.com\//.test(API) ||
      /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/.test(API) || localTest;
  var MAX_SESSION_MS = 6 * 60 * 60 * 1000; // hard limit, enforced here even with no network
  var CHECK_MS = 2 * 60 * 1000;            // how often to ask the server if the session is still open
  var LOAD_WATCHDOG_MS = 20000;
  var ENDED_MSG = 'Your session has ended. Please sign in again.';
  // Storage keys are prefixed pwt_ so they never collide with other apps on the same github.io origin.
  var K_WORKER = 'pwt_worker', K_UID = 'pwt_uid', K_SID = 'pwt_sid', K_DEADLINE = 'pwt_deadline';

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { return ''; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k) || ''; if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { return ''; } }

  function post(body) {
    // text/plain avoids a browser preflight request, which Apps Script cannot answer
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  function show(step) {
    pinStep.hidden = step !== 'pin'; detailsStep.hidden = step !== 'details'; live.hidden = step !== 'live';
  }

  // ---------- locations (static file on this site) ----------
  var LOCS = [], byId = {};
  function normq(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function renderLocs(query) {
    var current = loc.value, terms = normq(query || '') ? normq(query).split(' ') : [];
    var frag = document.createDocumentFragment(), shown = 0, keep = false;
    var first = document.createElement('option'); first.value = ''; first.textContent = 'Select your polling place';
    frag.appendChild(first);
    LOCS.forEach(function (l) {
      var hay = normq(l.name + ' ' + l.address + ' ' + l.id);
      var match = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      if (!match && l.id !== current) return; // keep the chosen one visible while filtering
      var o = document.createElement('option'); o.value = l.id; o.textContent = l.name; frag.appendChild(o);
      if (l.id === current) keep = true;
      if (match) shown++;
    });
    loc.innerHTML = ''; loc.appendChild(frag);
    loc.value = keep ? current : '';
    if (!loc.value && terms.length && shown === 1) loc.selectedIndex = 1; // single match: preselect it
    locCount.textContent = terms.length
      ? (shown ? shown + ' of ' + LOCS.length + ' locations match.' : 'No locations match. Clear the filter to see all ' + LOCS.length + '.')
      : LOCS.length + ' locations';
    showAddr();
  }
  function showAddr() { var l = byId[loc.value]; locAddr.textContent = l ? 'Address: ' + l.address : ''; }
  function loadLocations() {
    return fetch('locations.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      LOCS = (j.locations || []).filter(function (l) { return l && l.id && l.name; })
        .map(function (l) { return { id: String(l.id), name: String(l.name), address: String(l.address || '') }; });
      byId = {}; LOCS.forEach(function (l) { byId[l.id] = l; });
      loc.disabled = false;
      renderLocs('');
    }).catch(function () {
      loc.innerHTML = '<option value="">Could not load locations</option>';
      msg.textContent = 'Could not load the location list. Reload the page to try again.';
    });
  }
  locFilter.addEventListener('input', function () { renderLocs(locFilter.value); });
  loc.addEventListener('change', function () { showAddr(); validLoc(); saveWorker(); });

  // ---------- validation ----------
  function digitsOf(v) { var d = String(v || '').replace(/\D/g, ''); if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1); return d; }
  function fmtPhone(d) {
    d = d.slice(0, 10);
    if (d.length < 4) return d.length ? '(' + d : '';
    if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }
  function setErr(el, errId, text) { $(errId).textContent = text || ''; el.setAttribute('aria-invalid', text ? 'true' : 'false'); return !text; }
  function cleanName() { return nameEl.value.replace(/\s+/g, ' ').trim(); }
  function validName() { var n = cleanName(); return setErr(nameEl, 'name-error', !n ? 'Enter your name.' : n.length < 2 ? 'Enter your full name.' : ''); }
  function validLoc() { return setErr(loc, 'loc-error', byId[loc.value] ? '' : 'Choose your polling place from the list.'); }
  function validPhone() {
    var d = digitsOf(phoneEl.value);
    if (!d) return setErr(phoneEl, 'phone-error', 'Enter your phone number.');
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return setErr(phoneEl, 'phone-error', 'Enter a valid 10-digit US phone number, e.g. (843) 555-0123.');
    phoneEl.value = fmtPhone(d);
    return setErr(phoneEl, 'phone-error', '');
  }
  phoneEl.addEventListener('input', function () {
    phoneEl.value = fmtPhone(digitsOf(phoneEl.value));
    if (phoneEl.getAttribute('aria-invalid') === 'true') validPhone();
  });
  phoneEl.addEventListener('blur', function () { if (phoneEl.value) validPhone(); saveWorker(); });
  nameEl.addEventListener('blur', function () { if (nameEl.value) validName(); saveWorker(); });

  detForm.addEventListener('input', function () {
    if (msg.textContent && !detForm.querySelector('[aria-invalid="true"]')) msg.textContent = '';
  });
  loc.addEventListener('change', function () { if (msg.textContent && !detForm.querySelector('[aria-invalid="true"]')) msg.textContent = ''; });

  // ---------- remembered details (this device) ----------
  function saveWorker() { ls(K_WORKER, JSON.stringify({ name: cleanName(), locationId: loc.value, phone: digitsOf(phoneEl.value) })); }
  function restoreWorker() {
    try {
      var s = JSON.parse(ls(K_WORKER) || 'null'); if (!s) return;
      if (s.name) nameEl.value = s.name;
      if (s.locationId && byId[s.locationId]) loc.value = s.locationId;
      if (s.phone) phoneEl.value = fmtPhone(digitsOf(s.phone));
      showAddr();
    } catch (e) {}
  }
  $('forget').addEventListener('click', function () {
    ls(K_WORKER, ''); ls(K_UID, '');
    nameEl.value = ''; phoneEl.value = ''; locFilter.value = ''; loc.value = ''; renderLocs('');
    setErr(nameEl, 'name-error'); setErr(loc, 'loc-error'); setErr(phoneEl, 'phone-error'); msg.textContent = '';
    nameEl.focus();
  });

  // ---------- session handling ----------
  var sid = '', deadline = 0, lastCheck = 0, checking = false, tick = null, pinValue = '';
  function setDeadline(j, cap) {
    var left = (typeof j.sessionExpiresIn === 'number' && j.sessionExpiresIn > 0) ? j.sessionExpiresIn * 1000 : MAX_SESSION_MS;
    deadline = Math.min(Date.now() + Math.min(left, MAX_SESSION_MS), cap || Infinity);
    ss(K_DEADLINE, String(deadline));
  }
  function endSession() {
    if (tick) { clearInterval(tick); tick = null; }
    sid = ''; deadline = 0; pinValue = '';
    ss(K_SID, ''); ss(K_DEADLINE, '');
    ls(K_UID, ''); // next sign-in on this device starts a fresh chat identity
    closeTawk();
    where.textContent = ''; pinEl.value = '';
    show('pin'); pinMsg.textContent = ENDED_MSG;
  }
  function check(resume) {
    if (!sid || checking) return Promise.resolve(null);
    checking = true; lastCheck = Date.now();
    var asked = sid;
    return post({ action: 'session', sessionId: asked, resume: !!resume })
      .then(function (j) {
        if (asked !== sid) return null;
        // Only an explicit answer ends the session; errors and unknown actions are ignored.
        if (j && j.ended) { endSession(); return null; }
        if (j && j.active) { setDeadline(j, Number(ss(K_DEADLINE)) || 0); return j; }
        return null;
      }, function () { return null; })
      .then(function (j) { checking = false; return j; });
  }
  function onTick() {
    if (!deadline) return;
    if (Date.now() >= deadline) { endSession(); return; }
    if (sid && Date.now() - lastCheck >= CHECK_MS) check(false);
  }
  function watch() { if (tick) clearInterval(tick); lastCheck = Date.now(); tick = setInterval(onTick, 15000); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) onTick(); });

  // ---------- tawk.to ----------
  var tawkInjected = false, tawkUsedThisPage = false;
  window.__pwt = { loaded: false, login: null, setAttributes: null, setAttributesIdentity: null, addEvent: null, addTags: null };
  function idOk(s) { return typeof s === 'string' && /^[A-Za-z0-9]{1,64}$/.test(s); }
  function clip(s) { s = String(s == null ? '' : s); return s.length > 255 ? s.slice(0, 255) : s; }

  function applyDetails(cfg) {
    var api = window.Tawk_API, d = window.__pwt;
    // Custom attributes: keys alphanumeric + dash (stored lowercase), values 1..255 chars.
    var custom = {
      'polling-place': clip(cfg.location), 'location-id': clip(cfg.locationId),
      'location-address': clip(cfg.address || '-'), 'worker-phone': clip(cfg.phone), 'worker-id': clip(cfg.userId)
    };
    var attrs = {}; for (var a in custom) attrs[a] = custom[a];
    if (cfg.hash) { attrs.hash = cfg.hash; attrs.userId = cfg.userId; } // secure mode: send the hash with the userId it was made from
    api.setAttributes(attrs, function (err) { d.setAttributes = err || 'ok'; });
    if (!cfg.hash) {
      // Secure Mode off: name/phone via setAttributes (also set via Tawk_API.visitor before load).
      // If a property later turns Secure Mode on without TAWK_API_KEY this call fails on its own
      // and the custom attributes above are unaffected.
      api.setAttributes({ name: clip(cfg.name), phone: cfg.phoneE164 }, function (err) { d.setAttributesIdentity = err || 'ok'; });
    }
    api.addEvent('poll-worker-check-in', custom, function (err) { d.addEvent = err || 'ok'; });
    api.addTags(['poll-worker', 'loc-' + cfg.locationId], function (err) { d.addTags = err || 'ok'; });
  }

  function onTawkReady(cfg) {
    var api = window.Tawk_API, d = window.__pwt;
    if (d.loaded) return; // login() reconnects the widget; apply only once
    d.loaded = true;
    var finish = function () {
      applyDetails(cfg);
      api.maximize();
      liveMsg.textContent = 'The chat is open. Type your question in the chat window. If you close it, use the button below to open it again.';
    };
    if (cfg.hash && typeof api.login === 'function') {
      api.login({ hash: cfg.hash, userId: cfg.userId, name: clip(cfg.name), phone: cfg.phoneE164 }, function (err) {
        d.login = err || 'ok';
        if (err) { // e.g. INVALID_HASH (wrong TAWK_API_KEY): still try to name the visitor; works when Secure Mode is off
          api.setAttributes({ name: clip(cfg.name), phone: cfg.phoneE164 }, function (e2) { d.setAttributesIdentity = e2 || 'ok'; });
        }
        finish();
      });
    } else finish();
  }

  function startTawk(cfg) {
    if (!idOk(cfg.propertyId) || !idOk(cfg.widgetId)) { show('details'); msg.textContent = 'Support chat is not available right now. Contact your election office.'; return; }
    tawkUsedThisPage = true;
    if (tawkInjected) return;
    tawkInjected = true;
    // Must be set before the embed script downloads (tawk.to: "Do not place this object in a function").
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_LoadStart = new Date();
    if (!cfg.hash) window.Tawk_API.visitor = { name: clip(cfg.name), phone: cfg.phoneE164 };
    window.Tawk_API.onLoad = function () { onTawkReady(cfg); };

    var s1 = document.createElement('script');
    s1.async = true;
    s1.src = 'https://embed.tawk.to/' + cfg.propertyId + '/' + cfg.widgetId;
    s1.charset = 'UTF-8';
    s1.setAttribute('crossorigin', '*');
    s1.onerror = function () {
      tawkInjected = false;
      liveMsg.textContent = 'The chat could not load. Check your connection, then tap "Open chat" to try again.';
    };
    document.body.appendChild(s1);
    // tawk.to sometimes fails to start a visitor session (seen as HTTP 500 from va.tawk.to), and onLoad never fires.
    setTimeout(function () {
      if (window.__pwt.loaded) return;
      liveMsg.textContent = 'The chat is taking longer than usual to open. Tap "Open chat" to reload and try again. You stay signed in.';
    }, LOAD_WATCHDOG_MS);
  }

  function closeTawk() {
    var api = window.Tawk_API;
    if (!api || !window.__pwt.loaded) return;
    try { if (typeof api.logout === 'function') api.logout(function () {}); } catch (e) {}
    try { api.hideWidget(); } catch (e) {}
    try { api.shutdown(); } catch (e) {}
  }

  reopen.addEventListener('click', function () {
    var api = window.Tawk_API;
    if (!tawkInjected || !window.__pwt.loaded || !api || typeof api.maximize !== 'function') { location.reload(); return; }
    try { api.showWidget(); } catch (e) {}
    api.maximize();
  });

  function start(cfg) {
    if (cfg.userId) ls(K_UID, cfg.userId);
    where.textContent = (cfg.name ? cfg.name + ', ' : '') + cfg.location + ' (ID ' + cfg.locationId + ')';
    show('live');
    startTawk(cfg);
  }

  // ---------- step 1: PIN ----------
  function serverError(j, el) {
    var e = j && j.error, t;
    if (e === 'invalid_pin') t = 'That PIN is not correct.';
    else if (e === 'outside_us') t = 'Sign-in is only available from the United States. If you use a VPN, turn it off and try again.';
    else if (e === 'invalid_phone') t = 'Enter a valid 10-digit US phone number.';
    else if (e === 'invalid_name') t = 'Enter your name (80 characters or fewer).';
    else if (e === 'invalid_location') t = 'Choose your polling place from the list.';
    else if (e === 'locked') t = 'Sign-in is paused after too many wrong attempts. Wait 10 minutes, then try again.';
    else t = 'Support chat is not available right now. Contact your election office.';
    el.textContent = t;
    return e;
  }
  pinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    pinMsg.textContent = '';
    if (!configured) { pinMsg.textContent = 'Support chat is not set up yet. Contact your election office.'; return; }
    var p = pinEl.value.trim();
    if (!p) { pinEl.setAttribute('aria-invalid', 'true'); pinMsg.textContent = 'Enter the PIN.'; pinEl.focus(); return; }
    pinEl.setAttribute('aria-invalid', 'false');
    pinGo.disabled = true;
    post({ action: 'checkPin', pin: p }).then(function (j) {
      if (j && j.ok) {
        pinValue = p; pinEl.value = '';
        show('details'); msg.textContent = '';
        (cleanName() ? (byId[loc.value] ? phoneEl : loc) : nameEl).focus();
      } else serverError(j, pinMsg);
    }).catch(function () { pinMsg.textContent = 'Could not reach the server. Check your connection and try again.'; })
      .then(function () { pinGo.disabled = false; });
  });
  $('back').addEventListener('click', function () { pinValue = ''; show('pin'); pinEl.focus(); });

  // ---------- step 2: details ----------
  detForm.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.textContent = '';
    var ok = [validName(), validLoc(), validPhone()];
    var bad = ok.indexOf(false);
    if (bad !== -1) { [nameEl, loc, phoneEl][bad].focus(); msg.textContent = 'Please fix the highlighted fields.'; return; }
    if (!pinValue) { show('pin'); return; }
    saveWorker();
    go.disabled = true; go.textContent = 'Starting chat...';
    post({ action: 'verify', pin: pinValue, userId: ls(K_UID), locationId: loc.value, name: cleanName(), phone: digitsOf(phoneEl.value) })
      .then(function (j) {
        if (j && j.provider === 'tawk') {
          pinValue = '';
          sid = (typeof j.sessionId === 'string') ? j.sessionId : '';
          ss(K_SID, sid);
          setDeadline(j);
          if (tawkUsedThisPage) { location.reload(); return; } // fresh widget for a new sign-in after logout
          start(j);
          watch();
        } else {
          var err = serverError(j, msg);
          if (err === 'invalid_pin' || err === 'locked') { pinValue = ''; show('pin'); serverError(j, pinMsg); }
        }
      })
      .catch(function () { msg.textContent = 'Could not reach the server. Check your connection and try again.'; })
      .then(function () { go.disabled = false; go.textContent = 'Start Chat'; });
  });

  // ---------- startup ----------
  loadLocations().then(function () {
    restoreWorker();
    // Reload with a session still open: ask the server and reopen the chat if it is.
    var d = Number(ss(K_DEADLINE)) || 0;
    sid = ss(K_SID);
    if (!configured) { pinMsg.textContent = 'Support chat is not set up yet. Contact your election office.'; return; }
    if (!d || Date.now() >= d) {
      if (d || sid) { ss(K_SID, ''); ss(K_DEADLINE, ''); sid = ''; if (d) pinMsg.textContent = ENDED_MSG; }
      return;
    }
    if (!sid) { ss(K_DEADLINE, ''); return; }
    deadline = d;
    show('live'); liveMsg.textContent = 'Reconnecting...';
    check(true).then(function (j) {
      if (j && j.provider === 'tawk' && sid) { start(j); watch(); }
      else if (sid) { show('pin'); } // could not confirm (network): sign in again
    });
  });
})();
