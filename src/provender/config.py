"""Configuration and filesystem paths for the meal planner.

Resolves where credentials and local settings live. The two per-user inputs — the
target spreadsheet and the service-account credentials file — are *not* hardcoded;
each is resolved from (in order) an environment variable, then a local
``config.json`` written by ``prov set-spreadsheet``, then a sensible default.
This keeps the tool generic: anyone points it at their own Sheet and key.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from platformdirs import user_config_dir

APP_NAME = "provender"

#: Environment variable holding the Google Sheets spreadsheet ID or full URL.
ENV_SPREADSHEET = "PROVENDER_SPREADSHEET"

#: Environment variable pointing at the service-account credentials JSON file.
ENV_CREDENTIALS = "PROVENDER_CREDENTIALS"


def config_dir() -> Path:
    """Return the per-user config directory, creating it if needed."""
    path = Path(user_config_dir(APP_NAME))
    path.mkdir(parents=True, exist_ok=True)
    return path


def default_credentials_path() -> Path:
    """Return the default location for the service-account credentials file."""
    return config_dir() / "credentials.json"


def config_file() -> Path:
    """Return the path to the local JSON config file."""
    return config_dir() / "config.json"


def read_config_file() -> dict[str, Any]:
    """Read the local config file, returning ``{}`` if missing or invalid."""
    path = config_file()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def write_config_value(key: str, value: str) -> Path:
    """Set ``key`` to ``value`` in the local config file, creating it if needed.

    Args:
        key: Config key (e.g. ``"spreadsheet"`` or ``"credentials_path"``).
        value: Value to store.

    Returns:
        The path to the config file that was written.
    """
    path = config_file()
    data = read_config_file()
    data[key] = value
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


@dataclass(slots=True)
class Settings:
    """Resolved runtime settings.

    Attributes:
        credentials_path: Path to the Google service-account JSON key.
        spreadsheet: Spreadsheet ID or URL the planner reads and writes.
    """

    credentials_path: Path
    spreadsheet: str | None

    @classmethod
    def load(cls) -> Settings:
        """Resolve settings from the environment, then the config file, then defaults.

        - Spreadsheet: ``MEALPLAN_SPREADSHEET`` env var → config file
          ``"spreadsheet"`` → ``None``.
        - Credentials: ``MEALPLAN_CREDENTIALS`` env var → config file
          ``"credentials_path"`` → the default per-user path.
        """
        file_cfg = read_config_file()

        creds = os.environ.get(ENV_CREDENTIALS) or file_cfg.get("credentials_path")
        credentials_path = (
            Path(creds).expanduser() if creds else default_credentials_path()
        )

        spreadsheet = os.environ.get(ENV_SPREADSHEET) or file_cfg.get("spreadsheet")

        return cls(credentials_path=credentials_path, spreadsheet=spreadsheet)
