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
        moisture_monitoring_thresholds_percent=(25, 60),
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
    assert (
        monstera.moisture_check_threshold,
        monstera.moisture_wet_threshold,
    ) == (30, 65)
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
            '"moisture_monitoring_thresholds_percent":'
            '{"watering_check_at_or_below":25,"prolonged_wet_at_or_above":60}'
            in body["messages"][1]["content"]
        )
        assert "identity confidence kept separate" in body["messages"][1]["content"]
        assert "response_format" not in body
        return httpx2.Response(
            200,
            json={
                "success": True,
                "result": {
                    "response": json.dumps(
                        {
                            "summary": "Mostly healthy.",
                            "identity_status": "match",
                            "identity_explanation": "Heart-shaped variegated leaves.",
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
            json={"success": True, "result": {"response": '{"identity_status":"uncertain"}'}},
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
async def test_unstructured_vision_response_is_normalized_without_inventing_identity() -> None:
    requests = 0

    async def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal requests
        requests += 1
        if requests == 1:
            assert request.url.path.endswith(f"/ai/run/{MODEL_ID}")
            return httpx2.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "response": "The leaves look wilted, but identity is not established.",
                        "usage": {"neurons": 8.5},
                    },
                },
            )
        body = json.loads(request.content)
        assert request.url.path.endswith("/ai/run/@cf/meta/llama-3.1-8b-instruct")
        assert body["response_format"]["type"] == "json_schema"
        assert "The leaves look wilted" in body["messages"][1]["content"]
        return httpx2.Response(
            200,
            json={
                "success": True,
                "result": {
                    "response": {
                        "identity_status": "uncertain",
                        "identity_explanation": "The source did not verify the identity.",
                        "summary": "Photo identity requires confirmation.",
                        "observations": ["Leaves appear wilted."],
                        "possible_issues": [],
                        "next_steps": [],
                        "watering_guidance": {
                            "assessment": "Care advice is withheld.",
                            "notification_point": "No sensor setting was changed.",
                            "manual_checks": [],
                            "watering_steps": [],
                            "drying_steps": [],
                        },
                        "confidence": "low",
                    },
                    "usage": {"neurons": 1.5},
                },
            },
        )

    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )

    result = await doctor.analyze(b"jpeg", context())

    assert requests == 2
    assert result.identity_status == "uncertain"
    assert result.observations == ["Leaves appear wilted."]
    assert result.next_steps == []
    assert result.neurons == 10


@pytest.mark.asyncio
async def test_cloudflare_json_mode_object_response_is_supported() -> None:
    async def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            json={
                "success": True,
                "result": {
                    "response": {
                        "identity_status": "match",
                        "identity_explanation": "Leaf shape is consistent.",
                        "summary": "The visible foliage is generally healthy.",
                        "observations": ["Green leaves"],
                        "possible_issues": [],
                        "next_steps": ["Continue regular monitoring."],
                        "watering_guidance": {
                            "assessment": "No immediate watering change is indicated.",
                            "notification_point": "Use the calibrated sensor threshold.",
                            "manual_checks": [],
                            "watering_steps": [],
                            "drying_steps": [],
                        },
                        "confidence": "medium",
                    }
                },
            },
        )

    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )
    assert (await doctor.analyze(b"jpeg", context())).identity_status == "match"


@pytest.mark.asyncio
@pytest.mark.parametrize("identity_status", ["mismatch", None, []])
async def test_unverified_identity_withholds_care_even_if_provider_supplies_it(
    identity_status: object,
) -> None:
    async def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            json={
                "success": True,
                "result": {
                    "response": json.dumps(
                        {
                            "identity_status": identity_status,
                            "identity_explanation": "**Different leaf shape and flowers.**",
                            "summary": "Water the saved species now.",
                            "next_steps": ["Water now"],
                            "confidence": "high",
                            "watering_guidance": {"watering_steps": ["Water now"]},
                        }
                    )
                },
            },
        )

    doctor = CloudflarePlantDoctor(
        "account-id", "private-token", transport=httpx2.MockTransport(handler)
    )
    result = await doctor.analyze(b"jpeg", context())
    assert result.identity_status != "match"
    assert result.confidence == "low"
    assert result.next_steps == []
    assert result.watering_guidance.watering_steps == []
    assert result.identity_explanation == "Different leaf shape and flowers."
