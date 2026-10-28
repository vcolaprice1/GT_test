"""Classify territories and resolve new place names during the daily import."""
import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request

AREAS = {"monferrato", "langhe", "alta langa", "canavese", "ossola", "roero", "oltregiogo"}
PROVINCES = {"TO": "Torino", "VC": "Vercelli", "BI": "Biella", "NO": "Novara",
             "VCO": "Verbano-Cusio-Ossola", "VB": "Verbano-Cusio-Ossola", "CN": "Cuneo", "AT": "Asti", "AL": "Alessandria"}


def norm(text):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower())


def kind(name):
    value = name.casefold()
    return "area" if value in AREAS or re.search(r"\b(val|valle|valli)\s|^serra d.ivrea|^lago\s", value) else "locality"


def select_result(results, name, province):
    matches = []
    for result in results:
        address = result.get("address", {})
        if address.get("country_code") != "it" or address.get("state") != "Piemonte":
            continue
        if norm(result.get("name", "")) != norm(name):
            continue
        if result.get("addresstype") not in {"village", "town", "city", "hamlet", "municipality", "suburb", "quarter", "region", "valley", "county"} and result.get("type") != "administrative":
            continue
        expected = [PROVINCES[p.strip()] for p in province.split("/") if p.strip() in PROVINCES]
        if expected and not any(norm(p) in norm(result.get("display_name", "")) for p in expected):
            continue
        lat, lon = float(result["lat"]), float(result["lon"])
        if not (44 <= lat <= 46.7 and 6 <= lon <= 9.5):
            continue
        if not any(abs(lat - m["lat"]) < .02 and abs(lon - m["lon"]) < .02 for m in matches):
            matches.append({"lat": lat, "lon": lon})
    return matches[0] if len(matches) == 1 else None


def enrich(records, cache_path):
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    requested, unresolved = 0, set()
    for record in records:
        for place in record["locations"]:
            place["kind"] = kind(place["name"])
            if "lat" in place and "lon" in place:
                continue
            key = place["name"] + "|" + place["province"]
            if key not in cache and requested < 20:
                if requested:
                    time.sleep(15.1)  # Periodic Nominatim jobs: at most four requests/minute.
                requested += 1
                query = place["name"] + ", " + PROVINCES.get(place["province"], "Piemonte") + ", Italia"
                endpoint = os.environ.get("GEOCODER_URL") or "https://nominatim.openstreetmap.org/search"
                url = endpoint + "?" + urllib.parse.urlencode({"q": query, "format": "jsonv2", "addressdetails": 1, "countrycodes": "it", "accept-language": "it", "limit": 5})
                try:
                    request = urllib.request.Request(url, headers={"User-Agent": "StorieDiPaesePiemonte/1.0 (bibliographic catalogue)"})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        cache[key] = select_result(json.load(response), place["name"], place["province"])
                except (OSError, ValueError):
                    print("Geocodifica temporaneamente non disponibile: " + key)
                    continue  # Retry transient errors on the next run.
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if cache.get(key):
                place.update(cache[key])
            else:
                unresolved.add(key)
    return sorted(unresolved)
