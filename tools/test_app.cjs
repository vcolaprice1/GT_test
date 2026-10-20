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
  const documentHandlers = {};
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: selector === "#scope" ? "all" : "",
      options: [], handlers: {}, innerHTML: "", textContent: "",
      append(value) { this.options.push(value); },
      addEventListener(event, fn) { this.handlers[event] = fn; },
      querySelector(child) { return element(`${selector} ${child}`); },
      querySelectorAll() { return []; },
      setAttribute(name, value) { this[name] = value; },
      contains(target) { return target === this || target.parent === this; },
      focus() {},
    });
    return elements.get(selector);
  }
  const context = vm.createContext({
    URL, console, records: structuredClone(records),
    document: { querySelector: element, createElement: () => ({}), body: { style: {} },
      addEventListener(event, fn) { documentHandlers[event] = fn; } },
  });
  vm.runInContext(source, context);
  vm.runInContext("state.records = records; setupFilters(); renderPdfPage = () => {};", context);
  return { element, documentHandlers, run: (code) => vm.runInContext(code, context) };
}

test("place menus close outside but stay open for internal selection", () => {
  const { element, documentHandlers, run } = harness();
  const publication = element("#publication-filter");
  const locality = element("#location-filter");
  publication.open = true;
  locality.open = true;
  run("setPlaceFilter('#publication-filter', ['Novara'])");
  documentHandlers.click({ target: { parent: publication } });
  assert.equal(publication.open, true);
  assert.equal(locality.open, false);
  documentHandlers.click({ target: element("#query") });
  assert.equal(publication.open, false);
  assert.equal(run("placeFilters['#publication-filter'].has('Novara')"), true);
});

