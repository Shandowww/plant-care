import {
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Grid2X2,
  Leaf,
  LockKeyhole,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sprout,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  archivePlant,
  completeAction,
  createPlant,
  getActionHistory,
  getActions,
  getHealth,
  getHomeAssistantEntities,
  getPlants,
  login,
  simulateConfirmedWatering,
  snoozeAction,
  syncHomeAssistant,
  undoAction,
  updatePlant,
  updatePlantEntityMapping,
} from "./api";
import { PlantCard } from "./components";
import { plantImage } from "./plant-images";
import type {
  ActionHistoryEvent,
  CareAction,
  HealthResponse,
  HomeAssistantEntity,
  Plant,
  PlantCreate,
  PlantEntityMapping,
  PlantResponse,
  PlantState,
} from "./types";

type SortKey = "urgency" | "name" | "moisture" | "temperature" | "last_update";
type View = "dashboard" | "actions" | "plants" | "settings" | "help";
type MenuName = "notifications" | "profile" | null;

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
  const value = window.location.hash.slice(1);
  return value === "actions" || value === "plants" || value === "settings" || value === "help"
    ? value
    : "dashboard";
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
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [photoPlant, setPhotoPlant] = useState<Plant | null>(null);
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
      setMobileNavOpen(false);
      setOpenMenu(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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

  async function handleCreatePlant(payload: PlantCreate) {
    const plant = await createPlant(payload);
    if (health?.simulator === false) {
      try { await syncHomeAssistant(); } catch { /* The background sync will retry. */ }
    }
    const response = await refreshPlants();
    const refreshed = response.plants.find((item) => item.id === plant.id) ?? plant;
    setAddPlantOpen(false);
    setSelectedPlant(refreshed);
    window.location.hash = "plants";
    setToast(`${plant.display_name} was added with its Home Assistant sensors.`);
  }

  async function handleUpdatePlant(plant: Plant, payload: PlantCreate) {
    const updated = await updatePlant(plant.id, payload);
    await refreshPlants();
    setEditingPlant(null);
    setSelectedPlant(updated);
    setToast(`${updated.display_name} was updated.`);
  }

  async function handleArchivePlant(plant: Plant) {
    await archivePlant(plant.id);
    await Promise.all([refreshPlants(), refreshActions()]);
    setEditingPlant(null);
    setSelectedPlant(null);
    setToast(`${plant.display_name} was removed from the dashboard. Its history was preserved.`);
  }

  async function handleUpdateMapping(plant: Plant, mapping: PlantEntityMapping) {
    await updatePlantEntityMapping(plant.id, mapping);
    if (health && !health.simulator) await syncHomeAssistant();
    const response = await refreshPlants();
    const updated = response.plants.find((item) => item.id === plant.id) ?? plant;
    setMappingPlant(null);
    setSelectedPlant(updated);
    setToast(`${plant.display_name} sensor mapping was updated.`);
  }

  async function handleSimulatedWatering(plant: Plant) {
    const updated = await simulateConfirmedWatering(plant.id);
    await Promise.all([refreshPlants(), refreshActions(), refreshActionHistory()]);
    setSelectedPlant(updated);
    setToast("Confirmed moisture recovery recorded; the watering action closed automatically.");
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
            onDetails={setSelectedPlant}
            onPhoto={setPhotoPlant}
          />
        ) : view === "actions" ? (
          <ActionQueue actions={actions} history={actionHistory} plants={data?.plants ?? []} error={actionError} saving={savingAction} snoozeHours={snoozeHours} onSnoozeHours={(id, hours) => setSnoozeHours((current) => ({ ...current, [id]: hours }))} onMutate={mutateAction} />
        ) : view === "settings" ? (
          <SettingsView compactCards={compactCards} onCompactCards={setCompactCards} onSaved={() => setToast("Portal preferences saved on this browser.")} />
        ) : (
          <HelpView health={health} onRefresh={refreshHealth} />
        )}
      </main>

      {selectedPlant && <PlantDetailDialog plant={selectedPlant} actions={actions.filter((action) => action.plant_id === selectedPlant.id)} onClose={() => setSelectedPlant(null)} onEdit={() => { setEditingPlant(selectedPlant); setSelectedPlant(null); }} onMapping={() => { setMappingPlant(selectedPlant); setSelectedPlant(null); }} onPhoto={() => { setSelectedPlant(null); setPhotoPlant(selectedPlant); }} onMarkDone={(action) => mutateAction(action, "complete")} onSimulateWatering={() => handleSimulatedWatering(selectedPlant)} />}
      {photoPlant && <PhotoDialog plant={photoPlant} onClose={() => setPhotoPlant(null)} />}
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

