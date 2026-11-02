import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAYLOAD_HEADER_V1,
  PAYLOAD_MAX_CHARS,
  PAYLOAD_MAX_FIELD_CHARS,
  PAYLOAD_MAX_ROWS,
  downloadCSV,
  formatDealMachineData,
} from "@/lib/leadCleaner";

const fixture = readFileSync(path.join(__dirname, "fixtures/dealmachine-v1.txt"), "utf8");

const payload = (rows: unknown, pretty = false) =>
  `${PAYLOAD_HEADER_V1}\n${pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows)}`;
const row = (id: number, line1: string, line2 = "Houston, TX 77033") => ({ id, line1, line2 });

describe("REISCRUB:v1:dealmachine payload — real fixture", () => {
  const r = formatDealMachineData(fixture);

  it("processes all rows with the expected counts", () => {
    expect(r.payloadError).toBeUndefined();
    expect(r.stats.totalLines).toBe(25);
    expect(r.excludedApn).toBe(3);
    expect(r.duplicatesRemoved).toBe(1);
    expect(r.flagged).toEqual([]);
    expect(r.contacts).toHaveLength(21);
  });

  it("collapses the two 4912 Ricky St ids to one row", () => {
    expect(r.contacts.filter((c) => c.address === "4912 ricky st")).toHaveLength(1);
  });

  it("keeps unit designators and lowercases output", () => {
    const addrs = r.contacts.map((c) => c.address);
    expect(addrs).toContain("4814 carmen st apt 1");
    expect(addrs).toContain("5123 larkspur st bldg d");
    expect(addrs).toContain("5214 rue st # b");
    expect(addrs).toContain("4821 doolittle blvd # a");
    expect(addrs).toContain("7350 st lo rd # 1");
    expect(addrs).toContain("931 noel st");
    expect(r.contacts[0]).toEqual({ address: "9214 faircroft dr", city: "houston", state: "tx", zip: "77033" });
  });

  it("never emits APN rows", () => {
    expect(r.contacts.some((c) => c.address.startsWith("apn"))).toBe(false);
  });

  it("handles a pretty-printed version of the same payload identically", () => {
    const rows = JSON.parse(fixture.slice(fixture.indexOf("\n") + 1));
    expect(formatDealMachineData(payload(rows, true))).toEqual(r);
  });

  it("tolerates a BOM and CRLF line endings", () => {
    const crlf = "﻿" + fixture.replace("\n", "\r\n");
    expect(formatDealMachineData(crlf)).toEqual(r);
  });
});

describe("payload row parsing", () => {
  it("accepts lowercase and mixed-case state, strips ZIP+4", () => {
    const r = formatDealMachineData(
      payload([row(1, "1 A St", "Houston, tx 77033"), row(2, "2 B St", "Houston, Tx 77033-1234"), row(3, "3 C St", "St. Louis, MO 63101")]),
    );
    expect(r.flagged).toEqual([]);
    expect(r.contacts).toEqual([
      { address: "1 a st", city: "houston", state: "tx", zip: "77033" },
      { address: "2 b st", city: "houston", state: "tx", zip: "77033" },
      { address: "3 c st", city: "st. louis", state: "mo", zip: "63101" },
    ]);
  });

  it("flags an unparseable line2 instead of dropping it", () => {
    const r = formatDealMachineData(payload([row(1, "1 A St"), row(2, "2 B St", "Houston 77033")]));
    expect(r.contacts).toHaveLength(1);
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged![0]).toMatchObject({ id: 2, line1: "2 B St", line2: "Houston 77033" });
  });

  it("dedupes on line1 with . and , stripped, whitespace collapsed and zip5; hyphens are kept", () => {
    const r = formatDealMachineData(
      payload([
        row(1, "12 N. Main St"),
        row(2, "12 n main  st"),
        row(3, "12 N Main St", "Houston, TX 77034"),
        row(4, "5-1 Oak St"),
        row(5, "51 Oak St"),
        row(6, "123-A Main St"),
        row(7, "123-a main st."),
      ]),
    );
    expect(r.duplicatesRemoved).toBe(2);
    expect(r.contacts.map((c) => `${c.address}|${c.zip}`)).toEqual([
      "12 n. main st|77033",
      "12 n main st|77034",
      "5-1 oak st|77033",
      "51 oak st|77033",
      "123-a main st|77033",
    ]);
  });

  it("one malformed row among valid rows: valid rows export, bad row flagged with raw values", () => {
    const r = formatDealMachineData(
      payload([row(1, "1 A St"), { line1: "2 B St", line2: "Houston, TX 77033" }, { id: 3, line1: 42, line2: "Houston, TX 77033" }, "junk", null, row(6, "6 F St")]),
    );
    expect(r.payloadError).toBeUndefined();
    expect(r.contacts.map((c) => c.address)).toEqual(["1 a st", "6 f st"]);
    expect(r.flagged).toHaveLength(4);
    expect(r.flagged![0]).toMatchObject({ line1: "2 B St", line2: "Houston, TX 77033" });
    expect(r.flagged![1]).toMatchObject({ id: 3, line1: 42 });
  });

  it("flags fields over 500 chars", () => {
    const long = "1 " + "A".repeat(PAYLOAD_MAX_FIELD_CHARS);
    const r = formatDealMachineData(payload([row(1, long), row(2, "2 B St", "H".repeat(PAYLOAD_MAX_FIELD_CHARS) + ", TX 77033"), row(3, "3 C St")]));
    expect(r.contacts).toHaveLength(1);
    expect(r.flagged).toHaveLength(2);
  });
});

