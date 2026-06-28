export const landingPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blink</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #0a0a0a; color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 24px;
    }
    h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 6px; letter-spacing: -1px }
    .sub { color: #666; margin-bottom: 40px; font-size: 0.95rem }
    .card { width: 100%; max-width: 380px; background: #111; border-radius: 16px; padding: 32px }
    .tabs { display: flex; gap: 0; margin-bottom: 28px; background: #1a1a1a; border-radius: 10px; padding: 4px }
    .tab {
      flex: 1; padding: 10px; border: none; background: none; color: #666;
      cursor: pointer; border-radius: 8px; font-size: 0.9rem; font-weight: 600; transition: all 0.15s
    }
    .tab.active { background: #4f6ef7; color: #fff }
    input {
      width: 100%; padding: 14px; margin-bottom: 12px;
      background: #1a1a1a; border: 1px solid #222; border-radius: 10px;
      color: #fff; font-size: 0.95rem; outline: none;
    }
    input:focus { border-color: #4f6ef7 }
    input::placeholder { color: #444 }
    .submit {
      width: 100%; padding: 14px; margin-top: 4px;
      background: #4f6ef7; border: none; border-radius: 10px;
      color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer;
    }
    .submit:disabled { opacity: 0.5; cursor: not-allowed }
    .msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 0.9rem }
    .error { background: #2a1111; color: #f88 }
    .success { background: #112a11; color: #8f8 }
  </style>
</head>
<body>
  <h1>Blink</h1>
  <p class="sub">End-to-end encrypted messaging</p>
  <div class="card">
    <div class="tabs">
      <button type="button" class="tab active" id="tab-reg" onclick="switchTab('register')">Sign Up</button>
      <button type="button" class="tab" id="tab-login" onclick="switchTab('login')">Log In</button>
    </div>

    <div id="register-form">
      <input id="reg-username" placeholder="Username" autocomplete="off" autocapitalize="none" spellcheck="false" />
      <input id="reg-password" type="password" placeholder="Password (min 8 chars)" />
      <input id="reg-password2" type="password" placeholder="Confirm password" />
      <button type="button" class="submit" id="reg-btn" onclick="register()">Create Account</button>
    </div>

    <div id="login-form" style="display:none">
      <input id="login-username" placeholder="Username" autocomplete="off" autocapitalize="none" spellcheck="false" />
      <input id="login-password" type="password" placeholder="Password" />
      <button type="button" class="submit" id="login-btn" onclick="login()">Log In</button>
    </div>

    <div id="msg" style="display:none"></div>
  </div>

  <script>
    function switchTab(tab) {
      var isReg = tab === 'register';
      document.getElementById('register-form').style.display = isReg ? '' : 'none';
      document.getElementById('login-form').style.display = isReg ? 'none' : '';
      document.getElementById('tab-reg').className = 'tab' + (isReg ? ' active' : '');
      document.getElementById('tab-login').className = 'tab' + (!isReg ? ' active' : '');
      hideMsg();
    }

    function showMsg(text, type) {
      var el = document.getElementById('msg');
      el.textContent = text;
      el.className = 'msg ' + type;
      el.style.display = 'block';
    }

    function hideMsg() {
      document.getElementById('msg').style.display = 'none';
    }

    function setLoading(btnId, loading) {
      var btn = document.getElementById(btnId);
      btn.disabled = loading;
      btn.textContent = loading ? 'Please wait...' : (btnId === 'reg-btn' ? 'Create Account' : 'Log In');
    }

    function register() {
      var username = document.getElementById('reg-username').value.trim();
      var password = document.getElementById('reg-password').value;
      var password2 = document.getElementById('reg-password2').value;
      if (!username) return showMsg('Enter a username', 'error');
      if (password.length < 8) return showMsg('Password must be at least 8 characters', 'error');
      if (password !== password2) return showMsg('Passwords do not match', 'error');
      setLoading('reg-btn', true);
      fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
      .then(function(r) {
        setLoading('reg-btn', false);
        if (!r.ok) return showMsg(r.data.error || 'Registration failed', 'error');
        showMsg('Account created! Log in with username: ' + username + '. Now open the Blink app on your device.', 'success');
      })
      .catch(function(e) {
        setLoading('reg-btn', false);
        showMsg('Network error: ' + e.message, 'error');
      });
    }

    function login() {
      var username = document.getElementById('login-username').value.trim();
      var password = document.getElementById('login-password').value;
      if (!username || !password) return showMsg('Fill in all fields', 'error');
      setLoading('login-btn', true);
      fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
      .then(function(r) {
        setLoading('login-btn', false);
        if (!r.ok) return showMsg(r.data.error || 'Login failed', 'error');
        showMsg('Logged in as ' + r.data.username + '. Open the Blink app on your device to start messaging.', 'success');
      })
      .catch(function(e) {
        setLoading('login-btn', false);
        showMsg('Network error: ' + e.message, 'error');
      });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      var isReg = document.getElementById('register-form').style.display !== 'none';
      if (isReg) register(); else login();
    });
  </script>
</body>
</html>`
