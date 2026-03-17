import "dotenv/config";
import { Command } from "commander";

export type AppConfig = {
  apiKey: string;
  inputPath: string;
  outputPath: string;
  nameColumn: string;
  domainColumn: string;
  model: string;
  temperature: number;
  maxTokens: number;
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
      "Enrich companies in a CSV with observability-tool evidence via Perplexity Sonar."
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
    .option("--model <name>", "Perplexity model name", "sonar-pro")
    .option("--temperature <number>", "Sampling temperature", "0.1")
    .option("--max-tokens <number>", "Max tokens", "2048");

  program.parse(argv);
  const opts = program.opts<{
    input: string;
    output: string;
    nameColumn: string;
    domainColumn: string;
    model: string;
    temperature: string;
    maxTokens: string;
  }>();

  const apiKey = requireNonEmpty(process.env.PERPLEXITY_API_KEY, "PERPLEXITY_API_KEY");

  const temperature = Number(opts.temperature);
  const maxTokens = Number(opts.maxTokens);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error("--temperature must be a number between 0 and 2");
  }
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error("--max-tokens must be a positive number");
  }

  return {
    apiKey,
    inputPath: requireNonEmpty(opts.input, "--input"),
    outputPath: requireNonEmpty(opts.output, "--output"),
    nameColumn: requireNonEmpty(opts.nameColumn, "--name-column"),
    domainColumn: requireNonEmpty(opts.domainColumn, "--domain-column"),
    model: requireNonEmpty(opts.model, "--model"),
    temperature,
    maxTokens
  };
}
