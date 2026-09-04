"""Exercises three extraction branches in one file: a __future__ import
(never extracted), a comma-separated plain import list (both stdlib,
unresolved), and a parenthesized multi-line from-import.
"""

from __future__ import annotations

import os, sys

from pkg.util import (
    helpers,
)


def run():
    return sys.platform, os.name, helpers.helper()