describe("whole-payload errors", () => {
  it("rejects an unsupported version", () => {
    const r = formatDealMachineData("REISCRUB:v2:dealmachine\n[]");
    expect(r.payloadError).toMatch(/unsupported/i);
    expect(r.contacts).toEqual([]);
  });

  it("rejects invalid JSON and non-array JSON", () => {
    expect(formatDealMachineData(`${PAYLOAD_HEADER_V1}\n[{"id":1,`).payloadError).toMatch(/invalid/i);
    expect(formatDealMachineData(`${PAYLOAD_HEADER_V1}\n{"id":1}`).payloadError).toMatch(/array/i);
  });

  it("rejects more than the row cap", () => {
    const rows = Array.from({ length: PAYLOAD_MAX_ROWS + 1 }, (_, i) => row(i, `${i} A St`));
    expect(formatDealMachineData(payload(rows)).payloadError).toMatch(/too many rows/i);
    expect(formatDealMachineData(payload(rows.slice(0, PAYLOAD_MAX_ROWS))).payloadError).toBeUndefined();
  });

  it("rejects input over the total size cap", () => {
    const r = formatDealMachineData(`${PAYLOAD_HEADER_V1}\n[${" ".repeat(PAYLOAD_MAX_CHARS)}]`);
    expect(r.payloadError).toMatch(/too large/i);
  });
});

describe("legacy manual paste is unchanged", () => {
  it("matches the output of the pre-payload parser", () => {
    const text = "123 Main St\nView Lead\nAustin, TX 78701\n456 Oak Ave\nStart Mail\nDallas, TX 75201\n789 Pine Rd\n\nApt 5\nMiami, fl 33101-1234";
    expect(formatDealMachineData(text)).toEqual({
      contacts: [
        { address: "123 main st", city: "", state: "", zip: "" },
        { address: "456 oak ave", city: "", state: "", zip: "" },
        { address: "789 pine rd", city: "", state: "", zip: "" },
        { address: "apt 5", city: "miami", state: "fl", zip: "33101" },
      ],
      stats: { totalLines: 9, parsed: 4, skipped: 4 },
    });
  });

  it("does not add payload fields", () => {
    const r = formatDealMachineData("1 A St\nHouston, TX 77033");
    expect(r.flagged).toBeUndefined();
    expect(r.payloadError).toBeUndefined();
  });
});

describe("downloadCSV", () => {
  it("does nothing on empty input instead of throwing", () => {
    expect(() => downloadCSV([], "x.csv")).not.toThrow();
  });
});
