import path from "path";
import { existsSync } from "fs";
import express from "express";
import multer from "multer";
import cors from "cors";
import { loadServerConfig, type ServerConfig } from "./serverConfig.js";
import { readCompanies } from "./csvReader.js";
import { rowsToCsvString, type OutputRow } from "./csvWriter.js";
import { researchCompany } from "./openaiClient.js";
import {
  createJob,
  setJobMessage,
  setJobProgress,
  setJobStatus,
  addJobWarning,
  markJobDone,
  markSingleJobDone,
  markJobError,
  getJob,
  markJobCancelled
} from "./jobStore.js";

const MAX_ROWS = 500;
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json());

function normalizeDomainInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    const hostname = url.hostname.trim().toLowerCase().replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
  }
}

async function processJob(
  jobId: string,
  csvBuffer: string,
  config: ServerConfig
): Promise<void> {
  const rows: OutputRow[] = [];

  try {
    setJobStatus(jobId, "processing");
    setJobMessage(jobId, "Starting...");
    setJobProgress(jobId, { currentRow: 0, totalRows: MAX_ROWS });

    for await (const row of readCompanies({
      csvBuffer,
      nameColumn: config.nameColumn,
      domainColumn: config.domainColumn
    })) {
      const currentJob = getJob(jobId);
      if (!currentJob || currentJob.status === "cancelled") {
        return;
      }

      if (rows.length >= MAX_ROWS) {
        addJobWarning(
          jobId,
          `Row limit reached (${MAX_ROWS}). Remaining rows skipped.`
        );
        break;
      }

      const processingMsg = `Processing row ${row.rowNumber}: ${row.companyName}`;
      console.log(`[server] ${processingMsg}`);
      setJobMessage(jobId, processingMsg);
      setJobProgress(jobId, { currentRow: row.rowNumber, totalRows: MAX_ROWS });

      const research = await researchCompany(row.companyName, row.companyDomain, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        maxCompletionTokens: config.maxCompletionTokens
      });

      const jobAfterResearch = getJob(jobId);
      if (!jobAfterResearch || jobAfterResearch.status === "cancelled") {
        return;
      }

      if (research.startsWith("Error:")) {
        const warnMsg = `Warning: research failed for ${row.companyName} — ${research}`;
        console.warn(`[server] ${warnMsg}`);
        addJobWarning(jobId, warnMsg);
      }

      rows.push({
        company_name: row.companyName,
        company_domain: row.companyDomain,
        observability_tool_research: research
      });

      const doneMsg = `Done row ${row.rowNumber}. Total: ${rows.length}`;
      console.log(`[server] ${doneMsg}`);
      setJobMessage(jobId, doneMsg);
      setJobProgress(jobId, { currentRow: row.rowNumber, totalRows: MAX_ROWS });
    }

    const csvString = await rowsToCsvString(rows);
    const csvBase64 = Buffer.from(csvString, "utf8").toString("base64");
    markJobDone(jobId, csvBase64, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[server] Error in job:", msg);
    markJobError(jobId, msg);
  }
}

async function processSingleJob(
  jobId: string,
  companyName: string,
  companyDomain: string,
  config: ServerConfig
): Promise<void> {
  try {
    setJobStatus(jobId, "processing");
    setJobMessage(jobId, `Processing: ${companyName}`);
    setJobProgress(jobId, { currentRow: 1, totalRows: 1 });

    const currentJob = getJob(jobId);
    if (!currentJob || currentJob.status === "cancelled") return;

    const research = await researchCompany(companyName, companyDomain, {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      maxCompletionTokens: config.maxCompletionTokens
    });

    const jobAfterResearch = getJob(jobId);
    if (!jobAfterResearch || jobAfterResearch.status === "cancelled") return;

    if (research.startsWith("Error:")) {
      markJobError(jobId, research);
      return;
    }

    setJobMessage(jobId, "Done");
    setJobProgress(jobId, { currentRow: 1, totalRows: 1 });
    markSingleJobDone(jobId, research);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[server] Error in single job:", msg);
    markJobError(jobId, msg);
  }
}

app.post("/research", upload.single("csv"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No CSV file provided. Use form field 'csv'." });
    return;
  }

  const csvBuffer = req.file.buffer.toString("utf8");

  try {
    const config = loadServerConfig();

    const firstLine = csvBuffer.split("\n")[0] ?? "";
    const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    if (!headers.includes(config.nameColumn) || !headers.includes(config.domainColumn)) {
      res.status(400).json({
        error: `CSV must have columns "${config.nameColumn}" and "${config.domainColumn}". Found: ${headers.join(", ")}`
      });
      return;
    }

    const jobId = createJob();
    void processJob(jobId, csvBuffer, config);
    res.json({ jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[server] Error:", msg);
    res.status(500).json({ error: msg });
  }
});

app.post("/research/single", async (req, res) => {
  const companyNameRaw = typeof req.body?.companyName === "string" ? req.body.companyName : "";
  const companyDomainRaw = typeof req.body?.companyDomain === "string" ? req.body.companyDomain : "";

  const companyName = companyNameRaw.trim();
  if (!companyName) {
    res.status(400).json({ error: "companyName is required" });
    return;
  }

  const companyDomain = normalizeDomainInput(companyDomainRaw);
  if (!companyDomain) {
    res.status(400).json({ error: "companyDomain must be a valid domain or URL" });
    return;
  }

  try {
    const config = loadServerConfig();
    const jobId = createJob();
    void processSingleJob(jobId, companyName, companyDomain, config);
    res.json({ jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[server] Error:", msg);
    res.status(500).json({ error: msg });
  }
});

app.post("/cancel/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
    res.status(409).json({ error: `Cannot cancel a job in status "${job.status}"` });
    return;
  }

  markJobCancelled(jobId);
  res.json({ status: "cancelled" });
});

app.get("/status/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status === "done") {
    res.json({
      status: "done",
      csv: job.csvBase64 ?? "",
      result: job.singleResult ?? "",
      rows: job.batchRows ?? [],
      warnings: job.warnings
    });
    return;
  }

  if (job.status === "error") {
    res.json({
      status: "error",
      error: job.error ?? "Unknown error"
    });
    return;
  }

  if (job.status === "cancelled") {
    res.json({
      status: "error",
      error: job.message ?? "Job was cancelled"
    });
    return;
  }

  res.json({
    status: job.status,
    message: job.message,
    totalRows: job.totalRows,
    currentRow: job.currentRow,
    warnings: job.warnings
  });
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