function PlantCollection({ dashboard, plants, counts, data, error, query, statusFilter, sort, onQuery, onStatus, onSort, onAdd, onDetails, onPhoto }: {
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
  onPhoto: (plant: Plant) => void;
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
    {error ? <section className="error-state" role="alert"><TriangleAlert /><h2>Dashboard disconnected</h2><p>{error} Home Assistant monitoring continues independently.</p><button type="button" onClick={() => window.location.reload()}>Try again</button></section> : !data ? <LoadingGrid /> : plants.length === 0 ? dashboard ? <section className="empty-state"><Check /><h2>Everything looks steady</h2><p>No plant needs attention right now. The full collection remains available under All plants.</p><a className="secondary-button" href="#plants">Open full collection</a></section> : <section className="empty-state"><Leaf /><h2>No plants match</h2><p>Clear a filter or search to see the rest of the household collection.</p><button type="button" onClick={() => { onQuery(""); onStatus("all"); }}>Clear filters</button></section> : <div className="plant-grid">{plants.map((plant) => <PlantCard plant={plant} key={plant.id} onDetails={onDetails} onPhoto={onPhoto} />)}</div>}
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
  return <section className="action-section"><div className="section-title"><h3>{title}</h3><span>{actions.length}</span></div>{actions.length === 0 ? <p className="section-empty">{empty}</p> : <div className="action-list">{actions.map((action) => { const sensorManaged = action.type === "low_moisture" || action.type === "sensor_issue"; return <article className={`action-card action-card--${action.status}`} key={action.id}><div className="action-card__priority">P{action.priority}</div><div className="action-card__copy"><span>{plantNames[action.plant_id] ?? "Unknown plant"}</span><h4>{action.title}</h4><p>{action.observation}</p><strong>{action.recommendation}</strong>{sensorManaged && action.status !== "completed" && <small className="automatic-note">Sensor-managed: closes automatically when the condition recovers.</small>}{action.status === "snoozed" && <small><Clock3 size={13} />Snoozed until {formatDateTime(action.snoozed_until)}</small>}{action.status === "completed" && <small><Check size={13} />Completed by {action.completed_by ?? "Household"} · {formatDateTime(action.completed_at)}</small>}</div><div className="action-card__controls">{action.status === "completed" ? <button type="button" disabled={saving === action.id} onClick={() => onMutate(action, "undo")}>Undo</button> : <><label><span className="sr-only">Snooze duration for {action.title}</span><select aria-label={`Snooze duration for ${action.title}`} value={snoozeHours[action.id] ?? 24} onChange={(event) => onSnoozeHours(action.id, Number(event.target.value))}><option value={6}>6 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option></select></label><button type="button" disabled={saving === action.id} onClick={() => onMutate(action, "snooze")}>Snooze</button>{!sensorManaged && <button className="complete-button" type="button" disabled={saving === action.id} onClick={() => onMutate(action, "complete")}><Check size={15} />Mark done</button>}</>}</div></article>; })}</div>}</section>;
}

function ActionHistory({ history, actions, plantNames }: { history: ActionHistoryEvent[]; actions: CareAction[]; plantNames: Record<string, string> }) {
  const actionById = Object.fromEntries(actions.map((action) => [action.id, action]));
  const labels: Record<ActionHistoryEvent["event_type"], string> = {
    action_completed: "Marked done manually",
    action_auto_completed: "Completed automatically after moisture recovery",
    action_snoozed: "Snoozed",
    action_reopened: "Reopened",
  };
  return <section className="action-section history-section"><div className="section-title"><h3>Action history</h3><span>{history.length}</span></div>{history.length === 0 ? <p className="section-empty">History appears after an action is snoozed, completed, or reopened.</p> : <div className="history-list">{history.map((event) => { const action = actionById[event.action_id]; return <article key={event.id}><span className={`history-icon history-icon--${event.event_type}`}><Check size={14} /></span><div><strong>{labels[event.event_type] ?? event.event_type}</strong><p>{action?.title ?? "Care action"}{action ? ` · ${plantNames[action.plant_id] ?? "Unknown plant"}` : ""}</p></div><small>{event.actor} · {formatDateTime(event.occurred_at)}</small></article>; })}</div>}</section>;
}

function SettingsView({ compactCards, onCompactCards, onSaved }: { compactCards: boolean; onCompactCards: (value: boolean) => void; onSaved: () => void }) {
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  return <div className="content page-view"><section className="intro"><div><h2>Portal preferences</h2><p>These simulator-safe display preferences are stored for this browser session.</p></div></section><div className="settings-grid"><section className="settings-card"><h3>Display</h3><label className="switch-row"><span><strong>Compact plant cards</strong><small>Show more plants at once.</small></span><input type="checkbox" checked={compactCards} onChange={(event) => onCompactCards(event.target.checked)} /></label></section><section className="settings-card"><h3>Quiet hours preview</h3><div className="form-row"><label>From<input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} /></label><label>Until<input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} /></label></div><p>Notification delivery is added in Phase 4; this lets you test the intended settings flow.</p></section><section className="settings-card settings-card--wide"><h3>Home Assistant integration</h3><div className="integration-status"><span className="connection-dot" /><div><strong>Entity mapping ready</strong><small>Open a plant’s Details window and choose Manage sensor mapping. Simulator entities are used locally; ingress loads live Home Assistant sensors.</small></div></div></section></div><button className="primary-button settings-save" type="button" onClick={onSaved}>Save portal preferences</button></div>;
}

