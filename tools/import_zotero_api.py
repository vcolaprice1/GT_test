"""Read the public group library; never write to Zotero or expose API keys."""
import argparse
from collections import defaultdict
import json
import os
from pathlib import Path
import re
import time
import urllib.request
from urllib.parse import urlsplit

from import_zotero import DATA, locations, normalize_locations, normalize_publication_fields, note_text
from map_locations import enrich

GROUP = "6366329"


def download():
    headers = {"Zotero-API-Version": "3", "User-Agent": "StorieDiPaesePiemonte/1.0"}
    if os.environ.get("ZOTERO_API_KEY"):
        headers["Zotero-API-Key"] = os.environ["ZOTERO_API_KEY"]
    items, version, total = [], None, None
    while total is None or len(items) < total:
        url = f"https://api.zotero.org/groups/{GROUP}/items?format=json&limit=100&start={len(items)}&sort=dateAdded&direction=asc"
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
            current = response.headers.get("Last-Modified-Version")
            count = int(response.headers["Total-Results"])
            if version is not None and (current != version or count != total):
                raise ValueError("La libreria è cambiata durante il download: riprovare.")
            version, total = current, count
            batch = json.load(response)
            backoff = float(response.headers.get("Backoff", "0"))
        if not batch or not isinstance(batch, list):
            raise ValueError("Risposta Zotero vuota o incompleta.")
        items.extend(batch)
        print(f"Zotero: {len(items)}/{total} elementi scaricati", flush=True)
        if backoff:
            time.sleep(backoff)
    if len(items) != total or len({item["key"] for item in items}) != total:
        raise ValueError("Download incompleto o elementi duplicati.")
    return items


def convert(items, cache):
    children = defaultdict(list)
    for item in items:
        data = item["data"]
        if data.get("parentItem"):
            children[data["parentItem"]].append(data)
    records = []
    for item in items:
        data = item["data"]
        if data.get("itemType") in ("note", "attachment", "annotation") or data.get("deleted"):
            continue
        title = data.get("title", "").strip()
        if not title:
            raise ValueError(f"Titolo mancante: {item['key']}")
        def creators(kind):
            return [c.get("name") or " ".join(filter(None, (c.get("firstName"), c.get("lastName"))))
                    for c in data.get("creators", []) if c.get("creatorType") == kind]
        notes, urls = [], []
        for child in [data] + children[item["key"]]:
            if child.get("itemType") == "note":
                text = note_text(child.get("note", ""))
                if text and text not in notes:
                    notes.append(text)
            url = child.get("url", "").strip()
            parsed = urlsplit(url)
            if parsed.scheme in ("https", "http") and parsed.hostname in ("opac.sbn.it", "sbn.it", "www.sbn.it") and url not in urls:
                urls.append(url)
        date, extra = data.get("date", ""), data.get("extra", "")
        year = re.search(r"\b(?:1[5-9]|20)\d{2}\b", date)
        record = dict(id="zotero-" + item["key"], zoteroKey=item["key"], title=title,
                      authors=creators("author"), editors=creators("editor"),
                      publisher=data.get("publisher", ""), publicationPlace=data.get("place", ""),
                      date=date, year=int(year.group()) if year else None,
                      tags=[t["tag"] for t in data.get("tags", [])],
                      locations=locations(extra), notes=notes, sbnUrls=urls, extra=extra,
                      pdf="assets/cfp-inwood.pdf")
        normalize_publication_fields(record)
        records.append(record)
    normalize_locations(records, cache)
    return sorted(records, key=lambda record: record["id"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DATA / "catalogo.json")
    parser.add_argument("--geo-cache", type=Path, default=DATA.parent / ".geocache" / "places.json")
    args = parser.parse_args()
    records = convert(download(), json.loads((DATA / "geocodes.json").read_text(encoding="utf-8")))
    previous = json.loads((DATA / "catalogo.json").read_text(encoding="utf-8"))
    if not records or (any(r["notes"] for r in previous) and not any(r["notes"] for r in records)):
        raise ValueError("Catalogo vuoto o note non accessibili: pubblicazione interrotta.")
    if len(records) < len(previous) * 0.8:
        raise ValueError("Oltre il 20% delle schede mancante: verificare la libreria prima di pubblicare.")
    enrich(records, args.geo_cache)
    missing = sorted({f"{loc['name']} ({loc['province']})" for r in records for loc in r["locations"] if "lat" not in loc})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(f"Importate {len(records)} pubblicazioni; {sum(bool(r['notes']) for r in records)} con note; {sum(bool(r['sbnUrls']) for r in records)} con SBN.")
    if missing:
        print("Località da geocodificare (schede disponibili, marcatori non aggiunti): " + "; ".join(missing))


if __name__ == "__main__":
    main()
