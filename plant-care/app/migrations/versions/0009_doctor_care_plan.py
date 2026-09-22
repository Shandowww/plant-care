"""Preserve Doctor care plans and consultation context across providers."""

from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plant_doctor_visits", sa.Column("care_plan", sa.JSON(), nullable=True))
    op.add_column("plant_doctor_visits", sa.Column("symptoms", sa.Text(), nullable=True))
    op.add_column("plant_doctor_visits", sa.Column("total_tokens", sa.Integer(), nullable=True))
    op.add_column(
        "plant_doctor_visits",
        sa.Column("fallback_used", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    for column in ("fallback_used", "total_tokens", "symptoms", "care_plan"):
        op.drop_column("plant_doctor_visits", column)
