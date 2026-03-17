import { loadConfig } from "./config.js";
import { readCompanies } from "./csvReader.js";
import { OutputCsvWriter } from "./csvWriter.js";
import { researchCompany } from "./perplexityClient.js";

async function main(): Promise<void> {
  const config = loadConfig(process.argv);
  const writer = new OutputCsvWriter(config.outputPath);

  let processed = 0;

  try {
    for await (const row of readCompanies({
      inputPath: config.inputPath,
      nameColumn: config.nameColumn,
      domainColumn: config.domainColumn
    })) {
      console.log(`[main] Processing row ${row.rowNumber}: ${row.companyName}`);

      const research = await researchCompany(row.companyName, row.companyDomain, {
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        searchType: config.searchType
      });

      await writer.writeRow({
        company_name: row.companyName,
        company_domain: row.companyDomain,
        observability_tool_research: research
      });

      processed += 1;
      console.log(`[main] Done row ${row.rowNumber}. Total written: ${processed}`);
    }
  } finally {
    await writer.close();
  }

  console.log(`[main] Finished. Output written to ${config.outputPath}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[fatal] ${msg}`);
  process.exitCode = 1;
});

