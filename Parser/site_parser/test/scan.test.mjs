import test from "node:test";
import assert from "node:assert/strict";
import { scanText, formatScanReport, loadMap, dictionaryWords } from "../text/scan.mjs";

test("JavaScript scanner mirrors the structural scan rules", () => {
  const report = scanText("ကိ ိ သွားသွားသွား", { dictionary: new Set(["ကိ"]) });
  assert.equal(report.orphan.total, 1);
  assert.equal(report.repeat.total, 1);
  assert.equal(report.unknown.total, 1);
  assert.ok(report.orphan.clusters[0].context.includes("ကိ"));
  assert.match(formatScanReport(report, { source: "sample.txt" }), /context:/u);
  assert.match(formatScanReport(report, { source: "sample.txt" }), /praser scan {2}sample\.txt/u);
});

test("sealed master map is loaded only by an explicit scanner dictionary request", () => {
  const data = loadMap("Parsed/parser/model/master.json.enc");
  const words = dictionaryWords(data);
  assert.deepEqual(Object.keys(data), ["dictionary", "top", "resolution", "syllables", "mapData"]);
  assert.ok(words.size > 1000);
});