function HelpView({ health, onRefresh }: { health: HealthResponse | null; onRefresh: () => void }) {
  useEffect(() => { if (!health) void onRefresh(); }, [health, onRefresh]);
  return <div className="content page-view"><section className="intro"><div><h2>Diagnostics</h2><p>Live checks for the local API, database, and simulator.</p></div><button className="secondary-button" type="button" onClick={onRefresh}><RefreshCw size={16} />Refresh</button></section><section className="diagnostic-card"><div><span className={`health-indicator ${health?.status === "ready" ? "is-ready" : ""}`} /><div><h3>{health?.status === "ready" ? "Portal is ready" : "Checking portal…"}</h3><p>API and database status from <code>/api/v1/health</code>.</p></div></div><dl><div><dt>Version</dt><dd>{health?.version ?? "—"}</dd></div><div><dt>Database</dt><dd>{health?.database ?? "—"}</dd></div><div><dt>Simulator</dt><dd>{health?.simulator ? "Enabled" : "Disabled"}</dd></div></dl></section><section className="settings-card help-card"><h3>What can be tested now?</h3><ul><li>Dashboard filtering, sorting, and status summaries</li><li>Plant detail views and manual simulator plant creation</li><li>Persistent care-action snooze, completion, and undo</li><li>Responsive navigation and shared-password login</li></ul></section></div>;
}

