// ---------- Config ----------
const NAV = [
  { key: 'overview', label: 'Overview', path: null },
  { key: 'users', label: 'Users', path: '/api/users' },
  { key: 'products', label: 'Products', path: '/api/products' },
  { key: 'orders', label: 'Orders', path: '/api/orders' },
  { key: 'payments', label: 'Payments', path: '/api/payments' },
  { key: 'notifications', label: 'Notifications', path: '/api/notifications' },
  { key: 'analytics', label: 'Analytics (Serverless)', path: null, serverless: true },
];

const DEMO_USER = 'admin';
const DEMO_PASS = 'demo123';

const app = document.getElementById('app');

// ---------- Storage helpers ----------
function getAuthUser() { return localStorage.getItem('cm_user'); }
function setAuthUser(u) { localStorage.setItem('cm_user', u); }
function clearAuthUser() { localStorage.removeItem('cm_user'); }
function getApiBase() { return localStorage.getItem('cm_api_base') || ''; }
function setApiBase(url) { localStorage.setItem('cm_api_base', url.trim().replace(/\/$/, '')); }
function getGatewayBase() { return localStorage.getItem('cm_gateway_base') || ''; }
function setGatewayBase(url) { localStorage.setItem('cm_gateway_base', url.trim().replace(/\/$/, '')); }

// ---------- Router ----------
function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash || 'overview';
}

window.addEventListener('hashchange', render);
window.addEventListener('load', render);

function render() {
  if (!getAuthUser()) {
    renderLogin();
  } else {
    renderShell();
  }
}

// ---------- Login screen ----------
function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand">
          <div class="logo">CM</div>
          <span>CloudMart</span>
        </div>
        <h1>Sign in</h1>
        <p class="sub">EKS microservices demo &mdash; internal admin console</p>
        <div class="login-error" id="loginError">Invalid username or password.</div>
        <form id="loginForm">
          <div class="field">
            <label>Username</label>
            <input type="text" id="username" autocomplete="username" placeholder="admin" />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" id="password" autocomplete="current-password" placeholder="••••••••" />
          </div>
          <button type="submit" class="btn-primary">Sign in</button>
        </form>
        <div class="login-hint">
          Demo credentials &mdash; username: <strong>${DEMO_USER}</strong>, password: <strong>${DEMO_PASS}</strong><br/>
          (Client-side demo login only. A production build would call a real auth service.)
        </div>
      </div>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    if (u === DEMO_USER && p === DEMO_PASS) {
      setAuthUser(u);
      location.hash = '#/overview';
      render();
    } else {
      document.getElementById('loginError').classList.add('show');
    }
  });
}

// ---------- App shell ----------
function renderShell() {
  const route = currentRoute();
  const user = getAuthUser();
  const navItem = NAV.find((n) => n.key === route) || NAV[0];

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="logo">CM</div>
          <span>CloudMart</span>
        </div>
        <nav>
          ${NAV.map((n) => `
            <a class="nav-item ${n.key === route ? 'active' : ''}" href="#/${n.key}">
              <span class="dot"></span>${n.label}
            </a>
          `).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="user-row">
            <div class="avatar">${user[0].toUpperCase()}</div>
            <span>${user}</span>
          </div>
          <button class="btn-logout" id="logoutBtn">Log out</button>
        </div>
      </aside>

      <div class="main">
        <div class="topbar">
          <h1>${navItem.label}</h1>
          <div class="api-config">
            ${navItem.serverless ? `
              <input id="gatewayBaseInput" type="text" placeholder="https://xxxx.execute-api.us-east-1.amazonaws.com" value="${getGatewayBase()}" />
              <button id="saveGatewayBase">Save</button>
            ` : `
              <input id="apiBaseInput" type="text" placeholder="http://your-alb-dns-name.elb.amazonaws.com" value="${getApiBase()}" />
              <button id="saveApiBase">Save</button>
            `}
          </div>
        </div>
        <div class="content" id="content">
          <div class="empty-state"><span class="loading-dot"></span>Loading...</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearAuthUser();
    location.hash = '#/overview';
    render();
  });

  if (navItem.serverless) {
    document.getElementById('saveGatewayBase').addEventListener('click', () => {
      setGatewayBase(document.getElementById('gatewayBaseInput').value);
      renderContent(route);
    });
  } else {
    document.getElementById('saveApiBase').addEventListener('click', () => {
      setApiBase(document.getElementById('apiBaseInput').value);
      renderContent(route);
    });
  }

  renderContent(route);
}

// ---------- Content per route ----------
function renderContent(route) {
  if (route === 'overview') {
    renderOverview();
  } else if (route === 'analytics') {
    renderAnalytics();
  } else {
    const navItem = NAV.find((n) => n.key === route);
    renderServiceTable(navItem);
  }
}

