import json
from datetime import UTC, datetime, timedelta

import httpx2
import pytest
from plantcare.care_profiles import care_profile
from plantcare.plant_doctor import (
    MODEL_ID,
    CloudflarePlantDoctor,
    MoistureHistoryContext,
    MoistureHistoryPoint,
    PlantDoctorContext,
    PlantDoctorHistoryContext,
    PlantDoctorProviderError,
    summarize_moisture_history,
)


def context() -> PlantDoctorContext:
    return PlantDoctorContext(
        display_name="Kitchen Pothos",
        common_name="Golden pothos",
        scientific_name="Epipremnum aureum",
        location="Kitchen",
        specific_position="Right shelf",
        environment_type="indoor",
        moisture=31,
        temperature=24.5,
        illuminance=450,
        temperature_range_celsius=(18, 29),
        soil_moisture_sensor_range_percent=(25, 60),
        care_profile_basis="golden pothos profile",
        moisture_history=MoistureHistoryContext(
            window_hours=168,
            readings_count=3,
            oldest_percent=41,
            latest_percent=31,
            minimum_percent=31,
            maximum_percent=41,
            trend="falling",
            current_high_streak_hours_at_least=None,
            current_low_streak_hours_at_least=None,
        ),
    )


def test_care_profiles_are_species_specific_and_fallback_transparently() -> None:
    monstera = care_profile("Monstera deliciosa", "Monstera", "indoor")
    orchid = care_profile("Orchids", "Orchids", "indoor")
    unknown = care_profile(None, "Unknown plant", "outdoor_exposed")

    assert (monstera.temperature_minimum, monstera.temperature_maximum) == (16, 29)
    assert (monstera.moisture_minimum, monstera.moisture_maximum) == (30, 65)
    assert "orchid fallback" in orchid.basis
    assert "species not confirmed" in unknown.basis


@pytest.mark.asyncio
async def test_cloudflare_request_keeps_token_in_header_and_parses_assessment() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.headers["authorization"] == "Bearer private-token"
        assert request.url.path.endswith(f"/ai/run/{MODEL_ID}")
        body = json.loads(request.content)
        assert body["image"].startswith("data:image/jpeg;base64,")
        assert "Kitchen Pothos" in body["messages"][1]["content"]
        assert "Epipremnum aureum" in body["messages"][1]["content"]
        assert (
            '"starting_soil_moisture_sensor_band_percent":[25,60]' in body["messages"][1]["content"]
        )
        assert "The summary must name this plant" in body["messages"][1]["content"]
        return httpx2.Response(
            200,
            json={
                "success": True,
                "result": {
                    "response": json.dumps(
                        {
                            "summary": "Mostly healthy.",
                            "observations": ["Green leaves"],
                            "possible_issues": [],
                            "next_steps": ["Check leaf undersides"],
                            "watering_guidance": {
                                "assessment": "Wait and keep monitoring.",
                                "notification_point": (
                                    "Start with an alert below 25% and calibrate it."
                                ),
                                "manual_checks": ["Check two root-zone spots."],
                                "watering_steps": ["Water slowly until excess drains."],
                                "drying_steps": [],
                            },
                            "confidence": "medium",
                        }
                    ),
                    "usage": {"neurons": 7.25},
                },
            },
        )

    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )

    result = await doctor.analyze(b"jpeg", context())

    assert result.summary == "Mostly healthy."
    assert result.neurons == 7.25
    assert result.provider == "Cloudflare Workers AI"
    assert result.watering_guidance.notification_point.startswith("Start with")


def test_moisture_history_summarizes_trend_and_current_wet_streak() -> None:
    now = datetime(2026, 9, 18, 12, tzinfo=UTC)
    summary = summarize_moisture_history(
        [
            MoistureHistoryPoint(now - timedelta(hours=72), 48),
            MoistureHistoryPoint(now - timedelta(hours=50), 67),
            MoistureHistoryPoint(now - timedelta(hours=24), 70),
        ],
        now=now,
        lower_percent=25,
        upper_percent=60,
    )

    assert summary.readings_count == 3
    assert summary.trend == "rising"
    assert summary.minimum_percent == 48
    assert summary.maximum_percent == 70
    assert summary.current_high_streak_hours_at_least == 50
    assert summary.current_low_streak_hours_at_least is None


@pytest.mark.asyncio
async def test_cloudflare_quota_error_is_normalized() -> None:
    async def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            429,
            json={"success": False, "errors": [{"code": 3036}]},
        )

    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )

    with pytest.raises(PlantDoctorProviderError, match="quota"):
        await doctor.analyze(b"jpeg", context())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "error_code", "expected_kind"),
    [
        (429, 3040, "capacity"),
        (429, 9999, "rate_limit"),
        (403, 5016, "configuration"),
        (401, 9109, "credentials"),
    ],
)
async def test_cloudflare_provider_errors_remain_distinguishable(
    status_code: int, error_code: int, expected_kind: str
) -> None:
    async def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            status_code,
            json={"success": False, "errors": [{"code": error_code}]},
        )

    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )

    with pytest.raises(PlantDoctorProviderError, match=expected_kind):
        await doctor.analyze(b"jpeg", context())


@pytest.mark.asyncio
async def test_cloudflare_prompt_includes_compact_outcome_history() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        prompt = body["messages"][1]["content"]
        assert "did_not_help" in prompt
        assert "Avoid repeating advice" in prompt
        return httpx2.Response(
            200,
            json={"success": True, "result": {"response": "Inspect current growth."}},
        )

    original = context()
    with_history = PlantDoctorContext(
        **{
            **original.__dict__,
            "history": (
                PlantDoctorHistoryContext(
                    checked_at="2026-09-09T10:00:00+00:00",
                    summary="Possible overwatering.",
                    recommendation="Reduce watering.",
                    decision="accepted",
                    outcome="did_not_help",
                ),
            ),
        }
    )
    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )

    await doctor.analyze(b"jpeg", with_history)


@pytest.mark.asyncio
async def test_unstructured_provider_response_is_safe_low_confidence_guidance() -> None:
    async def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            json={"success": True, "result": {"response": "Inspect the leaves closely."}},
        )

    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )

    result = await doctor.analyze(b"jpeg", context())

    assert result.confidence == "low"
    assert result.summary == "Inspect the leaves closely."
    assert result.next_steps == ["Inspect the plant directly before changing its care."]
