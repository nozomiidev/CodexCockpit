import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { encodeCompletedResponse } from "../src/sse.js";

interface EventFixture {
  readonly type: string;
  readonly response?: Readonly<Record<string, unknown>>;
  readonly item?: Readonly<Record<string, unknown>>;
}

describe("official Responses fixture contract", () => {
  it("matches the text-loop event order and payloads", async () => {
    const fixture = await fixtureJson("text-loop.json");
    expectGeneratedEvents(eventArray(fixture["expectedEvents"]));
  });

  it("matches both tool-call fixture event shapes", async () => {
    const fixture = await fixtureJson("tool-call-loop.json");
    const batches = fixture["expectedEventBatches"];
    if (!Array.isArray(batches)) throw new Error("fixture expectedEventBatches must be an array");
    for (const expected of batches) expectGeneratedEvents(eventArray(expected));
  });
});

function expectGeneratedEvents(expected: readonly EventFixture[]): void {
  const created = expected[0];
  const completed = expected.at(-1);
  if (created?.response === undefined || completed?.response === undefined) {
    throw new Error("fixture must start and end with response envelopes");
  }
  const responseId = requiredString(created.response, "id");
  const output = expected.flatMap((event) => (event.item === undefined ? [] : [event.item]));
  const actual = [
    { type: "response.created", response: { id: responseId } },
    ...encodeCompletedResponse(responseId, { output }).map(parseSseData),
  ];
  expect(actual).toHaveLength(expected.length);
  for (const [index, expectedEvent] of expected.entries()) {
    expect(actual[index]).toMatchObject(expectedEvent);
  }
}

async function fixtureJson(name: string): Promise<Readonly<Record<string, unknown>>> {
  const url = new URL(`../../../tests/fixtures/responses/${name}`, import.meta.url);
  const parsed: unknown = JSON.parse(await readFile(url, "utf8"));
  if (!isRecord(parsed)) throw new Error("fixture root must be an object");
  return parsed;
}

function parseSseData(frame: string): unknown {
  const data = frame
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  if (data === undefined) throw new Error("SSE frame has no data field");
  const parsed: unknown = JSON.parse(data);
  return parsed;
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`fixture ${key} must be a string`);
  return value;
}

function eventArray(value: unknown): readonly EventFixture[] {
  if (!Array.isArray(value) || !value.every(isEventFixture)) {
    throw new Error("fixture events must be valid event objects");
  }
  return value;
}

function isEventFixture(value: unknown): value is EventFixture {
  return isRecord(value) && typeof value["type"] === "string";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
