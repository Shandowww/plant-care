"""Persist compact Plant Doctor history and user outcomes.

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plant_doctor_visits",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("plant_id", sa.String(length=36), nullable=False),
        sa.Column("action_id", sa.String(length=36), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("observations", sa.JSON(), nullable=False),
        sa.Column("possible_issues", sa.JSON(), nullable=False),
        sa.Column("next_steps", sa.JSON(), nullable=False),
        sa.Column("sensor_snapshot", sa.JSON(), nullable=False),
        sa.Column("confidence", sa.String(length=16), nullable=False),
        sa.Column("provider", sa.String(length=120), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False),
        sa.Column("neurons", sa.Float(), nullable=True),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["action_id"], ["care_actions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plant_id"], ["plants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_plant_doctor_visits_plant_id", "plant_doctor_visits", ["plant_id"]
    )
    op.create_index(
        "ix_plant_doctor_visits_decision", "plant_doctor_visits", ["decision"]
    )
    op.create_index(
        "ix_plant_doctor_visits_outcome", "plant_doctor_visits", ["outcome"]
    )
    op.create_index(
        "ix_plant_doctor_visits_plant_created",
        "plant_doctor_visits",
        ["plant_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_plant_doctor_visits_plant_created", table_name="plant_doctor_visits")
    op.drop_index("ix_plant_doctor_visits_outcome", table_name="plant_doctor_visits")
    op.drop_index("ix_plant_doctor_visits_decision", table_name="plant_doctor_visits")
    op.drop_index("ix_plant_doctor_visits_plant_id", table_name="plant_doctor_visits")
    op.drop_table("plant_doctor_visits")
