import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(),
}));
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { readEnvFile } from './env.js';
import { transcribeAudioFile } from './transcription.js';

const mockReadEnvFile = vi.mocked(readEnvFile);

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

describe('transcribeAudioFile', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `test-audio-${Date.now()}.ogg`);
    fs.writeFileSync(tmpFile, Buffer.from('fake audio bytes'));
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns error when OPENAI_API_KEY is not set', async () => {
    mockReadEnvFile.mockReturnValue({});

    const result = await transcribeAudioFile(tmpFile);

    expect(result.error).toMatch(/OPENAI_API_KEY/);
    expect(result.transcript).toBeUndefined();
  });

  it('returns error when audio file does not exist', async () => {
    mockReadEnvFile.mockReturnValue({ OPENAI_API_KEY: 'sk-test' });

    const result = await transcribeAudioFile('/tmp/no-such-file-12345.ogg');

    expect(result.error).toBeDefined();
    expect(result.transcript).toBeUndefined();
  });

  it('POSTs multipart/form-data to Whisper API with bearer auth', async () => {
    mockReadEnvFile.mockReturnValue({ OPENAI_API_KEY: 'sk-test-key' });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await transcribeAudioFile(tmpFile);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(WHISPER_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer sk-test-key');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('returns transcript on successful API call', async () => {
    mockReadEnvFile.mockReturnValue({ OPENAI_API_KEY: 'sk-test' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'привет как дела' }),
      }),
    );

    const result = await transcribeAudioFile(tmpFile);

    expect(result.transcript).toBe('привет как дела');
    expect(result.error).toBeUndefined();
  });

  it('returns error on non-ok HTTP response', async () => {
    mockReadEnvFile.mockReturnValue({ OPENAI_API_KEY: 'sk-test' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }),
    );

    const result = await transcribeAudioFile(tmpFile);

    expect(result.error).toMatch(/401/);
    expect(result.transcript).toBeUndefined();
  });

  it('returns error on timeout', async () => {
    mockReadEnvFile.mockReturnValue({ OPENAI_API_KEY: 'sk-test' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = Object.assign(
                new Error('This operation was aborted'),
                {
                  name: 'AbortError',
                },
              );
              reject(err);
            });
          }),
      ),
    );

    const result = await transcribeAudioFile(tmpFile, { timeoutMs: 50 });

    expect(result.error).toMatch(/timed out|timeout|abort/i);
    expect(result.transcript).toBeUndefined();
  });
});
