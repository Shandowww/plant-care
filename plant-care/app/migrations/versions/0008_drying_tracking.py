"""Per-pot drying tracking and optional wet-duration alert."""

from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plants", sa.Column("drying_status", sa.String(32), nullable=True))
    op.add_column("plants", sa.Column("drying_note", sa.String(600), nullable=True))
    op.add_column("plants", sa.Column("wet_duration_hours_override", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("plants", "wet_duration_hours_override")
    op.drop_column("plants", "drying_note")
    op.drop_column("plants", "drying_status")
