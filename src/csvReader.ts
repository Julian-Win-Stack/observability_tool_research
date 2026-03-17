import fs from "node:fs";
import { Readable } from "node:stream";
import { parse } from "csv-parse";

export type CompanyRow = {
  companyName: string;
  companyDomain: string;
  rowNumber: number;
};

function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

const parseOptions = {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
  trim: false
} as const;

export async function* readCompanies(
  options:
    | { inputPath: string; nameColumn: string; domainColumn: string }
    | { csvBuffer: string; nameColumn: string; domainColumn: string }
): AsyncGenerator<CompanyRow> {
  const inputStream =
    "inputPath" in options
      ? fs.createReadStream(options.inputPath)
      : Readable.from([options.csvBuffer]);

  const parser = inputStream.pipe(parse(parseOptions));
  const nameColumn = options.nameColumn;
  const domainColumn = options.domainColumn;

  let rowNumber = 1; // header row is conceptually row 1; data starts after

  for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
    rowNumber += 1;

    const companyName = cleanCell(record[nameColumn]);
    const companyDomain = cleanCell(record[domainColumn]);

    if (!companyName || !companyDomain) {
      const missing =
        !companyName && !companyDomain
          ? "company name and domain"
          : !companyName
            ? "company name"
            : "company domain";
      console.warn(
        `[csv] Skipping row ${rowNumber}: missing ${missing} (headers: "${nameColumn}", "${domainColumn}")`
      );
      continue;
    }

    yield { companyName, companyDomain, rowNumber };
  }
}
