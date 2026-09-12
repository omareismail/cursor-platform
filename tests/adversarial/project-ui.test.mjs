#!/usr/bin/env node
/**
 * project-ui.test.mjs — portable Command Center page smoke (no browser binary).
 */

import { join } from "node:path";
import { check, report, section, REPO } from "../_harness.mjs";

const model = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_project-model.mjs").replace(/\\/g, "/")}`));
const dash = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "dashboard.mjs").replace(/\\/g, "/")}`));

function mockRes() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, h || {}); },
    end(buf) { this.body = buf; resolve(this); },
  };
  return { res, done };
}

async function http(method, url, host = "127.0.0.1:7777") {
  const { res, done } = mockRes();
  const ret = dash.onRequest({ method, url, headers: { host } }, res);
  await Promise.resolve(ret);
  if (res.body == null) await done;
  const text = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : String(res.body || "");
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.statusCode, text, json };
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

section("portable page smoke, keyboard hooks and contrast");
{
  const page = await http("GET", "/");
  check("page loads", page.status === 200 && /Command Center/.test(page.text), page.text.slice(0, 120));
  check("skip-link is first focusable affordance", /<a class="skip" href="#content">Skip to content<\/a>/.test(page.text), "");
  check("nav buttons are type=button", (page.text.match(/<button type="button" data-panel=/g) || []).length >= 16, String((page.text.match(/<button type="button" data-panel=/g) || []).length));
  check("focus-visible outline is defined", /button:focus-visible/.test(page.text), "");
  check("graph nodes are buttons with aria-label in the renderer", /aria-label/.test(page.text) && /graph-node/.test(page.text), "");
  const colors = {};
  for (const m of page.text.matchAll(/--(bg|text|muted|panel):(#(?:[0-9a-fA-F]{3,8}))/g)) colors[m[1]] = m[2];
  check("text on bg meets WCAG AA 4.5:1", colors.text && colors.bg && contrast(colors.text, colors.bg) >= 4.5, JSON.stringify({ ...colors, ratio: colors.text && colors.bg ? contrast(colors.text, colors.bg) : null }));
  check("muted on bg meets WCAG AA 4.5:1", colors.muted && colors.bg && contrast(colors.muted, colors.bg) >= 4.5, JSON.stringify({ muted: colors.muted, bg: colors.bg, ratio: colors.muted && colors.bg ? contrast(colors.muted, colors.bg) : null }));
  const graph = await http("GET", "/api/graph");
  check("GET /api/graph still 200", graph.status === 200 && Array.isArray(graph.json?.nodes), String(graph.status));
}

section("large-graph response-time budget");
{
  const phases = Array.from({ length: 40 }, (_, i) => ({ id: `PHASE-${String(i).padStart(3, "0")}`, name: `P${i}`, status: "PLANNED", order: i }));
  const checkpoints = phases.map((p, i) => ({ id: `CHK-${String(i).padStart(3, "0")}`, name: "T", phaseId: p.id, status: "NOT_STARTED", evidence: [{ id: `EV-${i}`, ref: `docs/${i}.md`, ok: true, valid: true }] }));
  const ideas = Array.from({ length: 80 }, (_, i) => ({
    id: `IDEA-${String(i).padStart(3, "0")}`, title: `I${i}`, status: "CAPTURED",
    implementationRefs: [`src/${i}.mjs`], testRefs: [`tests/${i}.test.mjs`], taskIds: [`T-${i}`],
  }));
  const features = ideas.map((_, i) => ({ id: `F-${i}`, name: `F${i}`, fileRefs: [`src/${i}.mjs`], testRefs: [`tests/${i}.test.mjs`] }));
  const t0 = Date.now();
  const g = model.buildGraph({ phases, checkpoints, ideas, features });
  const ms = Date.now() - t0;
  check("graph with 200+ nodes stays under 1500ms", g.nodes.length >= 200 && ms < 1500, `${ms}ms ${g.nodes.length} nodes`);
}

report();
