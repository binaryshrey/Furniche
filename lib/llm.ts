import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

const MODEL = 'claude-opus-5-5';

let client: Anthropic | null = null;

export function llmAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// One structured-output call. Returns null when no key is configured or the model declines,
// so every caller has a non-AI fallback.
export async function structured<T extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: T;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}): Promise<z.infer<T> | null> {
  if (!llmAvailable()) return null;
  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      output_config: { format: zodOutputFormat(opts.schema), effort: opts.effort ?? 'medium' },
    });
    if (response.stop_reason === 'refusal') return null;
    return (response.parsed_output as z.infer<T> | null) ?? null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error('[llm] invalid API key');
    else if (error instanceof Anthropic.RateLimitError) console.error('[llm] rate limited');
    else if (error instanceof Anthropic.APIError) console.error(`[llm] API error ${error.status}: ${error.message}`);
    else console.error('[llm] request failed', error);
    return null;
  }
}
