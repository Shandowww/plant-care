import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Plant } from "./types";

const plant: Plant = {
  id: "plant-1",
  display_name: "Golden Pothos",
  location: "Kitchen",
  specific_position: "Right shelf",
  common_name: "Golden pothos",
  scientific_name: "Epipremnum aureum",
  environment_type: "indoor",
  state: "action_needed",
  moisture: 18,
  moisture_status: "low",
  moisture_check_threshold: 25,
  moisture_wet_threshold: 60,
  moisture_check_threshold_override: null,
  moisture_wet_threshold_override: null,
  moisture_thresholds_custom: false,
  temperature: 24.2,
  temperature_status: "normal",
  temperature_minimum: 18,
  temperature_maximum: 29,
  care_profile_basis: "golden pothos profile",
  battery: 67,
  illuminance: null,
  photo_updated_at: null,
  last_reading_at: "2026-08-14T09:00:00Z",
  highest_priority_action: "Check soil moisture",
  entity_mapping: null,
  active: true,
};

const action = {
  id: "action-1",
  plant_id: "plant-1",
  type: "clean_leaves",
  title: "Clean leaves",
  observation: "Seasonal leaf cleaning is due.",
  recommendation: "Wipe both sides and inspect for pests.",
  status: "open",
  priority: 1,
  due_at: "2026-08-14T09:00:00Z",
  snoozed_until: null,
  completed_at: null,
  completed_by: null,
};

