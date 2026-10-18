const DEFAULT_DATABASE_URL = "https://gerador-goldxits-default-rtdb.firebaseio.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database";

let cachedAccessToken = "";
let cachedAccessTokenExpiry = 0;
let cachedCryptoKey = null;
let cachedKeyFingerprint = "";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function b64url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function privateKeyDer(pemValue) {
  const pem = String(pemValue || "").replace(/\\n/g, "\n");
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("missing_private_key");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signingKey(env) {
  const email = String(env.FIREBASE_CLIENT_EMAIL || "");
  const privateKey = String(env.FIREBASE_PRIVATE_KEY || "");
  if (!email || !privateKey) throw new Error("missing_service_account_secret");
  const fingerprint = `${email}:${privateKey.length}:${privateKey.slice(0, 32)}`;
  if (cachedCryptoKey && cachedKeyFingerprint === fingerprint) return { email, key: cachedCryptoKey };

  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  cachedCryptoKey = key;
  cachedKeyFingerprint = fingerprint;
  return { email, key };
}

async function accessToken(env) {
  const nowMs = Date.now();
  if (cachedAccessToken && nowMs < cachedAccessTokenExpiry - 60_000) return cachedAccessToken;

  const { email, key } = await signingKey(env);
  const nowSec = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`oauth_${response.status}`);

  cachedAccessToken = payload.access_token;
  cachedAccessTokenExpiry = nowMs + Number(payload.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

// Refuse oversized payloads before performing OAuth or database operations.
// Limit is measured in bytes, including if Content-Length is omitted.
async function formFields(request) {
  const maxBodyBytes = 4096;
  const reader = request.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function validKey(key) {
  return /^[A-Za-z0-9._-]{6,160}$/.test(key);
}

function validDeviceId(deviceId) {
  return /^[A-Za-z0-9._:-]{6,256}$/.test(deviceId) && deviceId !== "unknown";
}

function inactive(message) {
  return json({ success: false, active: false, message }, 200);
}

async function readLicense(url, token) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Firebase-ETag": "true",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`database_read_${response.status}`);
  return { record: await response.json(), etag: response.headers.get("etag") };
}

async function conditionalWrite(url, token, etag, record) {
  return fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "If-Match": etag,
    },
    body: JSON.stringify(record),
  });
}

