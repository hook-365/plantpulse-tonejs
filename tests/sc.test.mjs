import { test } from "node:test";
import assert from "node:assert/strict";
import * as sc from "../static/js/sc.js";
import { mulberry32 } from "./rng.mjs";

test("rrand on integers is an inclusive integer draw", () => {
  sc.setRng(mulberry32(7));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(sc.rrand(2, 4));
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
  for (let i = 0; i < 200; i++) { const x = sc.rrand(0.5, 1.5); assert.ok(x >= 0.5 && x < 1.5 && !Number.isInteger(x)); }
  sc.setRng(null);
});

test("coin: 0 never, 1 always, 0.3 about a third", () => {
  sc.setRng(mulberry32(3));
  let n0 = 0, n1 = 0, n3 = 0;
  for (let i = 0; i < 5000; i++) { if (sc.coin(0)) n0++; if (sc.coin(1)) n1++; if (sc.coin(0.3)) n3++; }
  assert.equal(n0, 0); assert.equal(n1, 5000);
  assert.ok(n3 > 1350 && n3 < 1650, `coin(0.3) hit ${n3}/5000`);
  sc.setRng(null);
});

test("wchoose follows its weights and normalises them", () => {
  sc.setRng(mulberry32(11));
  const c = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 6000; i++) c[sc.wchoose(["a", "b", "c"], [3, 1, 0])]++;
  assert.equal(c.c, 0);
  assert.ok(Math.abs(c.a / c.b - 3) < 0.4, `a:b = ${c.a}:${c.b}`);
  sc.setRng(null);
});

test("gauss has the requested moments", () => {
  sc.setRng(mulberry32(5));
  const xs = Array.from({ length: 20000 }, () => sc.gauss(2, 0.5));
  const m = sc.mean(xs);
  const sd = Math.sqrt(sc.mean(xs.map((x) => (x - m) ** 2)));
  assert.ok(Math.abs(m - 2) < 0.02, `mean ${m}`);
  assert.ok(Math.abs(sd - 0.5) < 0.02, `sd ${sd}`);
  sc.setRng(null);
});

test("div, mod, roundTo, fold, wrap, linlin match sclang", () => {
  assert.equal(sc.div(-7, 2), -4);
  assert.equal(sc.mod(-1, 7), 6);
  assert.equal(sc.roundTo(2.5), 3);
  assert.equal(sc.roundTo(1.234, 0.01), 1.23);
  assert.equal(sc.fold(11, 0, 10), 9);
  assert.equal(sc.wrap(11, 0, 10), 1);
  assert.equal(sc.linlin(0.5, 0, 1, 10, 20), 15);
  assert.equal(sc.linlin(2, 0, 1, 10, 20), 20);
  assert.equal(sc.nilOr(0, 5), 0);
  assert.equal(sc.nilOr(null, 5), 5);
});
