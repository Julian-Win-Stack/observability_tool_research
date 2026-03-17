import express from "express";
import multer from "multer";
import cors from "cors";
import { loadServerConfig } from "./serverConfig.js";
import { readCompanies } from "./csvReader.js";
import { rowsToCsvString, type OutputRow } from "./csvWriter.js";
import { researchCompany } from "./perplexityClient.js";

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());

app.post("/research", upload.single("csv"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No CSV file provided. Use form field 'csv'." });
    return;
  }

  const csvBuffer = req.file.buffer.toString("utf8");

  try {
    const config = loadServerConfig();
    const rows: OutputRow[] = [];

    for await (const row of readCompanies({
      csvBuffer,
      nameColumn: config.nameColumn,
      domainColumn: config.domainColumn
    })) {
      console.log(`[server] Processing row ${row.rowNumber}: ${row.companyName}`);
      const research = await researchCompany(row.companyName, row.companyDomain, {
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens
      });
      rows.push({
        company_name: row.companyName,
        company_domain: row.companyDomain,
        observability_tool_research: research
      });
      console.log(`[server] Done row ${row.rowNumber}. Total: ${rows.length}`);
    }

    const csvString = await rowsToCsvString(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="results.csv"');
    res.send(csvString);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[server] Error:", msg);
    res.status(500).json({ error: msg });
  }
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
