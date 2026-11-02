"""Add recording sessions, parts, speakers, and transcript segments."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_recording_pipeline"
down_revision = "0001_postgres_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recording_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("context_prompt", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="recording", nullable=False),
        sa.Column("finish_requested", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("expected_part_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("consecutive_rate_limits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recording_sessions_user_status", "recording_sessions", ["user_id", "status"])
    op.create_index("ix_recording_sessions_note_id", "recording_sessions", ["note_id"])

    op.create_table(
        "recording_parts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("part_index", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=24), server_default="queued", nullable=False),
        sa.Column("is_empty", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["recording_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "part_index", name="uq_recording_parts_session_index"),
    )
    op.create_index("ix_recording_parts_status", "recording_parts", ["status"])

    op.create_table(
        "session_speakers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("gemini_label", sa.String(length=160), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=80), nullable=True),
        sa.Column("sample_text", sa.Text(), server_default="", nullable=False),
        sa.Column("first_seen_part", sa.Integer(), nullable=False),
        sa.Column("user_confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["recording_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_session_speakers_session_first_seen",
        "session_speakers",
        ["session_id", "first_seen_part"],
    )

    op.create_table(
        "transcript_segments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("part_index", sa.Integer(), nullable=False),
        sa.Column("speaker_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("raw_gemini_label", sa.String(length=160), nullable=True),
        sa.Column("text", sa.Text(), server_default="", nullable=False),
        sa.Column("start_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("end_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["recording_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["speaker_id"], ["session_speakers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_transcript_segments_session_part_start",
        "transcript_segments",
        ["session_id", "part_index", "start_ms"],
    )


def downgrade() -> None:
    op.drop_index("ix_transcript_segments_session_part_start", table_name="transcript_segments")
    op.drop_table("transcript_segments")
    op.drop_index("ix_session_speakers_session_first_seen", table_name="session_speakers")
    op.drop_table("session_speakers")
    op.drop_index("ix_recording_parts_status", table_name="recording_parts")
    op.drop_table("recording_parts")
    op.drop_index("ix_recording_sessions_note_id", table_name="recording_sessions")
    op.drop_index("ix_recording_sessions_user_status", table_name="recording_sessions")
    op.drop_table("recording_sessions")
