"""Regression checks for Zotero record-to-attachment SBN associations."""

import unittest
import xml.etree.ElementTree as ET

from import_zotero import NS, sbn_links


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
