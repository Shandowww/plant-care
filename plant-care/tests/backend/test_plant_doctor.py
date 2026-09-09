import json

import httpx2
import pytest
from plantcare.plant_doctor import (
    MODEL_ID,
    CloudflarePlantDoctor,
    PlantDoctorContext,
    PlantDoctorProviderError,
)


def context() -> PlantDoctorContext:
    return PlantDoctorContext(
        display_name="Kitchen Pothos",
        common_name="Golden pothos",
        scientific_name="Epipremnum aureum",
        location="Kitchen",
        environment_type="indoor",
        moisture=31,
        temperature=24.5,
        illuminance=450,
    )


@pytest.mark.asyncio
async def test_cloudflare_request_keeps_token_in_header_and_parses_assessment() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.headers["authorization"] == "Bearer private-token"
        assert request.url.path.endswith(f"/ai/run/{MODEL_ID}")
        body = json.loads(request.content)
        assert body["image"].startswith("data:image/jpeg;base64,")
        assert "Kitchen Pothos" in body["messages"][1]["content"]
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
