export const landingPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blink — Secure Messaging</title>
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
    .card {
      width: 100%; max-width: 380px;
      background: #111; border-radius: 16px; padding: 32px;
    }
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
    button.submit {
      width: 100%; padding: 14px; margin-top: 4px;
      background: #4f6ef7; border: none; border-radius: 10px;
      color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s
    }
    button.submit:hover { opacity: 0.85 }
    button.submit:disabled { opacity: 0.5; cursor: not-allowed }
    .msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 0.9rem; display: none }
    .msg.error { background: #2a1111; color: #f88; display: block }
    .msg.success { background: #112a11; color: #8f8; display: block }
  </style>
</head>
<body>
  <h1>Blink</h1>
  <p class="sub">End-to-end encrypted messaging</p>
  <div class="card">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('register')">Sign Up</button>
      <button class="tab" onclick="switchTab('login')">Log In</button>
    </div>
    <div id="register-form">
      <input id="reg-username" placeholder="Username" autocomplete="off" autocapitalize="none" />
      <input id="reg-password" type="password" placeholder="Password (min 8 chars)" />
      <input id="reg-password2" type="password" placeholder="Confirm password" />
      <button class="submit" onclick="register()">Create Account</button>
    </div>
    <div id="login-form" style="display:none">
      <input id="login-username" placeholder="Username" autocomplete="off" autocapitalize="none" />
      <input id="login-password" type="password" placeholder="Password" />
      <button class="submit" onclick="login()">Log In</button>
    </div>
    <div id="msg" class="msg"></div>
  </div>

  <script>
    function switchTab(tab) {
      document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none'
      document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none'
      document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', (tab === 'register') === (i === 0)))
      showMsg('', '')
    }

    function showMsg(text, type) {
      const el = document.getElementById('msg')
      el.textContent = text
      el.className = 'msg' + (type ? ' ' + type : '')
    }

    async function register() {
      const username = document.getElementById('reg-username').value.trim()
      const password = document.getElementById('reg-password').value
      const password2 = document.getElementById('reg-password2').value
      if (!username || !password) return showMsg('Fill in all fields', 'error')
      if (password !== password2) return showMsg('Passwords do not match', 'error')
      if (password.length < 8) return showMsg('Password must be at least 8 characters', 'error')
      try {
        const res = await fetch('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        const data = await res.json()
        if (!res.ok) return showMsg(data.error || 'Registration failed', 'error')
        showMsg('Account created! Download the Blink app and log in with your username: ' + username, 'success')
      } catch (e) {
        showMsg('Network error — try again', 'error')
      }
    }

    async function login() {
      const username = document.getElementById('login-username').value.trim()
      const password = document.getElementById('login-password').value
      if (!username || !password) return showMsg('Fill in all fields', 'error')
      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        const data = await res.json()
        if (!res.ok) return showMsg(data.error || 'Login failed', 'error')
        showMsg('Logged in as ' + data.username + '. Open the Blink app on your device to start messaging.', 'success')
      } catch (e) {
        showMsg('Network error — try again', 'error')
      }
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const isRegister = document.getElementById('register-form').style.display !== 'none'
        isRegister ? register() : login()
      }
    })
  </script>
</body>
</html>`
