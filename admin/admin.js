(function () {
  var $ = function (id) { return document.getElementById(id); };
  var login = $('login'), panel = $('panel');
  var API = window.RELAY_URL || window.API_URL || ''; // relay replaces API_URL when set
  var token = '';
  try { token = sessionStorage.getItem('pwt_admin') || ''; } catch (e) {}

  function call(action, extra) {
    var body = { action: action, token: token };
    for (var k in (extra || {})) body[k] = extra[k];
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function clearMsgs() { $('msg').textContent = ''; $('err').textContent = ''; $('genOut').hidden = true; }
  function setToken(t) { token = t || ''; try { if (t) sessionStorage.setItem('pwt_admin', t); else sessionStorage.removeItem('pwt_admin'); } catch (e) {} }

  function refresh() {
    if (!token) { login.hidden = false; panel.hidden = true; return; }
    call('status').then(function (j) {
      if (j.authenticated) {
        login.hidden = true; panel.hidden = false;
        $('state').textContent = j.pinSet
          ? 'A PIN is set. It was last changed ' + new Date(j.pinUpdated).toLocaleString() + '. For security the current PIN cannot be shown; set a new one if it is lost.'
          : 'No PIN is set yet, so poll workers cannot start a chat. Set one below.';
        $('secure').textContent = j.secureMode === true
          ? 'tawk.to Secure Mode hash: ON (TAWK_API_KEY is set). Secure Mode must also be enabled in tawk.to.'
          : (j.secureMode === false ? 'tawk.to Secure Mode hash: off (TAWK_API_KEY not set). Fine while Secure Mode is off in tawk.to.' : '');
        $('pause').textContent = j.pinPaused ? 'PIN sign-in is currently paused because of repeated wrong attempts. Clear the lockout to resume.' : '';
        loadSessions();
      } else { setToken(''); login.hidden = false; panel.hidden = true; }
    }).catch(function () { $('loginMsg').textContent = 'Could not reach the server.'; });
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginMsg').textContent = ''; $('loginBtn').disabled = true;
    token = '';
    call('login', { password: $('pw').value }).then(function (j) {
      $('pw').value = '';
      if (j.ok) { setToken(j.token); clearMsgs(); refresh(); }
      else if (j.error === 'invalid_password') $('loginMsg').textContent = 'That password is not correct.';
      else if (j.error === 'locked') $('loginMsg').textContent = 'Too many attempts. Wait 15 minutes, then try again.';
      else $('loginMsg').textContent = 'Admin sign-in is not available right now.';
    }).catch(function () { $('loginMsg').textContent = 'Could not reach the server.'; })
      .then(function () { $('loginBtn').disabled = false; });
  });

  $('setForm').addEventListener('submit', function (e) {
    e.preventDefault(); clearMsgs();
    call('setPin', { pin: $('pin').value }).then(function (j) {
      if (j.ok) { $('pin').value = ''; $('msg').textContent = 'PIN saved. It works immediately.'; refresh(); }
      else if (j.error === 'unauthorized') refresh();
      else $('err').textContent = j.message || 'Could not save the PIN.';
    });
  });

  $('gen').addEventListener('click', function () {
    clearMsgs();
    call('generatePin').then(function (j) {
      if (j.pin) { $('genPin').textContent = j.pin; $('genOut').hidden = false; refresh(); }
      else if (j.error === 'unauthorized') refresh();
      else $('err').textContent = 'Could not generate a PIN.';
    });
  });

  $('reset').addEventListener('click', function () {
    clearMsgs();
    call('resetLockout').then(function (j) {
      if (j.ok) { $('msg').textContent = 'Lockout cleared.'; refresh(); } else refresh();
    });
  });

  // ---------- signed-in poll workers ----------
  var OLD_BACKEND = 'Session controls need the updated back end. Paste the new Code.gs into Apps Script and deploy a new version.';
  function sessMsgs(ok, err) { $('sessMsg').textContent = ok || ''; $('sessErr').textContent = err || ''; }
  function when(ms) { return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function line(cls, text) { var p = document.createElement('p'); p.className = cls; p.textContent = text; return p; }

  function loadSessions() {
    var list = $('sessList');
    call('admin_sessions').then(function (j) {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (j.error === 'unauthorized') { refresh(); return; }
      if (j.error === 'not_found') { $('sessState').textContent = OLD_BACKEND; $('endAll').disabled = true; return; }
      if (!j.ok || !Array.isArray(j.sessions)) { $('sessState').textContent = 'Could not load the list.'; return; }
      $('endAll').disabled = j.sessions.length === 0;
      $('sessState').textContent = j.sessions.length === 0 ? 'Nobody is signed in.'
        : j.sessions.length + (j.sessions.length === 1 ? ' poll worker is' : ' poll workers are') + ' signed in.';
      j.sessions.forEach(function (s) {
        var li = document.createElement('li');
        li.appendChild(line('who', String(s.name || '') + (s.phoneLast4 ? ' (phone ending ' + String(s.phoneLast4) + ')' : '')));
        li.appendChild(line('meta', String(s.location || '') + (s.locationId ? ' (ID ' + String(s.locationId) + ')' : '')));
        li.appendChild(line('meta', 'Signed in ' + when(s.created) + ', ends ' + when(s.exp)));
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'secondary'; btn.textContent = 'Log out';
        btn.addEventListener('click', function () {
          sessMsgs(); btn.disabled = true;
          call('admin_end_session', { id: String(s.id) }).then(function (r) {
            if (r.ok) { sessMsgs('Logged out ' + String(s.name || 'that poll worker') + '.'); loadSessions(); }
            else if (r.error === 'unauthorized') refresh();
            else if (r.error === 'not_found') sessMsgs('', OLD_BACKEND);
            else { btn.disabled = false; sessMsgs('', 'Could not log out that session.'); }
          }).catch(function () { btn.disabled = false; sessMsgs('', 'Could not reach the server.'); });
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
    }).catch(function () { $('sessState').textContent = 'Could not reach the server.'; });
  }

  $('sessRefresh').addEventListener('click', function () { sessMsgs(); loadSessions(); });

  $('endAll').addEventListener('click', function () {
    sessMsgs();
    if (!confirm('Log out every signed-in poll worker? Their chats will close and they must sign in again.')) return;
    $('endAll').disabled = true;
    call('admin_end_all').then(function (j) {
      if (j.ok) { sessMsgs('Logged out ' + Number(j.ended || 0) + ' session(s).'); loadSessions(); }
      else if (j.error === 'unauthorized') refresh();
      else if (j.error === 'not_found') sessMsgs('', OLD_BACKEND);
      else { $('endAll').disabled = false; sessMsgs('', 'Could not log everyone out.'); }
    }).catch(function () { $('endAll').disabled = false; sessMsgs('', 'Could not reach the server.'); });
  });

  $('out').addEventListener('click', function () {
    call('logout').then(function () { setToken(''); clearMsgs(); refresh(); });
  });

  refresh();
})();
