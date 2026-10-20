const state = { records: [], filtered: [], visible: 12, map: null, markers: null, previousFocus: null, suggestion: "", pdfDocument: null, pdfUrl: "", pdfTask: null, pdfToken: 0 };
const $ = (selector) => document.querySelector(selector);
const norm = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").trim();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
const selectors = ["#query", "#scope", "#author-filter", "#publisher-filter", "#title-filter", "#year-filter", "#year-from", "#year-to"];
const placeFilters = { "#publication-filter": new Set(), "#location-filter": new Set() };
const isUndated = (record) => /^\s*s\s*\.\s*d\s*\.?\s*$/i.test(record.date || "");
function expandedLabel(value, field) {
  const labels = { publicationPlace: ["sl", "S.l. (senza luogo di edizione)"], publisher: ["sn", "S.n. (senza nome)"], date: ["sd", "S.d. (senza data)"] };
  const label = labels[field];
  return label && String(value ?? "").toLowerCase().replace(/[.\s]/g, "") === label[0] ? label[1] : value;
}

function setPlaceFilter(selector, values) {
  placeFilters[selector] = new Set(values);
  const control = $(selector);
  for (const input of control.querySelectorAll('input[type="checkbox"]')) input.checked = placeFilters[selector].has(input.value);
  const selected = [...placeFilters[selector]];
  control.querySelector("summary span").textContent = selected.length ? selected.map(value => selector === "#publication-filter" ? expandedLabel(value, "publicationPlace") : value).join(", ") : (selector === "#location-filter" ? "Tutte" : "Tutti");
}

function setupPlaceFilter(selector, values) {
  const control = $(selector);
  control.querySelector(".multi-options").innerHTML = unique(values).map(value => `<label class="place-option"><input type="checkbox" value="${esc(value)}" /><span>${esc(selector === "#publication-filter" ? expandedLabel(value, "publicationPlace") : value)}</span></label>`).join("");
  const search = control.querySelector('input[type="search"]');
  const filterOptions = () => {
    for (const label of control.querySelectorAll(".place-option")) label.hidden = !norm(label.textContent).includes(norm(search.value));
  };
  search.addEventListener("input", filterOptions);
  control.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const selected = new Set(placeFilters[selector]);
    if (event.target.checked) selected.add(event.target.value);
    else selected.delete(event.target.value);
    setPlaceFilter(selector, selected);
    state.visible = 12;
    applyFilters();
  });
  control.querySelector(".clear-places").addEventListener("click", () => {
    setPlaceFilter(selector, []);
    search.value = "";
    filterOptions();
    state.visible = 12;
    applyFilters();
  });
}

function publicationYears(record) {
  const date = String(record.date || record.year || "");
  const range = date.match(/\b((?:1[5-9]|20)\d{2})\s*[-–—/]\s*((?:1[5-9]|20)\d{2})\b/);
  if (range && Number(range[2]) >= Number(range[1])) {
    return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
  }
  const years = date.match(/\b(?:1[5-9]|20)\d{2}\b/g);
  if (years) return [...new Set(years.map(Number))];
  const fallback = String(record.year ?? "").match(/^(?:1[5-9]|20)\d{2}$/);
  return fallback ? [Number(fallback[0])] : [];
}

function fillSelect(selector, values, label = value => value) {
  const select = $(selector);
  for (const value of unique(values)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label(value);
    select.append(option);
  }
}

