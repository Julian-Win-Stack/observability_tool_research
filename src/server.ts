import path from "path";
import { existsSync } from "fs";
import express from "express";
import multer from "multer";
import cors from "cors";
import { loadServerConfig } from "./serverConfig.js";
import { readCompanies } from "./csvReader.js";
import { rowsToCsvString, type OutputRow } from "./csvWriter.js";
import { researchCompany } from "./openaiClient.js";

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());

const SSE_MIN_CHUNK = 2048;

function sendSSE(res: express.Response, data: unknown): void {
  let out = JSON.stringify(data);
  const need = SSE_MIN_CHUNK - out.length - 6;
  if (need > 0 && typeof data === "object" && data !== null && !Array.isArray(data)) {
    out = JSON.stringify({ ...data, _: "x".repeat(need) });
  }
  res.write(`data: ${out}\n\n`);
}

app.post("/research", upload.single("csv"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No CSV file provided. Use form field 'csv'." });
    return;
  }

  const csvBuffer = req.file.buffer.toString("utf8");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const config = loadServerConfig();
    const rows: OutputRow[] = [];

    for await (const row of readCompanies({
      csvBuffer,
      nameColumn: config.nameColumn,
      domainColumn: config.domainColumn
    })) {
      const processingMsg = `Processing row ${row.rowNumber}: ${row.companyName}`;
      console.log(`[server] ${processingMsg}`);
      sendSSE(res, { type: "progress", message: processingMsg });

      const research = await researchCompany(row.companyName, row.companyDomain, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        maxCompletionTokens: config.maxCompletionTokens
      });
      rows.push({
        company_name: row.companyName,
        company_domain: row.companyDomain,
        observability_tool_research: research
      });

      const doneMsg = `Done row ${row.rowNumber}. Total: ${rows.length}`;
      console.log(`[server] ${doneMsg}`);
      sendSSE(res, { type: "progress", message: doneMsg });
    }

    const csvString = await rowsToCsvString(rows);
    const csvBase64 = Buffer.from(csvString, "utf8").toString("base64");
    sendSSE(res, { type: "done", csv: csvBase64 });
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[server] Error:", msg);
    sendSSE(res, { type: "error", message: msg });
    res.end();
  }
});

// Serve built frontend in production (e.g. Docker) — must be after API routes
const frontendDist = path.join(process.cwd(), "frontend", "dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
