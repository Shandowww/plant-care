import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const plant = {
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

const plantResponse = {
  plants: [plant],
  summary: { total: 1, action_needed: 1, overdue: 0, sensor_issues: 0 },
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

function mockApi(actionFixture = action) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
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
      return new Response(JSON.stringify({ ...plant, ...JSON.parse(String(init.body)) }), { status: 200 });
    }
    if (url.endsWith("/plants/plant-1/photo") && init?.method === "POST") {
      return new Response(JSON.stringify({ ...plant, photo_updated_at: "2026-09-09T18:00:00Z" }), { status: 200 });
    }
    if (url.endsWith("/plants/plant-1/photo") && init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/plants") && init?.method === "POST") {
      const payload = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ...plant, ...payload, id: "plant-2", state: "sensor_issue", entity_mapping: payload.entity_mapping ?? null }), { status: 201 });
    }
    if (url.endsWith("/plants")) return new Response(JSON.stringify(plantResponse), { status: 200 });
    if (url.endsWith("/actions")) return new Response(JSON.stringify({ actions: [actionFixture] }), { status: 200 });
    if (url.endsWith("/complete")) return new Response(JSON.stringify({ ...actionFixture, status: "completed", completed_at: "2026-08-14T10:00:00Z", completed_by: "Developer" }), { status: 200 });
    if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ready", version: "0.1.0", database: "ready", simulator: true }), { status: 200 });
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

  it("opens local photo management separately from details", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage Golden Pothos photo" }));
    expect(screen.getByRole("dialog", { name: "Golden Pothos photo" })).toBeInTheDocument();
    expect(screen.getByText("No personal photo yet")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Golden Pothos" })).not.toBeInTheDocument();
  });

  it("uploads and deletes a private plant photo", async () => {
    const fetchMock = mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage Golden Pothos photo" }));
    const photo = new File(["photo bytes"], "pothos.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/Choose or take a photo/), { target: { files: [photo] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    await screen.findByText("Golden Pothos photo was saved locally.");
    expect(screen.getByRole("img", { name: "Preview of Golden Pothos" })).toHaveAttribute(
      "src",
      expect.stringContaining("api/v1/plants/plant-1/photo"),
    );
    expect(screen.getByRole("img", { name: "Photo of Golden Pothos" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/photo",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await screen.findByText("Golden Pothos photo was deleted.");
    expect(screen.getByText("No personal photo yet")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "api/v1/plants/plant-1/photo",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("labels Plant Doctor as a demo", async () => {
    mockApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Golden Pothos details" }));
    fireEvent.click(screen.getByRole("button", { name: "Plant doctor · demo" }));
    expect(screen.getByRole("dialog", { name: "Check Golden Pothos" })).toBeInTheDocument();
    expect(screen.getByText("Provider connection pending")).toBeInTheDocument();
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
