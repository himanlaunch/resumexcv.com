import OpenAI from "openai";

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const digitalOceanApiKey = process.env.DIGITALOCEAN_TOKEN?.trim();

export const usingOpenRouter = Boolean(openRouterApiKey);

export const resumeCustomizationModel = usingOpenRouter
  ? process.env.OPENROUTER_MODEL?.trim() || "~anthropic/claude-sonnet-latest"
  : process.env.DIGITALOCEAN_MODEL?.trim();

export const fastLlmModel = usingOpenRouter
  ? process.env.OPENROUTER_FAST_MODEL?.trim() || "openai/gpt-5.6-luna"
  : process.env.DIGITALOCEAN_MODEL?.trim();

const fallbackModel =
  process.env.OPENROUTER_FALLBACK_MODEL?.trim() || "openai/gpt-5.6-terra";

export const llm = new OpenAI({
  apiKey: openRouterApiKey || digitalOceanApiKey || "missing-api-key",
  baseURL: usingOpenRouter
    ? "https://openrouter.ai/api/v1"
    : "https://inference.do-ai.run/v1",
  defaultHeaders: usingOpenRouter
    ? {
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL?.trim() || "https://resumex100.com",
        "X-OpenRouter-Title":
          process.env.OPENROUTER_SITE_NAME?.trim() || "ResumeX100",
      }
    : undefined,
});

/**
 * OpenRouter-only request fields. Resume content contains personal data, so
 * every request is restricted to zero-data-retention endpoints that deny data
 * collection. Structured workflows also require response-format support.
 */
export function openRouterRouting({
  structured = false,
}: {
  structured?: boolean;
} = {}): Record<string, unknown> {
  if (!usingOpenRouter) return {};

  return {
    models: [fallbackModel],
    provider: {
      zdr: true,
      data_collection: "deny",
      ...(structured ? { require_parameters: true } : {}),
    },
  };
}

export function llmProviderLabel(): string {
  return usingOpenRouter ? "OpenRouter" : "DigitalOcean";
}
