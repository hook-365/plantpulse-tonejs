import { test } from "node:test";
import assert from "node:assert/strict";
import { SignalProcessor } from "../static/js/signal.js";

test("a flat signal reads zero activity and volatility, centred", () => {
  const p = new SignalProcessor();
  let s;
  for (let i = 0; i < 100; i++) s = p.process(50);
  assert.equal(s.raw, 50);
  assert.equal(s.smoothed, 50);
  assert.ok(s.activity < 1e-6);
  assert.ok(s.volatility < 1e-6);
  assert.equal(s.trend, 0);
  assert.equal(s.signal_norm, 0);
});

test("a 70 mV step saturates activity toward 100 and decays with the 0.3 follower", () => {
  const p = new SignalProcessor();
  for (let i = 0; i < 20; i++) p.process(0);
  //! five readings at +350 mV move the 5-window mean by 70 mV per tick;
  //! the delta clips at 50 mV (of 70 = 71.4%), the 0.3 follower takes 21.4
  const a1 = p.process(350).activity;
  assert.ok(a1 > 21 && a1 < 22, `first tick ${a1}`);
  let s;
  for (let i = 0; i < 4; i++) s = p.process(350);
  assert.ok(s.activity > 55, `toward the clipped 71.4: ${s.activity}`);
  for (let i = 0; i < 40; i++) s = p.process(350);
  assert.ok(s.activity < 1, `decayed ${s.activity}`);
});

test("signal_norm tracks the 10-minute band and clamps", () => {
  const p = new SignalProcessor();
  let s;
  for (let i = 0; i < 300; i++) s = p.process(i % 2 ? 100 : 0);
  assert.ok(Math.abs(s.signal_norm) <= 1);
  for (let i = 0; i < 300; i++) s = p.process(100);
  assert.ok(s.signal_norm > 0.9, `high side ${s.signal_norm}`);
});
