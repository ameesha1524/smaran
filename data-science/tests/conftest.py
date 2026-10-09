from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GOLDEN = REPO / "golden-vectors.json"
REGISTRY = REPO / "backend" / "src" / "main" / "resources" / "game-registry.json"
