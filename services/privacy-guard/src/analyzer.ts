/**
 * Share analyzers turn a captured screen frame into a {@link ShareScene} the pure
 * detectors can judge.
 *
 * Strategy pattern (mirrors ArtInSight's `SceneDescriber`): the service holds one
 * {@link ShareAnalyzer} and never knows whether it is a canned fake or a real vision
 * model. The shell picks the implementation from config/credentials and injects it,
 * so the tile builds and tests with no network and degrades gracefully when nothing
 * is configured.
 */

import type { DisplayFrame } from '@aah/display-capture';
import { shareScene, type ShareScene } from './detectors.js';

export interface ShareAnalyzer {
  /** Describe a captured frame for privacy scanning, or `null` if nothing to scan. */
  analyze(frame: DisplayFrame): Promise<ShareScene | null>;
}

/**
 * Deterministic, network-free analyzer for tests and no-credentials boot.
 *
 * Returns a fixed scene (an empty, safe-to-share screenshot by default), so the
 * pipeline runs end to end with no vision model — it simply never finds anything
 * until a real {@link ShareAnalyzer} is injected.
 */
export class FakeShareAnalyzer implements ShareAnalyzer {
  readonly #scene: ShareScene;

  constructor(scene: Partial<ShareScene> = {}) {
    this.#scene = shareScene({ source: 'screenshot', isScreenCapture: true, ...scene });
  }

  async analyze(_frame: DisplayFrame): Promise<ShareScene | null> {
    return this.#scene;
  }
}

export interface OpenAIVisionShareConfig {
  apiKey: string;
  /** Chat-completions model with vision input. Defaults to gpt-4o-mini. */
  model?: string;
  /** Override endpoint (e.g. an Azure OpenAI deployment URL, or a local server). */
  endpoint?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const VISION_PROMPT =
  'You audit screenshots for private information BEFORE a blind user shares them. ' +
  'Read every piece of visible on-screen text verbatim (especially passwords, API ' +
  'keys, tokens, card numbers, government IDs, emails, and phone numbers) and count ' +
  'recognizable human faces. Respond ONLY with strict minified JSON of the form ' +
  '{"text": string, "faceCount": number}. Put all readable text in "text"; use an ' +
  'empty string and 0 when there is none.';

/**
 * Real analyzer backed by an OpenAI-compatible vision chat-completions endpoint. The
 * screen frame is sent inline as a base64 PNG data URL; the model returns the visible
 * text + face count, which the pure detectors then judge. Location metadata is not
 * recoverable from pixels, so it is reported as absent (honest, not inferred).
 */
export class OpenAIVisionShareAnalyzer implements ShareAnalyzer {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(config: OpenAIVisionShareConfig) {
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? 'gpt-4o-mini';
    this.#endpoint = config.endpoint ?? 'https://api.openai.com/v1/chat/completions';
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async analyze(frame: DisplayFrame): Promise<ShareScene | null> {
    const dataUrl = `data:image/png;base64,${toBase64(frame.data)}`;
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.#model,
        messages: [
          { role: 'system', content: VISION_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Audit this screen for private information.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`vision request failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('vision response contained no content');
    return parseScene(content);
  }
}

/** Parse the model's JSON reply into a {@link ShareScene}, tolerating fenced code. */
function parseScene(content: string): ShareScene {
  const jsonText = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: { text?: unknown; faceCount?: unknown };
  try {
    parsed = JSON.parse(jsonText) as { text?: unknown; faceCount?: unknown };
  } catch {
    // The model ignored the JSON instruction; treat the whole reply as read text so
    // text-pattern detectors still get a chance rather than silently passing.
    return shareScene({ source: 'screenshot', isScreenCapture: true, text: content });
  }
  const faceCount = typeof parsed.faceCount === 'number' ? Math.max(0, Math.trunc(parsed.faceCount)) : 0;
  return shareScene({
    source: 'screenshot',
    isScreenCapture: true,
    text: typeof parsed.text === 'string' ? parsed.text : '',
    faceCount,
  });
}

/** Base64-encode bytes without Node's Buffer (works anywhere lib=DOM provides btoa). */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