function NotificationsMenu({ actions, onClose }: { actions: CareAction[]; onClose: () => void }) {
  return <div className="popover notification-popover" role="dialog" aria-label="Notifications"><div className="popover__head"><strong>Needs attention</strong><button type="button" aria-label="Close notifications" onClick={onClose}><X size={15} /></button></div>{actions.slice(0, 3).map((action) => <div className="notification-item" key={action.id}><span /><div><strong>{action.title}</strong><small>{action.recommendation}</small></div></div>)}{actions.length === 0 && <p>All clear.</p>}<a href="#actions" onClick={onClose}>Open care queue</a></div>;
}

function ProfileMenu({ onClose }: { onClose: () => void }) {
  return <div className="popover profile-popover" role="dialog" aria-label="Profile menu"><strong>Home Assistant user</strong><span>Authenticated household member</span><a href="#settings" onClick={onClose}>Portal settings</a><a href="#help" onClick={onClose}>Diagnostics</a></div>;
}

function PlantDetailDialog({ plant, actions, onClose, onEdit, onMapping, onPhoto, onMarkDone, onSimulateWatering }: { plant: Plant; actions: CareAction[]; onClose: () => void; onEdit: () => void; onMapping: () => void; onPhoto: () => void; onMarkDone: (action: CareAction) => void; onSimulateWatering: () => void }) {
  const image = plantImage(plant);
  const openActions = actions.filter((action) => action.status !== "completed");
  const hasWateringAction = openActions.some((action) => action.type === "low_moisture");
  const mappedSensors = plant.entity_mapping ? Object.values(plant.entity_mapping).filter(Boolean).length : 0;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="dialog plant-dialog" role="dialog" aria-modal="true" aria-labelledby="plant-dialog-title"><button className="dialog__close" type="button" aria-label="Close plant details" onClick={onClose}><X /></button>{image && <figure className="detail-photo"><img src={image.src} alt={image.alt} /><figcaption>{image.credit}</figcaption></figure>}<span className={`status-pill status-pill--${plant.state}`}>{plant.state.replaceAll("_", " ")}</span><p className="eyebrow">{plant.location} · {plant.environment_type.replaceAll("_", " ")}</p><h2 id="plant-dialog-title">{plant.display_name}</h2><p className="dialog-subtitle">{plant.common_name}{plant.scientific_name ? ` · ${plant.scientific_name}` : ""}</p><div className="mapping-banner"><div><strong>Home Assistant sensors</strong><small>{mappedSensors === 0 ? "No entities mapped" : `${mappedSensors} of 4 entities mapped`}</small></div><button type="button" onClick={onMapping}>Manage sensor mapping</button></div><div className="detail-readings"><div><span>Moisture</span><strong>{plant.moisture === null ? "No reading" : `${plant.moisture}%`}</strong><small>{plant.moisture_status}</small></div><div><span>Temperature</span><strong>{plant.temperature === null ? "No reading" : `${plant.temperature.toFixed(1)}°C`}</strong><small>{plant.temperature_status}</small></div><div><span>Battery</span><strong>{plant.battery === null ? "No reading" : `${plant.battery}%`}</strong><small>Sensor power</small></div><div><span>Illuminance</span><strong>{plant.illuminance === null ? "Not mapped" : `${plant.illuminance} lx`}</strong><small>Optional reading</small></div></div><section className="detail-actions"><h3>Care actions</h3>{openActions.map((action) => { const sensorManaged = action.type === "low_moisture" || action.type === "sensor_issue"; return <div className="detail-action-row" key={action.id}><div><strong>{action.title}</strong><p>{action.recommendation}</p>{sensorManaged && <small>Sensor-managed: closes automatically when the condition recovers.</small>}</div>{!sensorManaged && <button type="button" onClick={() => onMarkDone(action)}>Mark done</button>}</div>; })}{openActions.length === 0 && <p>No open actions for this plant.</p>}{hasWateringAction && <button className="simulate-button" type="button" onClick={onSimulateWatering}>Simulate confirmed watering</button>}</section><div className="dialog__footer"><button className="secondary-button" type="button" onClick={onEdit}>Edit plant</button><button className="secondary-button" type="button" onClick={onPhoto}>Check with photo</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div></section></div>;
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

function PhotoDialog({ plant, onClose }: { plant: Plant; onClose: () => void }) {
  const [demo, setDemo] = useState(false);
  return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="photo-dialog-title"><button className="dialog__close" type="button" aria-label="Close photo check" onClick={onClose}><X /></button><p className="eyebrow">PRIVATE PHOTO CHECK</p><h2 id="photo-dialog-title">Check {plant.display_name}</h2>{demo ? <div className="demo-result"><Check /><h3>Demo capture flow works</h3><p>No image was uploaded. Provider-backed health assessment and private photo retention arrive in Phase 5.</p></div> : <><p className="dialog-subtitle">Test the consent and capture entry point without sending a real image.</p><div className="photo-placeholder"><Leaf /><span>Camera or photo picker</span></div><label className="consent-row"><input type="checkbox" required />I understand a future provider may process the selected image.</label></>}<div className="dialog__footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button>{!demo && <button className="primary-button" type="button" onClick={() => setDemo(true)}>Run demo check</button>}</div></section></div>;
}

function suggestedPlantName(entity: HomeAssistantEntity): string {
  const cleaned = entity.name
    .replace(/\s+(soil\s+)?(moisture|humidity|temperature|battery|illuminance|light)(\s+(sensor|level))?$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return cleaned || entity.name;
}

function AddPlantDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (payload: PlantCreate) => Promise<void> }) {
  const emptyMapping: PlantEntityMapping = { moisture_entity_id: null, temperature_entity_id: null, battery_entity_id: null, illuminance_entity_id: null };
  const [form, setForm] = useState<Omit<PlantCreate, "entity_mapping">>({ display_name: "", location: "", common_name: "", scientific_name: null, environment_type: "indoor" });
  const [mapping, setMapping] = useState<PlantEntityMapping>(emptyMapping);
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loadingSensors, setLoadingSensors] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    try { await onCreate({ ...form, entity_mapping: mapping }); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The plant could not be added."); setSaving(false); }
  }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog add-plant-dialog" role="dialog" aria-modal="true" aria-labelledby="add-plant-title"><button className="dialog__close" type="button" aria-label="Close add plant" onClick={onClose}><X /></button><p className="eyebrow">SENSOR-FIRST SETUP</p><h2 id="add-plant-title">Add a plant</h2><p className="dialog-subtitle">Choose the Home Assistant sensors first. PlantCare suggests editable identity and area values from their metadata.</p><form className="dialog-form sensor-first-form" onSubmit={submit}><fieldset className="sensor-first-fields"><legend>1. Choose sensors</legend>{source && <span className="source-badge">{source === "simulator" ? "Simulator entity catalog" : "Live Home Assistant entities"}</span>}{loadingSensors ? <p className="mapping-loading">Loading sensor entities…</p> : <div className="sensor-grid"><EntitySelect required label="Soil moisture" value={mapping.moisture_entity_id} entities={optionsFor(["moisture", "humidity"])} onChange={(value) => chooseSensor("moisture_entity_id", value)} /><EntitySelect label="Temperature" value={mapping.temperature_entity_id} entities={optionsFor(["temperature"])} onChange={(value) => chooseSensor("temperature_entity_id", value)} /><EntitySelect label="Battery" value={mapping.battery_entity_id} entities={optionsFor(["battery"])} onChange={(value) => chooseSensor("battery_entity_id", value)} /><EntitySelect label="Illuminance (any sensor)" value={mapping.illuminance_entity_id} entities={optionsFor(["illuminance"])} onChange={(value) => chooseSensor("illuminance_entity_id", value)} /></div>}</fieldset><p className="sensor-hint">If the plant device has no usable illuminance reading, PlantCare suggests one from the same Home Assistant area. You can select any illuminance sensor.</p><p className="form-step">2. Review editable plant details</p><label>Friendly name<input required maxLength={120} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><AreaSelect value={form.location} areas={areas} onChange={(location) => setForm({ ...form, location })} /><label>Common name<input required maxLength={120} value={form.common_name} onChange={(event) => setForm({ ...form, common_name: event.target.value })} /></label><label>Scientific name <small>optional</small><input maxLength={160} value={form.scientific_name ?? ""} onChange={(event) => setForm({ ...form, scientific_name: event.target.value || null })} /></label><label>Exposure<select value={form.environment_type} onChange={(event) => setForm({ ...form, environment_type: event.target.value as PlantCreate["environment_type"] })}><option value="indoor">Indoor</option><option value="outdoor_covered">Outdoor, covered</option><option value="outdoor_exposed">Outdoor, exposed</option></select></label>{message && <p className="inline-error" role="alert">{message}</p>}<div className="dialog__footer"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving || loadingSensors}>{saving ? "Adding…" : "Add connected plant"}</button></div></form></section></div>;
}

