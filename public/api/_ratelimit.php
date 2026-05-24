<?php
// ============================================================
// Platonian's School Assets — IP Rate Limiter (v10)
// ============================================================
//
// Tracks per-IP request counts in the `rate_limit` table.
// Used by auth.php to throttle login and forgot-password
// endpoints (the only PUBLIC write paths). 5 attempts per
// 60 seconds per IP by default.
//
// The table is created lazily by config.php migrations:
//   rate_limit (ip, bucket, count, window_start)
// ============================================================

/**
 * Return the client's IP. Trusts X-Forwarded-For only when
 * we're behind a known reverse proxy — out of scope here, so
 * we use REMOTE_ADDR directly.
 */
function client_ip() {
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

/**
 * Atomically increment the IP's counter in `bucket` and return
 * the new count along with the remaining quota.
 *
 * @param string $bucket  short label, e.g. "login" or "forgot"
 * @param int    $limit   max requests per window
 * @param int    $windowSec  window length in seconds
 * @return array {count, limit, remaining, retryAfter}
 */
function rate_limit_check($bucket, $limit = 5, $windowSec = 60) {
    $db    = getDB();
    $ip    = client_ip();
    $now   = time();
    $start = $now - $windowSec;

    // Get the existing row (if any). The row stores the START
    // of the current window — if that's older than $windowSec
    // ago, we reset to a fresh window.
    $stmt = $db->prepare("SELECT count, window_start FROM rate_limit WHERE ip = ? AND bucket = ?");
    $stmt->execute([$ip, $bucket]);
    $row = $stmt->fetch();

    if (!$row) {
        // First hit from this IP/bucket
        $db->prepare("INSERT INTO rate_limit (ip, bucket, count, window_start) VALUES (?, ?, 1, ?)")
           ->execute([$ip, $bucket, $now]);
        return ['count' => 1, 'limit' => $limit, 'remaining' => $limit - 1, 'retryAfter' => 0];
    }

    $windowStart = (int)$row['window_start'];
    $count       = (int)$row['count'];

    if ($windowStart < $start) {
        // Window has expired — reset
        $db->prepare("UPDATE rate_limit SET count = 1, window_start = ? WHERE ip = ? AND bucket = ?")
           ->execute([$now, $ip, $bucket]);
        return ['count' => 1, 'limit' => $limit, 'remaining' => $limit - 1, 'retryAfter' => 0];
    }

    // Window still active — increment
    $newCount = $count + 1;
    $db->prepare("UPDATE rate_limit SET count = ? WHERE ip = ? AND bucket = ?")
       ->execute([$newCount, $ip, $bucket]);

    $retryAfter = $newCount > $limit ? ($windowStart + $windowSec - $now) : 0;
    return [
        'count'      => $newCount,
        'limit'      => $limit,
        'remaining'  => max(0, $limit - $newCount),
        'retryAfter' => max(0, $retryAfter),
    ];
}

/**
 * Enforce a rate limit and short-circuit with 429 if exceeded.
 * Use this at the top of any public endpoint.
 *
 * Usage:
 *   rate_limit_enforce('login', 5, 60); // 5 / min
 */
function rate_limit_enforce($bucket, $limit = 5, $windowSec = 60) {
    $result = rate_limit_check($bucket, $limit, $windowSec);
    if ($result['count'] > $limit) {
        header('Retry-After: ' . $result['retryAfter']);
        sendJson([
            'ok'         => false,
            'error'      => 'Too many attempts from your network. Please wait '
                            . $result['retryAfter'] . ' seconds and try again.',
            'retryAfter' => $result['retryAfter'],
            'rateLimited'=> true,
        ], 429);
    }
}

/**
 * Reset an IP's count for a bucket (called after a successful
 * login so a user who entered the right password isn't punished
 * for their earlier typos).
 */
function rate_limit_reset($bucket) {
    $db = getDB();
    $ip = client_ip();
    $db->prepare("DELETE FROM rate_limit WHERE ip = ? AND bucket = ?")->execute([$ip, $bucket]);
}
