import "dotenv/config";

export type ServerConfig = {
  apiKey: string;
  baseUrl: string;
  nameColumn: string;
  domainColumn: string;
  model: string;
  maxCompletionTokens: number;
};

function requireEnv(name: string): string {
  const val = (process.env[name] ?? "").trim();
  if (!val) throw new Error(`${name} is required`);
  return val;
}

export function loadServerConfig(): ServerConfig {
  return {
    apiKey: requireEnv("AZURE_OPENAI_API_KEY"),
    baseUrl: requireEnv("AZURE_OPENAI_BASE_URL"),
    nameColumn: process.env.NAME_COLUMN ?? "Company Name",
    domainColumn: process.env.DOMAIN_COLUMN ?? "Website",
    model: process.env.MODEL ?? "gpt-5.4",
    maxCompletionTokens: Number(process.env.MAX_COMPLETION_TOKENS ?? "2048")
  };
}
