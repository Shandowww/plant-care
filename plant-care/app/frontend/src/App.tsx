import {
  Bell,
  Check,
  Camera,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Grid2X2,
  Leaf,
  ImagePlus,
  LockKeyhole,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shuffle,
  SlidersHorizontal,
  Sprout,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  archivePlant,
  completeAction,
  createPlant,
  createDoctorRecommendation,
  deletePlantPhoto,
  diagnosePlant,
  getActionHistory,
  getActions,
  getHealth,
  getHomeAssistantEntities,
  getPlantDoctorHistory,
  getPlantDoctorUsage,
  getPlants,
  login,
  simulateConfirmedWatering,
  snoozeAction,
  undoAction,
  updatePlant,
  updatePlantDoctorFeedback,
  updatePlantEntityMapping,
  uploadPlantPhoto,
} from "./api";
import { PlantCard } from "./components";
import { plantImage, plantPhotoUrl } from "./plant-images";
import { plantTipCollection } from "./plant-tips";
import type {
  ActionHistoryEvent,
  CareAction,
  HealthResponse,
  HomeAssistantEntity,
  Plant,
  PlantCreate,
  PlantDoctorResponse,
  PlantDoctorOutcome,
  PlantDoctorUsageResponse,
  PlantDoctorVisit,
  PlantEntityMapping,
  PlantResponse,
  PlantState,
} from "./types";

type SortKey = "urgency" | "name" | "moisture" | "temperature" | "last_update";
type View = "dashboard" | "actions" | "plants" | "settings" | "help";
type MenuName = "notifications" | "profile" | null;
type PlantPhotoChange = { file: File | null; deleteCurrent: boolean };

const urgencyOrder: Record<PlantState, number> = {
  overdue: 0,
  action_needed: 1,
  sensor_issue: 2,
  watch: 3,
  good: 4,
};

const viewTitles: Record<View, string> = {
  dashboard: "Your plant overview",
  actions: "Care queue",
  plants: "All plants",
  settings: "Settings",
  help: "Help & diagnostics",
};

function viewFromHash(): View {
  const value = window.location.hash.slice(1).split("/", 1)[0];
  return value === "actions" || value === "plants" || value === "settings" || value === "help"
    ? value
    : "dashboard";
}

