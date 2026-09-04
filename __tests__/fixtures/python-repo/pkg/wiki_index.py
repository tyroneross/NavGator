"""Leaf module with two known importers inside this fixture: pkg/search.py
and pkg/cli.py. scan-coverage.test.ts uses this module to prove
computeImpact finds both.
"""

import os


def build_index():
    return os.listdir('.')
