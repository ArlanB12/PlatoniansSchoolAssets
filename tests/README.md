# Tests

End-to-end smoke tests for Platonian's IS using Playwright. Each test loads a page, signs in if needed, and asserts no console errors occurred. This catches the vast majority of regressions you'd hit after a refactor.

## Setup

```bash
# From the repo root
cd tests
npm install
npx playwright install chromium
```

## Configuration

Tests assume the app is running at `http://localhost:8080` by default. Override with:

```bash
BASE_URL=http://platonians.local npx playwright test
```

Make sure the server is up before running tests (`php -S 0.0.0.0:8080 -t public/` for a quick standalone, or use your XAMPP install).

## Running

```bash
# Run all tests, headless
npx playwright test

# Watch mode (browser visible)
npx playwright test --headed

# Single test file
npx playwright test smoke.spec.js

# Generate HTML report
npx playwright test --reporter=html
npx playwright show-report
```

## What's covered

`smoke.spec.js` walks every page logged in as the seeded `admin@test.com / 123` account and asserts:

- No uncaught JS errors
- No `console.error` calls
- No failed network requests to `/api/*`
- The page rendered the expected H1/title element

This is intentionally shallow — it would catch a missing variable, a broken API endpoint, or a busted import path on day one. Deeper logical tests (CSV exports correct, accountability tier blocks correct user, etc.) are out of scope for v10.

## CI

The provided `package.json` declares a `test` script. To wire into GitHub Actions, see `tests/.github-workflow-example.yml`.
