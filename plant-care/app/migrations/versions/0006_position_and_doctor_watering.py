"""Add precise plant positions and structured Doctor watering guidance.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("plants", sa.Column("specific_position", sa.String(length=160), nullable=True))
    op.add_column("plant_doctor_visits", sa.Column("watering_guidance", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("plant_doctor_visits", "watering_guidance")
    op.drop_column("plants", "specific_position")
