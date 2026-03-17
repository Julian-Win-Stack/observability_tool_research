import fs from "node:fs";
import { parse } from "csv-parse";

export type CompanyRow = {
  companyName: string;
  companyDomain: string;
  rowNumber: number;
};

function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

export async function* readCompanies(options: {
  inputPath: string;
  nameColumn: string;
  domainColumn: string;
}): AsyncGenerator<CompanyRow> {
  const inputStream = fs.createReadStream(options.inputPath);
  const parser = inputStream.pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: false
    })
  );

  let rowNumber = 1; // header row is conceptually row 1; data starts after

  for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
    rowNumber += 1;

    const companyName = cleanCell(record[options.nameColumn]);
    const companyDomain = cleanCell(record[options.domainColumn]);

    if (!companyName || !companyDomain) {
      const missing =
        !companyName && !companyDomain
          ? "company name and domain"
          : !companyName
            ? "company name"
            : "company domain";
      console.warn(
        `[csv] Skipping row ${rowNumber}: missing ${missing} (headers: "${options.nameColumn}", "${options.domainColumn}")`
      );
      continue;
    }

    yield { companyName, companyDomain, rowNumber };
  }
}
