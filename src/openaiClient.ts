import { searchGoogle, type SearchResult } from "./searchApiClient.js";

type OpenAIConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt(): string {
  return [
    "You are an observability-tool judge.",
    "You are given a company and a list of candidate web pages (URLs and snippets).",
    "Your job is to decide, based ONLY on those pages, which observability, monitoring, logging, or APM tools this company actually uses.",
    "",
    "IMPORTANT:",
    "- Do NOT invent tools or URLs.",
    '- If the evidence is ambiguous or weak, you may mark a tool as "(low confidence)".',
    '- If none of the pages clearly mention an observability/monitoring/APM tool, return exactly: Not found',
    "",
    "Output format (no markdown, no brackets, numbered list):",
    "1. <tool name> : https://example.com/path",
    "2. <tool name> : https://example.com/path",
    "3. <tool name> : https://example.com/path",
    "",
    "Only return up to 3 tools.",
    "It is better to return 'Not found' than to guess.",
  ].join("\n");
}

function buildUserPrompt(
  companyName: string,
  domain: string,
  candidates: SearchResult[]
): string {
  const lines = [
    `Company name: ${companyName}`,
    `Company domain: ${domain}`,
    "",
    "Here are candidate pages that may contain evidence of observability/monitoring/APM tools:"
  ];

  if (candidates.length === 0) {
    lines.push("- (no candidate pages were found)");
  } else {
    for (const c of candidates) {
      lines.push(`- URL: ${c.link}`);
      if (c.title) lines.push(`  Title: ${c.title}`);
      if (c.snippet) lines.push(`  Snippet: ${c.snippet}`);
      lines.push("");
    }
  }

  lines.push(
    "",
    "From ONLY this evidence, decide which observability/monitoring/logging/APM tools this company uses.",
    "If none of the pages clearly indicate a tool, return exactly: Not found."
  );

  return lines.join("\n");
}

function cleanDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "");
}

function buildQueries(companyName: string, companyDomain: string): string[] {
  return [
    `${companyName} ${companyDomain} Datadog OR "Grafana" OR "New Relic" OR "Prometheus" OR "Splunk" OR "Dynatrace" OR "Elastic" OR "PagerDuty" OR "Honeycomb" OR "Observability Tool"`
  ];
}

async function gatherSearchCandidates(
  companyName: string,
  companyDomain: string
): Promise<SearchResult[]> {
  const queries = buildQueries(companyName, companyDomain);
  const allResults: SearchResult[] = [];

  for (const q of queries) {
    try {
      const results = await searchGoogle(q);
      allResults.push(...results);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[search-api] Query failed: ${q} (${message})`);
    }
  }

  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (!r.link || seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });

  return unique.slice(0, 10);
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
  cfg: OpenAIConfig
): Promise<string> {
  const url = `${cfg.baseUrl}/chat/completions`;
  const companyDomain = cleanDomain(domain);
  const candidates = await gatherSearchCandidates(companyName, companyDomain);
  const system = buildSystemPrompt();
  const user = buildUserPrompt(companyName, companyDomain, candidates);

  const body = {
    model: cfg.model,
    max_completion_tokens: cfg.maxCompletionTokens,
    stream: false,
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
          "api-key": cfg.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `OpenAI API ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
        );
      }

      const json = (await res.json()) as ChatCompletionsResponse;
      const content = extractContent(json);
      if (!content) throw new Error("OpenAI response missing message content");
      return content;
    } catch (err) {
      lastError = err;
      await sleep(backoffsMs[attempt]);
    }
  }

  const msg =
    lastError instanceof Error ? lastError.message : "Unknown error calling OpenAI";
  return `Error: ${msg}`;
}

