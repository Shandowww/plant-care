"""Persist normalized Home Assistant readings.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "readings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "plant_id",
            sa.String(36),
            sa.ForeignKey("plants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity_id", sa.String(255), nullable=False),
        sa.Column("metric", sa.String(32), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(32)),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idempotency_key", sa.String(600), nullable=False, unique=True),
    )
    op.create_index("ix_readings_plant_id", "readings", ["plant_id"])
    op.create_index("ix_readings_entity_id", "readings", ["entity_id"])
    op.create_index("ix_readings_metric", "readings", ["metric"])
    op.create_index("ix_readings_observed_at", "readings", ["observed_at"])
    op.create_index(
        "ix_readings_plant_metric_observed",
        "readings",
        ["plant_id", "metric", "observed_at"],
    )


def downgrade() -> None:
    op.drop_table("readings")
