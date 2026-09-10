import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Plant } from "./types";

const plant: Plant = {
  id: "plant-1",
  display_name: "Golden Pothos",
  location: "Kitchen",
  common_name: "Golden pothos",
  scientific_name: "Epipremnum aureum",
  environment_type: "indoor",
  state: "action_needed",
  moisture: 18,
  moisture_status: "low",
  temperature: 24.2,
  temperature_status: "normal",
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

function mockApi(actionFixture = action, plantFixture = plant) {
  let currentPlant = { ...plantFixture };
  let doctorChecks = 0;
  let doctorHistory: Array<Record<string, unknown>> = [];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/plant-doctor/usage")) return new Response(JSON.stringify({ checks_today: doctorChecks, period_started_at: "2026-09-10T00:00:00Z", resets_at: "2026-09-11T00:00:00Z", daily_free_neuron_limit: 10000, estimated_neurons_per_check: "about 10–50" }), { status: 200 });
    if (url.endsWith("/plants/plant-1/doctor/history") && (!init?.method || init.method === "GET")) return new Response(JSON.stringify({ visits: doctorHistory }), { status: 200 });
    if (url.includes("/plants/plant-1/doctor/history/") && init?.method === "PATCH") {
      const feedback = JSON.parse(String(init.body));
      const visitId = url.split("/").at(-1);
      doctorHistory = doctorHistory.map((visit) => visit.id === visitId ? { ...visit, ...feedback } : visit);
      return new Response(JSON.stringify(doctorHistory.find((visit) => visit.id === visitId)), { status: 200 });
    }
    if (url.endsWith("/actions/history")) return new Response(JSON.stringify({ events: [] }), { status: 200 });
    if (url.endsWith("/home-assistant/entities")) return new Response(JSON.stringify({ source: "simulator", areas: ["Bedroom", "Kitchen", "Living room"], entities: [
      { entity_id: "sensor.golden_pothos_soil_moisture", name: "Golden Pothos Soil moisture", device_class: "moisture", state: "18", unit: "%", area_name: "Kitchen", device_id: "device-pothos" },
      { entity_id: "sensor.golden_pothos_temperature", name: "Golden Pothos Temperature", device_class: "temperature", state: "24.9", unit: "°C", area_name: "Kitchen", device_id: "device-pothos" },
      { entity_id: "sensor.golden_pothos_battery", name: "Golden Pothos Battery", device_class: "battery", state: "67", unit: "%", area_name: "Kitchen", device_id: "device-pothos" },
      { entity_id: "sensor.golden_pothos_illuminance", name: "Golden Pothos Illuminance", device_class: "illuminance", state: "unavailable", unit: "lx", area_name: "Kitchen", device_id: "device-pothos" },
      { entity_id: "sensor.kitchen_motion_illuminance", name: "Kitchen Motion Illuminance", device_class: "illuminance", state: "465", unit: "lx", area_name: "Kitchen", device_id: "device-motion" },
    ] }), { status: 200 });
    if (url.endsWith("/plants/plant-1/entity-mapping") && init?.method === "PATCH") {
      return new Response(String(init.body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/plants/plant-1") && init?.method === "PATCH") {
      currentPlant = { ...currentPlant, ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify(currentPlant), { status: 200 });
    }
    if (url.endsWith("/plants/plant-1/photo") && init?.method === "POST") {
      currentPlant = { ...currentPlant, photo_updated_at: "2026-09-09T18:00:00Z" };
      return new Response(JSON.stringify(currentPlant), { status: 200 });
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
        observations: ["Leaves are mostly green."],
        possible_issues: ["One edge may be dry."],
        next_steps: ["Check the underside of the leaves."],
        sensor_snapshot: { moisture: 18, temperature: 24.2, illuminance: null },
        confidence: "medium",
        provider: "Cloudflare Workers AI",
        model: "@cf/meta/llama-3.2-11b-vision-instruct",
        neurons: 11.25,
        decision: "pending",
        outcome: "not_tried",
        created_at: "2026-09-10T08:00:00Z",
      };
      doctorHistory = [visit, ...doctorHistory];
      return new Response(JSON.stringify({
        visit_id: visit.id,
        summary: visit.summary,
        observations: visit.observations,
        possible_issues: visit.possible_issues,
        next_steps: visit.next_steps,
        confidence: visit.confidence,
        provider: visit.provider,
        model: visit.model,
        neurons: visit.neurons,
        disclaimer: "Confirm suggestions before changing care.",
      }), { status: 200 });
    }
    if (url.endsWith("/plants/plant-1/doctor/recommendation") && init?.method === "POST") {
      const payload = JSON.parse(String(init.body));
      doctorHistory = doctorHistory.map((visit) => visit.id === payload.visit_id ? { ...visit, action_id: "ai-action-1", decision: "accepted" } : visit);
      return new Response(JSON.stringify({
        ...action,
        id: "ai-action-1",
        type: "ai_recommendation",
        title: "Review AI recommendation",
        observation: "Suggested by Plant Doctor from a photo assessment.",
        recommendation: payload.recommendation,
      }), { status: 200 });
    }
    if (url.endsWith("/plants") && init?.method === "POST") {
      const payload = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ...plant, ...payload, id: "plant-2", state: "sensor_issue", entity_mapping: payload.entity_mapping ?? null }), { status: 201 });
    }
    if (url.endsWith("/plants")) return new Response(JSON.stringify({ plants: [currentPlant], summary: { total: 1, action_needed: 1, overdue: 0, sensor_issues: 0 } }), { status: 200 });
    if (url.endsWith("/actions")) return new Response(JSON.stringify({ actions: [actionFixture] }), { status: 200 });
    if (url.endsWith("/complete")) return new Response(JSON.stringify({ ...actionFixture, status: "completed", completed_at: "2026-08-14T10:00:00Z", completed_by: "Developer" }), { status: 200 });
    if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ready", version: "0.6.1", database: "ready", simulator: true, plant_doctor_configured: true }), { status: 200 });
    return new Response("", { status: 404 });
  });
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
    await waitFor(() => expect(screen.getByText("Golden Pothos")).toBeInTheDocument());
    expect(screen.getAllByText("Action needed").length).toBeGreaterThan(0);
    expect(screen.getByText("18%")).toBeInTheDocument();
  });

  it("opens a plant detail dialog", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    expect(screen.getByRole("dialog", { name: "Golden Pothos" })).toBeInTheDocument();
    expect(screen.getByText("Sensor power")).toBeInTheDocument();
  });

  it("opens details from anywhere on a plant card", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("article", { name: "Golden Pothos" }));
    expect(screen.getByRole("dialog", { name: "Golden Pothos" })).toBeInTheDocument();
  });

  it("shows the normal temperature range without opening plant details", async () => {
    mockApi();
    render(<App />);
    const temperature = await screen.findByRole("button", {
      name: "Temperature 24.2 degrees Celsius; show normal range",
    });
    fireEvent.click(temperature);
    expect(screen.getByText("Normal temperature range: 18–29°C")).toBeInTheDocument();
    expect(screen.getByText(/Typical range for golden pothos/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Golden Pothos" })).not.toBeInTheDocument();
  });

  it("keeps photo management inside Edit plant", async () => {
    mockApi();
    render(<App />);
    expect(screen.queryByRole("button", { name: "Manage Golden Pothos photo" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    expect(screen.queryByRole("button", { name: "Manage photo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    expect(screen.getByRole("group", { name: "Plant photo" })).toBeInTheDocument();
    expect(screen.getByText("Using the bundled species illustration")).toBeInTheDocument();
    expect(screen.getByLabelText(/Choose or take a photo/)).not.toHaveAttribute("capture");
  });

  it("uploads and deletes a private plant photo", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    const photo = new File(["photo bytes"], "pothos.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/Choose or take a photo/), { target: { files: [photo] } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Golden Pothos was updated.");
    expect(screen.getAllByRole("img", { name: "Photo of Golden Pothos" }).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/photo",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove current photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Golden Pothos was updated.");
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/photo",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("requires a current photo before Plant Doctor can run", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    expect(screen.getByRole("dialog", { name: "Check Golden Pothos" })).toBeInTheDocument();
    expect(screen.getByText("A current photo is required")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Edit plant" }));
    expect(screen.getByRole("dialog", { name: "Edit Golden Pothos" })).toBeInTheDocument();
  });

  it("runs Plant Doctor only after one-check consent and shows usage", async () => {
    const fetchMock = mockApi(action, { ...plant, photo_updated_at: "2026-09-09T18:00:00Z" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    expect(await screen.findByText("0 completed checks since 00:00 UTC")).toBeInTheDocument();
    expect(screen.getByText("Estimated about 10–50 neurons per check · 10,000 free neurons/day")).toBeInTheDocument();
    expect(screen.getByText(/Free-plan requests stop at the limit/)).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send for diagnosis" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send);
    await screen.findByText("The leaves look generally healthy.");
    expect(screen.getByText(/11\.25 neurons/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add AI recommendation" }));
    await screen.findByText("Added to care queue");
    expect(screen.getByText("AI recommendation added to Golden Pothos's care queue.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Patient history")).toBeInTheDocument();
    expect(screen.getByText("Added to queue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Didn't help" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Didn't help" })).toHaveAttribute("aria-pressed", "true"));
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ consent: true }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor/recommendation",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ recommendation: "Check the underside of the leaves.", visit_id: "visit-1" }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor/history/visit-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ outcome: "did_not_help" }) }),
    );
  });

  it("labels AI recommendations in the care queue", async () => {
    mockApi({ ...action, type: "ai_recommendation", title: "Review AI recommendation" });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /Care queue/ }));
    expect(await screen.findByText("AI recommendation")).toBeInTheDocument();
  });

  it("records when a Doctor recommendation is declined", async () => {
    const fetchMock = mockApi(action, { ...plant, photo_updated_at: "2026-09-09T18:00:00Z" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send for diagnosis" }));
    await screen.findByText("The leaves look generally healthy.");
    fireEvent.click(screen.getByRole("button", { name: "Don't add" }));
    await screen.findByRole("button", { name: "Not added" });
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/doctor/history/visit-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ decision: "declined" }) }),
    );
  });

  it("maps Home Assistant sensor entities from plant details", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("article", { name: "Golden Pothos" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage sensor mapping" }));
    await screen.findByRole("dialog", { name: "Map sensors for Golden Pothos" });
    fireEvent.change(screen.getByLabelText("Soil moisture"), { target: { value: "sensor.golden_pothos_soil_moisture" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(screen.getByText("Golden Pothos sensor mapping was updated.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/entity-mapping",
      expect.objectContaining({ method: "PATCH" }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit plant" }));
    fireEvent.change(screen.getByLabelText("Friendly name"), { target: { value: "Kitchen Pothos" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Kitchen Pothos" })).toBeInTheDocument());
  });

  it("navigates to the queue and completes an action", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /Care queue/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Shared household actions" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(screen.getByText(/Completed by Developer/)).toBeInTheDocument());
  });

  it("keeps sensor-managed actions automatic", async () => {
    mockApi({ ...action, type: "low_moisture", title: "Check soil moisture" });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: /Care queue/ }));
    await screen.findByRole("heading", { name: "Check soil moisture" });
    expect(screen.getByText(/Sensor-managed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Snooze" })).toBeInTheDocument();
  });

  it("uses the dashboard for attention and All plants for collection management", async () => {
    mockApi();
    render(<App />);
    await screen.findByRole("heading", { name: "Needs attention" });
    expect(screen.queryByPlaceholderText("Search plants, rooms, species…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Manage all plants" }));
    await screen.findByRole("heading", { name: "Plant collection" });
    expect(screen.getByPlaceholderText("Search plants, rooms, species…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add plant" })).toBeInTheDocument();
  });

  it("prefills editable plant details and companion sensors from the selected device", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Manage all plants" }));
    await screen.findByRole("heading", { name: "Plant collection" });
    fireEvent.click(screen.getByRole("button", { name: "Add plant" }));
    await screen.findByRole("dialog", { name: "Add a plant" });
    fireEvent.change(await screen.findByLabelText("Soil moisture *"), { target: { value: "sensor.golden_pothos_soil_moisture" } });
    expect(screen.getByLabelText("Friendly name")).toHaveValue("Golden Pothos");
    expect(screen.getByLabelText("Location")).toHaveValue("Kitchen");
    expect(screen.getByLabelText("Location").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Temperature")).toHaveValue("sensor.golden_pothos_temperature");
    expect(screen.getByLabelText("Battery")).toHaveValue("sensor.golden_pothos_battery");
    expect(screen.getByLabelText("Illuminance (any sensor)")).toHaveValue("sensor.kitchen_motion_illuminance");
    fireEvent.change(screen.getByLabelText("Friendly name"), { target: { value: "My Kitchen Pothos" } });
    fireEvent.click(screen.getByRole("button", { name: "Add connected plant" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"display_name":"My Kitchen Pothos"'),
      }),
    ));
  });

  it("shows a disconnected state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Dashboard disconnected")).toHaveLength(2));
    expect(screen.getByText("API unavailable")).toBeInTheDocument();
  });

  it("shows the shared-password screen when LAN authentication is required", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument());
    expect(screen.getByLabelText("Shared password")).toBeInTheDocument();
  });
});
