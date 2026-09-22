import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config
from plantcare.config import get_settings


def test_doctor_upgrade_preserves_existing_visit(tmp_path, monkeypatch):
    database = tmp_path / "migration.db"
    monkeypatch.setenv("PLANTCARE_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    get_settings.cache_clear()
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[2] / "app" / "migrations")
    )
    try:
        command.upgrade(config, "0008")
        with sqlite3.connect(database) as connection:
            # A representative pre-upgrade visit, independent of current ORM defaults.
            connection.execute("""
                INSERT INTO plant_doctor_visits
                (id, plant_id, created_at, updated_at, summary, observations, possible_issues,
                 next_steps, sensor_snapshot, confidence, provider, model, decision, outcome)
                VALUES ('old', 'plant', '2026-09-01', '2026-09-01', 'Existing advice', '[]', '[]',
                        '["Keep monitoring"]', '{}', 'low', 'Cloudflare', 'old-model',
                        'declined', 'not_tried')
            """)
        command.upgrade(config, "head")
        with sqlite3.connect(database) as connection:
            row = connection.execute(
                "SELECT summary, decision, care_plan, symptoms, total_tokens, fallback_used "
                "FROM plant_doctor_visits WHERE id='old'"
            ).fetchone()
            assert row == ("Existing advice", "declined", None, None, None, 0)
    finally:
        get_settings.cache_clear()