function plantIdFromHash(): string | null {
  const match = window.location.hash.match(/^#plants\/([^/?#]+)$/);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function LoadingGrid() {
  return <div className="plant-grid" aria-label="Loading plants">{Array.from({ length: 6 }, (_, index) => <div className="plant-card skeleton" key={index} />)}</div>;
}

function App() {
  const [data, setData] = useState<PlantResponse | null>(null);
  const [actions, setActions] = useState<CareAction[]>([]);
  const [actionHistory, setActionHistory] = useState<ActionHistoryEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PlantState | "all">("all");
  const [sort, setSort] = useState<SortKey>("urgency");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [view, setView] = useState<View>(viewFromHash);
  const [linkedPlantId, setLinkedPlantId] = useState<string | null>(plantIdFromHash);
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [tipVisits, setTipVisits] = useState<Record<string, number>>({});
  const [doctorPlant, setDoctorPlant] = useState<Plant | null>(null);
  const [addPlantOpen, setAddPlantOpen] = useState(false);
  const [editingPlant, setEditingPlant] = useState<Plant | null>(null);
  const [mappingPlant, setMappingPlant] = useState<Plant | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [compactCards, setCompactCards] = useState(false);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [snoozeHours, setSnoozeHours] = useState<Record<string, number>>({});
  const selectedPlantId = selectedPlant?.id;

  async function refreshPlants() {
    const response = await getPlants();
    setData(response);
    return response;
  }

  async function refreshActions() {
    const response = await getActions();
    setActions(response.actions);
    return response;
  }

  async function refreshActionHistory() {
    const response = await getActionHistory();
    setActionHistory(response.events);
    return response;
  }

  useEffect(() => {
    const controller = new AbortController();
    getPlants(controller.signal).then(setData).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (reason instanceof ApiError && reason.status === 401) {
        setRequiresLogin(true);
        return;
      }
      setError(reason instanceof Error ? reason.message : "The plant data could not be loaded.");
    });
    getActions(controller.signal).then((response) => setActions(response.actions)).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setActionError(reason instanceof Error ? reason.message : "The care queue could not be loaded.");
    });
    getActionHistory(controller.signal).then((response) => setActionHistory(response.events)).catch(() => undefined);
    getHealth().then(setHealth).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      getPlants().then(setData).catch(() => undefined);
      getActions().then((response) => setActions(response.actions)).catch(() => undefined);
      getActionHistory().then((response) => setActionHistory(response.events)).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedPlantId || !data) return;
    const refreshed = data.plants.find((plant) => plant.id === selectedPlantId);
    if (refreshed) setSelectedPlant(refreshed);
  }, [data, selectedPlantId]);

  useEffect(() => {
    const onHashChange = () => {
      setView(viewFromHash());
      setLinkedPlantId(plantIdFromHash());
      setMobileNavOpen(false);
      setOpenMenu(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!data || !linkedPlantId) return;
    const plant = data.plants.find((item) => item.id === linkedPlantId);
    if (!plant) return;
    setTipVisits((current) => ({ ...current, [plant.id]: (current[plant.id] ?? -1) + 1 }));
    setSelectedPlant(plant);
    window.history.replaceState(null, "", "#plants");
    setLinkedPlantId(null);
  }, [data, linkedPlantId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const plants = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-IL");
    const result = (data?.plants ?? []).filter((plant) => {
      const statusMatches = statusFilter === "all" || plant.state === statusFilter;
      const queryMatches = !normalizedQuery || [plant.display_name, plant.location, plant.common_name, plant.scientific_name ?? ""].some((value) => value.toLocaleLowerCase("en-IL").includes(normalizedQuery));
      return statusMatches && queryMatches;
    });
    return result.sort((left: Plant, right: Plant) => {
      if (sort === "name") return left.display_name.localeCompare(right.display_name, "en-IL");
      if (sort === "moisture") return (left.moisture ?? -1) - (right.moisture ?? -1);
      if (sort === "temperature") return (left.temperature ?? -100) - (right.temperature ?? -100);
      if (sort === "last_update") return new Date(right.last_reading_at ?? 0).getTime() - new Date(left.last_reading_at ?? 0).getTime();
      return urgencyOrder[left.state] - urgencyOrder[right.state];
    });
  }, [data, query, sort, statusFilter]);

  const attentionPlants = useMemo(
    () => (data?.plants ?? [])
      .filter((plant) => plant.state !== "good")
      .sort((left, right) => urgencyOrder[left.state] - urgencyOrder[right.state])
      .slice(0, 6),
    [data],
  );

  const counts = data?.summary ?? { total: 0, action_needed: 0, overdue: 0, sensor_issues: 0 };
  const activeActions = actions.filter((action) => action.status !== "completed");
  const currentDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toUpperCase();

  function showPlantDetails(plant: Plant) {
    setTipVisits((current) => ({ ...current, [plant.id]: (current[plant.id] ?? -1) + 1 }));
    setSelectedPlant(plant);
  }

  async function handleLogin(password: string) {
    await login(password);
    await Promise.all([refreshPlants(), refreshActions(), refreshActionHistory()]);
    setRequiresLogin(false);
  }

  async function mutateAction(action: CareAction, operation: "complete" | "snooze" | "undo") {
    setSavingAction(action.id);
    setActionError(null);
    try {
      const updated = operation === "complete"
        ? await completeAction(action.id)
        : operation === "undo"
          ? await undoAction(action.id)
          : await snoozeAction(action.id, snoozeHours[action.id] ?? 24);
      setActions((current) => current.map((item) => item.id === updated.id ? updated : item));
      await Promise.all([refreshPlants(), refreshActionHistory()]);
      setToast(operation === "complete" ? "Action completed." : operation === "undo" ? "Action reopened." : "Action snoozed.");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The action could not be updated.");
    } finally {
      setSavingAction(null);
    }
  }

  async function handleCreatePlant(payload: PlantCreate, photo: File | null) {
    let plant = await createPlant(payload);
    let photoWarning = false;
    if (photo) {
      try {
        plant = await uploadPlantPhoto(plant.id, photo);
      } catch {
        photoWarning = true;
      }
    }
    const response = await refreshPlants();
    const refreshed = response.plants.find((item) => item.id === plant.id) ?? plant;
    setAddPlantOpen(false);
    showPlantDetails(refreshed);
    window.location.hash = "plants";
    setToast(photoWarning
      ? `${plant.display_name} was added, but the photo could not be saved. You can retry in Edit plant.`
      : `${plant.display_name} was added with its Home Assistant sensors${photo ? " and photo" : ""}.`);
  }

  async function handleUpdatePlant(
    plant: Plant,
    payload: PlantCreate,
    photoChange: PlantPhotoChange,
  ) {
    let updated = await updatePlant(plant.id, payload);
    if (photoChange.deleteCurrent && plant.photo_updated_at) {
      await deletePlantPhoto(plant.id);
      updated = { ...updated, photo_updated_at: null };
    } else if (photoChange.file) {
      updated = await uploadPlantPhoto(plant.id, photoChange.file);
    }
    const response = await refreshPlants();
    const refreshed = response.plants.find((item) => item.id === plant.id) ?? updated;
    setEditingPlant(null);
    showPlantDetails(refreshed);
    setToast(`${refreshed.display_name} was updated.`);
  }

  async function handleArchivePlant(plant: Plant) {
    await archivePlant(plant.id);
    await Promise.all([refreshPlants(), refreshActions()]);
    setEditingPlant(null);
    setSelectedPlant(null);
    setToast(`${plant.display_name} was removed from the dashboard. Its history was preserved.`);
  }

  async function handleUpdateMapping(plant: Plant, mapping: PlantEntityMapping) {
    const savedMapping = await updatePlantEntityMapping(plant.id, mapping);
    const locallyUpdated = { ...plant, entity_mapping: savedMapping };
    setData((current) => current ? {
      ...current,
      plants: current.plants.map((item) => item.id === plant.id ? locallyUpdated : item),
    } : current);
    setMappingPlant(null);
    showPlantDetails(locallyUpdated);
    const response = await refreshPlants();
    const refreshed = response.plants.find((item) => item.id === plant.id);
    if (refreshed) setSelectedPlant(refreshed);
    setToast(`${plant.display_name} sensor mapping was updated.`);
  }

  async function handleSimulatedWatering(plant: Plant) {
    const updated = await simulateConfirmedWatering(plant.id);
    await Promise.all([refreshPlants(), refreshActions(), refreshActionHistory()]);
    setSelectedPlant(updated);
    setToast("Confirmed moisture recovery recorded; the watering action closed automatically.");
  }

  async function handleDoctorRecommendation(plant: Plant, recommendation: string, visitId: string | null) {
    await createDoctorRecommendation(plant.id, recommendation, visitId);
    await Promise.all([refreshPlants(), refreshActions(), refreshActionHistory()]);
    setToast(`AI recommendation added to ${plant.display_name}'s care queue.`);
  }

  async function refreshHealth() {
    try {
      setHealth(await getHealth());
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Diagnostics are unavailable.");
    }
  }

  if (requiresLogin) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className={`app-shell ${compactCards ? "compact-mode" : ""}`}>
      <aside className={`sidebar ${mobileNavOpen ? "sidebar--open" : ""}`} aria-label="Primary navigation">
        <div className="brand"><span className="brand__mark"><Sprout size={23} /></span><span>Plant<span>Care</span></span></div>
        <button className="sidebar__close" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X /></button>
        <nav>
          <NavLink view="dashboard" current={view} icon={<Grid2X2 size={19} />} label="Dashboard" />
          <NavLink view="actions" current={view} icon={<ClipboardCheck size={19} />} label="Care queue" badge={activeActions.length} />
          <NavLink view="plants" current={view} icon={<Leaf size={19} />} label="All plants" />
          <NavLink view="settings" current={view} icon={<Settings size={19} />} label="Settings" />
        </nav>
        <div className="sidebar__status"><span className="connection-dot" /><div><strong>{error ? "Dashboard disconnected" : health === null ? "Connecting…" : health.simulator ? "Simulator connected" : "Home Assistant connected"}</strong><span>{error ? "API unavailable" : health === null ? "Waiting for API" : `${counts.total || 0} ${health.simulator ? "plant scenarios" : "mapped plants"}`}</span></div></div>
        <NavLink view="help" current={view} icon={<CircleHelp size={19} />} label="Help & diagnostics" help />
      </aside>

      {mobileNavOpen && <button className="nav-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main>
        <header className="topbar">
          <button className="mobile-menu" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="topbar__identity"><span className="eyebrow">{currentDate}</span><h1>{viewTitles[view]} {view === "dashboard" && <span aria-hidden="true">☀</span>}</h1></div>
          <div className="topbar__actions">
            <div className="menu-anchor">
              <button className="icon-button notification-button" type="button" aria-label="Notifications" aria-expanded={openMenu === "notifications"} onClick={() => setOpenMenu(openMenu === "notifications" ? null : "notifications")}><Bell size={19} />{activeActions.length > 0 && <span />}</button>
              {openMenu === "notifications" && <NotificationsMenu actions={activeActions} onClose={() => setOpenMenu(null)} />}
            </div>
            <div className="menu-anchor">
              <button className="profile-button" type="button" aria-expanded={openMenu === "profile"} onClick={() => setOpenMenu(openMenu === "profile" ? null : "profile")}><span>HA</span><span>Home Assistant user<small>Authenticated household</small></span><ChevronDown size={15} /></button>
              {openMenu === "profile" && <ProfileMenu onClose={() => setOpenMenu(null)} />}
            </div>
          </div>
        </header>

        {view === "dashboard" || view === "plants" ? (
          <PlantCollection
            dashboard={view === "dashboard"}
            plants={view === "dashboard" ? attentionPlants : plants}
            counts={counts}
            data={data}
            error={error}
            query={query}
            statusFilter={statusFilter}
            sort={sort}
            onQuery={setQuery}
            onStatus={setStatusFilter}
            onSort={setSort}
            onAdd={() => setAddPlantOpen(true)}
            onDetails={showPlantDetails}
          />
        ) : view === "actions" ? (
          <ActionQueue actions={actions} history={actionHistory} plants={data?.plants ?? []} error={actionError} saving={savingAction} snoozeHours={snoozeHours} onSnoozeHours={(id, hours) => setSnoozeHours((current) => ({ ...current, [id]: hours }))} onMutate={mutateAction} />
        ) : view === "settings" ? (
          <SettingsView health={health} compactCards={compactCards} onCompactCards={setCompactCards} onSaved={() => setToast("Portal preferences saved on this browser.")} />
        ) : (
          <HelpView health={health} onRefresh={refreshHealth} />
        )}
      </main>

      {selectedPlant && <PlantDetailDialog plant={selectedPlant} tipVisit={tipVisits[selectedPlant.id] ?? 0} actions={actions.filter((action) => action.plant_id === selectedPlant.id)} onClose={() => setSelectedPlant(null)} onEdit={() => { setEditingPlant(selectedPlant); setSelectedPlant(null); }} onMapping={() => { setMappingPlant(selectedPlant); setSelectedPlant(null); }} onDoctor={() => { setSelectedPlant(null); setDoctorPlant(selectedPlant); }} onMarkDone={(action) => mutateAction(action, "complete")} onSimulateWatering={() => handleSimulatedWatering(selectedPlant)} />}
      {doctorPlant && <DoctorDialog plant={doctorPlant} onClose={() => setDoctorPlant(null)} onAddAction={handleDoctorRecommendation} />}
      {addPlantOpen && <AddPlantDialog onClose={() => setAddPlantOpen(false)} onCreate={handleCreatePlant} />}
      {editingPlant && <EditPlantDialog plant={editingPlant} onClose={() => setEditingPlant(null)} onUpdate={handleUpdatePlant} onArchive={handleArchivePlant} />}
      {mappingPlant && <EntityMappingDialog plant={mappingPlant} onClose={() => setMappingPlant(null)} onSave={handleUpdateMapping} />}
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}

function NavLink({ view, current, icon, label, badge, help = false }: { view: View; current: View; icon: React.ReactNode; label: string; badge?: number; help?: boolean }) {
  return <a href={`#${view}`} className={`nav-item ${current === view ? "nav-item--active" : ""} ${help ? "nav-item--help" : ""}`}>{icon}{label}{badge !== undefined && <span className="nav-badge">{badge}</span>}</a>;
}

function PlantCollection({ dashboard, plants, counts, data, error, query, statusFilter, sort, onQuery, onStatus, onSort, onAdd, onDetails }: {
  dashboard: boolean;
  plants: Plant[];
  counts: PlantResponse["summary"];
  data: PlantResponse | null;
  error: string | null;
  query: string;
  statusFilter: PlantState | "all";
  sort: SortKey;
  onQuery: (value: string) => void;
  onStatus: (value: PlantState | "all") => void;
  onSort: (value: SortKey) => void;
  onAdd: () => void;
  onDetails: (plant: Plant) => void;
}) {
  function openCollection(filter: PlantState | "all") {
    onQuery("");
    onStatus(filter);
    window.location.hash = "plants";
  }

  return <div className="content" id={dashboard ? "dashboard" : "plants"}>
    <section className="intro"><div><h2>{dashboard ? "Needs attention" : "Plant collection"}</h2><p>{dashboard ? "A focused overview of plants that need care, watching, or a sensor fix." : "Your full inventory: search, add, edit, inspect, or archive every plant."}</p></div>{dashboard ? <a className="secondary-button collection-link" href="#plants">Manage all plants</a> : <button className="primary-button" type="button" onClick={onAdd}><Plus size={17} />Add plant</button>}</section>
    {dashboard && <section className="summary-grid" aria-label="Plant summary">
      <button className="summary-card summary-card--all" type="button" onClick={() => openCollection("all")}><span className="summary-card__icon"><Sprout size={20} /></span><span><strong>{counts.total}</strong><small>Total plants</small></span></button>
      <button className="summary-card summary-card--action" type="button" onClick={() => openCollection("action_needed")}><span className="summary-card__icon"><DropletGlyph /></span><span><strong>{counts.action_needed}</strong><small>Action needed</small></span></button>
      <button className="summary-card summary-card--overdue" type="button" onClick={() => openCollection("overdue")}><span className="summary-card__icon"><TriangleAlert size={20} /></span><span><strong>{counts.overdue}</strong><small>Overdue</small></span></button>
      <button className="summary-card summary-card--sensor" type="button" onClick={() => openCollection("sensor_issue")}><span className="summary-card__icon"><SlidersHorizontal size={20} /></span><span><strong>{counts.sensor_issues}</strong><small>Sensor issues</small></span></button>
    </section>}
    {!dashboard && <PlantToolbar query={query} statusFilter={statusFilter} sort={sort} onQuery={onQuery} onStatus={onStatus} onSort={onSort} />}
    {error ? <section className="error-state" role="alert"><TriangleAlert /><h2>Dashboard disconnected</h2><p>{error} Home Assistant monitoring continues independently.</p><button type="button" onClick={() => window.location.reload()}>Try again</button></section> : !data ? <LoadingGrid /> : plants.length === 0 ? dashboard ? <section className="empty-state"><Check /><h2>Everything looks steady</h2><p>No plant needs attention right now. The full collection remains available under All plants.</p><a className="secondary-button" href="#plants">Open full collection</a></section> : <section className="empty-state"><Leaf /><h2>No plants match</h2><p>Clear a filter or search to see the rest of the household collection.</p><button type="button" onClick={() => { onQuery(""); onStatus("all"); }}>Clear filters</button></section> : <div className="plant-grid">{plants.map((plant) => <PlantCard plant={plant} key={plant.id} onDetails={onDetails} />)}</div>}
    {dashboard && data && <a className="view-all-link" href="#plants">Open the full collection ({data.plants.length})</a>}
  </div>;
}

function PlantToolbar({ query, statusFilter, sort, onQuery, onStatus, onSort }: { query: string; statusFilter: PlantState | "all"; sort: SortKey; onQuery: (value: string) => void; onStatus: (value: PlantState | "all") => void; onSort: (value: SortKey) => void }) {
  return <section className="toolbar" aria-label="Plant filters">
    <label className="search-field"><Search size={18} /><span className="sr-only">Search plants</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search plants, rooms, species…" /></label>
    <div className="toolbar__right"><label className="select-field"><SlidersHorizontal size={16} /><span className="sr-only">Status filter</span><select value={statusFilter} onChange={(event) => onStatus(event.target.value as PlantState | "all")}><option value="all">All statuses</option><option value="good">Good</option><option value="watch">Watch</option><option value="action_needed">Action needed</option><option value="overdue">Overdue</option><option value="sensor_issue">Sensor issue</option></select></label><label className="select-field"><span>Sort:</span><select value={sort} onChange={(event) => onSort(event.target.value as SortKey)}><option value="urgency">Urgency</option><option value="name">Name</option><option value="moisture">Moisture</option><option value="temperature">Temperature</option><option value="last_update">Last update</option></select></label></div>
  </section>;
}

function ActionQueue({ actions, history, plants, error, saving, snoozeHours, onSnoozeHours, onMutate }: { actions: CareAction[]; history: ActionHistoryEvent[]; plants: Plant[]; error: string | null; saving: string | null; snoozeHours: Record<string, number>; onSnoozeHours: (id: string, hours: number) => void; onMutate: (action: CareAction, operation: "complete" | "snooze" | "undo") => void }) {
  const plantNames = Object.fromEntries(plants.map((plant) => [plant.id, plant.display_name]));
  const open = actions.filter((action) => action.status === "open");
  const snoozed = actions.filter((action) => action.status === "snoozed");
  const completed = actions.filter((action) => action.status === "completed");
  return <div className="content page-view">
    <section className="intro"><div><h2>Shared household actions</h2><p>Mark an item done or snooze it here; every change is recorded below.</p></div><span className="queue-count">{open.length + snoozed.length} active</span></section>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <ActionSection title="Open" actions={open} empty="Nothing needs attention right now." plantNames={plantNames} saving={saving} snoozeHours={snoozeHours} onSnoozeHours={onSnoozeHours} onMutate={onMutate} />
    <ActionSection title="Snoozed" actions={snoozed} empty="No snoozed actions." plantNames={plantNames} saving={saving} snoozeHours={snoozeHours} onSnoozeHours={onSnoozeHours} onMutate={onMutate} />
    <ActionSection title="Recently completed" actions={completed} empty="Completed actions will appear here." plantNames={plantNames} saving={saving} snoozeHours={snoozeHours} onSnoozeHours={onSnoozeHours} onMutate={onMutate} />
    <ActionHistory history={history} actions={actions} plantNames={plantNames} />
  </div>;
}

function ActionSection({ title, actions, empty, plantNames, saving, snoozeHours, onSnoozeHours, onMutate }: { title: string; actions: CareAction[]; empty: string; plantNames: Record<string, string>; saving: string | null; snoozeHours: Record<string, number>; onSnoozeHours: (id: string, hours: number) => void; onMutate: (action: CareAction, operation: "complete" | "snooze" | "undo") => void }) {
  return <section className="action-section"><div className="section-title"><h3>{title}</h3><span>{actions.length}</span></div>{actions.length === 0 ? <p className="section-empty">{empty}</p> : <div className="action-list">{actions.map((action) => { const sensorManaged = action.type === "low_moisture" || action.type === "sensor_issue"; const aiRecommended = action.type === "ai_recommendation"; return <article className={`action-card action-card--${action.status}`} key={action.id}><div className="action-card__priority">P{action.priority}</div><div className="action-card__copy"><span>{plantNames[action.plant_id] ?? "Unknown plant"}{aiRecommended && <em className="ai-recommendation-badge">AI recommendation</em>}</span><h4>{action.title}</h4><p>{action.observation}</p><strong>{action.recommendation}</strong>{sensorManaged && action.status !== "completed" && <small className="automatic-note">Sensor-managed: closes automatically when the condition recovers.</small>}{action.status === "snoozed" && <small><Clock3 size={13} />Snoozed until {formatDateTime(action.snoozed_until)}</small>}{action.status === "completed" && <small><Check size={13} />Completed by {action.completed_by ?? "Household"} · {formatDateTime(action.completed_at)}</small>}</div><div className="action-card__controls">{action.status === "completed" ? <button type="button" disabled={saving === action.id} onClick={() => onMutate(action, "undo")}>Undo</button> : <><label><span className="sr-only">Snooze duration for {action.title}</span><select aria-label={`Snooze duration for ${action.title}`} value={snoozeHours[action.id] ?? 24} onChange={(event) => onSnoozeHours(action.id, Number(event.target.value))}><option value={6}>6 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option></select></label><button type="button" disabled={saving === action.id} onClick={() => onMutate(action, "snooze")}>Snooze</button>{!sensorManaged && <button className="complete-button" type="button" disabled={saving === action.id} onClick={() => onMutate(action, "complete")}><Check size={15} />Mark done</button>}</>}</div></article>; })}</div>}</section>;
}

function ActionHistory({ history, actions, plantNames }: { history: ActionHistoryEvent[]; actions: CareAction[]; plantNames: Record<string, string> }) {
  const actionById = Object.fromEntries(actions.map((action) => [action.id, action]));
  const labels: Record<ActionHistoryEvent["event_type"], string> = {
    action_completed: "Marked done manually",
    action_auto_completed: "Completed automatically after sensor recovery",
    action_snoozed: "Snoozed",
    action_reopened: "Reopened",
    ai_recommendation_created: "AI recommendation added",
    sensor_issue_created: "Sensor warning created",
  };
  return <section className="action-section history-section"><div className="section-title"><h3>Action history</h3><span>{history.length}</span></div>{history.length === 0 ? <p className="section-empty">History appears after an action is snoozed, completed, or reopened.</p> : <div className="history-list">{history.map((event) => { const action = actionById[event.action_id]; return <article key={event.id}><span className={`history-icon history-icon--${event.event_type}`}><Check size={14} /></span><div><strong>{labels[event.event_type] ?? event.event_type}</strong><p>{action?.title ?? "Care action"}{action ? ` · ${plantNames[action.plant_id] ?? "Unknown plant"}` : ""}</p></div><small>{event.actor} · {formatDateTime(event.occurred_at)}</small></article>; })}</div>}</section>;
}

function SettingsView({ health, compactCards, onCompactCards, onSaved }: { health: HealthResponse | null; compactCards: boolean; onCompactCards: (value: boolean) => void; onSaved: () => void }) {
  const notificationReady = health?.home_assistant_notifications_enabled;
  return <div className="content page-view"><section className="intro"><div><h2>Portal preferences</h2><p>Display preferences stay in this browser; sensor monitoring is configured in the Home Assistant app settings.</p></div></section><div className="settings-grid"><section className="settings-card"><h3>Display</h3><label className="switch-row"><span><strong>Compact plant cards</strong><small>Show more plants at once.</small></span><input type="checkbox" checked={compactCards} onChange={(event) => onCompactCards(event.target.checked)} /></label></section><section className="settings-card"><h3>Sensor monitoring</h3><div className="integration-status"><span className="connection-dot" /><div><strong>{health?.stale_sensor_hours ?? 72}-hour unchanged-value check</strong><small>Moisture, temperature, and illuminance are checked. Battery is excluded to avoid false alarms.</small></div></div></section><section className="settings-card settings-card--wide"><h3>Home Assistant notifications</h3><div className="integration-status"><span className={`connection-dot ${notificationReady ? "" : "connection-dot--inactive"}`} /><div><strong>{notificationReady ? "Persistent notifications enabled" : health?.simulator ? "Disabled in the local simulator" : "Disabled in app configuration"}</strong><small>New sensor warnings appear in Home Assistant with a link to the affected plant. They are dismissed automatically after the sensor value changes. Change delivery or the threshold under Home Assistant → Settings → Apps → Plant Care Dashboard → Configuration, then restart the app.</small></div></div></section><section className="settings-card settings-card--wide"><h3>Home Assistant integration</h3><div className="integration-status"><span className="connection-dot" /><div><strong>Entity mapping ready</strong><small>Open a plant’s Details window and choose Manage sensor mapping. Simulator entities are used locally; ingress loads live Home Assistant sensors.</small></div></div></section><section className="settings-card settings-card--wide"><h3>Plant Doctor</h3><div className="integration-status"><span className={`connection-dot ${health?.plant_doctor_configured ? "" : "connection-dot--inactive"}`} /><div><strong>{health?.plant_doctor_configured ? "Cloudflare credentials loaded" : "Cloudflare credentials not configured"}</strong><small>Credentials are read by the app backend only. Diagnostic photos are sent only after consent for each check.</small></div></div></section></div><button className="primary-button settings-save" type="button" onClick={onSaved}>Save display preferences</button></div>;
}

function HelpView({ health, onRefresh }: { health: HealthResponse | null; onRefresh: () => void }) {
  useEffect(() => { if (!health) void onRefresh(); }, [health, onRefresh]);
  return <div className="content page-view"><section className="intro"><div><h2>Diagnostics</h2><p>Live checks for the local API, database, sensor monitor, and notification delivery.</p></div><button className="secondary-button" type="button" onClick={onRefresh}><RefreshCw size={16} />Refresh</button></section><section className="diagnostic-card"><div><span className={`health-indicator ${health?.status === "ready" ? "is-ready" : ""}`} /><div><h3>{health?.status === "ready" ? "Portal is ready" : "Checking portal…"}</h3><p>API and database status from <code>/api/v1/health</code>.</p></div></div><dl><div><dt>Version</dt><dd>{health?.version ?? "—"}</dd></div><div><dt>Database</dt><dd>{health?.database ?? "—"}</dd></div><div><dt>Simulator</dt><dd>{health?.simulator ? "Enabled" : "Disabled"}</dd></div><div><dt>Plant Doctor</dt><dd>{health?.plant_doctor_configured ? "Configured" : "Not configured"}</dd></div><div><dt>Sensor timeout</dt><dd>{health ? `${health.stale_sensor_hours} hours` : "—"}</dd></div><div><dt>HA notifications</dt><dd>{health?.home_assistant_notifications_enabled ? "Enabled" : "Disabled"}</dd></div></dl></section><section className="settings-card help-card"><h3>What can be tested now?</h3><ul><li>Dashboard filtering, sorting, and status summaries</li><li>Plant details, sensor-first creation, and local private photos</li><li>Consent-based Plant Doctor checks when Cloudflare is configured</li><li>Persistent care-action snooze, completion, and undo</li><li>Home Assistant sensor warnings with plant deep links</li><li>Responsive navigation and shared-password login</li></ul></section></div>;
}

function NotificationsMenu({ actions, onClose }: { actions: CareAction[]; onClose: () => void }) {
  return <div className="popover notification-popover" role="dialog" aria-label="Notifications"><div className="popover__head"><strong>Needs attention</strong><button type="button" aria-label="Close notifications" onClick={onClose}><X size={15} /></button></div>{actions.slice(0, 3).map((action) => <a className="notification-item" href={`#plants/${encodeURIComponent(action.plant_id)}`} onClick={onClose} key={action.id}><span /><div><strong>{action.title}</strong><small>{action.recommendation}</small></div></a>)}{actions.length === 0 && <p>All clear.</p>}<a href="#actions" onClick={onClose}>Open care queue</a></div>;
}

function ProfileMenu({ onClose }: { onClose: () => void }) {
  return <div className="popover profile-popover" role="dialog" aria-label="Profile menu"><strong>Home Assistant user</strong><span>Authenticated household member</span><a href="#settings" onClick={onClose}>Portal settings</a><a href="#help" onClick={onClose}>Diagnostics</a></div>;
}

function PlantTipsSection({ plant, visit }: { plant: Plant; visit: number }) {
  const collection = plantTipCollection(plant);
  const [tipIndex, setTipIndex] = useState(visit % collection.tips.length);
  const [showAll, setShowAll] = useState(false);
  const featured = collection.tips[tipIndex] ?? collection.tips[0]!;

  function shuffleTip() {
    setTipIndex((current) => {
      const offset = 1 + Math.floor(Math.random() * (collection.tips.length - 1));
      return (current + offset) % collection.tips.length;
    });
  }

  return (
    <section className="detail-tips" aria-labelledby="plant-tips-title">
      <div className="detail-tips__heading">
        <div>
          <span className="eyebrow">GROW WITH CONFIDENCE</span>
          <h3 id="plant-tips-title">Tips for {plant.display_name}</h3>
          <p>{collection.label}{collection.fallback ? " · identify the species for tailored tips" : ""}</p>
        </div>
        <button className="tip-shuffle" type="button" onClick={shuffleTip} aria-label={`Shuffle care tip for ${plant.display_name}`}>
          <Shuffle size={15} aria-hidden="true" />
          Another tip
        </button>
      </div>
      <article className="featured-tip" aria-live="polite">
        <span>{featured.category}</span>
        <div>
          <h4>{featured.title}</h4>
          <p>{featured.body}</p>
        </div>
      </article>
      <button
        className="show-all-tips"
        type="button"
        aria-expanded={showAll}
        aria-controls={`all-tips-${plant.id}`}
        onClick={() => setShowAll((current) => !current)}
      >
        {showAll ? "Hide all tips" : `Show all tips (${collection.tips.length})`}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {showAll && (
        <div className="all-tips" id={`all-tips-${plant.id}`}>
          {collection.tips.map((tip) => (
            <article key={tip.title}>
              <span>{tip.category}</span>
              <div><h4>{tip.title}</h4><p>{tip.body}</p></div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PlantDetailDialog({ plant, tipVisit, actions, onClose, onEdit, onMapping, onDoctor, onMarkDone, onSimulateWatering }: { plant: Plant; tipVisit: number; actions: CareAction[]; onClose: () => void; onEdit: () => void; onMapping: () => void; onDoctor: () => void; onMarkDone: (action: CareAction) => void; onSimulateWatering: () => void }) {
  const image = plantImage(plant);
  const openActions = actions.filter((action) => action.status !== "completed");
  const hasWateringAction = openActions.some((action) => action.type === "low_moisture");
  const mappedSensors = plant.entity_mapping ? Object.values(plant.entity_mapping).filter(Boolean).length : 0;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="dialog plant-dialog" role="dialog" aria-modal="true" aria-labelledby="plant-dialog-title"><button className="dialog__close" type="button" aria-label="Close plant details" onClick={onClose}><X /></button>{image && <figure className="detail-photo"><img src={image.src} alt={image.alt} /><figcaption>{image.credit}</figcaption></figure>}<span className={`status-pill status-pill--${plant.state}`}>{plant.state.replaceAll("_", " ")}</span><p className="eyebrow">{plant.location} · {plant.environment_type.replaceAll("_", " ")}</p><h2 id="plant-dialog-title">{plant.display_name}</h2><p className="dialog-subtitle">{plant.common_name}{plant.scientific_name ? ` · ${plant.scientific_name}` : ""}</p><div className="mapping-banner"><div><strong>Home Assistant sensors</strong><small>{mappedSensors === 0 ? "No entities mapped" : `${mappedSensors} of 4 entities mapped`}</small></div><button type="button" onClick={onMapping}>Manage sensor mapping</button></div><div className="detail-readings"><div><span>Moisture</span><strong>{plant.moisture === null ? "No reading" : `${plant.moisture}%`}</strong><small>{plant.moisture_status}</small></div><div><span>Temperature</span><strong>{plant.temperature === null ? "No reading" : `${plant.temperature.toFixed(1)}°C`}</strong><small>{plant.temperature_status}</small></div><div><span>Battery</span><strong>{plant.battery === null ? "No reading" : `${plant.battery}%`}</strong><small>Sensor power</small></div><div><span>Illuminance</span><strong>{plant.illuminance === null ? "Not mapped" : `${plant.illuminance} lx`}</strong><small>Optional reading</small></div></div><PlantTipsSection plant={plant} visit={tipVisit} /><section className="detail-actions"><h3>Care actions</h3>{openActions.map((action) => { const sensorManaged = action.type === "low_moisture" || action.type === "sensor_issue"; return <div className="detail-action-row" key={action.id}><div>{action.type === "ai_recommendation" && <span className="ai-recommendation-badge">AI recommendation</span>}<strong>{action.title}</strong><p>{action.recommendation}</p>{sensorManaged && <small>Sensor-managed: closes automatically when the condition recovers.</small>}</div>{!sensorManaged && <button type="button" onClick={() => onMarkDone(action)}>Mark done</button>}</div>; })}{openActions.length === 0 && <p>No open actions for this plant.</p>}{hasWateringAction && <button className="simulate-button" type="button" onClick={onSimulateWatering}>Simulate confirmed watering</button>}</section><div className="dialog__footer"><button className="secondary-button" type="button" onClick={onEdit}>Edit plant</button><button className="secondary-button" type="button" onClick={onDoctor}>Plant doctor</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
}

function EntityMappingDialog({ plant, onClose, onSave }: { plant: Plant; onClose: () => void; onSave: (plant: Plant, mapping: PlantEntityMapping) => Promise<void> }) {
  const emptyMapping: PlantEntityMapping = { moisture_entity_id: null, temperature_entity_id: null, battery_entity_id: null, illuminance_entity_id: null };
  const [mapping, setMapping] = useState<PlantEntityMapping>(plant.entity_mapping ?? emptyMapping);
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getHomeAssistantEntities(controller.signal).then((response) => { setEntities(response.entities); setSource(response.source); }).catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setMessage(reason instanceof Error ? reason.message : "Entities could not be loaded."); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try { await onSave(plant, mapping); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The mapping could not be saved."); setSaving(false); }
  }
  const optionsFor = (deviceClasses: string[]) => entities.filter((entity) => entity.device_class && deviceClasses.includes(entity.device_class));
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="dialog mapping-dialog" role="dialog" aria-modal="true" aria-labelledby="mapping-dialog-title"><button className="dialog__close" type="button" aria-label="Close sensor mapping" onClick={onClose}><X /></button><p className="eyebrow">HOME ASSISTANT ENTITIES</p><h2 id="mapping-dialog-title">Map sensors for {plant.display_name}</h2><p className="dialog-subtitle">PlantCare keeps the plant and its history if an entity is changed or removed. Unavailable entities produce a sensor warning; they never delete the plant.</p>{source && <span className="source-badge">{source === "simulator" ? "Simulator entity catalog" : "Live Home Assistant entities"}</span>}{loading ? <p className="mapping-loading">Loading sensor entities…</p> : <form className="mapping-form" onSubmit={submit}><EntitySelect label="Soil moisture" value={mapping.moisture_entity_id} entities={optionsFor(["moisture", "humidity"])} onChange={(value) => setMapping({ ...mapping, moisture_entity_id: value })} /><EntitySelect label="Temperature" value={mapping.temperature_entity_id} entities={optionsFor(["temperature"])} onChange={(value) => setMapping({ ...mapping, temperature_entity_id: value })} /><EntitySelect label="Battery" value={mapping.battery_entity_id} entities={optionsFor(["battery"])} onChange={(value) => setMapping({ ...mapping, battery_entity_id: value })} /><EntitySelect label="Illuminance" value={mapping.illuminance_entity_id} entities={optionsFor(["illuminance"])} onChange={(value) => setMapping({ ...mapping, illuminance_entity_id: value })} />{message && <p className="inline-error" role="alert">{message}</p>}<div className="dialog__footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save mapping"}</button></div></form>}</section></div>;
}

function EntitySelect({ label, value, entities, onChange, required = false }: { label: string; value: string | null; entities: HomeAssistantEntity[]; onChange: (value: string | null) => void; required?: boolean }) {
  const currentMissing = value && !entities.some((entity) => entity.entity_id === value);
  return <label>{label}{required ? " *" : ""}<select required={required} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}><option value="">Not mapped</option>{currentMissing && <option value={value ?? ""}>{value} (currently unavailable)</option>}{entities.map((entity) => <option value={entity.entity_id} key={entity.entity_id}>{entity.name} — {entity.state}{entity.unit ? ` ${entity.unit}` : ""}{entity.area_name ? ` · ${entity.area_name}` : ""}</option>)}</select></label>;
}

function AreaSelect({ value, areas, onChange }: { value: string; areas: string[]; onChange: (value: string) => void }) {
  const options = areas.includes(value) || !value ? areas : [value, ...areas];
  return <label>Location<select required value={value} onChange={(event) => onChange(event.target.value)}><option value="">{areas.length ? "Select a Home Assistant area" : "No Home Assistant areas found"}</option>{options.map((area) => <option value={area} key={area}>{area}</option>)}</select></label>;
}

function entityHasReading(entity: HomeAssistantEntity): boolean {
  return !["", "unknown", "unavailable", "none", "null"].includes(entity.state.trim().toLowerCase());
}

function usePhotoPreview(file: File | null): string | null {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview;
}

function DoctorDialog({
  plant,
  onClose,
  onAddAction,
}: {
  plant: Plant;
  onClose: () => void;
  onAddAction: (plant: Plant, recommendation: string, visitId: string | null) => Promise<void>;
}) {
  const [consent, setConsent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<PlantDoctorResponse | null>(null);
  const [usage, setUsage] = useState<PlantDoctorUsageResponse | null>(null);
  const [history, setHistory] = useState<PlantDoctorVisit[]>([]);
  const [addingAction, setAddingAction] = useState(false);
  const [actionAdded, setActionAdded] = useState(false);
  const [actionDeclined, setActionDeclined] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const photoPreview = usePhotoPreview(photoFile);

  useEffect(() => {
    const controller = new AbortController();
    void getPlantDoctorUsage(controller.signal).then(setUsage).catch(() => undefined);
    void getPlantDoctorHistory(plant.id, controller.signal)
      .then((response) => setHistory(response.visits))
      .catch(() => undefined);
    return () => controller.abort();
  }, [plant.id]);

  async function refreshDoctorData() {
    const [nextUsage, nextHistory] = await Promise.all([
      getPlantDoctorUsage(),
      getPlantDoctorHistory(plant.id),
    ]);
    setUsage(nextUsage);
    setHistory(nextHistory.visits);
  }

  async function check() {
    if (!consent || !photoFile) return;
    setChecking(true);
    setMessage(null);
    try {
      setResult(await diagnosePlant(plant.id, photoFile));
      setActionAdded(false);
      setActionDeclined(false);
      await refreshDoctorData();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Plant Doctor could not complete the check.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function addAction() {
    if (!result || actionAdded || actionDeclined) return;
    const recommendation =
      result.next_steps.join(" · ") ||
      "Inspect the plant directly and confirm the visual assessment.";
    setAddingAction(true);
    setMessage(null);
    try {
      await onAddAction(plant, recommendation, result.visit_id);
      setActionAdded(true);
      await refreshDoctorData();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "The AI recommendation could not be added.",
      );
    } finally {
      setAddingAction(false);
    }
  }

  async function declineAction() {
    if (!result?.visit_id || actionAdded || actionDeclined) return;
    setSavingFeedback(result.visit_id);
    setMessage(null);
    try {
      await updatePlantDoctorFeedback(plant.id, result.visit_id, { decision: "declined" });
      setActionDeclined(true);
      await refreshDoctorData();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The decision could not be saved.");
    } finally {
      setSavingFeedback(null);
    }
  }

  async function recordOutcome(visit: PlantDoctorVisit, outcome: PlantDoctorOutcome) {
    setSavingFeedback(visit.id);
    setMessage(null);
    try {
      const updated = await updatePlantDoctorFeedback(plant.id, visit.id, { outcome });
      setHistory((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The outcome could not be saved.");
    } finally {
      setSavingFeedback(null);
    }
  }

  const earlierHistory = result?.visit_id
    ? history.filter((visit) => visit.id !== result.visit_id)
    : history;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="dialog doctor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-dialog-title"
      >
        <button
          className="dialog__close"
          type="button"
          aria-label="Close plant doctor"
          onClick={onClose}
        >
          <X />
        </button>
        <p className="eyebrow">PLANT DOCTOR · CLOUDFLARE AI</p>
        <h2 id="doctor-dialog-title">Check {plant.display_name}</h2>
        {result ? (
          <DoctorResult result={result} photo={photoPreview} plant={plant} />
        ) : (
          <>
            <p className="dialog-subtitle">
              Choose or take a current diagnostic photo. Your cover photo stays unchanged. The
              selected photo, latest sensor values, and up to five recent Doctor summaries,
              decisions, and outcomes will be sent to Cloudflare for this check.
            </p>
            {photoPreview ? (
              <div className="doctor-photo-selection">
                <img className="doctor-photo" src={photoPreview} alt={`Photo to diagnose for ${plant.display_name}`} />
                <label className="photo-picker doctor-photo-replace">
                  <ImagePlus size={17} />
                  <span><strong>Choose a different photo</strong><small>JPEG, PNG, WebP, or HEIC · maximum 10 MB</small></span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />
                </label>
              </div>
            ) : (
              <div className="doctor-empty">
                <Camera />
                <h3>Choose a current diagnostic photo</h3>
                <p>On iPhone you can take a new picture or select one from your photo library.</p>
                <label className="photo-picker doctor-photo-picker">
                  <ImagePlus size={18} />
                  <span><strong>Take or choose a photo</strong><small>It will not replace the plant's cover photo</small></span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />
                </label>
              </div>
            )}
            <DoctorUsage usage={usage} />
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I agree to send this photo and limited plant context to Cloudflare Workers AI for
              one assessment.
            </label>
            <p className="doctor-note">
              PlantCare does not store this diagnostic photo or replace the cover image. Results
              are saved locally as patient history; you decide whether to add the recommendation
              to the care queue and whether it helped.
            </p>
          </>
        )}
        {message && (
          <p className="inline-error" role="alert">
            {message}
          </p>
        )}
        {earlierHistory.length > 0 && (
          <DoctorHistory
            visits={earlierHistory}
            savingVisitId={savingFeedback}
            onOutcome={recordOutcome}
          />
        )}
        <div className="dialog__footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
          {!result && (
            <button
              className="primary-button"
              type="button"
              disabled={!photoFile || !consent || checking}
              onClick={check}
            >
              {checking ? "Checking…" : "Send for diagnosis"}
            </button>
          )}
          {result && (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setResult(null);
                  setPhotoFile(null);
                  setConsent(false);
                  setActionAdded(false);
                  setActionDeclined(false);
                }}
              >
                Check again
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!result.visit_id || actionAdded || actionDeclined || savingFeedback !== null}
                onClick={declineAction}
              >
                {actionDeclined ? "Not added" : "Don't add"}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={addingAction || actionAdded || actionDeclined}
                onClick={addAction}
              >
                {actionAdded
                  ? "Added to care queue"
                  : addingAction
                    ? "Adding…"
                    : "Add AI recommendation"}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function DoctorHistory({
  visits,
  savingVisitId,
  onOutcome,
}: {
  visits: PlantDoctorVisit[];
  savingVisitId: string | null;
  onOutcome: (visit: PlantDoctorVisit, outcome: PlantDoctorOutcome) => Promise<void>;
}) {
  const outcomeLabels: Record<PlantDoctorOutcome, string> = {
    not_tried: "Not tried",
    helped: "Helped",
    did_not_help: "Didn't help",
    not_sure: "Not sure",
  };
  return (
    <section className="doctor-history" aria-labelledby="doctor-history-title">
      <div className="doctor-history__heading">
        <div>
          <h3 id="doctor-history-title">Patient history</h3>
          <p>Stored locally; only the five most recent entries inform the next check.</p>
        </div>
        <span>{visits.length}</span>
      </div>
      <div className="doctor-history__list">
        {visits.map((visit) => (
          <article key={visit.id}>
            <div className="doctor-history__meta">
              <time dateTime={visit.created_at}>{formatDateTime(visit.created_at)}</time>
              <span className={`doctor-decision doctor-decision--${visit.decision}`}>
                {visit.decision === "accepted"
                  ? "Added to queue"
                  : visit.decision === "declined"
                    ? "Not added"
                    : "Awaiting decision"}
              </span>
            </div>
            <strong>{visit.summary}</strong>
            {visit.next_steps.length > 0 && <p>{visit.next_steps.join(" · ")}</p>}
            {visit.decision === "accepted" && (
              <div className="doctor-outcome" aria-label="Recommendation outcome">
                <span>Did it help?</span>
                {(["helped", "did_not_help", "not_sure"] as PlantDoctorOutcome[]).map(
                  (outcome) => (
                    <button
                      type="button"
                      key={outcome}
                      aria-pressed={visit.outcome === outcome}
                      disabled={savingVisitId === visit.id}
                      onClick={() => void onOutcome(visit, outcome)}
                    >
                      {outcomeLabels[outcome]}
                    </button>
                  ),
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
function DoctorUsage({ usage }: { usage: PlantDoctorUsageResponse | null }) {
  if (!usage) return <div className="doctor-usage doctor-usage--loading">Loading today's usage…</div>;
  return <aside className="doctor-usage" aria-label="Cloudflare AI usage reminder"><strong>{usage.checks_today} completed {usage.checks_today === 1 ? "check" : "checks"} since 00:00 UTC</strong><span>Estimated {usage.estimated_neurons_per_check} neurons per check · {usage.daily_free_neuron_limit.toLocaleString("en-US")} free neurons/day</span><small>Free-plan requests stop at the limit; Workers Paid may bill for overage. This local count includes successful PlantCare checks only.</small></aside>;
}

function DoctorResult({ result, photo, plant }: { result: PlantDoctorResponse; photo: string | null; plant: Plant }) {
  return <div className="doctor-result">{photo && <img className="doctor-result__photo" src={photo} alt={`Diagnosed photo of ${plant.display_name}`} />}<p className="doctor-result__identity"><strong>Assessment for {plant.display_name}</strong><span>{plant.common_name}{plant.scientific_name ? ` · ${plant.scientific_name}` : " · species not confirmed"}</span></p><div className="doctor-result__summary"><span className={`confidence confidence--${result.confidence}`}>{result.confidence} confidence</span><h3>{result.summary}</h3></div>{result.observations.length > 0 && <DoctorList title="Visible observations" items={result.observations} />}{result.possible_issues.length > 0 && <DoctorList title="Possible issues" items={result.possible_issues} />}{result.next_steps.length > 0 && <DoctorList title="Safe next checks" items={result.next_steps} />}<p className="doctor-disclaimer">{result.disclaimer}</p><small>{result.provider} · {result.neurons === null ? "Usage unavailable" : `${result.neurons.toFixed(2)} neurons`}</small></div>;
}

function DoctorList({ title, items }: { title: string; items: string[] }) {
  return <section><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function suggestedPlantName(entity: HomeAssistantEntity): string {
  const cleaned = entity.name
    .replace(/\s+(soil\s+)?(moisture|humidity|temperature|battery|illuminance|light)(\s+(sensor|level))?$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return cleaned || entity.name;
}

function AddPlantDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (payload: PlantCreate, photo: File | null) => Promise<void> }) {
  const emptyMapping: PlantEntityMapping = { moisture_entity_id: null, temperature_entity_id: null, battery_entity_id: null, illuminance_entity_id: null };
  const [form, setForm] = useState<Omit<PlantCreate, "entity_mapping">>({ display_name: "", location: "", common_name: "", scientific_name: null, environment_type: "indoor" });
  const [mapping, setMapping] = useState<PlantEntityMapping>(emptyMapping);
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loadingSensors, setLoadingSensors] = useState(true);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const photoPreview = usePhotoPreview(photoFile);
  useEffect(() => {
    const controller = new AbortController();
    getHomeAssistantEntities(controller.signal)
      .then((response) => { setEntities(response.entities); setAreas(response.areas); setSource(response.source); })
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setMessage(reason instanceof Error ? reason.message : "Entities could not be loaded."); })
      .finally(() => setLoadingSensors(false));
    return () => controller.abort();
  }, []);
  const optionsFor = (deviceClasses: string[]) => entities.filter((entity) => entity.device_class && deviceClasses.includes(entity.device_class));
  function chooseSensor(field: keyof PlantEntityMapping, value: string | null) {
    const selected = entities.find((entity) => entity.entity_id === value);
    setMapping((current) => {
      const next = { ...current, [field]: value };
      if (!selected) return next;
      const companions: Array<[keyof PlantEntityMapping, string[]]> = [
        ["moisture_entity_id", ["moisture", "humidity"]],
        ["temperature_entity_id", ["temperature"]],
        ["battery_entity_id", ["battery"]],
        ["illuminance_entity_id", ["illuminance"]],
      ];
      for (const [companionField, deviceClasses] of companions) {
        if (next[companionField]) continue;
        const companion = entities.find((entity) => selected.device_id && entity.device_id === selected.device_id && entity.device_class && deviceClasses.includes(entity.device_class) && entityHasReading(entity))
          ?? (companionField === "illuminance_entity_id"
            ? entities.find((entity) => entity.area_name === selected.area_name && entity.device_class === "illuminance" && entityHasReading(entity))
            : undefined);
        if (companion) next[companionField] = companion.entity_id;
      }
      return next;
    });
    if (selected) {
      const defaultName = suggestedPlantName(selected);
      setForm((current) => ({
        ...current,
        display_name: current.display_name || defaultName,
        common_name: current.common_name || defaultName,
        location: current.location || selected.area_name || "",
      }));
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    if (!mapping.moisture_entity_id) { setMessage("Choose a soil-moisture sensor first."); return; }
    setSaving(true);
    try { await onCreate({ ...form, entity_mapping: mapping }, photoFile); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The plant could not be added."); setSaving(false); }
  }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog add-plant-dialog" role="dialog" aria-modal="true" aria-labelledby="add-plant-title"><button className="dialog__close" type="button" aria-label="Close add plant" onClick={onClose}><X /></button><p className="eyebrow">SENSOR-FIRST SETUP</p><h2 id="add-plant-title">Add a plant</h2><p className="dialog-subtitle">Choose the Home Assistant sensors first. PlantCare suggests editable identity and area values from their metadata.</p><form className="dialog-form sensor-first-form" onSubmit={submit}><fieldset className="sensor-first-fields"><legend>1. Choose sensors</legend>{source && <span className="source-badge">{source === "simulator" ? "Simulator entity catalog" : "Live Home Assistant entities"}</span>}{loadingSensors ? <p className="mapping-loading">Loading sensor entities…</p> : <div className="sensor-grid"><EntitySelect required label="Soil moisture" value={mapping.moisture_entity_id} entities={optionsFor(["moisture", "humidity"])} onChange={(value) => chooseSensor("moisture_entity_id", value)} /><EntitySelect label="Temperature" value={mapping.temperature_entity_id} entities={optionsFor(["temperature"])} onChange={(value) => chooseSensor("temperature_entity_id", value)} /><EntitySelect label="Battery" value={mapping.battery_entity_id} entities={optionsFor(["battery"])} onChange={(value) => chooseSensor("battery_entity_id", value)} /><EntitySelect label="Illuminance (any sensor)" value={mapping.illuminance_entity_id} entities={optionsFor(["illuminance"])} onChange={(value) => chooseSensor("illuminance_entity_id", value)} /></div>}</fieldset><p className="sensor-hint">If the plant device has no usable illuminance reading, PlantCare suggests one from the same Home Assistant area. You can select any illuminance sensor.</p><p className="form-step">2. Review editable plant details</p><label>Friendly name<input required maxLength={120} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><AreaSelect value={form.location} areas={areas} onChange={(location) => setForm({ ...form, location })} /><label>Common name<input required maxLength={120} value={form.common_name} onChange={(event) => setForm({ ...form, common_name: event.target.value })} /></label><label>Scientific name <small>optional</small><input maxLength={160} value={form.scientific_name ?? ""} onChange={(event) => setForm({ ...form, scientific_name: event.target.value || null })} /></label><label>Exposure<select value={form.environment_type} onChange={(event) => setForm({ ...form, environment_type: event.target.value as PlantCreate["environment_type"] })}><option value="indoor">Indoor</option><option value="outdoor_covered">Outdoor, covered</option><option value="outdoor_exposed">Outdoor, exposed</option></select></label><fieldset className="edit-photo-section add-photo-section"><legend>3. Add a cover photo <small>optional</small></legend><div className="edit-photo-layout"><div className={`edit-photo-preview ${photoPreview ? "edit-photo-preview--image" : ""}`}>{photoPreview ? <img src={photoPreview} alt="New plant cover preview" /> : <><Camera /><span>You can add a cover now or later</span></>}</div><div className="edit-photo-controls"><p>This is the lasting image shown on the plant card. Doctor checks use a separate temporary photo.</p><label className="photo-picker"><ImagePlus size={18} /><span><strong>Choose or take a cover photo</strong><small>JPEG, PNG, WebP, or HEIC · maximum 10 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} /></label>{photoFile && <small className="selected-photo">Selected: {photoFile.name} · {(photoFile.size / 1024 / 1024).toFixed(1)} MB</small>}</div></div></fieldset>{message && <p className="inline-error" role="alert">{message}</p>}<div className="dialog__footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving || loadingSensors}>{saving ? "Adding…" : "Add connected plant"}</button></div></form></section></div>;
}

function EditPlantDialog({ plant, onClose, onUpdate, onArchive }: { plant: Plant; onClose: () => void; onUpdate: (plant: Plant, payload: PlantCreate, photoChange: PlantPhotoChange) => Promise<void>; onArchive: (plant: Plant) => Promise<void> }) {
  const [form, setForm] = useState<PlantCreate>({ display_name: plant.display_name, location: plant.location, common_name: plant.common_name, scientific_name: plant.scientific_name, environment_type: plant.environment_type as PlantCreate["environment_type"] });
  const [areas, setAreas] = useState<string[]>([plant.location]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [deleteCurrentPhoto, setDeleteCurrentPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getHomeAssistantEntities(controller.signal)
      .then((response) => setAreas(Array.from(new Set([plant.location, ...response.areas]))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [plant.location]);
  useEffect(() => {
    if (!photoFile || typeof URL.createObjectURL !== "function") { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => { if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url); };
  }, [photoFile]);
  const personalPhoto = plantPhotoUrl(plant);
  const fallbackImage = plantImage({ ...plant, photo_updated_at: null });
  const shownPhoto = photoPreview ?? (!deleteCurrentPhoto ? personalPhoto : null) ?? fallbackImage?.src ?? null;
  const shownPhotoAlt = photoPreview
    ? `New photo preview for ${plant.display_name}`
    : personalPhoto && !deleteCurrentPhoto
      ? `Current photo of ${plant.display_name}`
      : fallbackImage?.alt ?? `${plant.display_name} photo placeholder`;
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setMessage(null); try { await onUpdate(plant, form, { file: photoFile, deleteCurrent: deleteCurrentPhoto }); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The plant could not be updated."); setSaving(false); } }
  async function archive() { setSaving(true); setMessage(null); try { await onArchive(plant); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The plant could not be removed."); setSaving(false); } }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog edit-plant-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-plant-title"><button className="dialog__close" type="button" aria-label="Close edit plant" onClick={onClose}><X /></button><p className="eyebrow">LOCAL PLANT IDENTITY</p><h2 id="edit-plant-title">Edit {plant.display_name}</h2><p className="dialog-subtitle">Names, care identity, and the private photo stay in PlantCare. Home Assistant supplies areas and sensor values.</p><form className="dialog-form" onSubmit={submit}><fieldset className="edit-photo-section"><legend>Plant photo</legend><div className="edit-photo-layout"><div className={`edit-photo-preview ${shownPhoto ? "edit-photo-preview--image" : ""}`}>{shownPhoto ? <img src={shownPhoto} alt={shownPhotoAlt} /> : <><Camera /><span>No photo or species illustration available</span></>}</div><div className="edit-photo-controls"><p>{photoPreview ? "This new photo will replace the current image when you save." : deleteCurrentPhoto ? "The personal photo will be deleted when you save." : personalPhoto ? "Current private photo" : "Using the bundled species illustration"}</p><label className="photo-picker"><ImagePlus size={18} /><span><strong>{personalPhoto ? "Choose a replacement" : "Choose or take a photo"}</strong><small>JPEG, PNG, WebP, or HEIC · maximum 10 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => { setPhotoFile(event.target.files?.[0] ?? null); setDeleteCurrentPhoto(false); }} /></label>{photoFile && <small className="selected-photo">Selected: {photoFile.name} · {(photoFile.size / 1024 / 1024).toFixed(1)} MB</small>}{personalPhoto && !photoFile && <button className={deleteCurrentPhoto ? "secondary-button" : "danger-button"} type="button" onClick={() => setDeleteCurrentPhoto((current) => !current)}>{deleteCurrentPhoto ? "Keep current photo" : <><Trash2 size={15} />Remove current photo</>}</button>}</div></div><small className="photo-privacy-note">PlantCare resizes the image and removes embedded metadata before storing it in the Home Assistant add-on data.</small></fieldset><label>Friendly name<input required maxLength={120} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><AreaSelect value={form.location} areas={areas} onChange={(location) => setForm({ ...form, location })} /><label>Common name<input required maxLength={120} value={form.common_name} onChange={(event) => setForm({ ...form, common_name: event.target.value })} /></label><label>Scientific name <small>optional</small><input maxLength={160} value={form.scientific_name ?? ""} onChange={(event) => setForm({ ...form, scientific_name: event.target.value || null })} /></label><label>Exposure<select value={form.environment_type} onChange={(event) => setForm({ ...form, environment_type: event.target.value as PlantCreate["environment_type"] })}><option value="indoor">Indoor</option><option value="outdoor_covered">Outdoor, covered</option><option value="outdoor_exposed">Outdoor, exposed</option></select></label>{message && <p className="inline-error" role="alert">{message}</p>}<div className="dialog__footer dialog__footer--split"><button className="danger-button" type="button" onClick={() => setConfirmArchive(true)}>Remove from dashboard</button><span /><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div></form>{confirmArchive && <div className="archive-confirm" role="alertdialog" aria-labelledby="archive-title"><h3 id="archive-title">Remove {plant.display_name}?</h3><p>The plant disappears from the dashboard, but readings, actions, and audit history are preserved. Deleting a Home Assistant entity will follow the same non-destructive rule.</p><div><button className="secondary-button" type="button" onClick={() => setConfirmArchive(false)}>Keep plant</button><button className="danger-button" type="button" disabled={saving} onClick={archive}>Remove plant</button></div></div>}</section></div>;
}

function formatDateTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not scheduled";
}

function DropletGlyph() { return <span aria-hidden="true" className="droplet-glyph" />; }

function LoginScreen({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSubmitting(true); setMessage(null); try { await onLogin(password); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Login failed."); setSubmitting(false); } }
  return <main className="login-page"><section className="login-panel" aria-labelledby="login-title"><div className="login-brand"><span className="brand__mark"><Sprout size={25} /></span><span>Plant<span>Care</span></span></div><div className="login-lock"><LockKeyhole size={24} aria-hidden="true" /></div><p className="eyebrow">HOME LAN ACCESS</p><h1 id="login-title">Welcome back</h1><p>Use the shared household password to open your plant dashboard.</p><form onSubmit={submit}><label htmlFor="household-password">Shared password</label><input id="household-password" type="password" autoComplete="current-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} />{message && <p className="login-error" role="alert">{message}</p>}<button type="submit" disabled={submitting}>{submitting ? "Opening dashboard…" : "Open dashboard"}</button></form><p className="login-help">The password can only be created or changed from the authenticated Home Assistant view.</p></section></main>;
}

export default App;
