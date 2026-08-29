#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CALLER_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const ENV_KEY = 'MCP_HTTP_BEARER_TOKEN_HASHES';

function usage() {
  return `Usage:
  node scripts/manage-http-callers.mjs list [--env-file .env]
  node scripts/manage-http-callers.mjs add <caller> --token-file <path> [--env-file .env]
  node scripts/manage-http-callers.mjs rotate <caller> --token-file <path> [--env-file .env]
  node scripts/manage-http-callers.mjs revoke <caller> [--env-file .env]

Raw tokens are generated internally and written only to the requested mode-600 token file.
The environment file stores only caller IDs and SHA-256 token hashes.`;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function validateCaller(caller) {
  if (!CALLER_PATTERN.test(caller ?? '')) {
    throw new Error(
      'Caller ID must contain 1-128 letters, numbers, dots, underscores, @ signs, or hyphens.'
    );
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnv(envFile) {
  if (!existsSync(envFile)) throw new Error(`Environment file not found: ${envFile}`);
  const content = readFileSync(envFile, 'utf8');
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.startsWith(`${ENV_KEY}=`));
  const rawValue = lineIndex === -1 ? '' : unquote(lines[lineIndex].slice(ENV_KEY.length + 1));
  const records = new Map();

  for (const rawRecord of rawValue.split(',').map((record) => record.trim()).filter(Boolean)) {
    const separator = rawRecord.indexOf('=');
    const caller = separator === -1 ? '' : rawRecord.slice(0, separator).trim();
    const hash = separator === -1 ? '' : rawRecord.slice(separator + 1).trim().toLowerCase();
    validateCaller(caller);
    if (!HASH_PATTERN.test(hash)) {
      throw new Error(`Invalid SHA-256 hash stored for caller ${caller}.`);
    }
    if (records.has(caller)) throw new Error(`Duplicate caller stored in ${ENV_KEY}: ${caller}`);
    records.set(caller, hash);
  }

  return { content, newline, lines, lineIndex, records };
}

function saveEnv(envFile, loaded) {
  const serialized = [...loaded.records.entries()]
    .map(([caller, hash]) => `${caller}=${hash}`)
    .join(',');
  if (loaded.lineIndex === -1) {
    if (loaded.lines.at(-1) === '') loaded.lines.pop();
    loaded.lines.push(`${ENV_KEY}=${serialized}`, '');
  } else {
    loaded.lines[loaded.lineIndex] = `${ENV_KEY}=${serialized}`;
  }

  const temporaryFile = `${envFile}.${process.pid}.tmp`;
  const mode = statSync(envFile).mode & 0o777;
  try {
    writeFileSync(temporaryFile, loaded.lines.join(loaded.newline), {
      encoding: 'utf8',
      mode,
      flag: 'wx',
    });
    chmodSync(temporaryFile, mode);
    renameSync(temporaryFile, envFile);
  } finally {
    if (existsSync(temporaryFile)) unlinkSync(temporaryFile);
  }
}

function createTokenFile(tokenFile, token) {
  const parent = dirname(tokenFile);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  chmodSync(tokenFile, 0o600);
}

export function run(argv) {
  const [command, caller] = argv;
  const envFile = resolve(option(argv, '--env-file') ?? '.env');
  const loaded = loadEnv(envFile);

  if (command === 'list') {
    console.log([...loaded.records.keys()].sort().join('\n'));
    return;
  }

  validateCaller(caller);

  if (command === 'revoke') {
    if (!loaded.records.delete(caller)) throw new Error(`Caller does not exist: ${caller}`);
    saveEnv(envFile, loaded);
    console.log(`Revoked caller: ${caller}`);
    return;
  }

  if (command !== 'add' && command !== 'rotate') throw new Error(usage());
  if (command === 'add' && loaded.records.has(caller)) {
    throw new Error(`Caller already exists: ${caller}. Use rotate to replace its token.`);
  }
  if (command === 'rotate' && !loaded.records.has(caller)) {
    throw new Error(`Caller does not exist: ${caller}. Use add to create it.`);
  }

  const tokenFileOption = option(argv, '--token-file');
  if (!tokenFileOption) throw new Error('--token-file is required for add and rotate.');
  const tokenFile = resolve(tokenFileOption);
  const token = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');

  createTokenFile(tokenFile, token);
  try {
    loaded.records.set(caller, hash);
    saveEnv(envFile, loaded);
  } catch (error) {
    unlinkSync(tokenFile);
    throw error;
  }

  console.log(`${command === 'add' ? 'Added' : 'Rotated'} caller: ${caller}`);
  console.log(`Raw token written to: ${tokenFile}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
