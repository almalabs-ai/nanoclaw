import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export interface TranscribeResult {
  transcript?: string;
  error?: string;
}

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

export async function transcribeAudioFile(
  hostPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<TranscribeResult> {
  const env = readEnvFile(['OPENAI_API_KEY']);
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn({ hostPath }, 'Transcription skipped: OPENAI_API_KEY not set');
    return { error: 'OPENAI_API_KEY not set' };
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(hostPath);
  } catch (err) {
    logger.error(
      { hostPath, err },
      'Failed to read audio file for transcription',
    );
    return { error: `Failed to read audio file: ${String(err)}` };
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    logger.debug({ hostPath }, 'Transcribing audio via Whisper API');
    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), path.basename(hostPath));
    form.append('model', 'whisper-1');

    const resp = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.warn(
        { hostPath, status: resp.status },
        'Whisper API returned error',
      );
      return { error: `Whisper API error ${resp.status}: ${text}` };
    }

    const json = (await resp.json()) as { text: string };
    logger.info(
      { hostPath, chars: json.text.length },
      'Audio transcribed successfully',
    );
    return { transcript: json.text };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn({ hostPath, timeoutMs }, 'Whisper API request timed out');
      return { error: `Transcription timed out after ${timeoutMs}ms` };
    }
    logger.error({ hostPath, err }, 'Whisper API request failed');
    return { error: String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}
