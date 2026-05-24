/**
 * Platonian's IS — Single Entry Point (v10)
 *
 * Loaded by every HTML page after api.js + app.js + the page's
 * module script. Responsible for:
 *
 *   1. Calling window.API.bootstrap() to hydrate the session
 *      and CSRF token from the server-side PHP session.
 *   2. Dispatching the right page initializer based on the
 *      body's data-page attribute.
 *
 * Each module script's own DOMContentLoaded handlers still run
 * for wiring forms etc. (they were not migrated to avoid
 * touching ~2,400 lines of working code unnecessarily). They
 * call window.API.bootstrap() inline at the top, which is
 * idempotent — repeated calls return the same in-flight promise.
 *
 * Pages opt out of the auth bootstrap by setting
 * data-public="true" on the body (currently only index.html).
 */
(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", async () => {
    const page    = document.body.dataset.page    || "";
    const isPublic= document.body.dataset.public  === "true";

    // Public pages (login, register, forgot) don't need a server
    // session yet. They'll create one via /auth.php?action=login.
    if (!isPublic) {
      try {
        if (window.API && window.API.bootstrap) {
          await window.API.bootstrap();
        }
      } catch (e) {
        console.warn("[entry] bootstrap failed:", e);
      }
    }

    // Dispatch table — only pages with an init function listed here
    // get one auto-fired. Pages whose modules wire themselves in
    // their own DOMContentLoaded handlers don't need an entry here.
    const initByPage = {
      dashboard: () => window.IMS && window.IMS.initDashboardPage && window.IMS.initDashboardPage(),
    };

    const init = initByPage[page];
    if (typeof init === "function") {
      try { init(); }
      catch (e) { console.error(`[entry] init failed for page "${page}":`, e); }
    }
  });
})();
