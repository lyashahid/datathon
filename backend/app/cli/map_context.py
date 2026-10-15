"""Generate the source-backed local cartographic basemap."""

import json

from app.config.settings import Settings
from app.data.map_context import build_context

if __name__ == "__main__":
    print(json.dumps(build_context(Settings().data_dir), indent=2))
