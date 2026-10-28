import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from map_locations import kind, select_result, enrich


class MapLocationsTests(unittest.TestCase):
    def test_areas_do_not_include_towns_with_similar_names(self):
        for name in ("Monferrato", "Val Borbera", "Alta Val Chisone", "Langhe"):
            self.assertEqual(kind(name), "area")
        for name in ("Casale Monferrato", "Sale delle Langhe", "Valenza", "Pont Canavese"):
            self.assertEqual(kind(name), "locality")

    def test_wrong_province_ambiguous_and_street_results_are_rejected(self):
        result = dict(name="Motta de' Conti", lat="45.193343", lon="8.520934", addresstype="village", display_name="Motta de' Conti, Vercelli, Piemonte", address=dict(state="Piemonte", country_code="it"))
        self.assertIsNotNone(select_result([result], "Motta de’ Conti", "VC"))
        self.assertIsNone(select_result([result], "Motta de' Conti", "TO"))
        self.assertIsNone(select_result([result, dict(result, lat="45.4")], "Motta de' Conti", "VC"))
        self.assertIsNone(select_result([dict(result, addresstype="road")], "Motta de' Conti", "VC"))

    def test_cache_adds_coordinates_without_network_and_preserves_reviewed_points(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "places.json"
            cache.write_text(json.dumps({"Nuovo paese|TO": {"lat": 45.1, "lon": 7.1}}))
            records = [{"locations": [{"name": "Nuovo paese", "province": "TO"}, {"name": "Monferrato", "province": "AL", "lat": 45, "lon": 8}]}]
            with patch("urllib.request.urlopen", side_effect=AssertionError("No network expected")):
                self.assertEqual(enrich(records, cache), [])
            self.assertEqual(records[0]["locations"][0]["lat"], 45.1)
            self.assertEqual(records[0]["locations"][1]["kind"], "area")
