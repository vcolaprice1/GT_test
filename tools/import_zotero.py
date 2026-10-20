"""Convert a Zotero RDF export into the static catalogue used by the site.

Usage: python tools/import_zotero.py path/to/export.rdf [--geocode]
Geocoding uses Nominatim only during import and keeps a local cache.
"""

import argparse
import hashlib
from html.parser import HTMLParser
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
NS = {
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
    "bib": "http://purl.org/net/biblio#",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "vcard": "http://nwalsh.com/rdf/vCard#",
    "z": "http://www.zotero.org/namespaces/export#",
    "dcterms": "http://purl.org/dc/terms/",
    "link": "http://purl.org/rss/1.0/modules/link/",
}

ALIASES = {
    "Briga": "Briga Novarese",
    "Barbania Canavese": "Barbania",
    "Borgofranco di seso": "Borgosesia",
    "Miradolo": "San Secondo di Pinerolo",
    "Pino": "Pino Torinese",
    "CAselle Torinese": "Caselle Torinese",
    "Caltignana": "Caltignaga",
    "Ricetto": "Candelo",
    "Val d'Ellero e Alta val Tanaro": "Mondovì",
    "Val di Susa": "Susa",
    "Val Sessera e Val Strona": "Valdilana",
    "Valli di Lanzo": "Lanzo Torinese",
    "Canavese": "Rivarolo Canavese",
    # Transcription variants in the export; keep the original label in the UI.
    "Belgiarate": "Belgirate",
    "Borgofranco di seso (Borgosesia, VC)": "Borgosesia",
    "Bussolino Gassinese": "Gassino Torinese",
    "Cavallarmaggiore": "Cavallermaggiore",
    "Cariglio": "Caraglio",
    "Forno Cnavese": "Forno Canavese",
    "Ivea": "Ivrea",
    "Lanzo Toriese": "Lanzo Torinese",
    "Nieve": "Neive",
    "Novi Liguere": "Novi Ligure",
    "Pacetto Torinese": "Pecetto Torinese",
    "Pinero": "Pinerolo",
    "Piosacco": "Piossasco",
    "Pont Caavese": "Pont Canavese",
    "Veverone": "Viverone",
    # Broad areas are represented by a reference locality on the map.
    "Alta Val Chisone": "Pragelato",
    "Cinzano Rivalba": "Cinzano",
    "Oltregiogo": "Novi Ligure",
    "Parella, Colleretto, Loranzè, Quagliuzzo": "Parella",
    "Piaggio Valmara (Canobbio, VCO)": "Cannobio",
    "Pinerolo, Val Chisone e Germanasca": "Pinerolo",
    "Serra d'Ivera (Ivrea, TO)": "Ivrea",
    "Val Pellice, Valli d'Angrogna e di Luserna": "Torre Pellice",
    "Val Sessera e Val Strona (VC-VCO-BI)": "Valdilana",
}


def txt(node, path):
    child = node.find(path, NS)
    return " ".join("".join(child.itertext()).split()) if child is not None else ""