function EditPlantDialog({ plant, onClose, onUpdate, onArchive }: { plant: Plant; onClose: () => void; onUpdate: (plant: Plant, payload: PlantCreate) => Promise<void>; onArchive: (plant: Plant) => Promise<void> }) {
  const [form, setForm] = useState<PlantCreate>({ display_name: plant.display_name, location: plant.location, common_name: plant.common_name, scientific_name: plant.scientific_name, environment_type: plant.environment_type as PlantCreate["environment_type"] });
  const [areas, setAreas] = useState<string[]>([plant.location]);
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
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setMessage(null); try { await onUpdate(plant, form); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The plant could not be updated."); setSaving(false); } }
  async function archive() { setSaving(true); setMessage(null); try { await onArchive(plant); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "The plant could not be removed."); setSaving(false); } }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-plant-title"><button className="dialog__close" type="button" aria-label="Close edit plant" onClick={onClose}><X /></button><p className="eyebrow">LOCAL PLANT IDENTITY</p><h2 id="edit-plant-title">Edit {plant.display_name}</h2><p className="dialog-subtitle">Names and care identity stay in PlantCare. Home Assistant supplies areas, live sensor values, and mapping health.</p><form className="dialog-form" onSubmit={submit}><label>Friendly name<input required maxLength={120} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><AreaSelect value={form.location} areas={areas} onChange={(location) => setForm({ ...form, location })} /><label>Common name<input required maxLength={120} value={form.common_name} onChange={(event) => setForm({ ...form, common_name: event.target.value })} /></label><label>Scientific name <small>optional</small><input maxLength={160} value={form.scientific_name ?? ""} onChange={(event) => setForm({ ...form, scientific_name: event.target.value || null })} /></label><label>Exposure<select value={form.environment_type} onChange={(event) => setForm({ ...form, environment_type: event.target.value as PlantCreate["environment_type"] })}><option value="indoor">Indoor</option><option value="outdoor_covered">Outdoor, covered</option><option value="outdoor_exposed">Outdoor, exposed</option></select></label>{message && <p className="inline-error" role="alert">{message}</p>}<div className="dialog__footer dialog__footer--split"><button className="danger-button" type="button" onClick={() => setConfirmArchive(true)}>Remove from dashboard</button><span /><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div></form>{confirmArchive && <div className="archive-confirm" role="alertdialog" aria-labelledby="archive-title"><h3 id="archive-title">Remove {plant.display_name}?</h3><p>The plant disappears from the dashboard, but readings, actions, and audit history are preserved. Deleting a Home Assistant entity will follow the same non-destructive rule.</p><div><button className="secondary-button" type="button" onClick={() => setConfirmArchive(false)}>Keep plant</button><button className="danger-button" type="button" disabled={saving} onClick={archive}>Remove plant</button></div></div>}</section></div>;
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
