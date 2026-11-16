#!/usr/bin/env node
/**
 * Study Deck admin/invite CLI.
 *
 *   node scripts/admin.mjs init   [--username NAME] [--remote]
 *   node scripts/admin.mjs reset  [--username NAME] [--remote]
 *   node scripts/admin.mjs invite [--uses N] [--days N] [--label TEXT] [--remote]
 *
 * Local D1 is the default; pass --remote to target the deployed database
 * (requires an authenticated Wrangler session). Passwords are prompted on a
 * hidden TTY and never appear in argv, logs or this source file.
 *
 * Creating the first admin is only possible through this CLI: the public
 * registration endpoint always creates role "user".
 */
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { ask, askHidden } from "./lib/prompt.mjs";
import { DATABASE_NAME, d1Execute, d1Query } from "./lib/wrangler.mjs";

const PBKDF2_ITERATIONS = 100_000;
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I L O U

function usage() {
  console.log(`Study Deck admin CLI (database: ${DATABASE_NAME})

  node scripts/admin.mjs init   [--username NAME] [--remote]
      Create an admin account (role is set by the CLI, never by signup).

  node scripts/admin.mjs reset  [--username NAME] [--remote]
      Reset an admin password and revoke all of its sessions.

  node scripts/admin.mjs invite [--uses N] [--days N] [--label TEXT] [--code CODE] [--remote]
      Mint an invite code, or register the supplied code. The code is stored only as a hash.

Options:
  --remote        Target the deployed D1 database (default: local).
  --username      Admin username (prompted when omitted).
  --uses          Invite uses, 1-1000 (default 1).
  --days          Invite lifetime in days, 1-3650 (default: never expires).
  --label         Human-readable invite label (for your own bookkeeping).
  --code          Custom invite code (3-64 letters, digits or hyphens).
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const body = token.slice(2);
    const equals = body.indexOf("=");
    if (equals !== -1) {
      args[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[body] = next;
      index++;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${base64Url(salt)}$${base64Url(
    new Uint8Array(bits),
  )}`;
}

function parseInteger(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  const text = String(value);
  if (!/^\d+$/.test(text)) fail(`${name} must be an integer`);
  const parsed = Number.parseInt(text, 10);
  if (parsed < min || parsed > max) fail(`${name} must be between ${min} and ${max}`);
  return parsed;
}

async function promptPassword() {
  const first = await askHidden("New password (hidden, 10+ chars): ");
  if ([...first].length < 10) fail("password must be at least 10 characters");
  if (new TextEncoder().encode(first).length > 1024) fail("password is too long");
  const second = await askHidden("Repeat password (hidden): ");
  if (first !== second) fail("passwords do not match");
  return first;
}

async function promptUsername(args) {
  const raw = typeof args.username === "string" ? args.username : await ask("Admin username: ");
  const username = raw.trim();
  if (!USERNAME_PATTERN.test(username)) {
    fail("username must be 3-32 characters of A-Z a-z 0-9 _ . -");
  }
  return { username, lower: username.toLowerCase() };
}

function generateInviteCode() {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  let body = "";
  for (const byte of bytes) body += BASE32_ALPHABET[byte % BASE32_ALPHABET.length];
  const groups = body.match(/.{1,4}/g) ?? [];
  return `SD-${groups.join("-")}`;
}

function targetLabel(remote) {
  return remote ? "REMOTE D1" : "local D1";
}

async function initAdmin(args) {
  const remote = Boolean(args.remote);
  const { username, lower } = await promptUsername(args);
  const password = await promptPassword();
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const id = randomUUID();

  d1Execute(
    `INSERT INTO users
       (id, username, username_lower, role, password_hash, password_changed_at, created_at, updated_at)
     VALUES (${sqlString(id)}, ${sqlString(username)}, ${sqlString(lower)},
             'admin', ${sqlString(passwordHash)}, ${now}, ${now}, ${now});`,
    { remote },
  );
  console.log(`Created admin "${username}" in ${targetLabel(remote)}.`);
}

async function resetAdmin(args) {
  const remote = Boolean(args.remote);
  const { username, lower } = await promptUsername(args);

  const rows = d1Query(
    `SELECT id, role FROM users WHERE username_lower = ${sqlString(lower)};`,
    { remote },
  );
  if (rows.length === 0) fail(`no user named "${username}" in ${targetLabel(remote)}`);
  if (rows[0].role !== "admin") {
    fail(`"${username}" is not an admin; this CLI only resets admin passwords`);
  }

  const password = await promptPassword();
  const passwordHash = await hashPassword(password);
  const now = Date.now();

  // password_changed_at invalidates every older session via the session query;
  // the DELETE additionally covers a session created in the same millisecond.
  d1Execute(
    `UPDATE users
     SET password_hash = ${sqlString(passwordHash)},
         password_changed_at = ${now},
         updated_at = ${now}
     WHERE username_lower = ${sqlString(lower)} AND role = 'admin';`,
    { remote },
  );
  d1Execute(
    `DELETE FROM sessions
     WHERE user_id IN (SELECT id FROM users WHERE username_lower = ${sqlString(lower)});`,
    { remote },
  );
  console.log(
    `Reset password for admin "${username}" in ${targetLabel(remote)}; all sessions revoked.`,
  );
}

async function createInvite(args) {
  const remote = Boolean(args.remote);
  const uses = parseInteger(args.uses, 1, 1, 1000, "uses");
  const days = parseInteger(args.days, null, 1, 3650, "days");
  const label = typeof args.label === "string" ? args.label.trim().slice(0, 64) : null;

  const code = typeof args.code === "string" ? args.code.trim().toUpperCase() : generateInviteCode();
  if (!/^[A-Z0-9-]{3,64}$/.test(code)) {
    fail("invite code must be 3-64 characters of A-Z 0-9 -");
  }
  const codeHash = sha256Hex(code);
  const now = Date.now();
  const expiresAt = days === null ? "NULL" : String(now + days * 86_400_000);

  d1Execute(
    `INSERT INTO invites (code_hash, label, max_uses, used_count, created_at, expires_at, created_by)
     VALUES (${sqlString(codeHash)}, ${label === null ? "NULL" : sqlString(label)},
             ${uses}, 0, ${now}, ${expiresAt}, NULL);`,
    { remote },
  );
  console.log(`Created invite in ${targetLabel(remote)} (uses: ${uses}${
    days === null ? "" : `, expires in ${days} day(s)`
  }).`);
  console.log("");
  console.log(`  ${code}`);
  console.log("");
  console.log("Store this code now: only its SHA-256 hash is kept, it cannot be shown again.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (args.help || command === "help" || command === undefined) {
    usage();
    if (command === undefined) process.exitCode = 1;
    return;
  }
  switch (command) {
    case "init":
      await initAdmin(args);
      return;
    case "reset":
      await resetAdmin(args);
      return;
    case "invite":
      await createInvite(args);
      return;
    default:
      fail(`unknown command "${command}" (expected init, reset or invite)`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
