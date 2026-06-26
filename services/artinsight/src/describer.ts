/**
 * Scene describers turn a captured screen frame into a spoken-language description.
 *
 * Strategy pattern: the service holds one {@link SceneDescriber} and never knows
 * whether it is a canned fake or a real vision model. The shell picks the
 * implementation from config/credentials and injects it, so the tile builds and
 * tests with no network and degrades gracefully when nothing is configured.
 */

import type { DisplayFrame } from '@aah/display-capture';

export interface SceneDescriber {
  describe(frame: DisplayFrame): Promise<string>;
}

/** Deterministic, network-free describer for tests and no-credentials boot. */
export class FakeSceneDescriber implements SceneDescriber {
  constructor(
    private readonly text = 'Screen description is unavailable; no vision model is configured.',
  ) {}

  async describe(_frame: DisplayFrame): Promise<string> {
    return this.text;
  }
}

export interface OpenAIVisionConfig {
  apiKey: string;
  /** Chat-completions model with vision input. Defaults to gpt-4o-mini. */
  model?: string;
  /** Override endpoint (e.g. an Azure OpenAI deployment URL). */
  endpoint?: string;
  /** System prompt steering the description toward accessibility. */
  prompt?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROMPT =
  'You describe images for blind and low-vision users. Give a concise, vivid ' +
  'description in 2-3 sentences. Lead with the subject, then notable details, ' +
  'colors, any visible text, and mood. Do not start with "this image shows".';

/**
 * Real describer backed by an OpenAI-compatible vision chat-completions endpoint.
 * The screen frame is sent inline as a base64 PNG data URL.
 */
export class OpenAIVisionDescriber implements SceneDescriber {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #prompt: string;
  readonly #fetch: typeof fetch;

  constructor(config: OpenAIVisionConfig) {
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? 'gpt-4o-mini';
    this.#endpoint = config.endpoint ?? 'https://api.openai.com/v1/chat/completions';
    this.#prompt = config.prompt ?? DEFAULT_PROMPT;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async describe(frame: DisplayFrame): Promise<string> {
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
          { role: 'system', content: this.#prompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe what is on the screen.' },
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
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('vision response contained no description');
    }
    return text;
  }
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
