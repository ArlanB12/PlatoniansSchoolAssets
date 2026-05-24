<?php
// ============================================================
// Platonian's School Assets — Session, CSRF, Role Guards (v10)
// ============================================================
//
// Every endpoint file requires this AFTER config.php. It:
//   1. Starts a PHP session (cookie-based, HttpOnly, Lax).
//   2. Provides current_user() / require_auth($roles).
//   3. Provides csrf_token() / csrf_check() and enforces CSRF
//      automatically on any non-safe HTTP method.
//
// The login endpoint is the one place that does NOT require
// a session yet — it CREATES the session and the CSRF token.
// ============================================================

// Hardened cookie params BEFORE session_start
$_cookieParams = [
    'lifetime' => 0,                                  // session cookie (clears on browser close)
    'path'     => '/',
    'domain'   => '',
    'secure'   => !empty($_SERVER['HTTPS']),
    'httponly' => true,
    'samesite' => 'Lax',
];
session_set_cookie_params($_cookieParams);
session_name('PLATONIANS_SESS');

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

// Generate the CSRF token on first request of a session.
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

/**
 * Return the currently authenticated user array, or null.
 * Shape: ['email' => ..., 'role' => ..., 'name' => ...]
 */
function current_user() {
    return $_SESSION['user'] ?? null;
}

/**
 * Persist the authenticated user into the session.
 * Called by auth.php after a successful login.
 * Regenerates the session ID to prevent fixation.
 */
function login_user($user) {
    // Prevent session fixation: rotate ID on privilege change
    session_regenerate_id(true);
    $_SESSION['user'] = [
        'email'    => strtolower($user['email']),
        'username' => strtolower($user['username'] ?? explode('@', $user['email'])[0]),
        'role'     => strtolower($user['role']),
        'name'     => $user['name'],
    ];
    // CSRF token is rotated too so old tokens can't be reused
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

/**
 * Destroy the server-side session (logout).
 */
function logout_user() {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']);
    }
    session_destroy();
}

/**
 * Require an authenticated session. Optionally require one of
 * the given roles. Returns the user array on success or sends
 * a 401/403 JSON response and exits.
 *
 * Usage:
 *   require_auth();                          // any logged-in user
 *   require_auth(['admin']);                 // admins only
 *   require_auth(['admin', 'custodian']);    // staff only
 */
function require_auth($allowedRoles = null) {
    $user = current_user();
    if (!$user) {
        sendJson(['ok' => false, 'error' => 'Authentication required.', 'authRequired' => true], 401);
    }
    if ($allowedRoles !== null) {
        $allowed = is_array($allowedRoles) ? $allowedRoles : [$allowedRoles];
        if (!in_array($user['role'], $allowed, true)) {
            sendJson(['ok' => false, 'error' => 'You do not have permission to perform this action.'], 403);
        }
    }
    return $user;
}

/**
 * Return the current session's CSRF token.
 * The frontend reads this from /api/auth.php?action=me on page load
 * and includes it in every write request via the X-CSRF-Token header.
 */
function csrf_token() {
    return $_SESSION['csrf_token'] ?? '';
}

/**
 * Verify the incoming request's CSRF token matches the session's.
 * Called automatically by guard_request_csrf() below on every
 * non-safe HTTP method. Exits with 403 on mismatch.
 *
 * Token is accepted via either:
 *   - X-CSRF-Token header (preferred)
 *   - csrfToken field in the JSON body (fallback)
 */
function csrf_check() {
    $expected = $_SESSION['csrf_token'] ?? '';
    if (!$expected) {
        sendJson(['ok' => false, 'error' => 'Session expired. Please refresh and try again.'], 403);
    }
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!$provided) {
        // Fallback: read from JSON body. We re-read here to avoid
        // consuming the body from getBody() before the endpoint sees it.
        $raw = file_get_contents('php://input');
        if ($raw) {
            $body = json_decode($raw, true);
            if (is_array($body) && isset($body['csrfToken'])) {
                $provided = $body['csrfToken'];
            }
        }
    }
    if (!hash_equals($expected, (string)$provided)) {
        sendJson(['ok' => false, 'error' => 'Invalid or missing CSRF token.'], 403);
    }
}

/**
 * Enforce CSRF on any non-GET/HEAD/OPTIONS request.
 * Called at the top of every endpoint file (after require_once
 * config.php and _session.php).
 *
 * Two exceptions: action=login and action=forgot_verify/forgot_reset
 * — they can't have a session-bound token yet because the user
 * hasn't authenticated. They get IP-based rate limiting instead
 * (see _ratelimit.php).
 */
function guard_request_csrf() {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return; // safe methods don't need CSRF
    }
    $action = $_GET['action'] ?? '';
    // Pre-auth endpoints can't carry a session-bound CSRF token yet,
    // so they're protected by IP-based rate-limiting instead (see
    // _ratelimit.php). All authenticated endpoints DO require CSRF.
    //
    // - login           : creates the session + token
    // - forgot_request  : public ticket submission (v10.3)
    // - register        : self-registration for teachers/custodians
    // - check_lock      : read-only status probe used by login page
    $public = ['login', 'forgot_request', 'register', 'check_lock'];
    if (in_array($action, $public, true)) {
        return; // pre-auth endpoints are protected by rate limiting instead
    }
    csrf_check();
}
