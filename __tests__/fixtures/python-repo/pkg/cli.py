"""Imports the leaf module two different ways, plus a commented-out import
that must never produce a graph edge.
"""

from .search import search
from pkg import wiki_index

# import pkg.commented_out


def main():
    print(search('hello'))
    print(wiki_index.build_index())
