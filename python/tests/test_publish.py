"""Tests for auto-publishing rendered pages (``_publish_pages``)."""

import subprocess

from provender import cli


def _wire(monkeypatch, tmp_path, *, auto_publish, git_responses=None):
    """Point config at a render dir and fake out git + the index rebuild.

    ``git_responses`` maps a git subcommand (e.g. ``"push"``) to ``(returncode,
    stdout)``; unlisted subcommands return ``(0, "")``. Returns the recorded list
    of git subcommand argument tuples.
    """
    cfg = {
        "auto_publish": "true" if auto_publish else "",
        "render_dir": str(tmp_path / "recipes"),
    }
    monkeypatch.setattr(
        cli, "_config_value", lambda ss, key, default="": cfg.get(key, default)
    )
    monkeypatch.setattr(cli.shutil, "which", lambda name: "/usr/bin/git")
    monkeypatch.setattr(
        cli.sheets_mod, "read_table", lambda ss, tab: [{"recipe_id": "x"}]
    )
    monkeypatch.setattr(cli.render_mod, "render_index_html", lambda rows: "INDEX")

    responses = {"diff": (1, "")}  # default: something staged to commit
    responses.update(git_responses or {})
    calls = []

    def fake_run(cmd, capture_output=True, text=True, check=False):
        sub = cmd[3]  # ["git", "-C", <dir>, <sub>, ...]
        calls.append(tuple(cmd[3:]))
        rc, out = responses.get(sub, (0, ""))
        return subprocess.CompletedProcess(cmd, rc, stdout=out, stderr="boom")

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    return calls


def test_disabled_by_default(monkeypatch, tmp_path):
    _wire(monkeypatch, tmp_path, auto_publish=False)
    result = cli._publish_pages(object(), tmp_path / "recipes", "msg")
    assert result == {"published": False, "reason": "disabled"}


def test_commits_and_pushes(monkeypatch, tmp_path):
    calls = _wire(
        monkeypatch,
        tmp_path,
        auto_publish=True,
        git_responses={"remote": (0, "origin\n"), "push": (0, "")},
    )
    result = cli._publish_pages(object(), tmp_path / "recipes", "msg")
    assert result == {"published": True, "pushed": True}
    subs = [c[0] for c in calls]
    assert subs == ["rev-parse", "add", "diff", "commit", "remote", "push"]
    # index was refreshed at the served root before committing
    assert (tmp_path / "index.html").read_text() == "INDEX"


def test_nothing_to_commit_skips_commit(monkeypatch, tmp_path):
    calls = _wire(
        monkeypatch, tmp_path, auto_publish=True, git_responses={"diff": (0, "")}
    )
    result = cli._publish_pages(object(), tmp_path / "recipes", "msg")
    assert result == {"published": False, "reason": "nothing-to-commit"}
    assert "commit" not in [c[0] for c in calls]


def test_no_remote_commits_without_push(monkeypatch, tmp_path):
    calls = _wire(
        monkeypatch, tmp_path, auto_publish=True, git_responses={"remote": (0, "")}
    )
    result = cli._publish_pages(object(), tmp_path / "recipes", "msg")
    assert result == {"published": True, "pushed": False, "reason": "no-remote"}
    assert "push" not in [c[0] for c in calls]


def test_push_failure_is_swallowed(monkeypatch, tmp_path):
    _wire(
        monkeypatch,
        tmp_path,
        auto_publish=True,
        git_responses={"remote": (0, "origin\n"), "push": (1, "")},
    )
    result = cli._publish_pages(object(), tmp_path / "recipes", "msg")
    assert result == {"published": True, "pushed": False, "reason": "push-failed"}


def test_not_a_git_repo_skips(monkeypatch, tmp_path):
    _wire(
        monkeypatch, tmp_path, auto_publish=True, git_responses={"rev-parse": (128, "")}
    )
    result = cli._publish_pages(object(), tmp_path / "recipes", "msg")
    assert result == {"published": False, "reason": "not-a-git-repo"}
