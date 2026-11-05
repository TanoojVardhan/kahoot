// Turns spreadsheet rows into quiz questions. Pure and side-effect free so the rules can be tested.
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
  if (data.length > MAX_Q) return { questions, errors: [`Too many questions (${data.length}). The limit is ${MAX_Q}.`] };

  for (const { row, c } of data) {
    const text = cell(c[0]);
    const opts = [cell(c[1]), cell(c[2]), cell(c[3]), cell(c[4])];
    const filled = opts.filter(Boolean).length;
    const where = `Row ${row}`;
    let bad = false;
    const fail = (m: string) => { errors.push(`${where}: ${m}`); bad = true; };

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
    if (!bad) questions.push({ text, options: opts, correct, time });
  }
  return { questions, errors };
}

// Reads the first sheet of an .xlsx file in the browser.
export async function parseQuizFile(file: File): Promise<ImportResult> {
  if (!/\.xlsx$/i.test(file.name)) return { questions: [], errors: ['Please upload an .xlsx file (use the template). Old .xls and .csv are not supported.'] };
  const mod: any = await import('read-excel-file/browser');
  const read = mod.default || mod;
  const rows: any[][] = await read(file);
  return rowsToQuiz(rows);
}
