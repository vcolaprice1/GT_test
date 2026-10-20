"""Regression checks for Zotero record-to-attachment SBN associations."""

import unittest
import xml.etree.ElementTree as ET

from import_zotero import NS, sbn_links, normalize_locations, normalize_publication_fields


class PublicationFieldsTests(unittest.TestCase):
    def test_verified_inversion_preserves_id_and_source_values(self):
        record = {"id": "stable", "title": "Novara : pagine di storia",
                  "publicationPlace": "1977", "date": "Novara", "year": None}
        normalize_publication_fields(record)
        self.assertEqual((record["publicationPlace"], record["date"], record["year"]),
                         ("Novara", "1977", 1977))
        self.assertEqual(record["originalPublicationPlace"], "1977")
        self.assertEqual(record["originalDate"], "Novara")
        self.assertEqual(record["id"], "stable")
        normalized = dict(record)
        normalize_publication_fields(record)
        self.assertEqual(record, normalized)

    def test_spacing_and_unknown_place_expansion(self):
        for source, expected in [
            ("Sant'  Albano Stura", "Sant'Albano Stura"),
            ("Sant’ Albano Stura", "Sant'Albano Stura"),
            ("S.l.", "S.l."),
            ("Rocca de' Baldi", "Rocca de' Baldi"),
        ]:
            with self.subTest(source=source):
                record = {"title": "Test", "publicationPlace": source, "date": "1987", "year": 1987}
                normalize_publication_fields(record)
                self.assertEqual(record["publicationPlace"], expected)
                self.assertEqual(record["year"], 1987)

    def test_no_unverified_date_place_swaps(self):
        record = {"title": "Other book", "publicationPlace": "1977", "date": "Novara", "year": None}
        original = dict(record)
        normalize_publication_fields(record)
        self.assertEqual(record, original)


class LocationTests(unittest.TestCase):
    def test_typos_case_accents_and_duplicate_places(self):
        records = [{"locations": [
            {"name": " CAselle   Torinese ", "province": "TO"},
            {"name": "Caselle Torinese", "province": "TO"},
            {"name": "Cirié", "province": "TO"},
            {"name": "Ciriè", "province": "TO"},
        ]}]
        cache = {"Caselle Torinese|TO": {"lat": 45.17, "lon": 7.64}}
        normalize_locations(records, cache)
        places = records[0]["locations"]
        self.assertEqual([p["name"] for p in places], ["Caselle Torinese", "Ciriè"])
        self.assertEqual(places[0]["originalName"], " CAselle   Torinese ")
        self.assertEqual(places[0]["lat"], 45.17)

    def test_province_order_and_missing_province(self):
        records = [{"locations": [
            {"name": "Monferrato", "province": "AT / AL"},
            {"name": "Monferrato", "province": "AL / AT"},
            {"name": "Testona (Moncalieri, TO)", "province": ""},
            {"name": "Testona", "province": "TO"},
        ]}]
        normalize_locations(records, {})
        self.assertEqual(len(records[0]["locations"]), 2)
        self.assertEqual(records[0]["locations"][1]["province"], "TO")

    def test_reference_coordinates_do_not_merge_distinct_places(self):
        names = ["Pragelato", "Alta Val Chisone", "Novi Ligure", "Oltregiogo",
                 "Bussolino Gassinese", "Gassino Torinese", "Coazze", "Coazze?"]
        records = [{"locations": [{"name": n, "province": ""} for n in names]}]
        normalize_locations(records, {})
        self.assertEqual([p["name"] for p in records[0]["locations"]], names)

    def test_legacy_coordinates_and_nonempty_province_conflicts_are_preserved(self):
        records = [{"locations": [
            {"name": "Forno Cnavese", "province": "TO"},
            {"name": "Alba", "province": "AT"},
            {"name": "Alba", "province": "CN"},
        ]}]
        normalize_locations(records, {"Forno Cnavese|TO": {"lat": 45.3, "lon": 7.5}})
        self.assertEqual(records[0]["locations"][0]["name"], "Forno Canavese")
        self.assertEqual(records[0]["locations"][0]["lat"], 45.3)
        self.assertEqual(len(records[0]["locations"]), 3)


class SbnLinksTests(unittest.TestCase):
    def parse(self, body):
        namespaces = " ".join(f'xmlns:{key}="{value}"' for key, value in NS.items())
        root = ET.fromstring(f"<rdf:RDF {namespaces}>{body}</rdf:RDF>")
        nodes = {node.get(f"{{{NS['rdf']}}}about", ""): node for node in root}
        return root[0], nodes

    def test_only_the_books_linked_attachment_is_imported(self):
        book, nodes = self.parse("""
          <bib:Book rdf:about="#book"><link:link rdf:resource="#linked"/></bib:Book>
          <z:Attachment rdf:about="#other"><z:url>https://opac.sbn.it/other</z:url></z:Attachment>
          <z:Attachment rdf:about="#linked"><dc:identifier><dcterms:URI>
            <rdf:value>https://opac.sbn.it/record?a=1&amp;b=2</rdf:value>
          </dcterms:URI></dc:identifier></z:Attachment>
        """)
        self.assertEqual(sbn_links(book, nodes), ["https://opac.sbn.it/record?a=1&b=2"])

    def test_direct_and_attachment_duplicates_are_removed(self):
        book, nodes = self.parse("""
          <bib:Book rdf:about="#book"><z:url>https://opac.sbn.it/record</z:url>
            <link:link rdf:resource="#linked"/></bib:Book>
          <z:Attachment rdf:about="#linked"><z:url>https://opac.sbn.it/record</z:url></z:Attachment>
        """)
        self.assertEqual(sbn_links(book, nodes), ["https://opac.sbn.it/record"])

    def test_missing_reference_does_not_invent_a_link(self):
        book, nodes = self.parse('<bib:Book><link:link rdf:resource="#missing"/></bib:Book>')
        self.assertEqual(sbn_links(book, nodes), [])

    def test_non_sbn_and_unsafe_urls_are_excluded(self):
        for url in ("javascript:alert(1)", "https://opac.sbn.it.example.org/record",
                    "https://example.org/record", "file:///tmp/book", "https://[broken"):
            with self.subTest(url=url):
                book, nodes = self.parse(f"<bib:Book><z:url>{url}</z:url></bib:Book>")
                self.assertEqual(sbn_links(book, nodes), [])


if __name__ == "__main__":
    unittest.main()
