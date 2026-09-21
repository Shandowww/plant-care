"""Conservative per-pot dry-down comparison, not a diagnosis of root health."""

from datetime import UTC, datetime, timedelta
from statistics import median


def drying_assessment(
    points: list[tuple[datetime, float]],
    now: datetime,
    low: float,
    wet: float,
    override_hours: float | None = None,
) -> tuple[str, str, bool]:
    points = sorted(
        (time.replace(tzinfo=UTC) if time.tzinfo is None else time, value)
        for time, value in points
        if (time.replace(tzinfo=UTC) if time.tzinfo is None else time) <= now
    )
    if not points:
        return "learning", "Learning drying pattern — no usable moisture history yet.", False
    started: datetime | None = None
    high_since: datetime | None = None
    high_count = 0
    durations: list[float] = []
    previous: tuple[datetime, float] | None = None
    for time, value in points:
        # Long observation gaps cannot prove a continuous drying cycle.
        if previous and time - previous[0] > timedelta(hours=72):
            started = None
            high_since = None
            high_count = 0
        if value >= wet:
            high_since = high_since or time
            high_count += 1
        elif value <= wet - 5:
            high_since = None
            high_count = 0
        # A substantial observed rise suggests watering, but is not proof of it.
        if previous and time - previous[0] <= timedelta(hours=24):
            if value >= wet and value - previous[1] >= 15:
                started = time
        if started and value <= low + 5:
            hours = (time - started).total_seconds() / 3600
            if 24 <= hours <= 24 * 30:
                durations.append(hours)
            started = None
        previous = (time, value)
    typical = median(durations[-5:]) if len(durations) >= 3 else None
    wet_hours = (now - high_since).total_seconds() / 3600 if high_since else 0
    elapsed = (now - started).total_seconds() / 3600 if started else 0
    high = points[-1][1] >= wet
    # An explicit user limit wins. Otherwise compare only complete observed cycles.
    late = high and (
        wet_hours >= override_hours
        if override_hours is not None
        else typical is not None and elapsed > max(72, typical * 1.5)
    )
    # A long plateau remains worth reviewing even if historical cycles were unhealthy.
    review = high and wet_hours >= 24 * 14
    if (late or review) and high_count >= 3:
        reason = (
            f"Above your wet threshold for {wet_hours / 24:.1f} days; review drainage."
            if override_hours is not None or review
            else f"Drying longer than usual: {elapsed / 24:.1f} days since a likely watering; "
            f"previous cycles took about {(typical or 0) / 24:.1f} days."
        )
        return "review", reason + " This is a review prompt, not proof of overwatering.", True
    if started and elapsed < 48:
        return (
            "recently_watered",
            "Recently watered — a moisture rise suggests watering; tracking dry-down.",
            False,
        )
    recent_points = [value for time, value in points if now - time <= timedelta(hours=72)]
    no_downward_trend = (
        len(recent_points) >= 3
        and min(recent_points) >= wet
        and max(recent_points) - min(recent_points) < 5
    )
    if high and wet_hours >= 72 and no_downward_trend:
        return (
            "wet_watch",
            (
                f"Still very wet for {wet_hours / 24:.1f} days with no meaningful downward "
                "trend. Watching dry-down; this is information, not a care action."
            ),
            False,
        )
    if typical is None:
        return (
            "learning",
            (
                f"Learning drying pattern — {min(len(durations), 3)} of 3 cycles observed. "
                "High moisture alone is not an alert; a 14-day high plateau prompts review."
            ),
            False,
        )
    return (
        "drying",
        (
            f"Tracking dry-down — previous cycles took about {typical / 24:.1f} days. "
            "Usual does not necessarily mean healthy."
        ),
        False,
    )
