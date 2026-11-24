"""Checks the translations and packs Limbo for the Web Store.

Usage: python tools/build.py
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "store"

PARTS = ["manifest.json", "background.js", "settings.js", "lock.js", "tablock.js", "_locales", "icons", "ui"]


def check(folder):
    """Both languages must define exactly the same messages."""
    locales = {p.parent.name: set(json.loads(p.read_text("utf-8"))) for p in folder.glob("_locales/*/messages.json")}
    first = next(iter(locales.values()))
    for name, keys in locales.items():
        assert keys == first, f"{folder.name}/{name}: {keys ^ first}"


def pack(folder, parts, name):
    version = json.loads((folder / "manifest.json").read_text("utf-8"))["version"]
    target = STORE / f"{name}-{version}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for part in parts:
            path = folder / part
            files = sorted(p for p in path.rglob("*") if p.is_file()) if path.is_dir() else [path]
            for file in files:
                archive.write(file, file.relative_to(folder).as_posix())
    print(target.relative_to(ROOT), f"{target.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    STORE.mkdir(exist_ok=True)
    check(ROOT)
    pack(ROOT, PARTS, "limbo")
