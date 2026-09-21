from datetime import UTC, datetime, timedelta

from plantcare.drying import drying_assessment

NOW = datetime(2026, 9, 20, tzinfo=UTC)


def test_week_at_sensor_ceiling_is_an_informational_wet_watch_not_overwatering() -> None:
    points = [(NOW - timedelta(days=day), 100.0) for day in range(8)]
    status, note, alert = drying_assessment(points, NOW, 20, 50)
    assert status == "wet_watch"
    assert "Still very wet" in note
    assert not alert


def test_watering_rise_is_recent_not_an_alert() -> None:
    points = [(NOW - timedelta(hours=2), 20.0), (NOW, 100.0)]
    assert drying_assessment(points, NOW, 20, 50)[0] == "recently_watered"


def test_wet_watch_needs_three_recent_readings_and_no_downward_trend() -> None:
    points = [(NOW - timedelta(hours=hour), 100.0) for hour in (96, 48)]
    assert drying_assessment(points, NOW, 20, 50)[0] == "learning"
    points.append((NOW, 94.0))
    assert drying_assessment(points, NOW, 20, 50)[0] == "learning"


def test_custom_timer_and_absolute_review() -> None:
    points = [(NOW - timedelta(days=day), 100.0) for day in range(8)]
    assert drying_assessment(points, NOW, 20, 50, 144)[2]
    assert not drying_assessment(points, NOW, 20, 50, 240)[2]
    points = [(NOW - timedelta(days=day), 100.0) for day in range(15)]
    assert drying_assessment(points, NOW, 20, 50)[2]


def test_learning_compares_three_complete_cycles_and_recovers() -> None:
    points: list[tuple[datetime, float]] = []
    for start in (35, 28, 21):
        points.append((NOW - timedelta(days=start, hours=1), 20))
        for day in range(6):
            points.append((NOW - timedelta(days=start - day), 100 if day < 5 else 20))
    for day in range(10, -1, -1):
        points.append((NOW - timedelta(days=day), 100))
    # Start the current watering with a documented low-to-high rise.
    points.append((NOW - timedelta(days=10, hours=1), 20))
    status, note, alert = drying_assessment(points, NOW, 20, 50)
    assert status == "review" and alert
    assert "longer than usual" in note
    points.append((NOW + timedelta(hours=1), 20))
    assert not drying_assessment(points, NOW + timedelta(hours=1), 20, 50)[2]


def test_observation_gap_cannot_prove_continuous_wetness() -> None:
    points = [(NOW - timedelta(days=20), 100.0), (NOW, 100.0)]
    assert not drying_assessment(points, NOW, 20, 50, 24)[2]
