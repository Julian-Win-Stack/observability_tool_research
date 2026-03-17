type PerplexityConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt(): string {
  return [
    "You are an observability-tool researcher.",
    "Given a company name and domain, search for evidence of which observability, monitoring, or APM tools this company uses (e.g., Datadog, Grafana, New Relic, Prometheus, Splunk, Dynatrace, Elastic, PagerDuty, Honeycomb, Lightstep, etc.).",
    "",
    "Look at: job postings, vendor customer/case-study pages, tech blogs, conference talks, and press releases.",
    "",
    "Return your findings in this exact format (one line per tool found):",
    "",
    "Observability tool: <tool name> | Evidence URL: <url>",
    "Observability tool: <tool name> | Evidence URL: <url>",
    "",
    "If you cannot find ANY evidence (even uncertain), return exactly: Not found",
    "Do NOT add any extra commentary, headers, or markdown formatting."
  ].join("\n");
}

function buildUserPrompt(companyName: string, domain: string): string {
  return [`Company: ${companyName}`, `Domain: ${domain}`].join("\n");
}

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
};

function extractContent(json: ChatCompletionsResponse): string | null {
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed ? trimmed : null;
}

export async function researchCompany(
  companyName: string,
  domain: string,
  cfg: PerplexityConfig
): Promise<string> {
  const url = "https://api.perplexity.ai/chat/completions";
  const system = buildSystemPrompt();
  const user = buildUserPrompt(companyName, domain);

  const body = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const backoffsMs = [1000, 2000, 4000];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < backoffsMs.length; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Perplexity API ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
        );
      }

      const json = (await res.json()) as ChatCompletionsResponse;
      const content = extractContent(json);
      if (!content) throw new Error("Perplexity response missing message content");
      return content;
    } catch (err) {
      lastError = err;
      await sleep(backoffsMs[attempt]);
    }
  }

  const msg =
    lastError instanceof Error ? lastError.message : "Unknown error calling Perplexity";
  return `Error: ${msg}`;
}

