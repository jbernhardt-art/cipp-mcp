import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/manage-http-callers.mjs');

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function run(args: string[]) {
  return execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

describe('HTTP caller token management script', () => {
  let directory: string;
  let envFile: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cipp-callers-'));
    envFile = join(directory, '.env');
    writeFileSync(envFile, `EXISTING=value\nMCP_HTTP_BEARER_TOKEN_HASHES=jeff=${hash('jeff-token')}\n`);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('adds a caller while writing the raw token only to the requested file', () => {
    const tokenFile = join(directory, 'private', 'maricel.token');
    const output = run([
      'add',
      'maricel',
      '--env-file',
      envFile,
      '--token-file',
      tokenFile,
    ]);
    const token = readFileSync(tokenFile, 'utf8').trim();
    const env = readFileSync(envFile, 'utf8');

    expect(token).toHaveLength(64);
    expect(output).not.toContain(token);
    expect(env).not.toContain(token);
    expect(env).toContain(`maricel=${hash(token)}`);
    expect(env).toContain(`jeff=${hash('jeff-token')}`);
  });

  it('rotates one caller without changing other callers', () => {
    const firstFile = join(directory, 'maricel.token');
    run(['add', 'maricel', '--env-file', envFile, '--token-file', firstFile]);
    const firstToken = readFileSync(firstFile, 'utf8').trim();
    const replacementFile = join(directory, 'maricel-replacement.token');
    run(['rotate', 'maricel', '--env-file', envFile, '--token-file', replacementFile]);
    const replacementToken = readFileSync(replacementFile, 'utf8').trim();
    const env = readFileSync(envFile, 'utf8');

    expect(replacementToken).not.toBe(firstToken);
    expect(env).not.toContain(hash(firstToken));
    expect(env).toContain(`maricel=${hash(replacementToken)}`);
    expect(env).toContain(`jeff=${hash('jeff-token')}`);
  });

  it('revokes only the selected caller and lists remaining caller IDs', () => {
    const tokenFile = join(directory, 'kevin.token');
    run(['add', 'kevin', '--env-file', envFile, '--token-file', tokenFile]);
    run(['revoke', 'kevin', '--env-file', envFile]);

    const env = readFileSync(envFile, 'utf8');
    const list = run(['list', '--env-file', envFile]);
    expect(env).not.toContain('kevin=');
    expect(env).toContain('jeff=');
    expect(list.trim()).toBe('jeff');
  });
});
