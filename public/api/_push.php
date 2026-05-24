<?php
// ============================================================
// Platonian's School Assets — Web Push + Activity Log (v10.16)
// ============================================================
//
// Self-contained Web Push (VAPID) sender. NO Composer, NO external
// libraries — uses only PHP's built-in OpenSSL + cURL, which ship
// with XAMPP by default. This delivers REAL OS-level push
// notifications to the device (phone notification tray / desktop
// notification center), not just the in-app bell.
//
// Loaded by config.php after the DB helpers, so every endpoint can
// call notifyUser() / logActivity() without re-declaring helpers.
//
// VAPID keys are auto-generated once and cached in
//   api/.vapid_keys.json   (gitignored)
// so the same keypair is reused across requests. The PUBLIC key is
// handed to the browser by push.php?action=public_key; the PRIVATE
// key never leaves the server.
// ============================================================

if (!function_exists('vapid_keys')) {

    // ── base64url helpers (RFC 7515, no padding) ──────────────
    function b64u_encode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
    function b64u_decode($data) {
        $pad = strlen($data) % 4;
        if ($pad) $data .= str_repeat('=', 4 - $pad);
        return base64_decode(strtr($data, '-_', '+/'));
    }

    /**
     * Return the server VAPID keypair, generating + caching it on
     * first use. Shape:
     *   ['public' => <b64url uncompressed P-256 point, 65 bytes>,
     *    'private' => <b64url 32-byte scalar>,
     *    'pem' => <private key PEM for signing>]
     */
    function vapid_keys() {
        static $cached = null;
        if ($cached !== null) return $cached;

        $file = __DIR__ . '/.vapid_keys.json';
        if (is_file($file)) {
            $j = json_decode(@file_get_contents($file), true);
            if (is_array($j) && !empty($j['public']) && !empty($j['pem'])) {
                $cached = $j;
                return $cached;
            }
        }

        // Generate a fresh P-256 (prime256v1) keypair.
        $res = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name'       => 'prime256v1',
        ]);
        if ($res === false) return null; // OpenSSL EC unavailable

        openssl_pkey_export($res, $pem);
        $details = openssl_pkey_get_details($res);

        // Uncompressed public point: 0x04 || X(32) || Y(32)
        $x = str_pad($details['ec']['x'], 32, "\0", STR_PAD_LEFT);
        $y = str_pad($details['ec']['y'], 32, "\0", STR_PAD_LEFT);
        $publicPoint = "\x04" . $x . $y;
        $d = str_pad($details['ec']['d'], 32, "\0", STR_PAD_LEFT);

        $cached = [
            'public'  => b64u_encode($publicPoint),
            'private' => b64u_encode($d),
            'pem'     => $pem,
        ];
        @file_put_contents($file, json_encode($cached));
        @chmod($file, 0600);
        return $cached;
    }

    // ── ASN.1 DER -> raw 64-byte (r||s) ECDSA signature ───────
    function der_to_raw_sig($der) {
        // SEQUENCE { INTEGER r, INTEGER s }
        $off = 0;
        if (ord($der[$off++]) !== 0x30) return null;
        $seqLen = ord($der[$off++]);
        if ($seqLen & 0x80) { $n = $seqLen & 0x7f; $off += $n; }

        $readInt = function() use ($der, &$off) {
            if (ord($der[$off++]) !== 0x02) return null;
            $len = ord($der[$off++]);
            $val = substr($der, $off, $len);
            $off += $len;
            // Strip leading zero padding, then left-pad to 32 bytes.
            $val = ltrim($val, "\0");
            return str_pad($val, 32, "\0", STR_PAD_LEFT);
        };
        $r = $readInt();
        $s = $readInt();
        if ($r === null || $s === null) return null;
        return $r . $s;
    }

    /**
     * Build a signed VAPID Authorization header for a given push
     * service origin (e.g. https://fcm.googleapis.com).
     */
    function vapid_auth_header($audience, $subject = 'mailto:ict@dspmnhs.edu.ph') {
        $keys = vapid_keys();
        if (!$keys) return null;

        $header  = b64u_encode(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
        $payload = b64u_encode(json_encode([
            'aud' => $audience,
            'exp' => time() + 12 * 3600,
            'sub' => $subject,
        ]));
        $signingInput = $header . '.' . $payload;

        $pkey = openssl_pkey_get_private($keys['pem']);
        $der  = '';
        if (!openssl_sign($signingInput, $der, $pkey, OPENSSL_ALGO_SHA256)) return null;
        $raw  = der_to_raw_sig($der);
        if ($raw === null) return null;

        $jwt = $signingInput . '.' . b64u_encode($raw);
        return [
            'Authorization: vapid t=' . $jwt . ', k=' . $keys['public'],
        ];
    }

    /**
     * Encrypt a payload for a subscription using RFC 8291 aes128gcm.
     * Returns the ciphertext body, or null on failure.
     */
    function encrypt_push_payload($payload, $p256dh_b64, $auth_b64) {
        $userPublic = b64u_decode($p256dh_b64);     // 65 bytes
        $authSecret = b64u_decode($auth_b64);        // 16 bytes
        if (strlen($userPublic) !== 65) return null;

        // Ephemeral server keypair on the same curve.
        $res = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name'       => 'prime256v1',
        ]);
        if ($res === false) return null;
        $details   = openssl_pkey_get_details($res);
        $serverX   = str_pad($details['ec']['x'], 32, "\0", STR_PAD_LEFT);
        $serverY   = str_pad($details['ec']['y'], 32, "\0", STR_PAD_LEFT);
        $serverPub = "\x04" . $serverX . $serverY;

        // ECDH shared secret. PHP has no native ECDH for raw points,
        // so we derive it via openssl_pkey_derive using a peer key
        // built from the subscription's public point.
        $peerPem = ec_point_to_pem($userPublic);
        if (!$peerPem) return null;
        $shared = openssl_pkey_derive($peerPem, $res, 32);
        if ($shared === false) return null;

        // RFC 8291 key derivation (aes128gcm).
        $salt = random_bytes(16);

        // PRK_key = HMAC(auth_secret, shared)
        $prkKey = hash_hmac('sha256', $shared, $authSecret, true);

        // key_info = "WebPush: info\x00" || ua_public || server_public
        $keyInfo = "WebPush: info\x00" . $userPublic . $serverPub;
        $ikm     = hmac_expand($prkKey, $keyInfo, 32);

        // PRK = HMAC(salt, ikm)
        $prk = hash_hmac('sha256', $ikm, $salt, true);

        $cekInfo   = "Content-Encoding: aes128gcm\x00";
        $cek       = hmac_expand($prk, $cekInfo, 16);
        $nonceInfo = "Content-Encoding: nonce\x00";
        $nonce     = hmac_expand($prk, $nonceInfo, 12);

        // Pad: payload || 0x02 (last record delimiter)
        $plaintext = $payload . "\x02";

        $tag = '';
        $cipher = openssl_encrypt(
            $plaintext, 'aes-128-gcm', $cek,
            OPENSSL_RAW_DATA, $nonce, $tag, '', 16
        );
        if ($cipher === false) return null;

        // aes128gcm header: salt(16) || rs(4 = 4096) || idlen(1) || keyid(server pub 65)
        $rs     = pack('N', 4096);
        $idlen  = chr(65);
        $header = $salt . $rs . $idlen . $serverPub;

        return $header . $cipher . $tag;
    }

    // HKDF-Expand single block helper (length <= 32).
    function hmac_expand($prk, $info, $length) {
        $t = hash_hmac('sha256', $info . "\x01", $prk, true);
        return substr($t, 0, $length);
    }

    /**
     * Wrap a raw uncompressed EC point (0x04||X||Y) into a PEM
     * SubjectPublicKeyInfo so openssl_pkey_derive can consume it.
     */
    function ec_point_to_pem($point) {
        // DER prefix for an uncompressed prime256v1 public key.
        $der = "\x30\x59\x30\x13\x06\x07\x2a\x86\x48\xce\x3d\x02\x01"
             . "\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\x03\x42\x00"
             . $point;
        $pem = "-----BEGIN PUBLIC KEY-----\n"
             . chunk_split(base64_encode($der), 64, "\n")
             . "-----END PUBLIC KEY-----\n";
        return $pem;
    }

    /**
     * POST an encrypted push to a single subscription endpoint.
     * Returns the HTTP status code (or 0 on transport failure).
     * 404/410 means the subscription is dead and should be pruned.
     */
    function send_web_push($endpoint, $p256dh, $auth, $payloadJson) {
        $body = encrypt_push_payload($payloadJson, $p256dh, $auth);
        if ($body === null) return 0;

        $parts    = parse_url($endpoint);
        $audience = $parts['scheme'] . '://' . $parts['host'];
        $vapid    = vapid_auth_header($audience);
        if ($vapid === null) return 0;

        $headers = array_merge($vapid, [
            'Content-Type: application/octet-stream',
            'Content-Encoding: aes128gcm',
            'TTL: 86400',
            'Urgency: normal',
        ]);

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $code;
    }

    /**
     * Push to every subscription belonging to a user email.
     * Prunes dead subscriptions (404/410). Silently no-ops if the
     * push_subscriptions table is empty or OpenSSL EC is unavailable.
     */
    function pushToUser($db, $userEmail, $title, $message, $link = '', $type = 'info') {
        try {
            $stmt = $db->prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_email = ?");
            $stmt->execute([strtolower(trim($userEmail))]);
            $subs = $stmt->fetchAll();
        } catch (PDOException $e) { return; }
        if (!$subs) return;

        $payload = json_encode([
            'title' => $title,
            'body'  => $message,
            'link'  => $link ?: 'dashboard.html',
            'type'  => $type,
        ]);

        foreach ($subs as $s) {
            $code = send_web_push($s['endpoint'], $s['p256dh'], $s['auth'], $payload);
            if ($code === 404 || $code === 410) {
                try { $db->prepare("DELETE FROM push_subscriptions WHERE id = ?")->execute([$s['id']]); }
                catch (PDOException $e) {}
            }
        }
    }

    // ── UNIFIED NOTIFY: in-app bell + device push, in one call ──
    // This is the single function every endpoint should use. It
    // writes the DB notification (drives the bell) AND fires a real
    // device push to the same user. Replaces the per-file sendNotif.
    function notifyUser($db, $userEmail, $type, $title, $message, $link = '') {
        $email   = strtolower(trim($userEmail));
        $notifId = 'NTF-' . str_pad(nextCounter('notif_counter'), 5, '0', STR_PAD_LEFT);
        try {
            $db->prepare("INSERT INTO notifications (notif_id, user_email, type, title, message, link) VALUES (?,?,?,?,?,?)")
               ->execute([$notifId, $email, $type, $title, $message, $link]);
        } catch (PDOException $e) { /* non-fatal */ }
        // Fire device push (best-effort, never blocks the response path).
        pushToUser($db, $email, $title, $message, $link, $type);
    }

    function notifyStaff($db, $type, $title, $message, $link = '', $roles = ['superadmin','admin','custodian']) {
        // Build a safe parameterized IN clause — never interpolate role values directly.
        $safeRoles = array_values(array_filter($roles, fn($r) => preg_match('/^[a-z]+$/', $r)));
        if (!$safeRoles) return;
        $placeholders = implode(',', array_fill(0, count($safeRoles), '?'));
        try {
            $rows = $db->prepare("SELECT email FROM users WHERE role IN ($placeholders)");
            $rows->execute($safeRoles);
            $rows = $rows->fetchAll();
        } catch (PDOException $e) { return; }
        foreach ($rows as $r) notifyUser($db, $r['email'], $type, $title, $message, $link);
    }

    // ── ACTIVITY LOG ──────────────────────────────────────────
    // System-wide event log (who did what, when). Distinct from the
    // physical room-audit logs. Viewable by the Admin (Principal).
    //
    //   logActivity($db, $actorEmail, $actorRole, $actorName,
    //               $action, $target, $details)
    //
    // $action examples: 'login', 'asset_added', 'asset_removed',
    //   'request_approved', 'request_rejected', 'condition_updated',
    //   'room_audit', 'password_reset', 'policy_updated', ...
    function logActivity($db, $actorEmail, $actorRole, $actorName, $action, $target = '', $details = '') {
        try {
            $logId = 'ACT-' . str_pad(nextCounter('activity_counter'), 7, '0', STR_PAD_LEFT);
            $db->prepare("
                INSERT INTO activity_log
                    (log_id, actor_email, actor_role, actor_name, action, target, details, ip_address)
                VALUES (?,?,?,?,?,?,?,?)
            ")->execute([
                $logId,
                strtolower(trim($actorEmail)),
                $actorRole,
                $actorName,
                $action,
                substr($target, 0, 255),
                substr($details, 0, 500),
                $_SERVER['REMOTE_ADDR'] ?? '',
            ]);
        } catch (PDOException $e) { /* non-fatal — logging must never break the request */ }
    }

    // Convenience wrapper: pull actor identity straight from session.
    function logActivityAs($db, $me, $action, $target = '', $details = '') {
        if (!$me) return;
        logActivity($db, $me['email'] ?? '', $me['role'] ?? '', $me['name'] ?? '', $action, $target, $details);
    }
}
?>
