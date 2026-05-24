<?php
// ============================================================
// Platonian's School Assets — Health Check (v10)
// ============================================================
//
// Returns the running version + database connectivity. Use this
// to verify the server is up before triggering auto-backup cron,
// or to monitor uptime from an external service.
//
//   GET /api/health.php
//
// Response (200):
//   { "ok": true, "version": "10", "db": "ok", "ts": "2026-05-17T03:00:00+00:00" }
//
// Response (503) when DB is down:
//   { "ok": false, "version": "10", "db": "error", "error": "..." }
//
// No auth required — health endpoints have to be reachable
// before the user even signs in.
// ============================================================
require_once 'config.php';

const APP_VERSION = '10';

$dbStatus = 'unknown';
$dbError  = null;
$start    = microtime(true);

try {
    $db = getDB();
    // Cheapest possible roundtrip to confirm the connection is alive
    $db->query('SELECT 1');
    $dbStatus = 'ok';
} catch (Throwable $e) {
    $dbStatus = 'error';
    $dbError  = $e->getMessage();
}

$dbLatencyMs = (int)round((microtime(true) - $start) * 1000);

$payload = [
    'ok'        => $dbStatus === 'ok',
    'version'   => APP_VERSION,
    'env'       => APP_ENV,
    'db'        => $dbStatus,
    'dbLatency' => $dbLatencyMs,
    'phpVersion'=> PHP_VERSION,
    'ts'        => date('c'),
];
if ($dbError !== null) {
    // Don't leak raw DB error messages in production — they can expose
    // table names, credentials hints, or internal IPs to anonymous callers.
    $payload['error'] = (APP_ENV === 'production')
        ? 'Database unavailable.'
        : $dbError;
}

$status = $dbStatus === 'ok' ? 200 : 503;
sendJson($payload, $status);
