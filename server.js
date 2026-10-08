require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const initSqlJs = require('sql.js');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const OWNER_FILE = path.join(DATA, 'owner-auth.json');
const DB_FILE = path.join(DATA, 'app.sqlite');
const SESSION_SECRET_FILE = path.join(DATA, 'session-secret');
const FIREBASE_DATABASE_PATH = String(process.env.FIREBASE_DATABASE_PATH || 'proxyAndroid/keys').replace(/^\/+|\/+$/g, '');
let FIREBASE_DATABASE_URL = String(process.env.FIREBASE_DATABASE_URL || 'https://gerador-goldxits-default-rtdb.firebaseio.com').trim().replace(/\/+$/, '').replace(/\.json$/i, '');
// Tolerate an older .env that already included the Firebase path or .json suffix.
const firebasePathSuffix = `/${FIREBASE_DATABASE_PATH}`;
if (FIREBASE_DATABASE_URL.toLowerCase().endsWith(firebasePathSuffix.toLowerCase())) {
  FIREBASE_DATABASE_URL = FIREBASE_DATABASE_URL.slice(0, -firebasePathSuffix.length).replace(/\/+$/, '');
}
const FIREBASE_AUTH_TOKEN = String(process.env.FIREBASE_AUTH_TOKEN || '').trim();
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DURATION_PLANS = [
  { id: '1h', label: '1 hora', duration: 1, unit: 'hours', durationMs: 3600000, cost: 0.5 },
  { id: '1d', label: '1 dia', duration: 1, unit: 'days', durationMs: 86400000, cost: 1 },
  { id: '3d', label: '3 dias', duration: 3, unit: 'days', durationMs: 259200000, cost: 2 },
  { id: '7d', label: '7 dias', duration: 7, unit: 'days', durationMs: 604800000, cost: 6 },
  { id: '30d', label: '30 dias', duration: 30, unit: 'days', durationMs: 2592000000, cost: 8 }
];
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try { return fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim(); } catch {}
  const value = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(SESSION_SECRET_FILE, value, { mode: 0o600, flag: 'wx' });
  return value;
}
function passwordTag(password) {
  return crypto.createHmac('sha256', sessionSecret()).update(String(password)).digest('hex');
}
function writeOwnerAuthFile(document) {
  const tmp = `${OWNER_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(document, null, 2), { mode: 0o600, flag: 'w' });
  try { fs.renameSync(tmp, OWNER_FILE); }
  catch (err) {
    if (!['EEXIST', 'EPERM'].includes(err.code)) throw err;
    fs.rmSync(OWNER_FILE, { force: true });
    fs.renameSync(tmp, OWNER_FILE);
  }
  try { fs.chmodSync(OWNER_FILE, 0o600); } catch {}
}
class LocalDatabase {
  constructor(engine, filename) { this.engine = engine; this.filename = filename; this.txDepth = 0; }
  pragma(command) { try { this.engine.exec(`PRAGMA ${command}`); } catch {} }
  exec(sql) { this.engine.exec(sql); this.persist(); }
  prepare(sql) {
    const owner = this;
    return {
      get(...params) {
        const stmt = owner.engine.prepare(sql);
        try { stmt.bind(params); return stmt.step() ? stmt.getAsObject() : undefined; }
        finally { stmt.free(); }
      },
      all(...params) {
        const stmt = owner.engine.prepare(sql); const rows = [];
        try { stmt.bind(params); while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
        finally { stmt.free(); }
      },
      run(...params) {
        const stmt = owner.engine.prepare(sql);
        try { stmt.run(params); }
        finally { stmt.free(); }
        const changes = owner.engine.getRowsModified();
        const last = owner.engine.exec('SELECT last_insert_rowid() AS id');
        owner.persist();
        return { changes, lastInsertRowid: last[0]?.values?.[0]?.[0] ?? 0 };
      }
    };
  }
  transaction(fn) {
    return (...args) => {
      this.engine.exec('BEGIN'); this.txDepth++;
      let result;
      try { result = fn(...args); this.engine.exec('COMMIT'); }
      catch (err) { try { this.engine.exec('ROLLBACK'); } catch {} this.txDepth--; throw err; }
      this.txDepth--; this.persist(); return result;
    };
  }
  persist() {
    if (this.txDepth) return;
    const temp = `${this.filename}.tmp`;
    fs.writeFileSync(temp, Buffer.from(this.engine.export()), { mode: 0o600 });
    fs.renameSync(temp, this.filename);
    try { fs.chmodSync(this.filename, 0o600); } catch {}
  }
}
(async () => {
const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
const engine = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
const db = new LocalDatabase(engine, DB_FILE);
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS resellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0 CHECK(credits >= 0),
    prefix TEXT NOT NULL DEFAULT 'GoldCheats',
    active INTEGER NOT NULL DEFAULT 1,
    former_username TEXT,
    removed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    credit_cost INTEGER NOT NULL CHECK(credit_cost >= 0),
    separator TEXT NOT NULL DEFAULT '-',
    suffix_length INTEGER NOT NULL DEFAULT 6,
    alphabet TEXT NOT NULL DEFAULT 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reseller_id INTEGER NOT NULL REFERENCES resellers(id),
    rule_id INTEGER NOT NULL REFERENCES rules(id),
    value TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','paused')),
    phone TEXT,
    activated_at TEXT,
    duration_value INTEGER NOT NULL DEFAULT 30,
    duration_unit TEXT NOT NULL DEFAULT 'days',
    credit_cost REAL NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
const resellerColumns = new Set(db.prepare('PRAGMA table_info(resellers)').all().map(column => column.name));
if (!resellerColumns.has('former_username')) db.exec('ALTER TABLE resellers ADD COLUMN former_username TEXT');
if (!resellerColumns.has('removed_at')) db.exec('ALTER TABLE resellers ADD COLUMN removed_at TEXT');
if (!resellerColumns.has('password_tag')) db.exec('ALTER TABLE resellers ADD COLUMN password_tag TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_resellers_password_tag ON resellers(password_tag) WHERE password_tag IS NOT NULL');
if (!db.prepare('SELECT id FROM rules LIMIT 1').get()) {
  db.prepare('INSERT INTO rules (name, credit_cost, separator, suffix_length, alphabet) VALUES (?, ?, ?, ?, ?)')
    .run('Padrão', 1, '-', 6, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
}
const fixedRule = db.prepare('SELECT id FROM rules ORDER BY id LIMIT 1').get();
db.prepare("UPDATE rules SET name='Padrão', separator='-', suffix_length=6, alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', active=CASE WHEN id=? THEN 1 ELSE 0 END").run(fixedRule.id);
// Migração: remove metadados de celular do protótipo e prepara saldo/duração por key.
const keyColumns = new Set(db.prepare('PRAGMA table_info(keys)').all().map(column => column.name));
if (!keyColumns.has('duration_value')) db.exec("ALTER TABLE keys ADD COLUMN duration_value INTEGER NOT NULL DEFAULT 30");
if (!keyColumns.has('duration_unit')) db.exec("ALTER TABLE keys ADD COLUMN duration_unit TEXT NOT NULL DEFAULT 'days'");
if (!keyColumns.has('credit_cost')) db.exec('ALTER TABLE keys ADD COLUMN credit_cost REAL NOT NULL DEFAULT 1');
db.prepare("UPDATE keys SET status='pending' WHERE status='active' AND phone IS NULL AND activated_at IS NULL").run();
db.prepare('UPDATE keys SET phone=NULL, activated_at=NULL WHERE phone IS NOT NULL OR activated_at IS NOT NULL').run();

// OWNER_PASSWORD is supplied only through private server configuration. Persist its bcrypt hash separately.
const configuredOwnerPassword = String(process.env.OWNER_PASSWORD || '');
if (configuredOwnerPassword) {
  if (configuredOwnerPassword.length < 8 || configuredOwnerPassword.length > 128) {
    throw new Error('A variável privada OWNER_PASSWORD deve ter entre 8 e 128 caracteres.');
  }
  const activeResellers = db.prepare('SELECT password_hash AS passwordHash FROM resellers WHERE active=1 AND removed_at IS NULL').all();
  for (const reseller of activeResellers) {
    if (reseller.passwordHash && await bcrypt.compare(configuredOwnerPassword, reseller.passwordHash)) {
      throw new Error('OWNER_PASSWORD não pode ser igual à senha de um revendedor.');
    }
  }
  writeOwnerAuthFile({ passwordHash: await bcrypt.hash(configuredOwnerPassword, 12), createdAt: new Date().toISOString() });
}

const app = express();
app.disable('x-powered-by');
if (process.env.COOKIE_SECURE === 'true') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'"], scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"] } } }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  store: new session.MemoryStore(),
  name: 'keys_panel_session',
  secret: sessionSecret(),
  resave: false,
  saveUninitialized: true,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  next();
});
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' } });
const generationLocks = new Set();
const ownerFileExists = () => fs.existsSync(OWNER_FILE);
const cleanText = (value, max = 80) => String(value ?? '').trim().slice(0, max);
function audit(actor, action, details = {}) {
  db.prepare('INSERT INTO audit (actor, action, details) VALUES (?, ?, ?)').run(actor, action, JSON.stringify(details));
}
function csrf(req, res, next) {
  const supplied = req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken || '';
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Sessão expirada. Atualize a página e tente novamente.' });
  next();
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  if (req.session.user.role === 'reseller') {
    const reseller = db.prepare('SELECT id, username, credits, prefix, active, removed_at FROM resellers WHERE id = ?').get(req.session.user.id);
    if (!reseller || !reseller.active || reseller.removed_at) return req.session.destroy(() => res.status(401).json({ error: 'O acesso do revendedor foi removido ou bloqueado pelo proprietário.' }));
    req.reseller = reseller;
  }
  next();
}
function requireOwner(req, res, next) {
  if (req.session.user?.role !== 'owner') return res.status(403).json({ error: 'Apenas o proprietário pode realizar esta ação.' });
  next();
}
function canManageKey(req, key) {
  if (req.session.user?.role === 'owner') return true;
  return req.session.user?.role === 'reseller' && Number(req.reseller?.id) === Number(key.resellerId);
}
function safeUser(req) {
  if (req.session.user.role === 'owner') return { role: 'owner', username: req.session.user.username || '' };
  const r = req.reseller || db.prepare('SELECT id, username, credits, prefix, active FROM resellers WHERE id = ?').get(req.session.user.id);
  return { role: 'reseller', id: r.id, username: r.username, credits: r.credits, prefix: r.prefix };
}
function validateUsername(value) {
  const username = cleanText(value, 32);
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error('Use um usuário de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.');
  return username;
}
function validateOwnerPassword(value) {
  const password = String(value ?? '');
  if (password.length < 8 || password.length > 128) throw new Error('A senha do proprietário deve ter entre 8 e 128 caracteres.');
  return password;
}
function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < 10 || password.length > 128) throw new Error('A senha deve ter entre 10 e 128 caracteres.');
  return password;
}
async function ensureUniqueAccessPassword(password, exceptResellerId = null) {
  const tag = passwordTag(password);
  if (ownerFileExists()) {
    const owner = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
    if (owner.passwordHash && await bcrypt.compare(password, owner.passwordHash)) {
      throw new Error('Essa senha já pertence a outro acesso. Cada conta precisa de uma senha exclusiva.');
    }
  }
  const tagged = db.prepare('SELECT id FROM resellers WHERE password_tag=? AND active=1 AND removed_at IS NULL').get(tag);
  if (tagged && Number(tagged.id) !== Number(exceptResellerId)) {
    throw new Error('Essa senha já pertence a outro acesso. Cada conta precisa de uma senha exclusiva.');
  }
  const legacyRows = db.prepare('SELECT id, password_hash AS passwordHash FROM resellers WHERE password_tag IS NULL AND active=1 AND removed_at IS NULL').all();
  for (const row of legacyRows) {
    if (Number(row.id) === Number(exceptResellerId)) continue;
    if (row.passwordHash && await bcrypt.compare(password, row.passwordHash)) {
      throw new Error('Essa senha já pertence a outro acesso. Cada conta precisa de uma senha exclusiva.');
    }
  }
}
function validatePrefix(value) {
  const prefix = cleanText(value, 64);
  if (!prefix || !/[A-Za-z0-9]/.test(prefix) || /[\r\n\0]/.test(prefix)) throw new Error('Informe um prefixo com letras ou números (máximo 64 caracteres).');
  return prefix;
}
function validateRule(body) {
  const name = cleanText(body.name, 60);
  const creditCost = Number(body.creditCost);
  const separator = String(body.separator ?? '-').slice(0, 8);
  const suffixLength = Number(body.suffixLength);
  const alphabet = String(body.alphabet ?? '').slice(0, 64);
  if (!name) throw new Error('Informe o nome da regra.');
  if (!Number.isInteger(creditCost) || creditCost < 0 || creditCost > 1000000) throw new Error('O custo deve ser um número inteiro igual ou maior que zero.');
  if (!Number.isInteger(suffixLength) || suffixLength < 4 || suffixLength > 64) throw new Error('O tamanho aleatório deve ficar entre 4 e 64 caracteres.');
  if (!alphabet || alphabet.length < 2 || new Set(alphabet).size !== alphabet.length || /[\r\n\0]/.test(alphabet)) throw new Error('O conjunto de caracteres deve ter ao menos 2 caracteres diferentes.');
  if (/[\r\n\0]/.test(separator)) throw new Error('Separador inválido.');
  return { name, creditCost, separator, suffixLength, alphabet };
}
function normalizePrefix(prefix) {
  const cleaned = String(prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) throw new Error('O prefixo precisa conter ao menos uma letra ou número.');
  return cleaned;
}
function makeKey(prefix, reservedValues = new Set()) {
  const cleanPrefix = normalizePrefix(prefix);
  let value;
  do {
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)];
    value = `${cleanPrefix}-${suffix}`;
  } while (reservedValues.has(value));
  reservedValues.add(value);
  return value;
}
function firebaseUrl(child = '') {
  const fullPath = `${FIREBASE_DATABASE_PATH}${child ? `/${child}` : ''}.json`;
  const url = new URL(fullPath, `${FIREBASE_DATABASE_URL}/`);
  if (FIREBASE_AUTH_TOKEN) url.searchParams.set('auth', FIREBASE_AUTH_TOKEN);
  return url;
}
async function firebaseRequest(child = '', options = {}) {
  let response;
  try {
    response = await fetch(firebaseUrl(child), {
      method: options.method || 'GET',
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    throw new Error(`Não foi possível conectar ao Firebase: ${err.message}`);
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const reason = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new Error(`Firebase recusou a operação (${reason}). Verifique as regras de acesso.`);
  }
  return payload;
}
function halfCreditValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-8 && Math.abs(n) <= 100000000;
}
function roundCredits(value) { return Math.round((Number(value) + Number.EPSILON) * 2) / 2; }
function planForKey(data) { return DURATION_PLANS.find(plan => plan.id === String(data?.planId || '')); }
function readFirebaseStatus(localKey, remote) {
  if (!remote || typeof remote !== 'object') return { ...localKey, status: 'not_found', deviceConnected: false, remainingText: 'Não localizada no app' };
  const deviceId = String(remote.boundDeviceId || remote.deviceId || '');
  const started = Boolean(remote.activationStarted) || Number(remote.activatedAt) > 0 || Boolean(deviceId);
  const expiresAt = Number(remote.expiresAt) || 0;
  let status;
  if (started && expiresAt && Date.now() >= expiresAt) status = 'expired';
  else if (!deviceId) status = 'pending';
  else if (Boolean(remote.paused) || remote.status === 'paused') status = 'paused';
  else status = 'active';
  let remainingText = 'Inicia ao conectar';
  if (started) {
    const remainingMs = expiresAt ? expiresAt - Date.now() : Number(remote.remainingMs) || 0;
    if (remainingMs <= 0 && expiresAt) remainingText = 'Expirada';
    else if (remainingMs > 0 && remainingMs < 3600000) remainingText = `${Math.ceil(remainingMs / 60000)} min`;
    else if (remainingMs >= 3600000 && remainingMs < 86400000) remainingText = `${Math.ceil(remainingMs / 3600000)} h`;
    else if (remainingMs >= 86400000) remainingText = `${Math.ceil(remainingMs / 86400000)} d`;
    else remainingText = 'Contagem iniciada';
  }
  return { ...localKey, status, deviceConnected: Boolean(deviceId), remainingText, firebaseExpiresAt: expiresAt || null };
}

app.get('/api/bootstrap', (req, res) => res.json({ setupRequired: !ownerFileExists(), csrfToken: req.session.csrfToken }));
app.post('/api/setup', csrf, async (req, res, next) => {
  try {
    if (ownerFileExists()) return res.status(409).json({ error: 'O painel já foi configurado.' });
    const password = validateOwnerPassword(req.body.password);
    await ensureUniqueAccessPassword(password);
    writeOwnerAuthFile({ passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() });
    audit('Dono', 'owner_setup', {});
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { role: 'owner', username: '' };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.save(err2 => err2 ? next(err2) : res.json({ user: safeUser(req), csrfToken: req.session.csrfToken }));
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/login', loginLimiter, csrf, async (req, res, next) => {
  try {
    const password = String(req.body.password ?? '');
    if (!password || password.length > 128) return res.status(401).json({ error: 'Senha incorreta.' });
    let user = null;
    const tag = passwordTag(password);
    const resellerMatches = [];
    const taggedRows = db.prepare('SELECT id, username, password_hash AS passwordHash, password_tag AS passwordTag FROM resellers WHERE password_tag=? AND active=1 AND removed_at IS NULL').all(tag);
    const legacyRows = db.prepare('SELECT id, username, password_hash AS passwordHash FROM resellers WHERE password_tag IS NULL AND active=1 AND removed_at IS NULL').all();
    for (const reseller of [...taggedRows, ...legacyRows]) {
      if (reseller.passwordHash && await bcrypt.compare(password, reseller.passwordHash)) resellerMatches.push(reseller);
    }
    if (resellerMatches.length > 1) return res.status(401).json({ error: 'Esta senha está associada a mais de uma conta. Peça ao dono para definir senhas individuais.' });
    let ownerMatched = false;
    if (ownerFileExists()) {
      const owner = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
      ownerMatched = Boolean(owner.passwordHash && await bcrypt.compare(password, owner.passwordHash));
    }
    if (ownerMatched && resellerMatches.length) {
      return res.status(401).json({ error: 'Essa senha está repetida em outra conta. Peça ao dono para alterar a senha do revendedor.' });
    }
    if (ownerMatched) user = { role: 'owner', username: '' };
    else if (resellerMatches.length === 1) user = { role: 'reseller', id: resellerMatches[0].id, username: resellerMatches[0].username };
    if (!user) return res.status(401).json({ error: 'Senha incorreta.' });
    if (user.role === 'reseller' && !resellerMatches[0].passwordTag) {
      db.prepare('UPDATE resellers SET password_tag=? WHERE id=?').run(tag, user.id);
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = user;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.save(err2 => {
        if (err2) return next(err2);
        audit(user.username || 'Dono', 'login', {});
        if (user.role === 'reseller') req.reseller = db.prepare('SELECT id, username, credits, prefix, active FROM resellers WHERE id = ?').get(user.id);
        res.json({ user: safeUser(req), csrfToken: req.session.csrfToken });
      });
    });
  } catch (err) { next(err); }
});
app.post('/api/logout', csrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', requireAuth, (req, res) => res.json({ user: safeUser(req), csrfToken: req.session.csrfToken }));
app.get('/api/dashboard', requireAuth, async (req, res, next) => {
  try {
    // Compatibility data for older cached screens; new screens use plans and Firebase status.
    const rules = db.prepare('SELECT id, name, credit_cost AS creditCost, separator, suffix_length AS suffixLength, alphabet, active FROM rules WHERE active=1 ORDER BY id').all();
    let firebaseKeys = {}, firebaseAvailable = true, firebaseError = '';
    try { firebaseKeys = await firebaseRequest(''); firebaseKeys = firebaseKeys && typeof firebaseKeys === 'object' ? firebaseKeys : {}; }
    catch (err) { firebaseAvailable = false; firebaseError = err.message; }
    const firebaseKeyCount = Object.keys(firebaseKeys).length;
    const baseRows = req.session.user.role === 'owner'
      ? db.prepare(`SELECT k.id, k.value, k.status, k.duration_value AS durationValue, k.duration_unit AS durationUnit, k.credit_cost AS creditCost, k.created_at AS createdAt, k.updated_at AS updatedAt, COALESCE(NULLIF(r.former_username,''),r.username) AS reseller, r.prefix AS prefix FROM keys k JOIN resellers r ON r.id=k.reseller_id JOIN rules ru ON ru.id=k.rule_id ORDER BY k.id DESC LIMIT 200`).all()
      : db.prepare(`SELECT k.id, k.value, k.status, k.duration_value AS durationValue, k.duration_unit AS durationUnit, k.credit_cost AS creditCost, k.created_at AS createdAt, k.updated_at AS updatedAt FROM keys k JOIN rules ru ON ru.id=k.rule_id WHERE k.reseller_id=? ORDER BY k.id DESC LIMIT 200`).all(req.reseller.id);
    const keys = baseRows.map(key => firebaseAvailable
      ? readFirebaseStatus(key, firebaseKeys[key.value])
      : { ...key, status: 'sync_error', deviceConnected: false, remainingText: 'Firebase indisponível' });
    const plans = DURATION_PLANS.map(({ id, label, duration, unit, cost }) => ({ id, label, duration, unit, cost }));
    if (req.session.user.role === 'owner') {
      res.json({ user: safeUser(req), rules, plans, firebaseAvailable, firebaseError, firebaseKeyCount, firebasePath: `/${FIREBASE_DATABASE_PATH}`,
        metrics: {
          resellers: db.prepare('SELECT COUNT(*) AS n FROM resellers WHERE active = 1 AND removed_at IS NULL').get().n,
          credits: db.prepare('SELECT COALESCE(SUM(credits),0) AS n FROM resellers WHERE active = 1 AND removed_at IS NULL').get().n,
          keys: db.prepare('SELECT COUNT(*) AS n FROM keys').get().n,
          activeKeys: keys.filter(key => key.status === 'active').length,
          pendingKeys: keys.filter(key => key.status === 'pending').length,
          connectedDevices: keys.filter(key => key.deviceConnected).length
        },
        resellers: db.prepare('SELECT id, username, credits, prefix, active, created_at AS createdAt FROM resellers WHERE removed_at IS NULL ORDER BY id DESC').all(),
        keys,
        audit: db.prepare('SELECT id, actor, action, details, created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 100').all()
      });
    } else {
      res.json({ user: safeUser(req), rules, plans, firebaseAvailable, firebaseError, firebaseKeyCount, firebasePath: `/${FIREBASE_DATABASE_PATH}`, keys });
    }
  } catch (err) { next(err); }
});
app.post('/api/resellers', requireAuth, requireOwner, csrf, async (req, res) => {
  try {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);
    await ensureUniqueAccessPassword(password);
    const prefix = validatePrefix(req.body.prefix || 'GoldCheats');
    const credits = Number(req.body.credits || 0);
    if (!halfCreditValue(credits) || credits < 0) throw new Error('Créditos iniciais devem ser múltiplos de 0,5 e não negativos.');
    const result = db.prepare('INSERT INTO resellers (username, password_hash, password_tag, credits, prefix) VALUES (?, ?, ?, ?, ?)').run(username, await bcrypt.hash(password, 12), passwordTag(password), credits, prefix);
    audit(req.session.user.username || 'Dono', 'reseller_created', { reseller: username, credits, prefix });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (err) { res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Esse usuário já existe.' : err.message }); }
});
app.patch('/api/resellers/:id/credits', requireAuth, requireOwner, csrf, (req, res) => {
  try {
    const id = Number(req.params.id), delta = Number(req.body.delta), reason = cleanText(req.body.reason || 'Ajuste manual', 120);
    if (!Number.isInteger(id) || !halfCreditValue(delta) || delta === 0) throw new Error('Informe um ajuste inteiro diferente de zero.');
    const tx = db.transaction(() => {
      const r = db.prepare('SELECT username, credits FROM resellers WHERE id=? AND removed_at IS NULL').get(id);
      if (!r) throw new Error('Revendedor não encontrado.');
      const next = roundCredits(r.credits + delta);
      if (next < 0) throw new Error('O ajuste deixaria o saldo negativo.');
      db.prepare('UPDATE resellers SET credits=? WHERE id=?').run(next, id);
      audit(req.session.user.username || 'Dono', 'credits_adjusted', { reseller: r.username, delta, balance: next, reason });
      return next;
    });
    res.json({ credits: tx() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/resellers/:id', requireAuth, requireOwner, csrf, async (req, res) => {
  try {
    const id = Number(req.params.id); const r = db.prepare('SELECT username FROM resellers WHERE id=? AND removed_at IS NULL').get(id);
    if (!r) return res.status(404).json({ error: 'Revendedor não encontrado.' });
    if (req.body.active !== undefined) return res.status(400).json({ error: 'Ativação e desativação de revendedores não estão disponíveis.' });
    if (req.body.prefix !== undefined) db.prepare('UPDATE resellers SET prefix=? WHERE id=?').run(validatePrefix(req.body.prefix), id);
    if (req.body.password) {
      const password = validatePassword(req.body.password);
      await ensureUniqueAccessPassword(password, id);
      db.prepare('UPDATE resellers SET password_hash=?, password_tag=? WHERE id=?').run(await bcrypt.hash(password, 12), passwordTag(password), id);
    }
    audit(req.session.user.username || 'Dono', 'reseller_updated', { reseller: r.username, prefix: req.body.prefix, passwordChanged: Boolean(req.body.password) });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/resellers/:id', requireAuth, requireOwner, csrf, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Identificador de revendedor inválido.' });
    const reseller = db.prepare('SELECT id, username, credits FROM resellers WHERE id=? AND removed_at IS NULL').get(id);
    if (!reseller) return res.status(404).json({ error: 'Revendedor não encontrado.' });
    const previousUsername = reseller.username;
    const archivedUsername = `removido-${id}-${crypto.randomBytes(6).toString('hex')}`;
    const replacementHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const removedAt = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('UPDATE resellers SET username=?, former_username=?, password_hash=?, password_tag=NULL, active=0, removed_at=? WHERE id=?')
        .run(archivedUsername, previousUsername, replacementHash, removedAt, id);
      audit(req.session.user.username || 'Dono', 'reseller_removed', { reseller: previousUsername, creditsArchived: reseller.credits, keysRetained: true });
    });
    tx();
    res.json({ ok: true, username: previousUsername, keysRetained: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/keys', requireAuth, csrf, async (req, res) => {
  const resellerId = Number(req.reseller?.id);
  if (req.session.user.role !== 'reseller' || !resellerId) return res.status(403).json({ error: 'A geração é feita pelo acesso do revendedor.' });
  if (generationLocks.has(resellerId)) return res.status(409).json({ error: 'Uma geração já está em andamento; aguarde e tente novamente.' });
  generationLocks.add(resellerId);
  let createdRows = [];
  let totalCost = 0;
  try {
    const plan = planForKey(req.body);
    if (!plan) throw new Error('Selecione uma das durações disponíveis.');
    const quantity = Number(req.body.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('A quantidade deve ser de 1 a 100 keys.');
    totalCost = roundCredits(plan.cost * quantity);
    const remote = await firebaseRequest('');
    const remoteKeys = remote && typeof remote === 'object' ? remote : {};
    const reserved = new Set();
    for (const [id, item] of Object.entries(remoteKeys)) {
      reserved.add(String(id).toUpperCase());
      if (item?.key) reserved.add(String(item.key).toUpperCase());
      if (item?.value) reserved.add(String(item.value).toUpperCase());
    }
    for (const row of db.prepare('SELECT value FROM keys').all()) reserved.add(String(row.value).toUpperCase());
    const createdAt = Date.now();
    const keyBatch = Array.from({ length: quantity }, () => {
      const value = makeKey(req.reseller.prefix, reserved);
      const payload = {
        activatedAt: 0,
        activationStarted: false,
        boundDeviceId: '',
        boundFingerprint: '',
        createdAt,
        deviceBindingVersion: 3,
        durationMs: plan.durationMs,
        // Expiração compatível com o cliente; no primeiro vínculo, o app recalcula agora + duração.
        expiresAt: createdAt + plan.durationMs,
        key: value,
        lastSeenAt: 0,
        paused: false,
        remainingMs: plan.durationMs,
        status: 'active',
        unit: plan.unit
      };
      return { value, payload };
    });
    const rule = db.prepare('SELECT id FROM rules WHERE active=1 ORDER BY id LIMIT 1').get();
    if (!rule) throw new Error('Geração indisponível.');
    const reserve = db.transaction(() => {
      const current = db.prepare('SELECT credits FROM resellers WHERE id=? AND active=1').get(resellerId);
      if (!current || current.credits + 1e-8 < totalCost) throw new Error(`Saldo insuficiente. Esta geração custa ${plan.cost} crédito(s) por key.`);
      const nextBalance = roundCredits(current.credits - totalCost);
      db.prepare('UPDATE resellers SET credits=? WHERE id=?').run(nextBalance, resellerId);
      const rows = keyBatch.map(({ value }) => {
        const info = db.prepare('INSERT INTO keys (reseller_id, rule_id, value, status, duration_value, duration_unit, credit_cost) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(resellerId, rule.id, value, 'pending', plan.duration, plan.unit, plan.cost);
        return { id: Number(info.lastInsertRowid), value };
      });
      audit(req.reseller.username, 'key_generation_reserved', { quantity, planId: plan.id, credits: totalCost });
      return { rows, balance: nextBalance };
    });
    const reservation = reserve();
    createdRows = reservation.rows;
    try {
      // Match the reference app exactly: PATCH a map of keys at /proxyAndroid/keys.json.
      const updates = Object.fromEntries(keyBatch.map(({ value, payload }) => [value, payload]));
      await firebaseRequest('', { method: 'PATCH', body: updates });
    } catch (writeError) {
      console.error('Falha ao gravar key no Firebase RTDB:', writeError.message);
      // Resolve ambiguous timeouts by checking the remote records before refunding.
      let allPresent = false;
      try {
        const check = await firebaseRequest('');
        allPresent = keyBatch.every(({ value, payload }) => check?.[value]?.key === value && Number(check[value].createdAt) === createdAt && Number(check[value].durationMs) === payload.durationMs);
      } catch {}
      if (!allPresent) {
        try {
          const undo = db.transaction(() => {
            for (const row of createdRows) db.prepare('DELETE FROM keys WHERE id=?').run(row.id);
            const balance = db.prepare('SELECT credits FROM resellers WHERE id=?').get(resellerId)?.credits || 0;
            db.prepare('UPDATE resellers SET credits=? WHERE id=?').run(roundCredits(balance + totalCost), resellerId);
            audit(req.reseller.username, 'key_generation_failed', { quantity, planId: plan.id, creditsRefunded: totalCost });
          });
          undo();
        } catch (rollbackError) { console.error('Falha ao estornar reserva de geração:', rollbackError); }
        try { await Promise.all(keyBatch.map(({ value }) => firebaseRequest(`${encodeURIComponent(value)}`, { method: 'DELETE' }))); } catch (cleanupError) { console.error('Falha ao limpar gravação parcial no Firebase:', cleanupError); }
        throw new Error(`${writeError.message} Nenhuma key foi entregue e os créditos foram estornados.`);
      }
    }
    db.prepare("UPDATE keys SET status='pending', updated_at=CURRENT_TIMESTAMP WHERE id IN (" + createdRows.map(() => '?').join(',') + ")").run(...createdRows.map(row => row.id));
    audit(req.reseller.username, 'key_generated', { quantity, planId: plan.id, credits: totalCost, values: createdRows.map(row => row.value) });
    res.status(201).json({ keys: createdRows.map(row => row.value), plan: plan.label, costPerKey: plan.cost, totalCost, credits: reservation.balance, status: 'pending' });
  } catch (err) { res.status(err.message.includes('Saldo insuficiente') ? 400 : 502).json({ error: err.message }); }
  finally { generationLocks.delete(resellerId); }
});
app.post('/api/keys/:id/reset', requireAuth, csrf, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const key = db.prepare('SELECT id, value, reseller_id AS resellerId, duration_value AS durationValue, duration_unit AS durationUnit FROM keys WHERE id=?').get(id);
    if (!key) return res.status(404).json({ error: 'Key não encontrada.' });
    if (!canManageKey(req, key)) return res.status(404).json({ error: 'Key não encontrada neste acesso.' });
    const child = encodeURIComponent(key.value);
    const remote = await firebaseRequest(child);
    if (!remote) return res.status(404).json({ error: 'Key não encontrada no aplicativo externo.' });
    const deviceId = String(remote.boundDeviceId || remote.deviceId || '');
    if (!deviceId) throw new Error('Esta key ainda não está conectada a um dispositivo.');
    const now = Date.now();
    const expiresAt = Number(remote.expiresAt) || 0;
    const durationMs = Number(remote.durationMs) || 0;
    // Reset only unbinds the device; preserve expiresAt so the external app's countdown keeps running.
    const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : Number(remote.remainingMs) || durationMs;
    await firebaseRequest(child, { method: 'PATCH', body: {
      boundDeviceId: '', boundFingerprint: '', activatedAt: Number(remote.activatedAt) || 0,
      activationStarted: true, expiresAt, lastSeenAt: 0, remainingMs,
      paused: Boolean(remote.paused), status: 'active', deviceBindingVersion: 3
    }});
    db.prepare("UPDATE keys SET status='pending', phone=NULL, activated_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    audit(req.reseller?.username || req.session.user.username || 'Dono', 'key_reset', { keyId: id, action: 'device_unbound' });
    res.json({ value: key.value, remainingMs });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/keys/:id/status', requireAuth, csrf, async (req, res) => {
  try {
    const id = Number(req.params.id), status = req.body.status;
    if (!['active', 'paused'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    const key = db.prepare('SELECT id, value, reseller_id AS resellerId FROM keys WHERE id=?').get(id);
    if (!key) return res.status(404).json({ error: 'Key não encontrada.' });
    if (!canManageKey(req, key)) return res.status(404).json({ error: 'Key não encontrada neste acesso.' });
    const child = encodeURIComponent(key.value);
    const remote = await firebaseRequest(child);
    if (!remote) return res.status(404).json({ error: 'Key não encontrada no aplicativo externo.' });
    const connected = Boolean(remote.boundDeviceId || remote.deviceId);
    if (status === 'paused' && !connected) throw new Error('A key só pode ser pausada depois que o dispositivo se conectar no aplicativo.');
    await firebaseRequest(child, { method: 'PATCH', body: { paused: status === 'paused', status } });
    db.prepare('UPDATE keys SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(connected ? status : 'pending', id);
    audit(req.reseller?.username || req.session.user.username || 'Dono', status === 'paused' ? 'key_paused' : 'key_activated', { keyId: id });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/keys/:id', requireAuth, csrf, async (req, res) => {
  try {
    const id = Number(req.params.id); const key = db.prepare('SELECT value, reseller_id AS resellerId FROM keys WHERE id=?').get(id);
    if (!key) return res.status(404).json({ error: 'Key não encontrada.' });
    if (!canManageKey(req, key)) return res.status(404).json({ error: 'Key não encontrada neste acesso.' });
    await firebaseRequest(encodeURIComponent(key.value), { method: 'DELETE' });
    db.prepare('DELETE FROM keys WHERE id=?').run(id);
    audit(req.reseller?.username || req.session.user.username || 'Dono', 'key_deleted', { keyId: id, value: key.value });
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/app.js', (req, res) => res.type('application/javascript').sendFile(path.join(ROOT, 'app.js')));
app.get('/styles.css', (req, res) => res.type('text/css').sendFile(path.join(ROOT, 'styles.css')));
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erro interno. Consulte o log local do servidor.' });
});
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Painel disponível em http://${host}:${port}`));
})().catch(err => { console.error('Falha ao iniciar o painel:', err); process.exit(1); });