function mockApi(
  actionFixture = action,
  plantFixture = plant,
  simulator = true,
  doctorIdentity = "match",
  doctorProvider = "Cloudflare Workers AI",
  fallbackAvailable = false,
) {
  let currentPlant = { ...plantFixture };
  let doctorChecks = 0;
  let doctorHistory: Array<Record<string, unknown>> = [];
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/plant-doctor/verify"))
        return new Response(JSON.stringify({ok: true, reason: "verified", model: "gemini-test",
          message: "Key and model verified. No photo sent; generation quota not checked."}), {status: 200});
      if (url.endsWith("/plant-doctor/usage"))
        return new Response(
          JSON.stringify({
            checks_today: doctorChecks,
            provider: doctorProvider,
            configured: true,
            fallback_available: fallbackAvailable,
            period_started_at: "2026-09-10T00:00:00Z",
            resets_at: "2026-09-11T00:00:00Z",
            daily_free_neuron_limit: 10000,
            estimated_neurons_per_check: "about 10–50",
          }),
          { status: 200 },
        );
      if (
        url.endsWith("/plants/plant-1/doctor/history") &&
        (!init?.method || init.method === "GET")
      )
        return new Response(JSON.stringify({ visits: doctorHistory }), {
          status: 200,
        });
      if (
        url.includes("/plants/plant-1/doctor/history/") &&
        init?.method === "PATCH"
      ) {
        const feedback = JSON.parse(String(init.body));
        const visitId = url.split("/").at(-1);
        doctorHistory = doctorHistory.map((visit) =>
          visit.id === visitId ? { ...visit, ...feedback } : visit,
        );
        return new Response(
          JSON.stringify(doctorHistory.find((visit) => visit.id === visitId)),
          { status: 200 },
        );
      }
      if (url.endsWith("/actions/history"))
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      if (url.endsWith("/home-assistant/entities"))
        return new Response(
          JSON.stringify({
            source: "simulator",
            areas: ["Bedroom", "Kitchen", "Living room"],
            entities: [
              {
                entity_id: "sensor.golden_pothos_soil_moisture",
                name: "Golden Pothos Soil moisture",
                device_class: "moisture",
                state: "18",
                unit: "%",
                area_name: "Kitchen",
                device_id: "device-pothos",
              },
              {
                entity_id: "sensor.golden_pothos_temperature",
                name: "Golden Pothos Temperature",
                device_class: "temperature",
                state: "24.9",
                unit: "°C",
                area_name: "Kitchen",
                device_id: "device-pothos",
              },
              {
                entity_id: "sensor.kitchen_air_temperature",
                name: "Kitchen Air Temperature",
                device_class: "temperature",
                state: "24.2",
                unit: "°C",
                area_name: "Kitchen",
                device_id: "device-room",
              },
              {
                entity_id: "sensor.golden_pothos_battery",
                name: "Golden Pothos Battery",
                device_class: "battery",
                state: "67",
                unit: "%",
                area_name: "Kitchen",
                device_id: "device-pothos",
              },
              {
                entity_id: "sensor.golden_pothos_illuminance",
                name: "Golden Pothos Illuminance",
                device_class: "illuminance",
                state: "unavailable",
                unit: "lx",
                area_name: "Kitchen",
                device_id: "device-pothos",
              },
              {
                entity_id: "sensor.kitchen_motion_illuminance",
                name: "Kitchen Motion Illuminance",
                device_class: "illuminance",
                state: "465",
                unit: "lx",
                area_name: "Kitchen",
                device_id: "device-motion",
              },
            ],
          }),
          { status: 200 },
        );
      if (url.endsWith("/home-assistant/sync") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            plants_checked: 1,
            readings_added: 0,
            invalid_readings: 0,
            missing_entities: 0,
          }),
          { status: 200 },
        );
      }
      if (
        url.endsWith("/plants/plant-1/entity-mapping") &&
        init?.method === "PATCH"
      ) {
        const entityMapping = JSON.parse(String(init.body));
        currentPlant = { ...currentPlant, entity_mapping: entityMapping };
        return new Response(JSON.stringify(entityMapping), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/plants/plant-1") && init?.method === "PATCH") {
        currentPlant = { ...currentPlant, ...JSON.parse(String(init.body)) };
        return new Response(JSON.stringify(currentPlant), { status: 200 });
      }
      if (url.endsWith("/photo") && init?.method === "POST") {
        const plantId = url.split("/").at(-2) ?? "plant-1";
        const uploadedPlant = {
          ...(plantId === "plant-1" ? currentPlant : plant),
          id: plantId,
          photo_updated_at: "2026-09-09T18:00:00Z",
        };
        if (plantId === "plant-1") currentPlant = uploadedPlant;
        return new Response(JSON.stringify(uploadedPlant), { status: 200 });
      }
      if (url.endsWith("/plants/plant-1/photo") && init?.method === "DELETE") {
        currentPlant = { ...currentPlant, photo_updated_at: null };
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/plants/plant-1/doctor") && init?.method === "POST") {
        doctorChecks += 1;
        const visit = {
          id: `visit-${doctorChecks}`,
          action_id: null,
          summary: "The leaves look generally healthy.",
          identity_status: doctorIdentity,
          identity_explanation: "The visible leaves match the selected plant.",
          observations: ["Leaves are mostly green."],
          possible_issues: ["One edge may be dry."],
          next_steps: ["Check the underside of the leaves."],
          watering_guidance: {
            assessment: "Wait and keep monitoring.",
            notification_point: "Start below 25% and calibrate it.",
            manual_checks: ["Check two root-zone spots."],
            watering_steps: ["Water slowly until excess drains."],
            drying_steps: [],
          },
          sensor_snapshot: {
            moisture: 18,
            temperature: 24.2,
            illuminance: null,
          },
          confidence: "medium",
          provider: doctorProvider,
          total_tokens: doctorProvider === "Google Gemini" ? 732 : null,
          care_plan: {
            urgency: "soon", evidence: ["Recent wilting needs context."],
            avoid: ["Avoid harsh sun."], expected_improvement: "Depends on the cause.",
            reassess: "Reassess tomorrow.",
          },
          model: "@cf/meta/llama-3.2-11b-vision-instruct",
          neurons: 11.25,
          decision: "pending",
          outcome: "not_tried",
          created_at: "2026-09-10T08:00:00Z",
        };
        doctorHistory = [visit, ...doctorHistory];
        return new Response(
          JSON.stringify({
            visit_id: visit.id,
            identity_status: visit.identity_status,
            identity_explanation: visit.identity_explanation,
            summary: visit.summary,
            observations: visit.observations,
            possible_issues: visit.possible_issues,
            next_steps: visit.next_steps,
            watering_guidance: visit.watering_guidance,
            confidence: visit.confidence,
            provider: visit.provider,
            model: visit.model,
            neurons: visit.neurons,
            total_tokens: visit.total_tokens,
            care_plan: visit.care_plan,
            disclaimer: "Confirm suggestions before changing care.",
          }),
          { status: 200 },
        );
      }
      if (
        url.endsWith("/plants/plant-1/doctor/recommendation") &&
        init?.method === "POST"
      ) {
        const payload = JSON.parse(String(init.body));
        doctorHistory = doctorHistory.map((visit) =>
          visit.id === payload.visit_id
            ? { ...visit, action_id: "ai-action-1", decision: "accepted" }
            : visit,
        );
        return new Response(
          JSON.stringify({
            ...action,
            id: "ai-action-1",
            type: "ai_recommendation",
            title: "Review AI recommendation",
            observation: "Suggested by Plant Doctor from a photo assessment.",
            recommendation: payload.recommendation,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/plants") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            ...plant,
            ...payload,
            id: "plant-2",
            state: "sensor_issue",
            entity_mapping: payload.entity_mapping ?? null,
          }),
          { status: 201 },
        );
      }
      if (url.endsWith("/plants"))
        return new Response(
          JSON.stringify({
            plants: [currentPlant],
            summary: {
              total: 1,
              action_needed: 1,
              overdue: 0,
              sensor_issues: 0,
            },
          }),
          { status: 200 },
        );
      if (url.endsWith("/actions"))
        return new Response(JSON.stringify({ actions: [actionFixture] }), {
          status: 200,
        });
      if (url.endsWith("/complete"))
        return new Response(
          JSON.stringify({
            ...actionFixture,
            status: "completed",
            completed_at: "2026-08-14T10:00:00Z",
            completed_by: "Developer",
          }),
          { status: 200 },
        );
      if (url.endsWith("/health"))
        return new Response(
          JSON.stringify({
            status: "ready",
            version: "0.11.3",
            database: "ready",
            simulator,
            plant_doctor_configured: true,
            home_assistant_notifications_enabled: !simulator,
            stale_sensor_hours: 72,
          }),
          { status: 200 },
        );
      return new Response("", { status: 404 });
    });
}