function setupFilters() {
  fillSelect("#author-filter", state.records.flatMap((r) => [...(r.authors || []), ...(r.editors || [])]));
  fillSelect("#publisher-filter", state.records.map((r) => r.publisher), value => expandedLabel(value, "publisher"));
  fillSelect("#title-filter", state.records.map((r) => r.title));
  setupPlaceFilter("#publication-filter", state.records.map((r) => r.publicationPlace));
  setupPlaceFilter("#location-filter", state.records.flatMap((r) => r.locations.map((p) => p.name)));
  document.addEventListener("click", (event) => {
    for (const selector of Object.keys(placeFilters)) {
      const control = $(selector);
      if (control.open && !control.contains(event.target)) control.open = false;
    }
  });
  const years = state.records.flatMap((r) => publicationYears(r));
  fillSelect("#year-filter", years.map(String));
  if (state.records.some(isUndated)) fillSelect("#year-filter", ["undated"], () => "S.d. (senza data)");
  const rangeYears = years.length ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => String(Math.min(...years) + i)) : [];
  fillSelect("#year-from", rangeYears);
  fillSelect("#year-to", rangeYears);
  for (const selector of selectors) $(selector).addEventListener(selector === "#query" ? "input" : "change", () => {
    if (selector === "#year-filter" && $(selector).value) {
      $("#year-from").value = "";
      $("#year-to").value = "";
    } else if (["#year-from", "#year-to"].includes(selector) && $(selector).value) {
      $("#year-filter").value = "";
    }
    state.visible = 12;
    applyFilters();
  });
  $("#reset-filters").addEventListener("click", () => {
    for (const selector of selectors) $(selector).value = "";
    for (const selector of Object.keys(placeFilters)) {
      setPlaceFilter(selector, []);
      $(selector).querySelector('input[type="search"]').value = "";
      for (const label of $(selector).querySelectorAll(".place-option")) label.hidden = false;
      $(selector).open = false;
    }
    $("#scope").value = "all";
    state.visible = 12;
    applyFilters();
  });
}

function searchText(record, scope) {
  const fields = {
    title: record.title,
    authors: [...record.authors, ...record.editors].join(" "),
    publisher: record.publisher,
    publicationPlace: record.publicationPlace,
    locations: record.locations.map((p) => `${p.name} ${p.province}`).join(" "),
    year: [...publicationYears(record), record.date].filter(Boolean).join(" "),
    notes: record.notes.join(" "),
  };
  return scope === "all" ? Object.values(fields).join(" ") : fields[scope] || "";
}

function matches(record) {
  const query = norm($("#query").value);
  if (query && $("#scope").value === "year" && /^\d{4}$/.test(query) && !publicationYears(record).includes(Number(query))) return false;
  if (query && !norm(searchText(record, $("#scope").value)).includes(query)) return false;
  const author = $("#author-filter").value;
  if (author && ![...record.authors, ...record.editors].includes(author)) return false;
  if ($("#publisher-filter").value && record.publisher !== $("#publisher-filter").value) return false;
  if ($("#title-filter").value && record.title !== $("#title-filter").value) return false;
  if (placeFilters["#publication-filter"].size && !placeFilters["#publication-filter"].has(record.publicationPlace)) return false;
  if (placeFilters["#location-filter"].size && !record.locations.some((p) => placeFilters["#location-filter"].has(p.name))) return false;
  if ($("#year-filter").value === "undated") {
    if (!isUndated(record)) return false;
  } else if ($("#year-filter").value && !publicationYears(record).includes(Number($("#year-filter").value))) return false;
  if ($("#year-from").value || $("#year-to").value) {
    const from = $("#year-from").value ? Number($("#year-from").value) : -Infinity;
    const to = $("#year-to").value ? Number($("#year-to").value) : Infinity;
    if (!publicationYears(record).some((year) => year >= from && year <= to)) return false;
  }
  return true;
}

function card(record, index) {
  const person = (label, people) => people?.length ? `<div class="card-person"><span class="card-label">${label}</span><span>${esc(people.join(", "))}</span></div>` : "";
  const published = record.date || record.year || "s.d.";
  const place = record.locations.map((p) => p.name).join(", ") || "Non indicata";
  return `<article class="result-card">
    <div class="card-top"><span class="card-number">SCHEDA ${String(index + 1).padStart(3, "0")}</span></div>
    <div class="card-label card-title-label">TITOLO</div><h3>${esc(record.title)}</h3>
    <div class="card-people">${person("AUTORE", record.authors)}${person("CURATORE", record.editors)}</div>
    <div class="card-publication"><div><span class="card-label">ANNO</span><span>${esc(published)}</span></div>${record.publisher ? `<div><span class="card-label">EDITORE</span><span>${esc(record.publisher)}</span></div>` : ""}</div>
    <div class="card-divider"></div><div class="card-bottom"><div class="card-place"><span class="card-label">LOCALITÀ TRATTATA</span><span>${esc(place)}</span></div><button type="button" class="card-button" data-record="${esc(record.id)}" aria-label="Apri la scheda di ${esc(record.title)}">Apri scheda ↗</button></div>
  </article>`;
}

