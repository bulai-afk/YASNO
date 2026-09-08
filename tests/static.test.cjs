const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
test("JavaScript parses", () => assert.doesNotThrow(() => new Function(script)));
test("No external assets or network calls", () => {
  assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});
test("All seven routes exist", () => {
  for (const route of ["overview", "traffic", "sources", "audit", "plan", "projects", "login"]) {
    assert.match(script, new RegExp("function " + route + "\\("));
  }
});
test("Explicit demo disclosure and accessible modal", () => {
  assert.match(html, /Демонстрационные данные/);
  assert.match(html, /aria-labelledby="dialog-title"/);
  assert.match(html, /lang="ru"/);
  assert.match(html, /prefers-reduced-motion/);
});
