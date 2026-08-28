import { createHash, timingSafeEqual } from 'node:crypto';

export interface HttpClientIdentity {
  callerId: string;
}

export interface HttpClientTokenHash {
  callerId: string;
  hash: Buffer;
}

const CALLER_ID_PATTERN = /^[A-Za-z0-9._@-]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * Parse `caller=<sha256>,caller2=<sha256>` into validated token records.
 * Only token hashes are stored by the server. Raw bearer tokens never belong
 * in this setting.
 */
export function parseHttpClientTokenHashes(value: string | undefined): HttpClientTokenHash[] {
  if (!value?.trim()) return [];

  const callers = new Set<string>();
  const hashes = new Set<string>();

  return value.split(',').map((entry) => {
    const separator = entry.indexOf('=');
    const callerId = separator === -1 ? '' : entry.slice(0, separator).trim();
    const hashHex = separator === -1 ? '' : entry.slice(separator + 1).trim().toLowerCase();

    if (!CALLER_ID_PATTERN.test(callerId)) {
      throw new Error(
        `Invalid MCP bearer caller ID "${callerId}". Use 1-128 letters, numbers, dot, underscore, @, or hyphen.`
      );
    }
    if (!SHA256_PATTERN.test(hashHex)) {
      throw new Error(
        `Invalid MCP bearer token hash for caller "${callerId}". Expected exactly 64 hexadecimal SHA-256 characters.`
      );
    }
    if (callers.has(callerId)) {
      throw new Error(`Duplicate MCP bearer caller ID "${callerId}".`);
    }
    if (hashes.has(hashHex)) {
      throw new Error('The same MCP bearer token hash cannot be assigned to multiple callers.');
    }

    callers.add(callerId);
    hashes.add(hashHex);
    return { callerId, hash: Buffer.from(hashHex, 'hex') };
  });
}

/** Authenticate one standard HTTP Authorization bearer value. */
export function authenticateHttpBearer(
  authorization: string | string[] | undefined,
  tokenHashes: readonly HttpClientTokenHash[]
): HttpClientIdentity | undefined {
  if (typeof authorization !== 'string') return undefined;

  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match?.[1]) return undefined;

  const presentedHash = createHash('sha256').update(match[1], 'utf8').digest();
  for (const record of tokenHashes) {
    if (record.hash.length === presentedHash.length && timingSafeEqual(record.hash, presentedHash)) {
      return { callerId: record.callerId };
    }
  }
  return undefined;
}
