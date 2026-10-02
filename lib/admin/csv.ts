import Papa from "papaparse";
import { REPORTING_TZ } from "@/lib/billing/reports/denver";

export const EXPORT_DISCLAIMER = "Gross collected via GHL — processor fees, chargebacks and payouts not included. Not a bank reconciliation.";

/** Cells that a spreadsheet would execute as a formula. Only TEXT columns are guarded — numeric strings like "-0.0079" are untouched. */
const FORMULA_START = /^[=+\-@\t\r]/;
export const neutralizeFormula = (v: string): string => (FORMULA_START.test(v) ? `'${v}` : v);

export type Cell = string | number | boolean | null | undefined | Date;
export type Row = Record<string, Cell>;

const fmtDenverFull = (d: Date): string => d.toLocaleString("en-US", { timeZone: REPORTING_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short" });

export function metadataRows(o: { view: string; filters: Record<string, string>; now: Date; classifierVersion: number }): string[][] {
  const filters = Object.entries(o.filters).map(([k, v]) => `${k}=${v}`).join("; ") || "(none)";
  return [
    ["REIblast admin export"],
    ["View", o.view],
    ["Filters", filters],
    ["Generated (America/Denver)", fmtDenverFull(o.now)],
    ["Generated (UTC)", o.now.toISOString()],
    ["Classifier version", String(o.classifierVersion)],
    ["Reporting timezone", REPORTING_TZ],
    [EXPORT_DISCLAIMER],
    [],
  ];
}

export type CsvSpec = {
  view: string;
  filters: Record<string, string>;
  columns: string[];
  /** Columns holding text from GHL or people (descriptions, names, notes): formula-guarded. */
  textColumns: string[];
  chunks: AsyncIterable<Row[]>;
  classifierVersion: number;
};
export type FinishInfo = { rowCount: number; partial: boolean };

function cellOut(v: Cell, text: boolean): string | number | boolean {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && text) return neutralizeFormula(v);
  return v;
}

/**
 * Streams a CSV: metadata rows, then the header, then the data in chunks pulled on demand (backpressure-friendly).
 * `onFinish` is called exactly once — after the last chunk (partial:false), or on client abort / error (partial:true).
 */
export function csvStream(spec: CsvSpec, now: Date, onFinish: (i: FinishInfo) => Promise<void>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const text = new Set(spec.textColumns);
  const it = spec.chunks[Symbol.asyncIterator]();
  let rowCount = 0;
  let finished = false;
  let started = false;
  const finish = async (partial: boolean) => {
    if (finished) return;
    finished = true;
    await onFinish({ rowCount, partial });
  };
  const toArrays = (rows: Row[]) => rows.map((r) => spec.columns.map((c) => cellOut(r[c], text.has(c))));

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(enc.encode(`${Papa.unparse([...metadataRows({ view: spec.view, filters: spec.filters, now, classifierVersion: spec.classifierVersion }), spec.columns])}\r\n`));
          return;
        }
        const n = await it.next();
        if (n.done) {
          await finish(false);
          controller.close();
          return;
        }
        rowCount += n.value.length;
        controller.enqueue(enc.encode(`${Papa.unparse(toArrays(n.value))}\r\n`));
      } catch (err) {
        await finish(true);
        controller.error(err);
      }
    },
    async cancel() {
      await it.return?.();
      await finish(true);
    },
  });
}

export const csvFilename = (view: string, now: Date, suffix = ""): string => `reiblast-${view}${suffix ? `-${suffix}` : ""}-${now.toISOString().slice(0, 10)}.csv`;