test("captions are removed and publication corrections reach filters and years", () => {
  assert.ok(!html.includes("year-range-help"));
  assert.ok(!html.includes("Puoi scegliere più luoghi"));
  assert.ok(!html.includes("Estremi inclusi."));
  const novara = records.find(r => r.title === "Novara : pagine di storia");
  assert.equal(novara.publicationPlace, "Novara");
  assert.equal(novara.date, "1977");
  assert.equal(novara.year, 1977);
  assert.ok(!records.some(r => r.publicationPlace === "1977" || /Sant'\s+Albano/.test(r.publicationPlace)));
  const { element, run } = harness();
  run("setPlaceFilter('#publication-filter', ['Novara'])");
  element("#year-filter").value = "1977";
  element("#year-filter").handlers.change();
  assert.equal(run("state.filtered.some(r => r.title === 'Novara : pagine di storia')"), true);
});
test("every exact-year option filters the real catalogue and handles string years", () => {
  const { element, run } = harness();
  for (const { value } of element("#year-filter").options) {
    if (value === "undated") continue;
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

test("abbreviations expand only in filters and open detail; undated is selectable", () => {
  const { element, run } = harness();
  const undated = records.filter(r => /^s\.d\.$/i.test(r.date));
  assert.ok(undated.length > 0);
  assert.ok(element("#year-filter").options.some(o => o.value === "undated" && o.textContent === "S.d. (senza data)"));
  assert.ok(element("#publisher-filter").options.some(o => o.value === "S.n." && o.textContent === "S.n. (senza nome)"));
  assert.ok(element("#publication-filter .multi-options").innerHTML.includes("S.l. (senza luogo di edizione)"));
  element("#year-filter").value = "undated";
  element("#year-filter").handlers.change();
  assert.equal(run("state.filtered.length"), undated.length);
  assert.equal(run("matches({...records[0],date:'',year:null})"), false);
  run("openDetail({...records[0],publisher:'S.n.',publicationPlace:'S.l.',date:'S.d.',year:null})");
  const detail = element("#detail-content").innerHTML;
  for (const text of ["S.n. (senza nome)", "S.l. (senza luogo di edizione)", "S.d. (senza data)"]) assert.ok(detail.includes(text));
  const card = run("card({...records[0],publisher:'S.n.',date:'S.d.',year:null},0)");
  assert.ok(card.includes("S.n.") && card.includes("S.d."));
  assert.ok(!card.includes("senza nome") && !card.includes("senza data"));
  assert.ok(!records.some(r => /senza (luogo|nome|data)/.test([r.publisher,r.date,r.publicationPlace].join(" "))));
  element("#year-from").value = "1970";
  element("#year-from").handlers.change();
  assert.equal(element("#year-filter").value, "");
  element("#reset-filters").handlers.click();
  assert.equal(run("state.filtered.length"), records.length);
});

test("year text search, range and reset work", () => {
  const { element, run } = harness();
  element("#scope").value = "year";
  element("#query").value = "1980";
  element("#query").handlers.input();
  // 25 records beginning in 1980 + five multi-year editions spanning 1980.
  assert.equal(run("state.filtered.length"), 30);
  element("#year-from").value = "1940";
  element("#year-to").value = "1949";
  element("#year-to").handlers.change();
  assert.equal(run("state.filtered.length"), 0);
  element("#reset-filters").handlers.click();
  assert.equal(run("state.filtered.length"), records.length);
  assert.equal(element("#year-filter").value, "");
  assert.equal(element("#query").value, "");
  assert.equal(element("#scope").value, "all");
  assert.equal(element("#year-from").value, "");
  assert.equal(element("#year-to").value, "");
});

test("all detail cards hide internal tags and expose SBN only when present", () => {
  const { element, run } = harness();
  for (let i = 0; i < records.length; i++) {
    run(`openDetail(records[${i}])`);
    const detail = element("#detail-content").innerHTML;
    assert.ok(!detail.includes("Parole chiave"));
    assert.equal(detail.includes('class="sbn-link"'), records[i].sbnUrls.length > 0);
    assert.ok(!detail.includes("Consulta la scheda e le biblioteche"));
    assert.equal(detail.includes('class="detail-notes"'), records[i].notes.some(n => n.trim()));
  }
  assert.equal(run("sbnCatalogueLinks({sbnUrls:['javascript:alert(1)']})"), "");
  assert.equal(run("searchText({...records[0], tags:['INTERNAL_ONLY']}, 'all').includes('INTERNAL_ONLY')"), false);
  run("openDetail({...records[0], notes:['', '   ']})");
  assert.ok(!element("#detail-content").innerHTML.includes('class="detail-notes"'));
});

test("multiple places use OR within each group and AND between groups", () => {
  const { element, run } = harness();
  run("setPlaceFilter('#publication-filter', ['Torino','Roma']); applyFilters()");
  assert.equal(run("state.filtered.length"), records.filter(r => ["Torino", "Roma"].includes(r.publicationPlace)).length);
  run("setPlaceFilter('#location-filter', ['Caselle Torinese','Grugliasco']); applyFilters()");
  assert.equal(run("state.filtered.length"), records.filter(r => ["Torino", "Roma"].includes(r.publicationPlace) && r.locations.some(p => ["Caselle Torinese", "Grugliasco"].includes(p.name))).length);
  assert.ok(run("state.filtered.length") > 0);
  element("#reset-filters").handlers.click();
  assert.equal(run("state.filtered.length"), records.length);
  assert.equal(run("placeFilters['#publication-filter'].size + placeFilters['#location-filter'].size"), 0);
});

test("custom year range is inclusive, overlaps editions and supports open bounds", () => {
  const { element, run } = harness();
  element("#year-filter").value = "1980";
  element("#year-from").value = "1970";
  element("#year-from").handlers.change();
  assert.equal(element("#year-filter").value, "");
  element("#year-to").value = "1973";
  element("#year-to").handlers.change();
  const expected = records.filter(r => {
    const bounds = r.date.match(/^(\d{4})(?:-(\d{4}))?$/);
    return bounds && Number(bounds[1]) <= 1973 && Number(bounds[2] || bounds[1]) >= 1970;
  }).length;
  assert.equal(run("state.filtered.length"), expected);
  for (const date of ["1970", "1973", "1968-1974", "1973-1980"]) {
    assert.equal(run(`matches({...records[0], date: '${date}'})`), true, date);
  }
  for (const date of ["1969", "1974", "S.d."]) {
    assert.equal(run(`matches({...records[0], date: '${date}', year:null})`), false, date);
  }
  element("#year-from").value = "1975";
  element("#year-from").handlers.change();
  assert.equal(run("state.filtered.length"), 0);
  assert.equal(element("#year-range-error").hidden, false);
  element("#year-from").value = "";
  element("#year-from").handlers.change();
  assert.equal(element("#year-range-error").hidden, true);
  assert.equal(run("matches({...records[0], date: '1960'})"), true);
  element("#year-filter").value = "1980";
  element("#year-filter").handlers.change();
  assert.equal(element("#year-from").value, "");
  assert.equal(element("#year-to").value, "");
  assert.equal(run("state.filtered.length"), 30);
});

test("map shortcut replaces rather than adds to the current locality selection", () => {
  const { run } = harness();
  run("setPlaceFilter('#location-filter',['Torino','Grugliasco']); setPlaceFilter('#location-filter',['Caselle Torinese']); applyFilters()");
  assert.equal(run("placeFilters['#location-filter'].size"), 1);
  assert.equal(run("state.filtered.length"), 2);
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
