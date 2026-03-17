import "dotenv/config";

const SEARCH_API_KEY = process.env.SEARCHAPI_API_KEY ?? "";

if (!SEARCH_API_KEY) {
  throw new Error("SEARCHAPI_API_KEY is required");
}

export type SearchResult = {
  title: string;
  link: string;
  snippet: string;
};

type SearchApiResponse = {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
};

export async function searchGoogle(query: string): Promise<SearchResult[]> {
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", SEARCH_API_KEY);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SearchAPI ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }

  const json = (await res.json()) as SearchApiResponse;
  const organic = json.organic_results ?? [];

  return organic
    .map((r) => ({
      title: r.title ?? "",
      link: r.link ?? "",
      snippet: r.snippet ?? ""
    }))
    .filter((r) => r.link);
}
