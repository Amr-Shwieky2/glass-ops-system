import "server-only";

/**
 * Small, swappable text-generation abstraction for the AI quote-drafting
 * feature (see src/server/ai/quote-generator.ts). Deliberately minimal —
 * a single-turn system+user prompt in, a raw text string out — so the one
 * implementation below (a locally self-hosted Ollama server) could later be
 * replaced by a different provider without touching any caller.
 *
 * NO PAID AI API IS USED ANYWHERE IN THIS APP: there is no API key for any
 * hosted LLM provider configured on this machine, and none should ever be
 * assumed. callOllama talks to Ollama (https://ollama.com), which is free,
 * requires no account, and runs entirely on infrastructure the operator
 * controls — see .env.example for the two environment variables that
 * configure it and how to install/run it.
 */

export interface GenerateTextParams {
  systemPrompt: string;
  userPrompt: string;
  /** When true, asks the provider to constrain decoding to syntactically
   * valid JSON (Ollama's `format: "json"` request field — grammar-
   * constrained generation, not just a prompt instruction). This only
   * guarantees well-formed JSON, not that it matches any particular
   * schema, so callers must still validate the parsed shape themselves;
   * it does materially cut down on the most common local-model failure
   * mode (stray unescaped quotes, trailing commas, prose wrapped around
   * the object) without needing the model to reliably follow a "return
   * only JSON" instruction on its own. */
  jsonMode?: boolean;
}

/** Thrown by callOllama on any failure reaching or getting a valid
 * response from the model — network error, non-200, or a malformed
 * response body. Callers catch this specifically and turn it into a clear
 * Arabic user-facing message; it must never surface as a raw stack trace
 * in the UI. */
export class AiProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AiProviderError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

function ollamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
}

/**
 * The model to use, defaulting to "qwen2.5:3b" — a small (~1.9GB),
 * genuinely free, locally-run model that is a well-known entry in
 * Ollama's public library (`ollama pull qwen2.5:3b`). Chosen after
 * actually testing both this and the llama3.2:3b family against this
 * feature's real Hebrew-JSON prompts on this machine: llama3.2 produced
 * incoherent, mis-tokenized Hebrew and invalid JSON on every attempt
 * (Meta's official language list for Llama 3.2 does not include Hebrew,
 * and in practice it shows), while qwen2.5:3b — whose official language
 * list also omits Hebrew, but whose tokenizer and pretraining handle it
 * far better in practice — produced syntactically valid, parseable JSON
 * on every attempt once the prompt told it not to embed literal quote
 * marks inside string values (Hebrew's ש"מ-style abbreviations otherwise
 * broke JSON parsing) — though in practice the model still ignores that
 * instruction often enough that src/server/ai/quote-generator.ts's parser
 * additionally repairs stray unescaped quotes inside string values rather
 * than relying on prompting alone. Content quality on a 3B model is still
 * modest (occasional stray words in another language, or a failed
 * generation that needs a retry), which is exactly why this feature is
 * draft-assist only, reviewed by a human before saving.
 * The provider itself is model-agnostic — swapping OLLAMA_MODEL to a
 * larger qwen2.5 tag (e.g. qwen2.5:7b) needs no code change here if
 * content quality ever needs to improve and the extra RAM is available.
 */
function ollamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || "qwen2.5:3b";
}

/** How long to wait for Ollama before giving up, in ms. A hung (not
 * merely down) Ollama server previously left a generation request pending
 * indefinitely with just a spinner — this bounds it so it always resolves
 * into the same clear Arabic error as every other failure mode. */
function ollamaTimeoutMs(): number {
  const raw = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 45_000;
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

/**
 * Calls Ollama's /api/generate — the single-turn "system + prompt in, one
 * completion out" endpoint, which fits this feature's shape more directly
 * than /api/chat's multi-message history (checked against Ollama's
 * documented API: /api/generate accepts a top-level `system` field
 * alongside `prompt`, exactly this shape, with stream:false returning the
 * full response in one JSON object rather than a line-delimited stream).
 */
export async function callOllama(params: GenerateTextParams): Promise<string> {
  const url = `${ollamaBaseUrl()}/api/generate`;
  const timeoutMs = ollamaTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel(),
        system: params.systemPrompt,
        prompt: params.userPrompt,
        stream: false,
        ...(params.jsonMode ? { format: "json" } : {}),
        // Lower temperature than Ollama's default (0.8): this feature
        // wants a consistent, well-formed structured document, not
        // creative variation, and a lower temperature measurably reduces
        // both malformed JSON and garbled mixed-script content on small
        // local models.
        options: { temperature: 0.3 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiProviderError(
        `Ollama at ${url} did not respond within ${timeoutMs}ms (hung or overloaded).`,
        { cause: err },
      );
    }
    throw new AiProviderError(
      `Failed to reach Ollama at ${url}. Is Ollama installed and running?`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new AiProviderError(
      `Ollama returned HTTP ${res.status} from ${url}: ${bodyText.slice(0, 500)}`,
    );
  }

  let data: OllamaGenerateResponse;
  try {
    data = (await res.json()) as OllamaGenerateResponse;
  } catch (err) {
    throw new AiProviderError("Ollama returned a response that was not valid JSON.", {
      cause: err,
    });
  }

  if (typeof data.response !== "string") {
    throw new AiProviderError(
      `Ollama response was missing the expected "response" field: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }

  return data.response;
}

/** The provider interface every caller programs against. */
export type GenerateText = (params: GenerateTextParams) => Promise<string>;

/** The active implementation — swap this line to change provider globally. */
export const generateText: GenerateText = callOllama;