function renderResults() {
  const total = state.filtered.length;
  $("#result-count").textContent = `${total} ${total === 1 ? "pubblicazione trovata" : "pubblicazioni trovate"}`;
  if (!total) {
    $("#results").innerHTML = `<div class="empty-state"><h3>Nessun risultato</h3><p>Prova una parola diversa oppure azzera i filtri.</p></div>`;
  } else {
    $("#results").innerHTML = state.filtered.slice(0, state.visible).map((r) => card(r, state.records.indexOf(r))).join("");
  }
  $("#more-results").hidden = total <= state.visible;
}

function applyFilters() {
  const invalidRange = Boolean($("#year-from").value && $("#year-to").value && Number($("#year-from").value) > Number($("#year-to").value));
  $("#year-range-error").hidden = !invalidRange;
  $("#year-to").setAttribute("aria-invalid", String(invalidRange));
  state.filtered = state.records.filter(matches);
  renderResults();
  renderMapMarkers();
}

function fact(label, value) {
  return value ? `<div class="detail-fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "";
}

function sbnCatalogueLinks(record) {
  const urls = (record.sbnUrls || []).filter((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && ["opac.sbn.it", "www.sbn.it", "sbn.it"].includes(url.hostname);
    } catch (_) { return false; }
  });
  return urls.length ? `<div class="sbn-links">${urls.map((url, index) => `<a class="sbn-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Consulta nel catalogo SBN${urls.length > 1 ? ` · ${index + 1}` : ""} ↗</a>`).join("")}</div>` : "";
}

function openDetail(record) {
  state.previousFocus = document.activeElement;
  const places = record.locations.map((p) => `${p.name}${p.province ? ` (${p.province})` : ""}`).join(", ");
  const notes = (record.notes || []).filter(note => String(note).trim());
  $("#detail-content").innerHTML = `<div class="detail-layout">
    <div class="detail-meta"><div class="detail-kicker">SCHEDA BIBLIOGRAFICA</div><h2 id="detail-title">${esc(record.title)}</h2>
      <dl class="detail-facts">${fact("Autore", record.authors.join(", "))}${fact("Curatore", record.editors.join(", "))}${fact("Editore", expandedLabel(record.publisher, "publisher"))}${fact("Luogo di edizione", expandedLabel(record.publicationPlace, "publicationPlace"))}${fact("Anno", expandedLabel(record.date, "date"))}${fact("Località trattata", places)}</dl>
      ${sbnCatalogueLinks(record)}
      ${notes.length ? `<div class="detail-notes"><h3>Note</h3>${notes.map((note) => `<p>${esc(note)}</p>`).join("")}</div>` : ""}
    </div>
    <div class="pdf-pane"><div class="pdf-heading"><h3>Documento associato</h3><span class="sample-badge">PDF DIMOSTRATIVO</span></div><p class="pdf-disclaimer">Il documento campione è temporaneamente associato a tutte le schede. Non è il testo della pubblicazione indicata.</p>
      <div class="pdf-cover-row"><img class="pdf-cover" src="assets/copertina-campione.png" alt="Prima pagina del PDF dimostrativo" /><div class="pdf-index"><div class="pdf-index-title">INDICE DEL DOCUMENTO</div><div class="pdf-pages"><button type="button" data-page="1" class="active" aria-label="Pagina 1">1</button><button type="button" data-page="2" aria-label="Pagina 2">2</button><button type="button" data-page="3" aria-label="Pagina 3">3</button></div></div></div>
      <div class="pdf-canvas-wrap" role="region" aria-label="Lettore del PDF dimostrativo"><canvas id="pdf-canvas" aria-label="Pagina del PDF dimostrativo"></canvas><p id="pdf-message" role="status">Caricamento della pagina…</p></div><a class="pdf-open" href="${esc(record.pdf)}" target="_blank" rel="noopener noreferrer">Apri il PDF in una nuova scheda ↗</a>
    </div>
  </div>`;
  $("#detail-overlay").hidden = false;
  document.body.style.overflow = "hidden";
  $("#detail-close").focus();
  renderPdfPage(1, record.pdf);
}

async function renderPdfPage(pageNumber, pdfUrl = "assets/cfp-inwood.pdf") {
  const token = ++state.pdfToken;
  const message = $("#pdf-message");
  if (!message) return;
  message.hidden = false;
  message.textContent = "Caricamento della pagina…";
  try {
    if (!window.pdfjsLib) throw new Error("Lettore PDF non caricato");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    if (state.pdfUrl !== pdfUrl) {
      state.pdfUrl = pdfUrl;
      state.pdfDocument = null;
    }
    if (!state.pdfDocument) state.pdfDocument = await pdfjsLib.getDocument(pdfUrl).promise;
    const documentPdf = state.pdfDocument;
    if (token !== state.pdfToken) return;
    const pageList = $(".pdf-pages");
    if (pageList && Number(pageList.dataset.pages) !== documentPdf.numPages) {
      pageList.innerHTML = Array.from({ length: documentPdf.numPages }, (_, index) => `<button type="button" data-page="${index + 1}" aria-label="Pagina ${index + 1}">${index + 1}</button>`).join("");
      pageList.dataset.pages = String(documentPdf.numPages);
    }
    const page = await documentPdf.getPage(pageNumber);
    if (token !== state.pdfToken) return;
    const canvas = $("#pdf-canvas");
    const wrap = $(".pdf-canvas-wrap");
    if (!canvas || !wrap) return;
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min((wrap.clientWidth - 20) / natural.width, 1.4);
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewport.width * pixelRatio);
    canvas.height = Math.round(viewport.height * pixelRatio);
    canvas.style.width = `${Math.round(viewport.width)}px`;
    canvas.style.height = `${Math.round(viewport.height)}px`;
    const context = canvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (state.pdfTask) {
      state.pdfTask.cancel();
      try { await state.pdfTask.promise; } catch (_) { /* Cancellation is expected. */ }
    }
    if (token !== state.pdfToken) return;
    state.pdfTask = page.render({ canvasContext: context, viewport });
    await state.pdfTask.promise;
    if (token !== state.pdfToken) return;
    message.hidden = true;
    wrap.scrollTop = 0;
    document.querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", Number(button.dataset.page) === pageNumber));
  } catch (error) {
    if (token !== state.pdfToken) return;
    message.hidden = false;
    message.textContent = "Anteprima non disponibile. Apri il PDF in una nuova scheda.";
    console.error(error);
  }
}

function closeDetail() {
  state.pdfToken++;
  if (state.pdfTask) state.pdfTask.cancel();
  $("#detail-overlay").hidden = true;
  document.body.style.overflow = "";
  state.previousFocus?.focus?.();
}

function setupDetail() {
  document.addEventListener("click", (event) => {
    const open = event.target.closest("[data-record]");
    if (open) {
      const record = state.records.find((r) => r.id === open.dataset.record);
      if (record) openDetail(record);
    }
    if (event.target.closest("[data-close]")) closeDetail();
    const page = event.target.closest("[data-page]");
    if (page) {
      renderPdfPage(Number(page.dataset.page), state.pdfUrl);
    }
    const placeButton = event.target.closest("[data-place]");
    if (placeButton) {
      setPlaceFilter("#location-filter", [placeButton.dataset.place]);
      $("#advanced-filters").open = true;
      state.visible = 12;
      applyFilters();
      state.map?.closePopup();
      $("#catalogo").scrollIntoView({ behavior: "smooth" });
    }
  });
  $("#detail-close").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#detail-overlay").hidden) closeDetail(); });
}

function initMap() {
  if (!window.L) {
    $("#map").innerHTML = `<p style="padding:25px;color:#183a37">La mappa non è disponibile: controlla la connessione Internet. Il catalogo resta consultabile.</p>`;
    return;
  }
  state.map = L.map("map", { scrollWheelZoom: false }).setView([45.05, 8.0], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(state.map);
  fetch("data/piemonte.geojson").then((response) => {
    if (!response.ok) throw new Error(`Confine Piemonte: HTTP ${response.status}`);
    return response.json();
  }).then((boundary) => {
    L.geoJSON(boundary, { interactive: false, style: { color: "#173f3b", weight: 3, opacity: 0.95, fillColor: "#b85840", fillOpacity: 0.08 } }).addTo(state.map);
  }).catch((error) => console.warn("Confine del Piemonte non disponibile", error));
  state.markers = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44 });
  state.map.addLayer(state.markers);
}

function renderMapMarkers() {
  if (!state.map || !state.markers) return;
  state.markers.clearLayers();
  const places = new Map();
  for (const record of state.filtered) for (const place of record.locations) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    const key = `${place.name}|${place.province}|${place.lat}|${place.lon}`;
    if (!places.has(key)) places.set(key, { ...place, records: [] });
    places.get(key).records.push(record);
  }
  for (const place of places.values()) {
    const icon = L.divIcon({ html: '<span class="map-pin"><span class="map-pin-core"></span></span>', className: "map-pin-icon", iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
    const marker = L.marker([place.lat, place.lon], { icon, title: place.name, alt: `Località trattata: ${place.name}` });
    const heading = `${esc(place.name)}${place.province ? ` (${esc(place.province)})` : ""}`;
    const links = place.records.slice(0, 4).map((r) => `<button type="button" data-record="${esc(r.id)}" style="display:block;width:100%;text-align:left;margin-top:5px">${esc(r.title)}</button>`).join("");
    marker.bindPopup(`<div class="place-popup"><strong>${heading}</strong><p>${place.records.length} ${place.records.length === 1 ? "pubblicazione" : "pubblicazioni"}</p>${links}<button type="button" class="popup-catalog-link" data-place="${esc(place.name)}">Vedi nel catalogo ↗</button></div>`);
    state.markers.addLayer(marker);
  }
  $("#map-count").textContent = state.filtered.filter((r) => r.locations.some((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))).length;
  if (places.size) state.map.fitBounds(state.markers.getBounds(), { padding: [28, 28], maxZoom: 10 });
  setTimeout(() => state.map.invalidateSize(), 0);
}

function setupSuggestions() {
  const form = $("#suggestion-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    state.suggestion = `Segnalazione per Storie di paese Piemonte\n\nTitolo: ${values.title}\nAutore/curatore: ${values.author || "Non indicato"}\nAnno: ${values.year || "Non indicato"}\nLocalità trattata: ${values.place || "Non indicata"}\nDettagli: ${values.details || "Nessuno"}\n`;
    $("#suggestion-output").hidden = false;
    const host = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    const repo = location.pathname.split("/").filter(Boolean)[0] || (host ? `${host[1]}.github.io` : "");
    if (host && repo) {
      const url = `https://github.com/${host[1]}/${repo}/issues/new?` + new URLSearchParams({ title: `Segnalazione: ${values.title}`, body: state.suggestion });
      $("#github-issue-link").href = url;
      $("#github-issue-link").hidden = false;
      $("#suggestion-status").textContent = "La segnalazione è pronta. Apri GitHub Issues per inviarla.";
    } else {
      $("#github-issue-link").hidden = true;
      $("#suggestion-status").textContent = "La segnalazione è pronta. Scarica il testo per conservarlo e inviarlo alla redazione.";
    }
  });
  $("#download-suggestion").addEventListener("click", () => {
    if (!state.suggestion) return;
    const url = URL.createObjectURL(new Blob([state.suggestion], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "segnalazione-storie-di-paese.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function renderStats() {
  const records = state.records;
  const places = unique(records.flatMap((r) => r.locations.map((p) => `${norm(p.name)}|${p.province}`)));
  const years = records.flatMap(publicationYears).sort((a, b) => a - b);
  $("#stat-records").textContent = records.length;
  $("#stat-places").textContent = places.length;
  $("#stat-publishers").textContent = unique(records.map((r) => r.publisher)).length;
  $("#stat-years").textContent = years.length ? `${years[0]}–${years.at(-1)}` : "—";
}

async function start() {
  setupDetail();
  setupSuggestions();
  $("#more-results").addEventListener("click", () => { state.visible += 12; renderResults(); });
  try {
    // Revalidate the catalogue; a fresh script must not use a stale export.
    const response = await fetch("data/catalogo.json?v=20261020-5", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.records = await response.json();
    state.records.sort((a, b) => a.title.localeCompare(b.title, "it", { sensitivity: "base" }));
    renderStats();
    setupFilters();
    initMap();
    applyFilters();
  } catch (error) {
    $("#result-count").textContent = "Impossibile caricare il catalogo";
    $("#results").innerHTML = `<div class="empty-state"><h3>Catalogo non disponibile</h3><p>Ricarica la pagina oppure apri il sito tramite un server web.</p></div>`;
    console.error(error);
  }
}

start();
