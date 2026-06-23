"""Tests for settings resolution (env var > config file > default)."""

import json

from provender import config as cfg


def test_write_config_value(tmp_path, monkeypatch):
    f = tmp_path / "config.json"
    monkeypatch.setattr(cfg, "config_file", lambda: f)
    cfg.write_config_value("spreadsheet", "abc123")
    assert json.loads(f.read_text())["spreadsheet"] == "abc123"


def test_spreadsheet_from_config_file(tmp_path, monkeypatch):
    f = tmp_path / "config.json"
    f.write_text(json.dumps({"spreadsheet": "from-file"}))
    monkeypatch.setattr(cfg, "config_file", lambda: f)
    monkeypatch.delenv(cfg.ENV_SPREADSHEET, raising=False)
    assert cfg.Settings.load().spreadsheet == "from-file"


def test_env_var_overrides_config_file(tmp_path, monkeypatch):
    f = tmp_path / "config.json"
    f.write_text(json.dumps({"spreadsheet": "from-file"}))
    monkeypatch.setattr(cfg, "config_file", lambda: f)
    monkeypatch.setenv(cfg.ENV_SPREADSHEET, "from-env")
    assert cfg.Settings.load().spreadsheet == "from-env"


def test_missing_config_is_none(tmp_path, monkeypatch):
    monkeypatch.setattr(cfg, "config_file", lambda: tmp_path / "nope.json")
    monkeypatch.delenv(cfg.ENV_SPREADSHEET, raising=False)
    assert cfg.Settings.load().spreadsheet is None