class NoteText(HTMLParser):
    """Turn Zotero's HTML memo body into readable, searchable plain text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"p", "div", "br", "li"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"p", "div", "li"}:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def note_text(value):
    parser = NoteText()
    parser.feed(value)
    return "\n".join(" ".join(line.split()) for line in "".join(parser.parts).splitlines() if line.strip())


def people(node, group):
    result = []
    for li in node.findall(f"bib:{group}/rdf:Seq/rdf:li", NS):
        given = txt(li, ".//foaf:givenName")
        surname = txt(li, ".//foaf:surname")
        name = " ".join(p for p in (given, surname) if p)
        if name:
            result.append(name)
    return result


def sbn_links(item, nodes_by_id):
    """Read SBN URLs from the record and its explicitly linked web attachments."""
    nodes = [item]
    links = []
    for ref in item.findall("link:link", NS):
        resource = ref.get(f"{{{NS['rdf']}}}resource", "")
        if resource in nodes_by_id:
            nodes.append(nodes_by_id[resource])
        else:
            links.append(resource)
    for node in nodes:
        links.extend(
            "".join(value.itertext()).strip()
            for value in node.findall("dc:identifier/dcterms:URI/rdf:value", NS)
        )
        links.append(txt(node, "z:url"))
    result = []
    for url in links:
        try:
            parsed = urllib.parse.urlsplit(url)
        except ValueError:
            continue
        if parsed.scheme in ("http", "https") and parsed.hostname in ("opac.sbn.it", "www.sbn.it", "sbn.it"):
            if url not in result:
                result.append(url)
    return result


def locations(raw):
    match = re.search(r"(?:location|localit[aà]|locantion)\s*:\s*([^\r\n]+)", raw, re.I)
    if not match:
        return []
    content = match.group(1).strip()
    # Semicolons may also separate province codes inside parentheses.
    pieces, start, depth = [], 0, 0
    for index, char in enumerate(content):
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif char == ";" and depth == 0:
            pieces.append(content[start:index])
            start = index + 1
    pieces.append(content[start:])
    result = []
    for piece in pieces:
        label = piece.strip(" ,;\t")
        if not label:
            continue
        province = ""
        parenthetical = re.search(r"\(([^()]*)\)$", label)
        if parenthetical:
            inner = parenthetical.group(1).strip()
            codes = [part.strip().replace("?", "") for part in inner.split(";")]
            if codes and all(re.fullmatch(r"[A-Z]{2,3}", code) for code in codes):
                province = " / ".join(codes)
                label = label[: parenthetical.start()].strip()
            elif len(codes) > 1 and re.fullmatch(r"[A-Z]{2,3}", codes[-1]):
                province = codes[-1]
                label = label[: parenthetical.start()].strip()
        if not label:
            if province:
                for loc in result:
                    if not loc["province"]:
                        loc["province"] = province
            continue
        if label.startswith("Pino ("):
            label = "Pino"
        if label == "Ricetto" and any(p["name"] == "Candelo" for p in result):
            continue
        result.append({"name": label, "province": province})
    if result and result[-1]["province"]:
        for loc in result:
            if not loc["province"]:
                loc["province"] = result[-1]["province"]
    return result


def geocode(name, province):
    query = f"{ALIASES.get(name, name)}, Piemonte, Italia"
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "limit": 3}, quote_via=urllib.parse.quote
    )
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "StorieDiPaesePiemonte/1.0 (bibliographic site; source on GitHub)"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        results = json.load(response)
    for result in results:
        lat, lon = float(result["lat"]), float(result["lon"])
        if 44.0 <= lat <= 46.7 and 6.0 <= lon <= 9.5:
            return {"lat": round(lat, 6), "lon": round(lon, 6), "source": "OpenStreetMap / Nominatim"}
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("rdf", type=Path)
    parser.add_argument("--geocode", action="store_true")
    args = parser.parse_args()
    root = ET.parse(args.rdf).getroot()
    nodes_by_id = {item.get(f"{{{NS['rdf']}}}about", ""): item for item in root}
    DATA.mkdir(exist_ok=True)
    cache_file = DATA / "geocodes.json"
    cache = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
    memo_by_id = {}
    for item in root:
        if item.tag.rsplit("}", 1)[-1].lower() in ("memo", "note"):
            key = item.get(f"{{{NS['rdf']}}}about", "")
            memo_by_id[key] = note_text(txt(item, "rdf:value") or txt(item, "dc:description"))

    records = []
    place_keys = {}
    seen_ids = set()
    for i, item in enumerate(root, 1):
        if item.tag.rsplit("}", 1)[-1].lower() in ("memo", "note", "attachment"):
            continue
        title = txt(item, "dc:title")
        if not title:
            continue
        extra_node = item.find("dc:description", NS)
        if extra_node is None:
            extra_node = item.find("z:extra", NS)
        raw_extra = "".join(extra_node.itertext()).strip() if extra_node is not None else ""
        locs = locations(raw_extra)
        notes = []
        for ref in item.findall("dcterms:isReferencedBy", NS):
            key = ref.get(f"{{{NS['rdf']}}}resource", "")
            if key in memo_by_id and memo_by_id[key]:
                notes.append(memo_by_id[key])
        # Some Zotero exports put the note inline instead of referring to a Memo.
        for note in item.findall(".//z:note", NS):
            value = note_text("".join(note.itertext()))
            if value and value not in notes:
                notes.append(value)
        date = txt(item, "dc:date")
        year_match = re.search(r"\b(?:1[5-9]|20)\d{2}\b", date)
        creators = people(item, "authors")
        editors = people(item, "editors")
        source_id = item.get(f"{{{NS['rdf']}}}about", f"#item_{i}").lstrip("#")
        publisher = txt(item, "dc:publisher/foaf:Organization/foaf:name")
        publication_place = txt(item, "dc:publisher/foaf:Organization/vcard:adr/vcard:Address/vcard:locality")
        identity = "|".join((title, date, ";".join(creators), ";".join(editors), publisher, publication_place, raw_extra)).casefold()
        record_id = "libro-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
        if record_id in seen_ids:
            record_id = "libro-" + hashlib.sha256((identity + "|" + source_id).encode("utf-8")).hexdigest()[:12]
        seen_ids.add(record_id)
        record = {
            "id": record_id,
            "sourceRdfId": source_id,
            "title": title,
            "authors": creators,
            "editors": editors,
            "publisher": publisher,
            "publicationPlace": publication_place,
            "date": date,
            "year": int(year_match.group()) if year_match else None,
            "tags": [" ".join("".join(x.itertext()).split()) for x in item.findall("dc:subject", NS)],
            "locations": locs,
            "notes": notes,
            "sbnUrls": sbn_links(item, nodes_by_id),
            "extra": raw_extra,
            "pdf": "assets/cfp-inwood.pdf",
        }
        records.append(record)
        for loc in locs:
            key = f"{loc['name']}|{loc['province']}"
            place_keys[key] = loc

    if args.geocode:
        for key, loc in sorted(place_keys.items()):
            if key in cache and cache[key] is not None:
                continue
            try:
                cache[key] = geocode(loc["name"], loc["province"])
                print(f"{key}: {cache[key]}", flush=True)
            except Exception as exc:
                print(f"{key}: ERROR {exc}", flush=True)
                cache[key] = None
            cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            time.sleep(1.1)

    for record in records:
        for loc in record["locations"]:
            key = f"{loc['name']}|{loc['province']}"
            coords = cache.get(key)
            if coords:
                loc.update({"lat": coords["lat"], "lon": coords["lon"]})
    DATA.mkdir(exist_ok=True)
    if len({record["id"] for record in records}) != len(records):
        raise ValueError("Two publications have identical stable IDs; review their title, date and creators")
    (DATA / "catalogo.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    mapped = sum(bool(any("lat" in loc for loc in r["locations"])) for r in records)
    print(f"Imported {len(records)} records, {sum(bool(r['notes']) for r in records)} with notes, {mapped} with map coordinates.")
    print(f"{sum(bool(r['sbnUrls']) for r in records)} records with SBN catalogue links.")


if __name__ == "__main__":
    main()
