import asyncio
import base64
import json
from dataclasses import replace

import httpx2
import pytest
from plantcare.config import Settings
from plantcare.doctor_providers import (
    FallbackPlantDoctor,
    GeminiPlantDoctor,
    bounded_assessment,
    configured_doctor,
)
from plantcare.plant_doctor import PlantDoctorProviderError, _assessment
from test_plant_doctor import context


def assessment() -> dict:
    return {
        "identity_status": "uncertain",
        "identity_explanation": "Wilted flowers obscure identifying details.",
        "summary": "Wilting with wet soil needs attention, not more water.",
        "observations": ["Drooping leaves"],
        "possible_issues": ["Root stress or heat; dehydration is not established."],
        "next_steps": ["Empty standing water from the saucer."],
        "confidence": "medium",
        "watering_guidance": {
            "assessment": "Do not add water while the root zone is wet.",
            "notification_point": "Keep existing settings pending calibration.",
            "manual_checks": [],
            "watering_steps": [],
            "drying_steps": ["Allow unobstructed drainage."],
        },
        "care_plan": {
            "urgency": "soon",
            "evidence": ["Wet sensor reading conflicts with simple dehydration."],
            "avoid": ["Do not force drying in harsh sun."],
            "expected_improvement": "Recovery depends on the cause.",
            "reassess": "Review in 24 hours; investigate roots if worsening.",
        },
    }


def envelope(value: dict, finish: str = "STOP") -> dict:
    return {
        "candidates": [
            {
                "finishReason": finish,
                "content": {
                    "parts": [{"text": json.dumps(value)}],
                },
            }
        ],
        "usageMetadata": {"totalTokenCount": 732},
    }


@pytest.mark.asyncio
async def test_gemini_sends_private_header_photo_context_and_preserves_uncertain_care():
    async def handler(request):
        assert request.headers["x-goog-api-key"] == "test-secret"
        assert "test-secret" not in str(request.url)
        body = json.loads(request.content)
        parts = body["contents"][0]["parts"]
        assert base64.b64decode(parts[1]["inlineData"]["data"]) == b"jpeg"
        assert "Wilted since yesterday" in parts[0]["text"]
        assert "sensor is stale" in parts[0]["text"]
        assert "slow drying" in parts[0]["text"]
        assert body["generationConfig"]["responseMimeType"] == "application/json"
        return httpx2.Response(200, json=envelope(assessment()))

    doctor = GeminiPlantDoctor("test-secret", "gemini-test", httpx2.MockTransport(handler))
    result = await doctor.analyze(
        b"jpeg",
        replace(
            context(),
            symptoms="Wilted since yesterday",
            reading_freshness="sensor is stale",
            drying_context="slow drying",
        ),
    )
    assert result.provider == "Google Gemini"
    assert result.total_tokens == 732
    assert result.neurons is None
    assert result.identity_status == "uncertain"
    assert result.next_steps == assessment()["next_steps"]
    assert result.watering_guidance.watering_steps == []
    assert result.care_plan.urgency == "soon"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (401, "credentials"),
        (403, "credentials"),
        (429, "rate_limit"),
        (400, "configuration"),
        (404, "configuration"),
        (503, "unavailable"),
    ],
)
async def test_gemini_errors(status, kind):
    doctor = GeminiPlantDoctor(
        "secret",
        "gemini-test",
        httpx2.MockTransport(
            lambda _: httpx2.Response(status, json={"error": {"message": "private detail"}}),
        ),
    )
    with pytest.raises(PlantDoctorProviderError) as error:
        await doctor.analyze(b"jpeg", context())
    assert error.value.kind == kind
    assert error.value.provider == "Google Gemini"
    assert "private detail" not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"candidates": []},
        envelope(assessment(), "MAX_TOKENS"),
        envelope(assessment(), "SAFETY"),
        envelope({"summary": "Not a complete response"}),
        envelope({**assessment(), "next_steps": "Water now"}),
    ],
)
async def test_gemini_rejects_incomplete_assessments(payload):
    doctor = GeminiPlantDoctor(
        "secret",
        "gemini-test",
        httpx2.MockTransport(
            lambda _: httpx2.Response(200, json=payload),
        ),
    )
    with pytest.raises(PlantDoctorProviderError, match="invalid_response"):
        await doctor.analyze(b"jpeg", context())


@pytest.mark.asyncio
async def test_gemini_timeout():
    def handler(request):
        raise httpx2.ReadTimeout("timeout", request=request)

    doctor = GeminiPlantDoctor("secret", "gemini-test", httpx2.MockTransport(handler))
    with pytest.raises(PlantDoctorProviderError, match="unavailable"):
        await doctor.analyze(b"jpeg", context())


def test_provider_selection_preserves_cloudflare_and_requires_explicit_fallback():
    settings = Settings(cloudflare_account_id="account", cloudflare_api_token="secret")  # noqa: S106
    _, name, fallback = configured_doctor(settings)
    assert name == "Cloudflare Workers AI" and not fallback
    settings.gemini_api_key = Settings(gemini_api_key="key").gemini_api_key
    provider, name, fallback = configured_doctor(settings)
    assert isinstance(provider, GeminiPlantDoctor)
    assert name == "Google Gemini" and not fallback
    settings.doctor_cloudflare_fallback = True
    assert isinstance(configured_doctor(settings)[0], FallbackPlantDoctor)
    settings.gemini_api_key = None
    settings.doctor_provider = "gemini"
    assert configured_doctor(settings)[0] is None


@pytest.mark.asyncio
async def test_total_assessment_deadline_returns_provider_error():
    class SlowProvider:
        async def analyze(self, photo, ctx):
            await asyncio.sleep(1)

    with pytest.raises(PlantDoctorProviderError, match="unavailable") as error:
        await bounded_assessment(SlowProvider(), b"jpeg", context(), "Google Gemini", 0.001)
    assert error.value.provider == "Google Gemini"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", [None, "unavailable", "credentials"])
async def test_fallback_only_on_retryable_failure_not_uncertainty(kind):
    calls = []

    class Primary:
        async def analyze(self, photo, ctx):
            if kind:
                raise PlantDoctorProviderError(kind, "Google Gemini")
            return _assessment(json.dumps(assessment()), None, ctx, provider="Google Gemini")

    class Secondary:
        async def analyze(self, photo, ctx):
            calls.append(photo)
            return _assessment(json.dumps(assessment()), None, ctx)

    provider = FallbackPlantDoctor(Primary(), Secondary())
    if kind == "credentials":
        with pytest.raises(PlantDoctorProviderError):
            await provider.analyze(b"jpeg", context())
        assert calls == []
    else:
        result = await provider.analyze(b"jpeg", context())
        assert result.fallback_used == (kind == "unavailable")
        assert len(calls) == (1 if kind else 0)
