"""Imports the leaf module via an absolute dotted path, plus a third-party
package that has no local file to resolve against.
"""

from pkg.wiki_index import build_index
import requests


def search(query):
    index = build_index()
    return requests.get('https://example.com', params={'q': query, 'index': index})
