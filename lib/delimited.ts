type RawDelimitedRow = Record<string, string>;

export type ParsedDelimitedResult = {
  delimiter: "csv" | "tsv";
  headers: string[];
  rows: RawDelimitedRow[];
};

function splitLine(line: string, delimiterChar: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiterChar) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

export function detectDelimiter(filename: string, text: string): "csv" | "tsv" {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".tsv")) return "tsv";
  if (lowerName.endsWith(".csv")) return "csv";

  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;

  return tabCount >= commaCount ? "tsv" : "csv";
}

export function parseDelimitedText(
  text: string,
  filename: string,
  explicitDelimiter?: "csv" | "tsv"
): ParsedDelimitedResult {
  const delimiter = explicitDelimiter ?? detectDelimiter(filename, text);
  const delimiterChar = delimiter === "tsv" ? "\t" : ",";

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }

  const headers = splitLine(lines[0], delimiterChar).map((header) => header.trim());
  const rows: RawDelimitedRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = splitLine(lines[index], delimiterChar);
    const row: RawDelimitedRow = {};
    headers.forEach((header, hIndex) => {
      row[header] = (values[hIndex] ?? "").trim();
    });
    rows.push(row);
  }

  return { delimiter, headers, rows };
}

export function findFirstHeader(
  headers: string[],
  candidates: string[]
): string | null {
  const normalized = headers.map((header) => header.toLowerCase().trim());
  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase().trim();
    const idx = normalized.indexOf(candidateLower);
    if (idx >= 0) return headers[idx];
  }
  return null;
}