function chooseDiagnosticPhoto() {
  const photo = new File(["current diagnostic photo"], "diagnostic.jpg", {
    type: "image/jpeg",
  });
  fireEvent.change(screen.getByLabelText(/Take or choose a photo/), {
    target: { files: [photo] },
  });
  return photo;
}

describe("portal", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("renders simulator plant status without relying on colour alone", async () => {
    mockApi();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Golden Pothos")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Action needed").length).toBeGreaterThan(0);
    expect(screen.getByText("18%")).toBeInTheDocument();
  });

  it("opens a plant detail dialog", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Golden Pothos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sensor power")).toBeInTheDocument();
  });

  it("opens details from anywhere on a plant card", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("article", { name: "Golden Pothos" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Golden Pothos" }),
    ).toBeInTheDocument();
  });

  it("opens the linked plant directly from a Home Assistant notification", async () => {
    window.location.hash = "#plants/plant-1";
    mockApi();

    render(<App />);

    expect(
      await screen.findByRole("dialog", { name: "Golden Pothos" }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#plants");
  });

  it("shows plant-specific tips, shuffles them, and expands the full guide", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    expect(
      screen.getByRole("heading", { name: "Tips for Golden Pothos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Care guide for Golden pothos"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Read the soil, not the calendar"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Close plant details" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Golden Pothos details" }),
    );
    expect(
      screen.getByText("Variegation follows the light"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Shuffle care tip for Golden Pothos",
      }),
    );
    expect(
      screen.queryByText("Variegation follows the light"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all tips (5)" }));
    expect(
      screen.getByRole("button", { name: "Hide all tips" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getAllByText("Read the soil, not the calendar").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Choose trailing or climbing").length,
    ).toBeGreaterThan(0);
  });

  it("shows the normal temperature range without opening plant details", async () => {
    mockApi();
    render(<App />);
    const temperature = await screen.findByRole("button", {
      name: "Temperature 24.2 degrees Celsius; show normal range",
    });
    fireEvent.click(temperature);
    expect(
      screen.getByText("Normal temperature range: 18–29°C"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/golden pothos profile/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Golden Pothos" }),
    ).not.toBeInTheDocument();
  });

  it("shows the plant-specific moisture triggers without opening plant details", async () => {
    mockApi();
    render(<App />);
    const moisture = await screen.findByRole("button", {
      name: "Moisture 18 percent; show monitoring thresholds",
    });
    fireEvent.click(moisture);
    expect(
      screen.getByText("Watering check at or below 25%"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Wet tracking at or above 60%/)).toBeInTheDocument();
    expect(
      screen.getByText(/Calibrate thresholds for your sensor, substrate, and placement/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Golden Pothos" }),
    ).not.toBeInTheDocument();
  });

  it("keeps photo management inside Edit plant", async () => {
    mockApi();
    render(<App />);
    expect(
      screen.queryByRole("button", { name: "Manage Golden Pothos photo" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    expect(
      screen.queryByRole("button", { name: "Manage photo" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    expect(
      screen.getByRole("group", { name: "Plant photo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Using the bundled species illustration"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Choose or take a photo/)).not.toHaveAttribute(
      "capture",
    );
  });

  it("uploads and deletes a private plant photo", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    const photo = new File(["photo bytes"], "pothos.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(screen.getByLabelText(/Choose or take a photo/), {
      target: { files: [photo] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Golden Pothos was updated.");
    expect(
      screen.getAllByRole("img", { name: "Photo of Golden Pothos" }).length,
    ).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/photo",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove current photo" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Golden Pothos was updated.");
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/photo",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("requires a separate diagnostic photo without replacing the cover", async () => {
    mockApi(action, { ...plant, photo_updated_at: "2026-09-09T18:00:00Z" });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    expect(
      screen.getByRole("dialog", { name: "Check Golden Pothos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose a current diagnostic photo"),
    ).toBeInTheDocument();
    expect(screen.getByText(/cover photo stays unchanged/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Take or choose a photo/)).not.toHaveAttribute(
      "capture",
    );
    expect(
      screen.getByRole("button", { name: "Send for diagnosis" }),
    ).toBeDisabled();
  });

  it("blocks accepting advice for a mismatched photo", async () => {
    mockApi(action, plant, true, "mismatch");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    await screen.findByText("0 completed checks since 00:00 UTC");
    chooseDiagnosticPhoto();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send for diagnosis" }));
    expect(await screen.findByText("This may be a different plant.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add AI recommendation" })).toBeDisabled();
  });

  it("runs Plant Doctor only after one-check consent and shows usage", async () => {
    const fetchMock = mockApi(action, {
      ...plant,
      photo_updated_at: "2026-09-09T18:00:00Z",
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    expect(
      await screen.findByText("0 completed checks since 00:00 UTC"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Estimated about 10–50 neurons per check · 10,000 free neurons/day",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Failed attempts and fallback processing/),
    ).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send for diagnosis" });
    expect(send).toBeDisabled();
    chooseDiagnosticPhoto();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send);
    await screen.findByText("The leaves look generally healthy.");
    expect(
      screen.getByText("Assessment for Golden Pothos"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Golden pothos · Epipremnum aureum"),
    ).toBeInTheDocument();
    expect(screen.getByText("Watering plan")).toBeInTheDocument();
    expect(screen.getByText("YOUR AI GARDENER")).toBeInTheDocument();
    expect(screen.getByText("What to do now")).toBeInTheDocument();
    expect(screen.getByText("Suggested notification point")).toBeInTheDocument();
    expect(screen.getByText("Check two root-zone spots.")).toBeInTheDocument();
    expect(screen.getByText("Check two root-zone spots.").tagName).toBe("Q");
    expect(screen.getByText(/11\.25 neurons/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Add AI recommendation" }),
    );
    await screen.findByText("Added to care queue");
    expect(
      screen.getByText(
        "AI recommendation added to Golden Pothos's care queue.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Patient history")).toBeInTheDocument();
    expect(screen.getByText("Added to queue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Didn't help" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Didn't help" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor/recommendation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recommendation: "Check the underside of the leaves.",
          visit_id: "visit-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor/history/visit-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ outcome: "did_not_help" }),
      }),
    );
  });

  it("labels AI recommendations in the care queue", async () => {
    mockApi({
      ...action,
      type: "ai_recommendation",
      title: "Review AI recommendation",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /Care queue/ }));
    expect(await screen.findByText("AI recommendation")).toBeInTheDocument();
  });

  it("sends symptoms with Gemini consent and leaves fallback optional", async () => {
    const fetchMock = mockApi(action, plant, true, "uncertain", "Google Gemini", true);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    await screen.findByText("0 completed checks since 00:00 UTC");
    expect(screen.queryByText(/10,000 free neurons/)).not.toBeInTheDocument();
    expect(screen.getByText(/Google AI Studio for remaining quota/)).toBeInTheDocument();
    chooseDiagnosticPhoto();
    fireEvent.change(screen.getByRole("textbox"), {target: {value: "Wilted since yesterday"}});
    const fallback = screen.getByRole("checkbox", {name: /Also allow Cloudflare/});
    expect(fallback).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", {name: /I agree to send/}));
    const doctorDialog = screen.getByRole("dialog", {name: "Check Golden Pothos"});
    doctorDialog.scrollTop = 500;
    fireEvent.click(screen.getByRole("button", {name: "Send for diagnosis"}));
    await screen.findByText("The leaves look generally healthy.");
    await waitFor(() => expect(doctorDialog.scrollTop).toBe(0));
    expect(screen.getByText("Plant identity is not confirmed.")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Add AI recommendation"})).toBeEnabled();
    expect(screen.getByText("Attention soon")).toBeInTheDocument();
    expect(screen.getByText("Reassess tomorrow.")).toBeInTheDocument();
    expect(screen.getByText(/732 tokens/)).toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith("/doctor") && init?.method === "POST");
    const body = request?.[1]?.body as FormData;
    expect(body.get("symptoms")).toBe("Wilted since yesterday");
    expect(body.get("fallback_consent")).toBe("false");
  });

  it("verifies Gemini setup from Settings without submitting a diagnosis", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("link", {name: "Settings"}));
    fireEvent.click(await screen.findByRole("button", {name: "Verify Gemini setup"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Connection verified (gemini-test)");
    expect(fetchMock).toHaveBeenCalledWith("api/v1/plant-doctor/verify", expect.objectContaining({method: "POST"}));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/doctor"))).toBe(false);
  });

  it("records when a Doctor recommendation is declined", async () => {
    const fetchMock = mockApi(action, {
      ...plant,
      photo_updated_at: "2026-09-09T18:00:00Z",
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    await screen.findByText("0 completed checks since 00:00 UTC");
    chooseDiagnosticPhoto();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send for diagnosis" }));
    await screen.findByText("The leaves look generally healthy.");
    fireEvent.click(screen.getByRole("button", { name: "Don't add" }));
    await screen.findByRole("button", { name: "Not added" });
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor/history/visit-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ decision: "declined" }),
      }),
    );
  });

  it("maps Home Assistant sensor entities from plant details", async () => {
    const fetchMock = mockApi(action, {
      ...plant,
      entity_mapping: {
        moisture_entity_id: "sensor.golden_pothos_soil_moisture",
        temperature_entity_id: "sensor.golden_pothos_temperature",
        battery_entity_id: "sensor.golden_pothos_battery",
        illuminance_entity_id: "sensor.kitchen_motion_illuminance",
      },
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("article", { name: "Golden Pothos" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Manage sensor mapping" }),
    );
    await screen.findByRole("dialog", {
      name: "Map sensors for Golden Pothos",
    });
    fireEvent.change(screen.getByLabelText("Temperature"), {
      target: { value: "sensor.kitchen_air_temperature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() =>
      expect(
        screen.getByText("Golden Pothos sensor mapping was updated."),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/entity-mapping",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("sensor.kitchen_air_temperature"),
      }),
    );
  });

  it("refreshes a saved sensor change without a second browser-driven sync", async () => {
    const fetchMock = mockApi(
      action,
      {
        ...plant,
        entity_mapping: {
          moisture_entity_id: "sensor.golden_pothos_soil_moisture",
          temperature_entity_id: "sensor.golden_pothos_temperature",
          battery_entity_id: "sensor.golden_pothos_battery",
          illuminance_entity_id: null,
        },
      },
      false,
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("article", { name: "Golden Pothos" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Manage sensor mapping" }),
    );
    fireEvent.change(await screen.findByLabelText("Temperature"), {
      target: { value: "sensor.kitchen_air_temperature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    expect(
      await screen.findByText("Golden Pothos sensor mapping was updated."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/entity-mapping",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("sensor.kitchen_air_temperature"),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "api/v1/home-assistant/sync",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses ingress-relative API paths", async () => {
    const fetchMock = mockApi();
    render(<App />);
    await screen.findByText("Golden Pothos");
    expect(
      fetchMock.mock.calls.every(([input]) => !String(input).startsWith("/")),
    ).toBe(true);
  });

  it("edits an existing plant", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    fireEvent.change(screen.getByLabelText("Friendly name"), {
      target: { value: "Kitchen Pothos" },
    });
    fireEvent.change(screen.getByLabelText(/Specific position/), {
      target: { value: "Beside the north window" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Kitchen Pothos" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getAllByText(/Kitchen · Beside the north window/).length,
    ).toBeGreaterThan(0);
  });

  it("saves custom moisture monitoring thresholds", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Golden Pothos details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Customize thresholds for this plant",
      }),
    );
    fireEvent.change(screen.getByLabelText(/Watering-check trigger/), {
      target: { value: "22" },
    });
    fireEvent.change(screen.getByLabelText(/Prolonged-wet trigger/), {
      target: { value: "58" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "api/v1/plants/plant-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining(
            '"moisture_check_threshold_override":22',
          ),
        }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1",
      expect.objectContaining({
        body: expect.stringContaining('"moisture_wet_threshold_override":58'),
      }),
    );
  });

  it("navigates to the queue and completes an action", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /Care queue/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Shared household actions" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await waitFor(() =>
      expect(screen.getByText(/Completed by Developer/)).toBeInTheDocument(),
    );
  });

  it("keeps sensor-managed actions automatic", async () => {
    mockApi({ ...action, type: "low_moisture", title: "Check soil moisture" });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /Care queue/ }));
    await screen.findByRole("heading", { name: "Check soil moisture" });
    expect(screen.getByText(/Monitoring-managed/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Snooze" })).toBeInTheDocument();
  });

  it("uses the dashboard for attention and All plants for collection management", async () => {
    mockApi();
    render(<App />);
    await screen.findByRole("heading", { name: "Needs attention" });
    expect(
      screen.queryByPlaceholderText("Search plants, rooms, species…"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Manage all plants" }));
    await screen.findByRole("heading", { name: "Plant collection" });
    expect(
      screen.getByPlaceholderText("Search plants, rooms, species…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add plant" }),
    ).toBeInTheDocument();
  });

  it("prefills editable plant details and companion sensors from the selected device", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("link", { name: "Manage all plants" }),
    );
    await screen.findByRole("heading", { name: "Plant collection" });
    fireEvent.click(screen.getByRole("button", { name: "Add plant" }));
    await screen.findByRole("dialog", { name: "Add a plant" });
    fireEvent.change(await screen.findByLabelText("Soil moisture *"), {
      target: { value: "sensor.golden_pothos_soil_moisture" },
    });
    expect(screen.getByLabelText("Friendly name")).toHaveValue("Golden Pothos");
    expect(screen.getByLabelText("Home Assistant area")).toHaveValue("Kitchen");
    expect(screen.getByLabelText("Home Assistant area").tagName).toBe("SELECT");
    expect(screen.getByLabelText(/Specific position/)).toHaveValue("");
    expect(screen.getByLabelText("Temperature")).toHaveValue(
      "sensor.golden_pothos_temperature",
    );
    expect(screen.getByLabelText("Battery")).toHaveValue(
      "sensor.golden_pothos_battery",
    );
    expect(screen.getByLabelText("Illuminance (any sensor)")).toHaveValue(
      "sensor.kitchen_motion_illuminance",
    );
    fireEvent.change(screen.getByLabelText("Friendly name"), {
      target: { value: "My Kitchen Pothos" },
    });
    fireEvent.change(screen.getByLabelText(/Specific position/), {
      target: { value: "Right side" },
    });
    const cover = new File(["new cover"], "new-plant.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(screen.getByLabelText(/Choose or take a cover photo/), {
      target: { files: [cover] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add connected plant" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "api/v1/plants",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"display_name":"My Kitchen Pothos"'),
        }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"specific_position":"Right side"'),
      }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "api/v1/plants/plant-2/photo",
        expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
      ),
    );
  });

  it("shows a disconnected state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 503 }),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getAllByText("Dashboard disconnected")).toHaveLength(2),
    );
    expect(screen.getByText("API unavailable")).toBeInTheDocument();
  });

  it("shows the shared-password screen when LAN authentication is required", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 401 }),
    );
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Welcome back" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Shared password")).toBeInTheDocument();
  });
});
