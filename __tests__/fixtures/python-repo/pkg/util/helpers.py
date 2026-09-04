"""Two-level relative import, walking up from pkg/util/ to pkg/ before
resolving the leaf module.
"""

from ..wiki_index import build_index


def helper():
    return build_index()