async function renderAnalytics() {
  const content = document.getElementById('content');
  const base = getGatewayBase();

  content.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Analytics &mdash; API Gateway + Lambda</h2>
        <span class="pill pending" id="analyticsStatus">checking</span>
      </div>
      <div id="analyticsWrap" style="padding: 18px;">
        <div class="empty-state"><span class="loading-dot"></span>Loading...</div>
      </div>
    </div>
  `;

  if (!base) {
    document.getElementById('analyticsWrap').innerHTML = `
      <div class="empty-state">Set the API Gateway invoke URL above (from the eks-demo-api-gateway stack output) and click Save.</div>
    `;
    document.getElementById('analyticsStatus').textContent = 'not configured';
    return;
  }

  try {
    const res = await fetch(`${base}/summary`);
    const json = await res.json();
    document.getElementById('analyticsStatus').textContent = 'up';
    document.getElementById('analyticsStatus').className = 'pill up';
    document.getElementById('analyticsWrap').innerHTML = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="label">Products in catalog</div>
          <div class="value">${json.productCount ?? '—'}</div>
        </div>
        <div class="summary-card">
          <div class="label">Order events processed</div>
          <div class="value">${json.orderEventCount ?? '—'}</div>
        </div>
        <div class="summary-card">
          <div class="label">Generated at</div>
          <div class="value" style="font-size:14px;">${json.generatedAt ? new Date(json.generatedAt).toLocaleTimeString() : '—'}</div>
        </div>
      </div>
      <h2 style="font-size:14px; margin: 6px 0 10px; color:#94a3b8;">Recent order events (from the ProcessOrder Lambda)</h2>
      <pre style="background:#0f172a; padding:14px; border-radius:8px; font-size:12px; overflow-x:auto;">${JSON.stringify(json.recentOrderEvents || [], null, 2)}</pre>
    `;
  } catch (err) {
    document.getElementById('analyticsStatus').textContent = 'down';
    document.getElementById('analyticsStatus').className = 'pill down';
    document.getElementById('analyticsWrap').innerHTML = `
      <div class="empty-state">Could not reach ${base}/summary.<br/>${err}</div>
    `;
  }
}

async function renderOverview() {
  const content = document.getElementById('content');
  const base = getApiBase();

  content.innerHTML = `<div class="summary-grid" id="summaryGrid"></div>`;
  const grid = document.getElementById('summaryGrid');

  const services = NAV.filter((n) => n.path);
  grid.innerHTML = services.map((s) => `
    <div class="summary-card">
      <div class="label">${s.label}</div>
      <div class="value" id="count-${s.key}">&mdash;</div>
      <span class="pill pending" id="pill-${s.key}">checking</span>
    </div>
  `).join('');

  if (!base) {
    services.forEach((s) => {
      document.getElementById(`pill-${s.key}`).textContent = 'not configured';
    });
    return;
  }

  services.forEach(async (s) => {
    try {
      const res = await fetch(`${base}${s.path}`);
      const json = await res.json();
      const pill = document.getElementById(`pill-${s.key}`);
      if (!res.ok) {
        document.getElementById(`count-${s.key}`).textContent = '\u2014';
        pill.textContent = `error ${res.status}`;
        pill.className = 'pill down';
        return;
      }
      document.getElementById(`count-${s.key}`).textContent = json.count ?? (json.data || []).length;
      pill.textContent = 'up';
      pill.className = 'pill up';
    } catch (err) {
      const pill = document.getElementById(`pill-${s.key}`);
      pill.textContent = 'down';
      pill.className = 'pill down';
    }
  });
}

async function renderServiceTable(navItem) {
  const content = document.getElementById('content');
  const base = getApiBase();

  content.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>${navItem.label}</h2>
        <span class="pill pending" id="tableStatus">checking</span>
      </div>
      <div id="tableWrap"><div class="empty-state"><span class="loading-dot"></span>Loading...</div></div>
    </div>
  `;

  if (!base) {
    document.getElementById('tableWrap').innerHTML = `
      <div class="empty-state">Set the API base URL above (your ALB DNS name) and click Save.</div>
    `;
    document.getElementById('tableStatus').textContent = 'not configured';
    return;
  }

  try {
    const res = await fetch(`${base}${navItem.path}`);
    const json = await res.json();

    if (!res.ok) {
      document.getElementById('tableStatus').textContent = `error ${res.status}`;
      document.getElementById('tableStatus').className = 'pill down';
      document.getElementById('tableWrap').innerHTML = `
        <div class="empty-state">
          ${navItem.label} returned HTTP ${res.status}.<br/>
          ${json.error || 'Unknown error'}${json.details ? `<br/><span style="font-size:11px; color:#64748b;">${json.details}</span>` : ''}
        </div>
      `;
      return;
    }

    const rows = json.data || [];
    document.getElementById('tableStatus').textContent = 'up';
    document.getElementById('tableStatus').className = 'pill up';

    if (rows.length === 0) {
      document.getElementById('tableWrap').innerHTML = `<div class="empty-state">No records returned.</div>`;
      return;
    }

    const columns = Object.keys(rows[0]);
    document.getElementById('tableWrap').innerHTML = `
      <table>
        <thead><tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>${columns.map((c) => `<td>${formatCell(c, row[c])}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('tableStatus').textContent = 'down';
    document.getElementById('tableStatus').className = 'pill down';
    document.getElementById('tableWrap').innerHTML = `
      <div class="empty-state">Could not reach ${navItem.label} at ${base}${navItem.path}.<br/>${err}</div>
    `;
  }
}

function formatCell(col, value) {
  if (col === 'status') {
    const cls = String(value).toLowerCase();
    return `<span class="pill ${cls}">${value}</span>`;
  }
  if (col === 'price' || col === 'amount') {
    return `$${Number(value).toFixed(2)}`;
  }
  return value;
}
