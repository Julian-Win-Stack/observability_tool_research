import fs from "node:fs";
import { stringify } from "csv-stringify";

export type OutputRow = {
  company_name: string;
  company_domain: string;
  observability_tool_research: string;
};

export function rowsToCsvString(rows: OutputRow[]): Promise<string> {
  return new Promise((resolve, reject) => {
    stringify(
      rows,
      {
        header: true,
        columns: [
          { key: "company_name", header: "Company Name" },
          { key: "company_domain", header: "Website" },
          { key: "observability_tool_research", header: "observability_tool" }
        ]
      },
      (err, output) => {
        if (err) reject(err);
        else resolve(output ?? "");
      }
    );
  });
}

export class OutputCsvWriter {
  private readonly fileStream: fs.WriteStream;
  private readonly stringifier;
  private closed = false;

  constructor(outputPath: string) {
    this.fileStream = fs.createWriteStream(outputPath, { encoding: "utf8" });

    this.stringifier = stringify({
      header: true,
      columns: [
        { key: "company_name", header: "Company Name" },
        { key: "company_domain", header: "Website" },
        { key: "observability_tool_research", header: "observability_tool" }
      ]
    });

    this.stringifier.pipe(this.fileStream);
  }

  async writeRow(row: OutputRow): Promise<void> {
    if (this.closed) throw new Error("OutputCsvWriter is closed");

    return new Promise((resolve, reject) => {
      const ok = this.stringifier.write(row, (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });

      if (!ok) {
        this.stringifier.once("drain", resolve);
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await new Promise<void>((resolve, reject) => {
      this.stringifier.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.fileStream.end(() => resolve());
      this.fileStream.on("error", reject);
    });
  }
}