async function activateLicense(key, deviceId, token, databaseUrl = DEFAULT_DATABASE_URL, databasePath = "proxyAndroid/keys") {
  const baseUrl = String(databaseUrl || DEFAULT_DATABASE_URL).trim().replace(/\/+$/, "");
  const path = String(databasePath || "proxyAndroid/keys").replace(/^\/+|\/+$/g, "");
  const url = `${baseUrl}/${path}/${encodeURIComponent(key)}.json`;

  // RTDB ETag/If-Match makes first-device activation compare-and-swap atomic.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { record, etag } = await readLicense(url, token);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return inactive("Licença não encontrada ou inválida.");
    }
    if (record.key && String(record.key) !== key) return inactive("Licença inválida.");
    if (record.paused === true) return inactive("Licença pausada.");

    const status = String(record.status || "").toLowerCase();
    const boundDeviceId = String(record.boundDeviceId || "").trim();
    const now = Date.now();

    if (status === "active") {
      if (!boundDeviceId && record.activationStarted !== true) {
        const durationMs = Number(record.durationMs ?? record.remainingMs ?? 0);
        if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || !Number.isSafeInteger(now + durationMs)) {
          return inactive("Licença sem duração válida.");
        }
        if (!etag) throw new Error("database_missing_etag");
        const activated = {
          ...record,
          status: "active",
          activationStarted: true,
          activatedAt: now,
          boundDeviceId: deviceId,
          expiresAt: now + durationMs,
          remainingMs: durationMs,
          lastSeenAt: now,
        };
        const write = await conditionalWrite(url, token, etag, activated);
        if (write.status === 412) continue;
        if (!write.ok) throw new Error(`database_write_${write.status}`);
        return json({ success: true, active: true, message: "Licença ativada neste dispositivo." });
      }
      const expiresAt = Number(record.expiresAt);
      // Fail closed: missing/invalid expiration must never mean unlimited access.
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        return inactive("Licença expirada ou com validade inválida.");
      }

      if (!etag) throw new Error("database_missing_etag");
      if (!boundDeviceId && record.activationStarted === true) {
        const rebound = { ...record, boundDeviceId: deviceId, lastSeenAt: now };
        rebound.remainingMs = Math.max(0, expiresAt - now);
        const write = await conditionalWrite(url, token, etag, rebound);
        if (write.status === 412) continue;
        if (!write.ok) throw new Error(`database_write_${write.status}`);
        return json({ success: true, active: true, message: "Licença vinculada neste dispositivo; a validade original continua." });
      }
      if (boundDeviceId !== deviceId) return inactive("Licença vinculada a outro dispositivo.");
      const updated = { ...record, lastSeenAt: now };
      updated.remainingMs = Math.max(0, expiresAt - now);
      const write = await conditionalWrite(url, token, etag, updated);
      if (write.status === 412) continue;
      if (!write.ok) throw new Error(`database_write_${write.status}`);
      return json({ success: true, active: true, message: "Licença ativa neste dispositivo." });
    }

    if (status !== "pending" || record.activationStarted === true || boundDeviceId.length > 0) {
      return inactive("Licença inválida ou não ativável.");
    }

    const durationMs = Number(record.remainingMs ?? record.durationMs ?? 0);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0 ||
        !Number.isSafeInteger(now + durationMs)) {
      return inactive("Licença sem duração válida.");
    }
    if (!etag) throw new Error("database_missing_etag");

    const activated = {
      ...record,
      status: "active",
      activationStarted: true,
      activatedAt: now,
      boundDeviceId: deviceId,
      expiresAt: now + durationMs,
      remainingMs: durationMs,
      lastSeenAt: now,
    };
    const write = await conditionalWrite(url, token, etag, activated);
    if (write.status === 412) continue;
    if (!write.ok) throw new Error(`database_write_${write.status}`);
    return json({ success: true, active: true, message: "Licença ativada neste dispositivo." });
  }

  return inactive("A licença mudou durante a ativação. Tente novamente.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "draco-license-bridge" });
    }
    if (request.method !== "POST") {
      return json({ success: false, active: false, message: "Use POST." }, 405);
    }

    try {
      // This is a basic mitigation, not a guarantee against distributed abuse.
      // Cloudflare may put many mobile users behind the same public IP.
      const ip = request.headers.get("cf-connecting-ip") || "unidentified";
      const rate = await env.LICENSE_RATE_LIMITER.limit({ key: ip });
      if (!rate.success) return json({
        success: false, active: false, message: "Muitas tentativas. Aguarde um minuto."
      }, 429);

      const fields = await formFields(request);
      if (!fields) return json({
        success: false, active: false, message: "Solicitação muito grande."
      }, 413);
      const key = String(fields.key || "").trim();
      const deviceId = String(fields.deviceId || "").trim();
      if (!validKey(key)) return inactive("Chave inválida.");
      if (!validDeviceId(deviceId)) return inactive("Não foi possível identificar este dispositivo.");

      const token = await accessToken(env);
      return await activateLicense(
        key,
        deviceId,
        token,
        env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL,
        env.FIREBASE_DATABASE_PATH || "proxyAndroid/keys"
      );
    } catch (error) {
      // Never log key, device ID, private key, or request body.
      console.error("license_bridge_error", error && error.message ? error.message : "internal");
      return json({
        success: false,
        active: false,
        message: "Falha temporária na validação. Verifique a configuração do servidor.",
      }, 500);
    }
  },
};

// Exported for offline unit tests; clients cannot call this directly over HTTP.
export { activateLicense };
