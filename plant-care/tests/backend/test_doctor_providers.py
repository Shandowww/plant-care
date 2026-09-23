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
    verify_gemini,
)
from plantcare.plant_doctor import PlantDoctorProviderError, _assessment
from structlog.testing import capture_logs
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
@pytest.mark.parametrize("model", ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-test"])
async def test_gemini_latency_setting_and_private_attempt_diagnostics(model):
    def handler(request):
        config = json.loads(request.content)["generationConfig"]
        if model == "gemini-3.6-flash":
            assert config["thinkingConfig"] == {"thinkingLevel": "low"}
        else:
            assert "thinkingConfig" not in config
        return httpx2.Response(200, json=envelope(assessment()))

    doctor = GeminiPlantDoctor("private-key", model, httpx2.MockTransport(handler))
    with capture_logs() as events:
        await doctor.analyze(b"private-photo", context())
    event = next(e for e in events if e["event"] == "plant_doctor_gemini_attempt")
    assert event["status_code"] == 200
    assert event["attempt"] == 1
    assert event["outcome"] == "response"
    assert event["elapsed_seconds"] >= 0
    assert "private-key" not in str(events)
    assert "private-photo" not in str(events)
    assert assessment()["summary"] not in str(events)


@pytest.mark.asyncio
async def test_gemini_logs_inflight_deadline_without_retrying():
    async def handler(request):
        await asyncio.sleep(1)
        return httpx2.Response(200, json=envelope(assessment()))

    doctor = GeminiPlantDoctor("secret", "gemini-test", httpx2.MockTransport(handler))
    with capture_logs() as events:
        with pytest.raises(PlantDoctorProviderError, match="timeout"):
            await bounded_assessment(doctor, b"jpeg", context(), "Google Gemini", seconds=0.01)
    attempts = [e for e in events if e["event"] == "plant_doctor_gemini_attempt"]
    assert len(attempts) == 1
    assert attempts[0]["status_code"] is None
    assert attempts[0]["outcome"] == "cancelled"


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
        (503, "capacity"),
    ],
)
async def test_gemini_errors(status, kind):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx2.Response(status, json={"error": {"message": "private detail"}})

    doctor = GeminiPlantDoctor(
        "secret",
        "gemini-test",
        httpx2.MockTransport(handler),
    )
    with pytest.raises(PlantDoctorProviderError) as error:
        await doctor.analyze(b"jpeg", context())
    assert error.value.kind == kind
    assert error.value.provider == "Google Gemini"
    assert "private detail" not in str(error.value)
    assert len(calls) == (2 if status == 503 else 1)


@pytest.mark.asyncio
async def test_gemini_recovers_after_one_service_rejection():
    calls = []

    def handler(request):
        calls.append(request.content)
        if len(calls) == 1:
            return httpx2.Response(503)
        return httpx2.Response(200, json=envelope(assessment()))

    doctor = GeminiPlantDoctor("secret", "gemini-test", httpx2.MockTransport(handler))
    result = await doctor.analyze(b"jpeg", context())
    assert result.summary == assessment()["summary"]
    assert len(calls) == 2
    assert calls[0] == calls[1]


@pytest.mark.asyncio
async def test_gemini_retry_respects_overall_deadline():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx2.Response(503)

    doctor = GeminiPlantDoctor("secret", "gemini-test", httpx2.MockTransport(handler))
    with pytest.raises(PlantDoctorProviderError, match="timeout"):
        await bounded_assessment(doctor, b"jpeg", context(), "Google Gemini", seconds=0.01)
    assert len(calls) == 1


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
    with pytest.raises(PlantDoctorProviderError, match="timeout"):
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

    with pytest.raises(PlantDoctorProviderError, match="timeout") as error:
        await bounded_assessment(SlowProvider(), b"jpeg", context(), "Google Gemini", 0.001)
    assert error.value.provider == "Google Gemini"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", [None, "unavailable", "timeout", "credentials"])
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
        assert result.fallback_used == (kind in ("unavailable", "timeout"))
        assert len(calls) == (1 if kind else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "reason"),
    [
        (200, "verified"),
        (400, "credentials"),
        (401, "credentials"),
        (403, "credentials"),
        (404, "configuration"),
        (429, "rate_limit"),
        (503, "capacity"),
    ],
)
async def test_verify_is_metadata_only_and_redacts_errors(status, reason):
    key = "synthetic-test-key"

    async def handler(request):
        assert request.method == "GET"
        assert request.url.path.endswith("/models/gemini-test")
        assert request.headers["x-goog-api-key"] == key
        assert key not in str(request.url)
        assert request.content == b""
        payload = (
            {"name": "models/gemini-test", "supportedGenerationMethods": ["generateContent"]}
            if status == 200
            else {
                "error": {
                    "message": key,
                    "details": [{"reason": "API_KEY_INVALID"}] if status == 400 else [],
                }
            }
        )
        return httpx2.Response(status, json=payload)

    result = await verify_gemini(
        Settings(gemini_api_key=key, gemini_model="gemini-test"), httpx2.MockTransport(handler)
    )
    assert result.reason == reason
    assert result.ok == (status == 200)
    assert key not in result.model_dump_json()


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["missing", "timeout", "network", "malformed", "unsupported"])
async def test_verify_failures(case):
    def handler(request):
        assert case != "missing"
        if case == "timeout":
            raise httpx2.ReadTimeout("private detail", request=request)
        if case == "network":
            raise httpx2.ConnectError("private detail", request=request)
        return httpx2.Response(
            200,
            json={}
            if case == "malformed"
            else {"name": "models/gemini-test", "supportedGenerationMethods": []},
        )

    settings = Settings(gemini_api_key=None if case == "missing" else "synthetic-test-key")
    result = await verify_gemini(settings, httpx2.MockTransport(handler))
    assert not result.ok
    assert result.reason == {
        "missing": "not_configured",
        "malformed": "invalid_response",
        "unsupported": "configuration",
    }.get(case, case)
    assert "private detail" not in result.message
