import { createHash } from 'node:crypto';
import {
  authenticateHttpBearer,
  parseHttpClientTokenHashes,
} from '../src/http-client-auth.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('HTTP MCP bearer authentication', () => {
  const jeffToken = 'test-token-for-jeff-that-is-long-and-random-enough';
  const alexToken = 'test-token-for-alex-that-is-long-and-random-enough';

  it('matches a bearer token to its caller without storing the raw token', () => {
    const records = parseHttpClientTokenHashes(
      `jeff=${sha256(jeffToken)},alex=${sha256(alexToken)}`
    );

    expect(records).toHaveLength(2);
    expect(records[0]?.hash.toString('hex')).toBe(sha256(jeffToken));
    expect(records[0]?.hash.toString('utf8')).not.toContain(jeffToken);
    expect(authenticateHttpBearer(`Bearer ${alexToken}`, records)).toEqual({
      callerId: 'alex',
    });
  });

  it.each([
    undefined,
    '',
    'Basic abc123',
    'Bearer',
    'Bearer wrong-token',
    ['Bearer duplicated', 'Bearer duplicated'],
  ])('rejects a missing or invalid Authorization value', (authorization) => {
    const records = parseHttpClientTokenHashes(`jeff=${sha256(jeffToken)}`);
    expect(authenticateHttpBearer(authorization, records)).toBeUndefined();
  });

  it('rejects malformed hashes, duplicate callers, and reused hashes', () => {
    expect(() => parseHttpClientTokenHashes('bad caller=abc')).toThrow('Invalid MCP bearer caller ID');
    expect(() => parseHttpClientTokenHashes('jeff=abc')).toThrow('Invalid MCP bearer token hash');
    expect(() =>
      parseHttpClientTokenHashes(`jeff=${sha256(jeffToken)},jeff=${sha256(alexToken)}`)
    ).toThrow('Duplicate MCP bearer caller ID');
    expect(() =>
      parseHttpClientTokenHashes(`jeff=${sha256(jeffToken)},alex=${sha256(jeffToken)}`)
    ).toThrow('cannot be assigned to multiple callers');
  });
});
