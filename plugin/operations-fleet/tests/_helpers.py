from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


def load_module(name: str, path: Path) -> ModuleType:
    """Import a script by file path, so tests can use scripts that are not on sys.path."""
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
