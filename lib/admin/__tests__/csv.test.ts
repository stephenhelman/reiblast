import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { csvStream, EXPORT_DISCLAIMER, metadataRows, neutralizeFormula, type CsvSpec, type Row } from "../csv";

const NOW = new Date("2026-09-27T18:30:00.000Z"); // 12:30 MDT

async function* chunks(...cs: Row[][]): AsyncGenerator<Row[]> { for (const c of cs) yield c; }
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const r = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done, value } = await r.read(); if (done) return out; out += dec.decode(value); }
}
const spec = (over: Partial<CsvSpec> = {}): CsvSpec => ({ view: "revenue", filters: { fromMonth: "2026-06", toMonth: "2026-09" }, columns: ["id", "amount", "description"], textColumns: ["description"], chunks: chunks([{ id: "a", amount: "-0.007900", description: "Outbound SMS" }]), classifierVersion: 2, ...over });

describe("formula-injection guard", () => {
  it("prefixes a quote on cells a spreadsheet would execute", () => {
    for (const v of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(neutralizeFormula(v)).toBe(`'${v}`);
    for (const v of ["Outbound SMS", "12 =x", "", "a-b"]) expect(neutralizeFormula(v)).toBe(v);
  });
  it("guards TEXT columns only; numeric strings like -0.0079 are left exactly as they are", async () => {
    const csv = await readAll(csvStream(spec({ chunks: chunks([{ id: "a", amount: "-0.007900", description: "=HYPERLINK(\"http://x\")" }, { id: "b", amount: "-12.000000", description: "+1 555" }]) }), NOW, async () => {}));
    const rows = Papa.parse<string[]>(csv).data;
    const data = rows.filter((r) => r[0] === "a" || r[0] === "b");
    expect(data[0][1]).toBe("-0.007900");
    expect(data[0][2]).toBe(`'=HYPERLINK("http://x")`);
    expect(data[1][2]).toBe("'+1 555");
  });
});

describe("metadata block", () => {
  const meta = metadataRows({ view: "costs", filters: { fromMonth: "2026-06", month: "2026-08" }, now: NOW, classifierVersion: 2 });
  it("contains every required line", () => {
    const flat = meta.map((r) => r.join(" | "));
    expect(flat[0]).toBe("REIblast admin export");
    expect(flat).toContain("View | costs");
    expect(flat).toContain("Filters | fromMonth=2026-06; month=2026-08");
    expect(flat.find((l) => l.startsWith("Generated (America/Denver)"))).toMatch(/09\/27\/2026.*12:30:00.*MDT/);
    expect(flat).toContain("Generated (UTC) | 2026-09-27T18:30:00.000Z");
    expect(flat).toContain("Classifier version | 2");
    expect(flat).toContain("Reporting timezone | America/Denver");
    expect(flat).toContain(EXPORT_DISCLAIMER);
    expect(EXPORT_DISCLAIMER).toBe("Gross collected via GHL — processor fees, chargebacks and payouts not included. Not a bank reconciliation.");
    expect(meta[meta.length - 1]).toEqual([]); // blank line before the header
  });
  it("says (none) when there are no filters", () => expect(metadataRows({ view: "members", filters: {}, now: NOW, classifierVersion: 2 })[2]).toEqual(["Filters", "(none)"]));
});

describe("csvStream", () => {
  it("writes metadata, then the header ONCE, then every chunk's rows; reports the row count once", async () => {
    const finished: { rowCount: number; partial: boolean }[] = [];
    const csv = await readAll(csvStream(spec({ chunks: chunks([{ id: "1", amount: "1", description: "a" }, { id: "2", amount: "2", description: "b" }], [{ id: "3", amount: "3", description: "c" }]) }), NOW, async (i) => void finished.push(i)));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("REIblast admin export");
    expect(lines.filter((l) => l === "id,amount,description").length).toBe(1);
    expect(lines.slice(lines.indexOf("id,amount,description") + 1)).toEqual(["1,1,a", "2,2,b", "3,3,c"]);
    expect(finished).toEqual([{ rowCount: 3, partial: false }]);
  });
  it("an empty result still has metadata + header", async () => {
    const finished: unknown[] = [];
    const csv = await readAll(csvStream(spec({ chunks: chunks() }), NOW, async (i) => void finished.push(i)));
    expect(csv).toContain("id,amount,description");
    expect(finished).toEqual([{ rowCount: 0, partial: false }]);
  });
  it("escapes commas, quotes and newlines; dates become ISO; null becomes empty", async () => {
    const csv = await readAll(csvStream(spec({ columns: ["id", "when", "note"], textColumns: ["note"], chunks: chunks([{ id: "x", when: new Date("2026-09-01T00:00:00Z"), note: 'he said "hi", ok\nbye' }, { id: "y", when: null, note: undefined }]) }), NOW, async () => {}));
    const rows = Papa.parse<string[]>(csv).data.filter((r) => r[0] === "x" || r[0] === "y");
    expect(rows[0]).toEqual(["x", "2026-09-01T00:00:00.000Z", 'he said "hi", ok\nbye']);
    expect(rows[1]).toEqual(["y", "", ""]);
  });
  it("a client abort marks the export partial, exactly once", async () => {
    const finished: { rowCount: number; partial: boolean }[] = [];
    async function* many(): AsyncGenerator<Row[]> { for (let i = 0; i < 100; i++) yield [{ id: String(i), amount: "1", description: "d" }]; }
    const stream = csvStream(spec({ chunks: many() }), NOW, async (i) => void finished.push(i));
    const r = stream.getReader();
    await r.read(); // metadata
    await r.read(); // first data chunk
    await r.cancel();
    expect(finished.length).toBe(1);
    expect(finished[0].partial).toBe(true);
    expect(finished[0].rowCount).toBeLessThan(100);
  });
  it("a failing source errors the stream and records a partial finish", async () => {
    const finished: { rowCount: number; partial: boolean }[] = [];
    async function* boom(): AsyncGenerator<Row[]> { yield [{ id: "1", amount: "1", description: "d" }]; throw new Error("db went away"); }
    await expect(readAll(csvStream(spec({ chunks: boom() }), NOW, async (i) => void finished.push(i)))).rejects.toThrow("db went away");
    expect(finished).toEqual([{ rowCount: 1, partial: true }]);
  });
});
