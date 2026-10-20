const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const records = JSON.parse(fs.readFileSync(path.join(root, "data/catalogo.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\nstart\(\);\s*$/, "");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function harness() {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: selector === "#scope" ? "all" : "",
      options: [], handlers: {}, innerHTML: "", textContent: "",
      append(value) { this.options.push(value); },
      addEventListener(event, fn) { this.handlers[event] = fn; },
      focus() {},
    });
    return elements.get(selector);
  }
  const context = vm.createContext({
    URL, console, records: structuredClone(records),
    document: { querySelector: element, createElement: () => ({}), body: { style: {} } },
  });
  vm.runInContext(source, context);
  vm.runInContext("state.records = records; setupFilters(); renderPdfPage = () => {};", context);
  return { element, run: (code) => vm.runInContext(code, context) };
}

test("every exact-year option filters the real catalogue and handles string years", () => {
  const { element, run } = harness();
  for (const { value } of element("#year-filter").options) {
    element("#year-filter").value = value;
    element("#year-filter").handlers.change();
    const expected = records.filter(r => {
      const bounds = r.date.match(/^(\d{4})-(\d{4})$/);
      return bounds ? Number(value) >= Number(bounds[1]) && Number(value) <= Number(bounds[2]) : r.year === Number(value);
    }).length;
    assert.equal(run("state.filtered.length"), expected, value);
    assert.ok(expected > 0);
  }
  element("#year-filter").value = "1980";
  assert.equal(run("matches({...records.find(r => r.year === 1980), year: '1980'})"), true);
  assert.equal(run("publicationYears({date: '[1980]'})[0]"), 1980);
  assert.equal(run("publicationYears({date: 'S.d.'}).length"), 0);
  assert.equal(run("publicationYears({date: '1978–1980'}).join(',')"), "1978,1979,1980");
  assert.equal(run("publicationYears({year:'1980'}).join(',')"), "1980");
});

test("year text search, combined decade and reset work", () => {
  const { element, run } = harness();
  element("#scope").value = "year";
  element("#query").value = "1980";
  element("#query").handlers.input();
  // 25 records beginning in 1980 + five multi-year editions spanning 1980.
  assert.equal(run("state.filtered.length"), 30);
  element("#year-filter").value = "1980";
  element("#period-filter").value = "1940–1949";
  element("#period-filter").handlers.change();
  assert.equal(run("state.filtered.length"), 0);
  element("#reset-filters").handlers.click();
  assert.equal(run("state.filtered.length"), records.length);
  assert.equal(element("#year-filter").value, "");
  assert.equal(element("#query").value, "");
  assert.equal(element("#scope").value, "all");
});

test("all detail cards hide internal tags and expose SBN only when present", () => {
  const { element, run } = harness();
  for (let i = 0; i < records.length; i++) {
    run(`openDetail(records[${i}])`);
    const detail = element("#detail-content").innerHTML;
    assert.ok(!detail.includes("Parole chiave"));
    assert.equal(detail.includes('class="sbn-link"'), records[i].sbnUrls.length > 0);
  }
  assert.equal(run("sbnCatalogueLinks({sbnUrls:['javascript:alert(1)']})"), "");
  assert.equal(run("searchText({...records[0], tags:['INTERNAL_ONLY']}, 'all').includes('INTERNAL_ONLY')"), false);
});

test("HTML assets and catalogue have the same cache revision", () => {
  const script = html.match(/src="app\.js\?v=([^"]+)"/)[1];
  const css = html.match(/href="styles\.css\?v=([^"]+)"/)[1];
  const data = source.match(/catalogo\.json\?v=([^"]+)"/)[1];
  assert.equal(script, css);
  assert.equal(script, data);
  assert.ok(source.includes('cache: "no-cache"'));
});

test("normalized map places do not retain known duplicate spellings", () => {
  const places = records.flatMap(r => r.locations);
  assert.ok(!places.some(p => ["CAselle Torinese", "Ivea", "Cirié", "Cariglio"].includes(p.name)));
  const caselle = places.filter(p => p.name === "Caselle Torinese");
  assert.ok(caselle.length > 1);
  assert.equal(new Set(caselle.map(p => `${p.name}|${p.province}|${p.lat}|${p.lon}`)).size, 1);
  assert.equal(records.filter(r => r.locations.some(p => Number.isFinite(p.lat))).length, 484);
});
