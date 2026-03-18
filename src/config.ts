import "dotenv/config";
import { Command } from "commander";

export type AppConfig = {
  apiKey: string;
  baseUrl: string;
  inputPath: string;
  outputPath: string;
  nameColumn: string;
  domainColumn: string;
  model: string;
  maxCompletionTokens: number;
};

function requireNonEmpty(value: string | undefined, name: string): string {
  const v = (value ?? "").trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function loadConfig(argv = process.argv): AppConfig {
  const program = new Command();

  program
    .name("observability-tool-research")
    .description(
      "Enrich companies in a CSV with observability-tool evidence via OpenAI."
    )
    .requiredOption("-i, --input <path>", "Input CSV path")
    .option("-o, --output <path>", "Output CSV path", "output.csv")
    .option(
      "--name-column <header>",
      "CSV header for company name",
      "Company Name"
    )
    .option(
      "--domain-column <header>",
      "CSV header for company domain/website",
      "Company Domain"
    )
    .option("--model <name>", "OpenAI model name", "o4-mini")
    .option("--max-completion-tokens <number>", "Max completion tokens", "2048");

  program.parse(argv);
  const opts = program.opts<{
    input: string;
    output: string;
    nameColumn: string;
    domainColumn: string;
    model: string;
    maxCompletionTokens: string;
  }>();

  const apiKey = requireNonEmpty(process.env.AZURE_OPENAI_API_KEY, "AZURE_OPENAI_API_KEY");
  const baseUrl = requireNonEmpty(process.env.AZURE_OPENAI_BASE_URL, "AZURE_OPENAI_BASE_URL");

  const maxCompletionTokens = Number(opts.maxCompletionTokens);
  if (!Number.isFinite(maxCompletionTokens) || maxCompletionTokens <= 0) {
    throw new Error("--max-completion-tokens must be a positive number");
  }

  return {
    apiKey,
    baseUrl,
    inputPath: requireNonEmpty(opts.input, "--input"),
    outputPath: requireNonEmpty(opts.output, "--output"),
    nameColumn: requireNonEmpty(opts.nameColumn, "--name-column"),
    domainColumn: requireNonEmpty(opts.domainColumn, "--domain-column"),
    model: requireNonEmpty(opts.model, "--model"),
    maxCompletionTokens
  };
}
