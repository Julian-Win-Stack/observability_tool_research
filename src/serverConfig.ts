import "dotenv/config";

export type ServerConfig = {
  apiKey: string;
  nameColumn: string;
  domainColumn: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

function requireEnv(name: string): string {
  const val = (process.env[name] ?? "").trim();
  if (!val) throw new Error(`${name} is required`);
  return val;
}

export function loadServerConfig(): ServerConfig {
  return {
    apiKey: requireEnv("PERPLEXITY_API_KEY"),
    nameColumn: process.env.NAME_COLUMN ?? "Company Name",
    domainColumn: process.env.DOMAIN_COLUMN ?? "Website",
    model: process.env.MODEL ?? "sonar-reasoning-pro",
    temperature: Number(process.env.TEMPERATURE ?? "0.1"),
    maxTokens: Number(process.env.MAX_TOKENS ?? "2048")
  };
}
