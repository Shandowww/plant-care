"""Phase 1 foundation tables.

Revision ID: 0001
Revises: None
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("location", sa.String(120), nullable=False),
        sa.Column("common_name", sa.String(120), nullable=False),
        sa.Column("scientific_name", sa.String(160)),
        sa.Column("environment_type", sa.String(32), nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("moisture", sa.Float()),
        sa.Column("moisture_status", sa.String(32), nullable=False),
        sa.Column("temperature", sa.Float()),
        sa.Column("temperature_status", sa.String(32), nullable=False),
        sa.Column("battery", sa.Float()),
        sa.Column("illuminance", sa.Float()),
        sa.Column("last_reading_at", sa.DateTime(timezone=True)),
        sa.Column("simulator_scenario", sa.String(64)),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_plants_display_name", "plants", ["display_name"])
    op.create_index("ix_plants_location", "plants", ["location"])
    op.create_index("ix_plants_state", "plants", ["state"])
    op.create_index("ix_plants_active", "plants", ["active"])

    op.create_table(
        "care_actions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("plant_id", sa.String(36), sa.ForeignKey("plants.id", ondelete="CASCADE")),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("observation", sa.Text(), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("snoozed_until", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("completed_by", sa.String(120)),
        sa.Column("deduplication_key", sa.String(200), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_care_actions_plant_id", "care_actions", ["plant_id"])
    op.create_index("ix_care_actions_type", "care_actions", ["type"])
    op.create_index("ix_care_actions_status", "care_actions", ["status"])
    op.create_index("ix_care_actions_queue", "care_actions", ["status", "due_at"])

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(120), primary_key=True),
        sa.Column("typed_value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor", sa.String(120), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("object_type", sa.String(80), nullable=False),
        sa.Column("object_id", sa.String(80)),
        sa.Column("old_json", sa.JSON()),
        sa.Column("new_json", sa.JSON()),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_events_event_type", "audit_events", ["event_type"])
    op.create_index("ix_audit_events_occurred_at", "audit_events", ["occurred_at"])


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("app_settings")
    op.drop_table("care_actions")
    op.drop_table("plants")
