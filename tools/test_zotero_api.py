import unittest
from import_zotero_api import convert


class ApiTests(unittest.TestCase):
    def test_children_notes_links_and_normalization(self):
        items = [
            {"key": "ABC123", "data": {"itemType": "book", "title": "Titolo", "date": "S.d.", "place": "Sant'  Albano Stura", "extra": "Location: Caselle Torinese (TO)", "creators": [{"creatorType": "editor", "firstName": "Anna", "lastName": "Rossi"}]}},
            {"key": "NOTE", "data": {"itemType": "note", "parentItem": "ABC123", "note": "<p>Una nota</p>"}},
            {"key": "LINK", "data": {"itemType": "attachment", "parentItem": "ABC123", "url": "https://opac.sbn.it/risultati-ricerca-avanzata/-/opac-adv/detail/TEST"}},
            {"key": "OTHER", "data": {"itemType": "note", "note": "Nota indipendente"}},
        ]
        records = convert(items, {})
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["id"], "zotero-ABC123")
        self.assertEqual(record["notes"], ["Una nota"])
        self.assertEqual(len(record["sbnUrls"]), 1)
        self.assertEqual(record["editors"], ["Anna Rossi"])
        self.assertEqual(record["authors"], [])
        self.assertEqual(record["publicationPlace"], "Sant'Albano Stura")
        self.assertIsNone(record["year"])
        self.assertEqual(record["date"], "S.d.")


if __name__ == "__main__":
    unittest.main()
