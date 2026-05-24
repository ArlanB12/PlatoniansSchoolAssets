// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Helper: attach console + network listeners to a fresh page and
 * return an object collectors can be inspected after navigation.
 */
function attachErrorCollectors(page) {
  /** @type {string[]} */ const consoleErrors = [];
  /** @type {string[]} */ const pageErrors    = [];
  /** @type {string[]} */ const failedApiReqs = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/') && res.status() >= 500) {
      failedApiReqs.push(`${res.status()} ${url}`);
    }
  });

  return { consoleErrors, pageErrors, failedApiReqs };
}

/**
 * Sign in via the UI. We do this for every test rather than reuse
 * storage state because the CSRF token is bound to the session
 * lifecycle and reusing state across tests would skip that path.
 */
async function loginAs(page, email = 'admin@test.com', pw = '123', role = 'admin') {
  await page.goto('/index.html');
  await page.selectOption('#login-role', role);
  await page.fill('#login-email', email);
  await page.fill('#login-password', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard.html', { timeout: 10_000 });
}

/* ───────────────────── tests ───────────────────── */

test('login page renders without errors', async ({ page }) => {
  const c = attachErrorCollectors(page);
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/Platonian|Sign In|Login/);
  expect(c.consoleErrors, c.consoleErrors.join('\n')).toEqual([]);
  expect(c.pageErrors,    c.pageErrors.join('\n')).toEqual([]);
});

test('health endpoint responds 200 with db=ok', async ({ request }) => {
  const res = await request.get('/api/health.php');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.db).toBe('ok');
});

test('CSRF: write without token is rejected', async ({ request }) => {
  // No session cookie → no CSRF token → server should reject.
  const res = await request.post('/api/users.php?action=delete', {
    data: { email: 'fake@test.com' },
  });
  // Could be 401 (no auth) or 403 (csrf) depending on session state.
  // Either way, the request MUST fail.
  expect(res.status()).toBeGreaterThanOrEqual(401);
  expect(res.status()).toBeLessThanOrEqual(403);
});

const PAGES = [
  { path: '/dashboard.html',    name: 'dashboard'    },
  { path: '/inventory.html',    name: 'inventory'    },
  { path: '/transactions.html', name: 'transactions' },
  { path: '/users.html',        name: 'users'        },
  { path: '/reports.html',      name: 'reports'      },
  { path: '/policy.html',       name: 'policy'       },
];

for (const { path, name } of PAGES) {
  test(`${name} page renders without errors (as admin)`, async ({ page }) => {
    const c = attachErrorCollectors(page);
    await loginAs(page);
    await page.goto(path);

    // Give async page init (bootstrap, sync, render) time to finish.
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    // Give dashboard sync indicator a moment to clear.
    await page.waitForTimeout(500);

    expect(c.pageErrors,    `pageerror on ${name}:\n${c.pageErrors.join('\n')}`).toEqual([]);
    expect(c.failedApiReqs, `5xx on ${name}:\n${c.failedApiReqs.join('\n')}`).toEqual([]);

    // We allow console warnings but assert no console.error.
    // Filter out Chart.js's harmless "registerables" deprecation
    // and the v10 expected fallback warning when sync is bypassed.
    const realErrors = c.consoleErrors.filter(e =>
      !/registerables|sync from server failed/i.test(e)
    );
    expect(realErrors, `console.error on ${name}:\n${realErrors.join('\n')}`).toEqual([]);
  });
}

test('logout destroys session and redirects', async ({ page }) => {
  await loginAs(page);
  await page.click('#logout-btn');
  await page.waitForURL('**/index.html');
  // After logout, /api/auth.php?action=me should return 401.
  const res = await page.request.get('/api/auth.php?action=me');
  expect(res.status()).toBe(401);
});
