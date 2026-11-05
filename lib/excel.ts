// Turns spreadsheet rows into quiz questions. Valid rows are kept; each bad row is skipped and reported in `errors`. Pure and side-effect free so the rules can be tested.
// Columns: Question | Option A | Option B | Option C | Option D | Correct (A-D) | Seconds (optional)

export type ImportedQ = { text: string; options: string[]; correct: number; time: number };
export type ImportResult = { questions: ImportedQ[]; errors: string[] };

const MAX_Q = 60;
const cell = (v: any) => (v === null || v === undefined ? '' : String(v).trim());

export function rowsToQuiz(rows: any[][]): ImportResult {
  const errors: string[] = [];
  const questions: ImportedQ[] = [];
  const data: { row: number; c: any[] }[] = [];
  rows.forEach((c, i) => {
    if (i === 0 && cell(c?.[0]).toLowerCase().startsWith('question')) return; // header row
    if (!Array.isArray(c) || c.every((x) => cell(x) === '')) return; // blank row
    data.push({ row: i + 1, c });
  });
  if (data.length === 0) return { questions, errors: ['No questions found. Fill in the Questions sheet below the header row.'] };

  for (const { row, c } of data) {
    // Past the limit: keep the first MAX_Q, report the rest as one line.
    if (questions.length + errors.filter((e) => e.startsWith('Row')).length >= MAX_Q) {
      errors.push(`Rows ${row} onward were NOT imported: a quiz can have at most ${MAX_Q} questions.`);
      break;
    }
    const text = cell(c[0]);
    const opts = [cell(c[1]), cell(c[2]), cell(c[3]), cell(c[4])];
    const filled = opts.filter(Boolean).length;
    const where = `Row ${row}${text ? ` ("${text.slice(0, 40)}${text.length > 40 ? '…' : ''}")` : ''}`;
    // One error line per bad row (all of its problems together), so errors.length = number of skipped rows.
    const problems: string[] = [];
    const fail = (m: string) => { problems.push(m); };

    if (!text) fail('question text is empty');
    else if (text.length > 300) fail('question text is longer than 300 characters');
    if (filled < 2) fail('needs at least 2 options');
    if (opts.some((o) => o.length > 120)) fail('an option is longer than 120 characters');

    // Correct answer: A-D, 1-4, or the exact text of one option.
    const raw = cell(c[5]);
    let correct = -1;
    if (/^[A-Da-d]$/.test(raw)) correct = raw.toUpperCase().charCodeAt(0) - 65;
    else if (/^[1-4]$/.test(raw)) correct = Number(raw) - 1;
    else if (raw) { const m = opts.findIndex((o) => o && o.toLowerCase() === raw.toLowerCase()); if (m >= 0) correct = m; }
    if (!raw) fail('"Correct" is empty (use A, B, C or D)');
    else if (correct < 0) fail(`"Correct" must be A, B, C or D (got "${raw.slice(0, 30)}")`);
    else if (!opts[correct]) fail(`the correct answer points at an empty option (${'ABCD'[correct]})`);

    let time = 20;
    const t = cell(c[6]);
    if (t !== '') {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 5 || n > 120) fail(`"Seconds" must be a whole number from 5 to 120 (got "${t.slice(0, 20)}")`);
      else time = n;
    }
    if (problems.length) errors.push(`${where}: ${problems.join('; ')}`);
    else questions.push({ text, options: opts, correct, time });
  }
  return { questions, errors };
}

// ---------- CSV ----------

/** Minimal RFC 4180 parser: quoted fields, "" escapes, line breaks inside quotes, CRLF, BOM, and , ; or tab separators. */
export function parseCsv(input: string): string[][] {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  // Pick the separator from the first line, ignoring anything inside quotes (Excel in many locales writes ';').
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') q = !q;
    else if (!q && (ch === '\n' || ch === '\r')) break;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === '') inQ = true; // a quote only opens a quoted field at the field start
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (inQ) throw new Error('unclosed quote');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Excel's plain "CSV" is often Windows-1252, not UTF-8. Try UTF-8 strictly first, then fall back.
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

// Reads an .xlsx (first sheet) or .csv file in the browser.
export async function parseQuizFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    try { return rowsToQuiz(parseCsv(await readText(file))); }
    catch { return { questions: [], errors: ['That CSV file is malformed (a quote is never closed). Re-save it from Excel as CSV, or use the template.'] }; }
  }
  if (name.endsWith('.xlsx')) {
    const mod: any = await import('read-excel-file');
    const read = mod.default || mod;
    const rows: any[][] = await read(file);
    return rowsToQuiz(rows);
  }
  return { questions: [], errors: ['Please upload an .xlsx or .csv file (use the template). Old .xls files are not supported.'] };
}
