"""Add per-plant Home Assistant entity mappings.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plant_entity_mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "plant_id",
            sa.String(36),
            sa.ForeignKey("plants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("moisture_entity_id", sa.String(255)),
        sa.Column("temperature_entity_id", sa.String(255)),
        sa.Column("battery_entity_id", sa.String(255)),
        sa.Column("illuminance_entity_id", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_plant_entity_mappings_plant_id", "plant_entity_mappings", ["plant_id"]
    )


def downgrade() -> None:
    op.drop_table("plant_entity_mappings")
