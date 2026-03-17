type PerplexityConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  searchType: "auto" | "pro";
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt(): string {
  return [
    "You are an observability-tool researcher.",
    "Given a company name and domain, search for evidence of which observability, monitoring, logging, or APM tools this company uses (e.g., Datadog, Grafana, New Relic, Prometheus, Splunk, Dynatrace, Elastic, PagerDuty, Honeycomb, Lightstep, etc.).",
    "",
    "First, search the web for real pages mentioning BOTH the company and an observability / monitoring / logging / APM tool.",
    "For each candidate page, check that:",
    "- The URL is reachable (not 404).",
    "- The page is actually about the company AND the tool.",
    "",
    "IMPORTANT URL RULES:",
    " - You must ONLY return URLs that actually exist on the live web.",
    " - NEVER invent or guess URLs (do NOT make up slugs or IDs like /job/123456).",
    " - If you are not sure a URL exists, do NOT output it.",
    " - Every line you output MUST include a URL.",
    "",
    "Return your findings in this exact format (one line per tool found).",
    "",
    "Example:",
    "Observability tool: Datadog | Evidence URL: https://jobs.ashbyhq.com/cointracker/sre-role-mentions-datadog",
    "",
    "Output format (no markdown, no brackets, no extra text):",
    "Observability tool: <tool name> | Evidence URL: https://example.com/path",
    "",
    "When answering:",
    "Only return up to 3 tools.",
    "If you find strong evidence (clear, direct mention of the company using the tool), output it as specified.",
    'If evidence is weak or indirect (for example a job posting or blog suggests the tool but is not fully explicit), you may still output it but include "(low confidence)" after the tool name.',
    'If, after searching, you cannot find any valid URLs that plausibly mention BOTH the company and an observability/monitoring/logging/APM tool, then return exactly: Not found.',
    "Do NOT add any extra commentary, headers, or markdown formatting."
  ].join("\n");
}

function buildUserPrompt(companyName: string, domain: string): string {
  return [
    `Company name: ${companyName}`,
    `Company domain: ${domain}`,
    "",
    "Task: Identify any observability, monitoring, logging, or APM tools this company uses.",
    "Search the web and check: job postings, vendor customer/case-study pages, tech blogs, conference talks, and press releases.",
    "If you find signals, extract the specific tool name and the most direct evidence URL."
  ].join("\n");
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
    enable_search_classifier: true,
    disable_search: false,
    stream: false,
    web_search_options: {
      search_type: cfg.searchType
    },
    search_language_filter: ["en"],
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

