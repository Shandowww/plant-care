import gardenerUrl from "./gardener.svg";
import { NotificationSettings } from "./NotificationSettings";
import { plantStatusLabel } from "./plant-status";
import {
  Bell,
  Check,
  Camera,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Droplets,
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
import { useEffect, useMemo, useRef, useState } from "react";
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
  verifyGeminiSetup,
} from "./api";
import { PlantCard } from "./components";
import { plantImage, plantPhotoUrl } from "./plant-images";
import { plantTipCollection } from "./plant-tips";
import { useI18n } from "./i18n";
import { useAppearance, type Appearance } from "./appearance";
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

const autoManagedActionTypes = new Set([
  "low_moisture",
  "prolonged_wet",
  "low_battery",
  "sensor_issue",
]);

function viewFromHash(): View {
  const value = window.location.hash.slice(1).split("/", 1)[0];
  return value === "actions" ||
    value === "plants" ||
    value === "settings" ||
    value === "help"
    ? value
    : "dashboard";
}

function plantIdFromHash(): string | null {
  const match = window.location.hash.match(/^#plants\/([^/?#]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function LoadingGrid() {
  return (
    <div className="plant-grid" aria-label="Loading plants">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="plant-card skeleton" key={index} />
      ))}
    </div>
  );
}

function App() {
  const { locale, t } = useI18n();
  const [appearance, setAppearance] = useAppearance();
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
  const [linkedPlantId, setLinkedPlantId] = useState<string | null>(
    plantIdFromHash,
  );
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
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const refreshLock = useRef(false);
  const pullStart = useRef<{ x: number; y: number } | null>(null);
  const dialogOpen = Boolean(selectedPlant || doctorPlant || addPlantOpen || editingPlant || mappingPlant);
  const dialogKey = selectedPlant ? `detail-${selectedPlant.id}` : doctorPlant ? `doctor-${doctorPlant.id}` :
    editingPlant ? `edit-${editingPlant.id}` : mappingPlant ? `mapping-${mappingPlant.id}` : addPlantOpen ? "add" : "";
  const selectedPlantId = selectedPlant?.id;

  useEffect(() => {
    if (!dialogKey) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    dialog?.querySelector<HTMLButtonElement>(".dialog__close")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (!dialog) return;
      if (event.key === "Escape" && dialogKey.startsWith("detail-")) {
        dialog.querySelector<HTMLButtonElement>(".dialog__close:not(:disabled)")?.click();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href], input:not(:disabled):not([type='hidden']), select:not(:disabled), textarea:not(:disabled), [tabindex='0']",
      ));
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", trap);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [dialogKey]);

  async function refreshDashboard() {
    if (refreshLock.current || dialogOpen) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      const [nextData, nextActions, nextHistory, nextHealth] = await Promise.all([
        getPlants(), getActions(), getActionHistory(), getHealth(),
      ]);
      setData(nextData);
      setActions(nextActions.actions);
      setActionHistory(nextHistory.events);
      setHealth(nextHealth);
      setError(null);
      setActionError(null);
      setToast(t("refresh.success", "Data refreshed."));
    } catch {
      setToast(t("refresh.failed", "Refresh failed. Your last data is still available; please retry."));
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }

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
    getPlants(controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        if (reason instanceof ApiError && reason.status === 401) {
          setRequiresLogin(true);
          return;
        }
        setError(
          reason instanceof Error
            ? reason.message
            : "The plant data could not be loaded.",
        );
      });
    getActions(controller.signal)
      .then((response) => setActions(response.actions))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setActionError(
          reason instanceof Error
            ? reason.message
            : "The care queue could not be loaded.",
        );
      });
    getActionHistory(controller.signal)
      .then((response) => setActionHistory(response.events))
      .catch(() => undefined);
    getHealth()
      .then(setHealth)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      getPlants()
        .then(setData)
        .catch(() => undefined);
      getActions()
        .then((response) => setActions(response.actions))
        .catch(() => undefined);
      getActionHistory()
        .then((response) => setActionHistory(response.events))
        .catch(() => undefined);
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
    setTipVisits((current) => ({
      ...current,
      [plant.id]: (current[plant.id] ?? -1) + 1,
    }));
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
    const normalizedQuery = query.trim().toLocaleLowerCase(locale === "he" ? "he-IL" : "en-IL");
    const result = (data?.plants ?? []).filter((plant) => {
      const statusMatches =
        statusFilter === "all" || plant.state === statusFilter;
      const queryMatches =
        !normalizedQuery ||
        [
          plant.display_name,
          plant.location,
          plant.specific_position ?? "",
          plant.common_name,
          plant.scientific_name ?? "",
        ].some((value) =>
          value.toLocaleLowerCase(locale === "he" ? "he-IL" : "en-IL").includes(normalizedQuery),
        );
      return statusMatches && queryMatches;
    });
    return result.sort((left: Plant, right: Plant) => {
      if (sort === "name")
        return left.display_name.localeCompare(right.display_name, locale === "he" ? "he-IL" : "en-IL");
      if (sort === "moisture")
        return (left.moisture ?? -1) - (right.moisture ?? -1);
      if (sort === "temperature")
        return (left.temperature ?? -100) - (right.temperature ?? -100);
      if (sort === "last_update")
        return (
          new Date(right.last_reading_at ?? 0).getTime() -
          new Date(left.last_reading_at ?? 0).getTime()
        );
      return urgencyOrder[left.state] - urgencyOrder[right.state];
    });
  }, [data, locale, query, sort, statusFilter]);

  const attentionPlants = useMemo(
    () =>
      (data?.plants ?? [])
        .filter((plant) => plant.state !== "good")
        .sort(
          (left, right) => urgencyOrder[left.state] - urgencyOrder[right.state],
        )
        .slice(0, 6),
    [data],
  );

  const counts = data?.summary ?? {
    total: 0,
    action_needed: 0,
    overdue: 0,
    sensor_issues: 0,
  };
  const activeActions = actions.filter(
    (action) => action.status !== "completed",
  );
  const currentDate = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(new Date())
    .toUpperCase();

  function showPlantDetails(plant: Plant) {
    setTipVisits((current) => ({
      ...current,
      [plant.id]: (current[plant.id] ?? -1) + 1,
    }));
    setSelectedPlant(plant);
  }

  async function handleLogin(password: string) {
    await login(password);
    await Promise.all([
      refreshPlants(),
      refreshActions(),
      refreshActionHistory(),
    ]);
    setRequiresLogin(false);
  }

  async function mutateAction(
    action: CareAction,
    operation: "complete" | "snooze" | "undo",
  ) {
    setSavingAction(action.id);
    setActionError(null);
    try {
      const updated =
        operation === "complete"
          ? await completeAction(action.id)
          : operation === "undo"
            ? await undoAction(action.id)
            : await snoozeAction(action.id, snoozeHours[action.id] ?? 24);
      setActions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      await Promise.all([refreshPlants(), refreshActionHistory()]);
      setToast(
        operation === "complete"
          ? "Action completed."
          : operation === "undo"
            ? "Action reopened."
            : "Action snoozed.",
      );
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "The action could not be updated.",
      );
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
    const refreshed =
      response.plants.find((item) => item.id === plant.id) ?? plant;
    setAddPlantOpen(false);
    showPlantDetails(refreshed);
    window.location.hash = "plants";
    setToast(
      photoWarning
        ? `${plant.display_name} was added, but the photo could not be saved. You can retry in Edit plant.`
        : `${plant.display_name} was added with its Home Assistant sensors${photo ? " and photo" : ""}.`,
    );
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
    const refreshed =
      response.plants.find((item) => item.id === plant.id) ?? updated;
    setEditingPlant(null);
    showPlantDetails(refreshed);
    setToast(`${refreshed.display_name} was updated.`);
  }

  async function handleArchivePlant(plant: Plant) {
    await archivePlant(plant.id);
    await Promise.all([refreshPlants(), refreshActions()]);
    setEditingPlant(null);
    setSelectedPlant(null);
    setToast(
      `${plant.display_name} was removed from the dashboard. Its history was preserved.`,
    );
  }

  async function handleUpdateMapping(
    plant: Plant,
    mapping: PlantEntityMapping,
  ) {
    const savedMapping = await updatePlantEntityMapping(plant.id, mapping);
    const locallyUpdated = { ...plant, entity_mapping: savedMapping };
    setData((current) =>
      current
        ? {
            ...current,
            plants: current.plants.map((item) =>
              item.id === plant.id ? locallyUpdated : item,
            ),
          }
        : current,
    );
    setMappingPlant(null);
    showPlantDetails(locallyUpdated);
    const response = await refreshPlants();
    const refreshed = response.plants.find((item) => item.id === plant.id);
    if (refreshed) setSelectedPlant(refreshed);
    setToast(`${plant.display_name} sensor mapping was updated.`);
  }

  async function handleSimulatedWatering(plant: Plant) {
    const updated = await simulateConfirmedWatering(plant.id);
    await Promise.all([
      refreshPlants(),
      refreshActions(),
      refreshActionHistory(),
    ]);
    setSelectedPlant(updated);
    setToast(
      "Confirmed moisture recovery recorded; the watering action closed automatically.",
    );
  }

  async function handleDoctorRecommendation(
    plant: Plant,
    recommendation: string,
    visitId: string | null,
  ) {
    await createDoctorRecommendation(plant.id, recommendation, visitId);
    await Promise.all([
      refreshPlants(),
      refreshActions(),
      refreshActionHistory(),
    ]);
    setToast(`AI recommendation added to ${plant.display_name}'s care queue.`);
  }

  async function refreshHealth() {
    try {
      setHealth(await getHealth());
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Diagnostics are unavailable.",
      );
    }
  }

  if (requiresLogin) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className={`app-shell ${compactCards ? "compact-mode" : ""}`}>
      <aside
        inert={dialogOpen}
        className={`sidebar ${mobileNavOpen ? "sidebar--open" : ""}`}
      aria-label={t("a11y.primaryNav", "Primary navigation")}
      >
        <div className="brand">
          <span className="brand__mark">
            <Sprout size={23} />
          </span>
          <span>
            Plant<span>Care</span>
          </span>
        </div>
        <button
          className="sidebar__close"
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label={t("a11y.closeNav", "Close navigation")}
        >
          <X />
        </button>
        <nav>
          <NavLink
            view="dashboard"
            current={view}
            icon={<Grid2X2 size={19} />}
            label={t("nav.dashboard", "Dashboard")}
          />
          <NavLink
            view="actions"
            current={view}
            icon={<ClipboardCheck size={19} />}
            label={t("nav.actions", "Care queue")}
            badge={activeActions.length}
          />
          <NavLink
            view="plants"
            current={view}
            icon={<Leaf size={19} />}
            label={t("nav.plants", "All plants")}
          />
          <NavLink
            view="settings"
            current={view}
            icon={<Settings size={19} />}
            label={t("nav.settings", "Settings")}
          />
        </nav>
        <div className="sidebar__status">
          <span className="connection-dot" />
          <div>
            <strong>
              {error
                ? t("connection.disconnected", "Dashboard disconnected")
                : health === null
                  ? t("connection.connecting", "Connecting…")
                  : health.simulator
                    ? t("connection.simulator", "Simulator connected")
                    : t("connection.ha", "Home Assistant connected")}
            </strong>
            <span>
              {error
                ? t("connection.unavailable", "API unavailable")
                : health === null
                  ? t("connection.waiting", "Waiting for API")
                  : health.simulator
                    ? t("connection.scenarios", "{{count}} plant scenarios", { count: counts.total || 0 })
                    : t("connection.plants", "{{count}} mapped plants", { count: counts.total || 0 })}
            </span>
          </div>
        </div>
        <NavLink
          view="help"
          current={view}
          icon={<CircleHelp size={19} />}
          label={t("nav.help", "Help & diagnostics")}
          help
        />
      </aside>

      {mobileNavOpen && (
        <button
          className="nav-scrim"
          type="button"
          aria-label={t("a11y.closeNav", "Close navigation")}
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <main
        inert={dialogOpen}
        onTouchStart={(event) => {
          pullStart.current = null;
          setPullDistance(0);
          const target = event.target;
          const touch = event.touches[0];
          if (dialogOpen || mobileNavOpen || view === "settings" || refreshing || window.scrollY > 0 ||
            event.touches.length !== 1 || !touch || !(target instanceof Element) ||
            target.closest("button, a, input, select, textarea, label, [role='dialog']")) return;
          pullStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (!pullStart.current) return;
          if (event.touches.length !== 1 || !touch) {
            pullStart.current = null; setPullDistance(0); return;
          }
          const dx = Math.abs(touch.clientX - pullStart.current.x);
          const dy = touch.clientY - pullStart.current.y;
          if (dx > 20 || dy < 0) { pullStart.current = null; setPullDistance(0); return; }
          setPullDistance(Math.min(100, dy));
        }}
        onTouchEnd={() => {
          if (pullStart.current && pullDistance >= 80) void refreshDashboard();
          pullStart.current = null;
          setPullDistance(0);
        }}
        onTouchCancel={() => { pullStart.current = null; setPullDistance(0); }}
      >
        {pullDistance > 20 && <div className="pull-refresh" role="status">
          <RefreshCw size={16} />
          {pullDistance >= 80 ? t("refresh.release", "Release to refresh") : t("refresh.pull", "Pull to refresh")}
        </div>}
        <header className="topbar">
          <button
            className="mobile-menu"
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label={t("a11y.openNav", "Open navigation")}
          >
            <Menu />
          </button>
          <div className="topbar__identity">
            <span className="eyebrow">{currentDate}</span>
            <h1>
              {{
                dashboard: t("view.dashboard", "Your plant overview"),
                actions: t("view.actions", "Care queue"),
                plants: t("view.plants", "All plants"),
                settings: t("view.settings", "Settings"),
                help: t("view.help", "Help & diagnostics"),
              }[view]}{" "}
              {view === "dashboard" && <span aria-hidden="true">☀</span>}
            </h1>
          </div>
          <div className="topbar__actions">
            <button className="icon-button refresh-button" type="button"
              aria-label={t("refresh.label", "Refresh data")}
              title={t("refresh.label", "Refresh data")}
              disabled={refreshing || dialogOpen} aria-busy={refreshing}
              onClick={() => void refreshDashboard()}>
              <RefreshCw size={19} className={refreshing ? "refresh-spinning" : undefined} />
            </button>
            <div className="menu-anchor">
              <button
                className="icon-button notification-button"
                type="button"
                aria-label={t("a11y.notifications", "Notifications")}
                aria-expanded={openMenu === "notifications"}
                onClick={() =>
                  setOpenMenu(
                    openMenu === "notifications" ? null : "notifications",
                  )
                }
              >
                <Bell size={19} />
                {activeActions.length > 0 && <span />}
              </button>
              {openMenu === "notifications" && (
                <NotificationsMenu
                  actions={activeActions}
                  onClose={() => setOpenMenu(null)}
                />
              )}
            </div>
            <div className="menu-anchor">
              <button
                className="profile-button"
                type="button"
                aria-label={t("profile.user", "Home Assistant user")}
                aria-expanded={openMenu === "profile"}
                onClick={() =>
                  setOpenMenu(openMenu === "profile" ? null : "profile")
                }
              >
                <span>HA</span>
                <span>
                  {t("profile.user", "Home Assistant user")}<small>{t("profile.household", "Authenticated household")}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {openMenu === "profile" && (
                <ProfileMenu onClose={() => setOpenMenu(null)} />
              )}
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
          <ActionQueue
            actions={actions}
            history={actionHistory}
            plants={data?.plants ?? []}
            error={actionError}
            saving={savingAction}
            snoozeHours={snoozeHours}
            onSnoozeHours={(id, hours) =>
              setSnoozeHours((current) => ({ ...current, [id]: hours }))
            }
            onMutate={mutateAction}
          />
        ) : view === "settings" ? (
          <SettingsView
            appearance={appearance}
            onAppearance={setAppearance}
            health={health}
            compactCards={compactCards}
            onCompactCards={setCompactCards}
            onSaved={() =>
              setToast("Portal preferences saved on this browser.")
            }
          />
        ) : (
          <HelpView health={health} onRefresh={refreshHealth} />
        )}
      </main>

      {selectedPlant && (
        <PlantDetailDialog
          plant={selectedPlant}
          tipVisit={tipVisits[selectedPlant.id] ?? 0}
          actions={actions.filter(
            (action) => action.plant_id === selectedPlant.id,
          )}
          onClose={() => setSelectedPlant(null)}
          onEdit={() => {
            setEditingPlant(selectedPlant);
            setSelectedPlant(null);
          }}
          onMapping={() => {
            setMappingPlant(selectedPlant);
            setSelectedPlant(null);
          }}
          onDoctor={() => {
            setSelectedPlant(null);
            setDoctorPlant(selectedPlant);
          }}
          onMarkDone={(action) => mutateAction(action, "complete")}
          onSimulateWatering={() => handleSimulatedWatering(selectedPlant)}
        />
      )}
      {doctorPlant && (
        <DoctorDialog
          plant={doctorPlant}
          onClose={() => setDoctorPlant(null)}
          onAddAction={handleDoctorRecommendation}
        />
      )}
      {addPlantOpen && (
        <AddPlantDialog
          onClose={() => setAddPlantOpen(false)}
          onCreate={handleCreatePlant}
        />
      )}
      {editingPlant && (
        <EditPlantDialog
          plant={editingPlant}
          onClose={() => setEditingPlant(null)}
          onUpdate={handleUpdatePlant}
          onArchive={handleArchivePlant}
        />
      )}
      {mappingPlant && (
        <EntityMappingDialog
          plant={mappingPlant}
          onClose={() => setMappingPlant(null)}
          onSave={handleUpdateMapping}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function NavLink({
  view,
  current,
  icon,
  label,
  badge,
  help = false,
}: {
  view: View;
  current: View;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  help?: boolean;
}) {
  return (
    <a
      href={`#${view}`}
      className={`nav-item ${current === view ? "nav-item--active" : ""} ${help ? "nav-item--help" : ""}`}
    >
      {icon}
      {label}
      {badge !== undefined && <span className="nav-badge">{badge}</span>}
    </a>
  );
}

function PlantCollection({
  dashboard,
  plants,
  counts,
  data,
  error,
  query,
  statusFilter,
  sort,
  onQuery,
  onStatus,
  onSort,
  onAdd,
  onDetails,
}: {
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
  const { t } = useI18n();
  function openCollection(filter: PlantState | "all") {
    onQuery("");
    onStatus(filter);
    window.location.hash = "plants";
  }

  return (
    <div className="content" id={dashboard ? "dashboard" : "plants"}>
      <section className="intro">
        <div>
          <h2>{dashboard ? t("dashboard.attention", "Needs attention") : t("dashboard.collection", "Plant collection")}</h2>
          <p>
            {dashboard
              ? t("dashboard.attentionHelp", "A focused overview of plants that need care, watching, or a sensor fix.")
              : t("dashboard.collectionHelp", "Your full inventory: search, add, edit, inspect, or archive every plant.")}
          </p>
        </div>
        {dashboard ? (
          <a className="secondary-button collection-link" href="#plants">
            {t("dashboard.manage", "Manage all plants")}
          </a>
        ) : (
          <button className="primary-button" type="button" onClick={onAdd}>
            <Plus size={17} />
            {t("dashboard.add", "Add plant")}
          </button>
        )}
      </section>
      {dashboard && (
        <section className="summary-grid" aria-label={t("dashboard.summary", "Plant summary")}>
          <button
            className="summary-card summary-card--all"
            type="button"
            onClick={() => openCollection("all")}
          >
            <span className="summary-card__icon">
              <Sprout size={20} />
            </span>
            <span>
              <strong>{counts.total}</strong>
              <small>{t("dashboard.total", "Total plants")}</small>
            </span>
          </button>
          <button
            className="summary-card summary-card--action"
            type="button"
            onClick={() => openCollection("action_needed")}
          >
            <span className="summary-card__icon">
              <DropletGlyph />
            </span>
            <span>
              <strong>{counts.action_needed}</strong>
              <small>{t("dashboard.actionNeeded", "Action needed")}</small>
            </span>
          </button>
          <button
            className="summary-card summary-card--overdue"
            type="button"
            onClick={() => openCollection("overdue")}
          >
            <span className="summary-card__icon">
              <TriangleAlert size={20} />
            </span>
            <span>
              <strong>{counts.overdue}</strong>
              <small>{t("dashboard.overdue", "Overdue")}</small>
            </span>
          </button>
          <button
            className="summary-card summary-card--sensor"
            type="button"
            onClick={() => openCollection("sensor_issue")}
          >
            <span className="summary-card__icon">
              <SlidersHorizontal size={20} />
            </span>
            <span>
              <strong>{counts.sensor_issues}</strong>
              <small>{t("dashboard.sensorIssues", "Sensor issues")}</small>
            </span>
          </button>
        </section>
      )}
      {!dashboard && (
        <PlantToolbar
          query={query}
          statusFilter={statusFilter}
          sort={sort}
          onQuery={onQuery}
          onStatus={onStatus}
          onSort={onSort}
        />
      )}
      {error ? (
        <section className="error-state" role="alert">
          <TriangleAlert />
          <h2>{t("connection.disconnected", "Dashboard disconnected")}</h2>
          <p>{t("dashboard.disconnectedHelp", "{{error}} Home Assistant monitoring continues independently.", { error })}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {t("common.tryAgain", "Try again")}
          </button>
        </section>
      ) : !data ? (
        <LoadingGrid />
      ) : plants.length === 0 ? (
        dashboard ? (
          <section className="empty-state">
            <Check />
            <h2>{t("dashboard.steady", "Everything looks steady")}</h2>
            <p>{t("dashboard.steadyHelp", "No plant needs attention right now. The full collection remains available under All plants.")}</p>
            <a className="secondary-button" href="#plants">
              {t("dashboard.openCollection", "Open full collection")}
            </a>
          </section>
        ) : (
          <section className="empty-state">
            <Leaf />
            <h2>{t("dashboard.noMatch", "No plants match")}</h2>
            <p>{t("dashboard.noMatchHelp", "Clear a filter or search to see the rest of the household collection.")}</p>
            <button
              type="button"
              onClick={() => {
                onQuery("");
                onStatus("all");
              }}
            >
              {t("dashboard.clearFilters", "Clear filters")}
            </button>
          </section>
        )
      ) : (
        <div className="plant-grid">
          {plants.map((plant) => (
            <PlantCard plant={plant} key={plant.id} onDetails={onDetails} />
          ))}
        </div>
      )}
      {dashboard && data && (
        <a className="view-all-link" href="#plants">
          {t("dashboard.openCount", "Open the full collection ({{count}})", { count: data.plants.length })}
        </a>
      )}
    </div>
  );
}

function PlantToolbar({
  query,
  statusFilter,
  sort,
  onQuery,
  onStatus,
  onSort,
}: {
  query: string;
  statusFilter: PlantState | "all";
  sort: SortKey;
  onQuery: (value: string) => void;
  onStatus: (value: PlantState | "all") => void;
  onSort: (value: SortKey) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="toolbar" aria-label={t("filters.label", "Plant filters")}>
      <label className="search-field">
        <Search size={18} />
        <span className="sr-only">{t("filters.search", "Search plants")}</span>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("filters.placeholder", "Search plants, rooms, species…")}
        />
      </label>
      <div className="toolbar__right">
        <label className="select-field">
          <SlidersHorizontal size={16} />
          <span className="sr-only">{t("filters.status", "Status filter")}</span>
          <select
            value={statusFilter}
            onChange={(event) =>
              onStatus(event.target.value as PlantState | "all")
            }
          >
            <option value="all">{t("filters.all", "All statuses")}</option>
            <option value="good">{t("filters.good", "Good")}</option>
            <option value="watch">{t("filters.watch", "Watch")}</option>
            <option value="action_needed">{t("filters.action", "Action needed")}</option>
            <option value="overdue">{t("filters.overdue", "Overdue")}</option>
            <option value="sensor_issue">{t("filters.sensor", "Sensor issue")}</option>
          </select>
        </label>
        <label className="select-field">
          <span>{t("filters.sort", "Sort:")}</span>
          <select
            value={sort}
            onChange={(event) => onSort(event.target.value as SortKey)}
          >
            <option value="urgency">{t("filters.urgency", "Urgency")}</option>
            <option value="name">{t("filters.name", "Name")}</option>
            <option value="moisture">{t("filters.moisture", "Moisture")}</option>
            <option value="temperature">{t("filters.temperature", "Temperature")}</option>
            <option value="last_update">{t("filters.updated", "Last update")}</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function ActionQueue({
  actions,
  history,
  plants,
  error,
  saving,
  snoozeHours,
  onSnoozeHours,
  onMutate,
}: {
  actions: CareAction[];
  history: ActionHistoryEvent[];
  plants: Plant[];
  error: string | null;
  saving: string | null;
  snoozeHours: Record<string, number>;
  onSnoozeHours: (id: string, hours: number) => void;
  onMutate: (
    action: CareAction,
    operation: "complete" | "snooze" | "undo",
  ) => void;
}) {
  const plantNames = Object.fromEntries(
    plants.map((plant) => [plant.id, plant.display_name]),
  );
  const open = actions.filter((action) => action.status === "open");
  const snoozed = actions.filter((action) => action.status === "snoozed");
  const completed = actions.filter((action) => action.status === "completed");
  return (
    <div className="content page-view">
      <section className="intro">
        <div>
          <h2>Shared household actions</h2>
          <p>
            Mark an item done or snooze it here; every change is recorded below.
          </p>
        </div>
        <span className="queue-count">
          {open.length + snoozed.length} active
        </span>
      </section>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <ActionSection
        title="Open"
        actions={open}
        empty="Nothing needs attention right now."
        plantNames={plantNames}
        saving={saving}
        snoozeHours={snoozeHours}
        onSnoozeHours={onSnoozeHours}
        onMutate={onMutate}
      />
      <ActionSection
        title="Snoozed"
        actions={snoozed}
        empty="No snoozed actions."
        plantNames={plantNames}
        saving={saving}
        snoozeHours={snoozeHours}
        onSnoozeHours={onSnoozeHours}
        onMutate={onMutate}
      />
      <ActionSection
        title="Recently completed"
        actions={completed}
        empty="Completed actions will appear here."
        plantNames={plantNames}
        saving={saving}
        snoozeHours={snoozeHours}
        onSnoozeHours={onSnoozeHours}
        onMutate={onMutate}
      />
      <ActionHistory
        history={history}
        actions={actions}
        plantNames={plantNames}
      />
    </div>
  );
}

function ActionSection({
  title,
  actions,
  empty,
  plantNames,
  saving,
  snoozeHours,
  onSnoozeHours,
  onMutate,
}: {
  title: string;
  actions: CareAction[];
  empty: string;
  plantNames: Record<string, string>;
  saving: string | null;
  snoozeHours: Record<string, number>;
  onSnoozeHours: (id: string, hours: number) => void;
  onMutate: (
    action: CareAction,
    operation: "complete" | "snooze" | "undo",
  ) => void;
}) {
  return (
    <section className="action-section">
      <div className="section-title">
        <h3>{title}</h3>
        <span>{actions.length}</span>
      </div>
      {actions.length === 0 ? (
        <p className="section-empty">{empty}</p>
      ) : (
        <div className="action-list">
          {actions.map((action) => {
            const sensorManaged = autoManagedActionTypes.has(action.type);
            const aiRecommended = action.type === "ai_recommendation";
            return (
              <article
                className={`action-card action-card--${action.status}`}
                key={action.id}
              >
                <div className="action-card__priority">P{action.priority}</div>
                <div className="action-card__copy">
                  <span>
                    {plantNames[action.plant_id] ?? "Unknown plant"}
                    {aiRecommended && (
                      <em className="ai-recommendation-badge">
                        AI recommendation
                      </em>
                    )}
                  </span>
                  <h4>{action.title}</h4>
                  <p>{action.observation}</p>
                  <strong>{action.recommendation}</strong>
                  {sensorManaged && action.status !== "completed" && (
                    <small className="automatic-note">
                      Monitoring-managed: closes automatically when the condition
                      recovers.
                    </small>
                  )}
                  {action.status === "snoozed" && (
                    <small>
                      <Clock3 size={13} />
                      Snoozed until {formatDateTime(action.snoozed_until)}
                    </small>
                  )}
                  {action.status === "completed" && (
                    <small>
                      <Check size={13} />
                      Completed by {action.completed_by ?? "Household"} ·{" "}
                      {formatDateTime(action.completed_at)}
                    </small>
                  )}
                </div>
                <div className="action-card__controls">
                  {action.status === "completed" ? (
                    <button
                      type="button"
                      disabled={saving === action.id}
                      onClick={() => onMutate(action, "undo")}
                    >
                      Undo
                    </button>
                  ) : (
                    <>
                      <label>
                        <span className="sr-only">
                          Snooze duration for {action.title}
                        </span>
                        <select
                          aria-label={`Snooze duration for ${action.title}`}
                          value={snoozeHours[action.id] ?? 24}
                          onChange={(event) =>
                            onSnoozeHours(action.id, Number(event.target.value))
                          }
                        >
                          <option value={6}>6 hours</option>
                          <option value={24}>24 hours</option>
                          <option value={72}>3 days</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={saving === action.id}
                        onClick={() => onMutate(action, "snooze")}
                      >
                        Snooze
                      </button>
                      {!sensorManaged && (
                        <button
                          className="complete-button"
                          type="button"
                          disabled={saving === action.id}
                          onClick={() => onMutate(action, "complete")}
                        >
                          <Check size={15} />
                          Mark done
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ActionHistory({
  history,
  actions,
  plantNames,
}: {
  history: ActionHistoryEvent[];
  actions: CareAction[];
  plantNames: Record<string, string>;
}) {
  const actionById = Object.fromEntries(
    actions.map((action) => [action.id, action]),
  );
  const labels: Record<ActionHistoryEvent["event_type"], string> = {
    action_completed: "Marked done manually",
    action_auto_completed: "Completed automatically after recovery",
    action_snoozed: "Snoozed",
    action_reopened: "Reopened",
    ai_recommendation_created: "AI recommendation added",
    sensor_issue_created: "Sensor warning created",
    care_rule_action_created: "Monitoring action created",
  };
  return (
    <section className="action-section history-section">
      <div className="section-title">
        <h3>Action history</h3>
        <span>{history.length}</span>
      </div>
      {history.length === 0 ? (
        <p className="section-empty">
          History appears after an action is snoozed, completed, or reopened.
        </p>
      ) : (
        <div className="history-list">
          {history.map((event) => {
            const action = actionById[event.action_id];
            return (
              <article key={event.id}>
                <span
                  className={`history-icon history-icon--${event.event_type}`}
                >
                  <Check size={14} />
                </span>
                <div>
                  <strong>
                    {labels[event.event_type] ?? event.event_type}
                  </strong>
                  <p>
                    {action?.title ?? "Care action"}
                    {action
                      ? ` · ${plantNames[action.plant_id] ?? "Unknown plant"}`
                      : ""}
                  </p>
                </div>
                <small>
                  {event.actor} · {formatDateTime(event.occurred_at)}
                </small>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SettingsView({
  appearance,
  onAppearance,
  health,
  compactCards,
  onCompactCards,
  onSaved,
}: {
  appearance: Appearance;
  onAppearance: (value: Appearance) => void;
  health: HealthResponse | null;
  compactCards: boolean;
  onCompactCards: (value: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const notificationReady = health?.home_assistant_notifications_enabled;
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<string | null>(null);
  async function verify() {
    setVerifying(true);
    setVerification(null);
    try {
      const result = await verifyGeminiSetup();
      setVerification(`${result.ok ? "Connection verified" : "Not verified"} (${result.model}): ${result.message}`);
    } catch (reason) {
      setVerification(reason instanceof Error ? reason.message : "Verification could not complete. Please retry.");
    } finally {
      setVerifying(false);
    }
  }
  return (
    <div className="content page-view">
      <section className="intro">
        <div>
          <h2>Portal preferences</h2>
          <p>
            Display preferences stay in this browser; sensor monitoring is
            configured in the Home Assistant app settings.
          </p>
        </div>
      </section>
      <div className="settings-grid">
        <section className="settings-card">
          <h3>Display</h3>
          <fieldset className="appearance-picker">
            <legend>{t("appearance.title", "Appearance")}</legend>
            <div>
              {(["system", "light", "dark"] as const).map((value) => (
                <label key={value}>
                  <input type="radio" name="appearance" value={value}
                    checked={appearance === value}
                    onChange={() => onAppearance(value)} />
                  <span>{t(`appearance.${value}`, value === "system" ? "System" : value === "light" ? "Light" : "Dark")}</span>
                </label>
              ))}
            </div>
            <p>{t("appearance.note", "Applies immediately. Remembered on this device.")}</p>
          </fieldset>
          <label className="switch-row">
            <span>
              <strong>Compact plant cards</strong>
              <small>Show more plants at once.</small>
            </span>
            <input
              type="checkbox"
              checked={compactCards}
              onChange={(event) => onCompactCards(event.target.checked)}
            />
          </label>
        </section>
        <section className="settings-card">
          <h3>Sensor monitoring</h3>
          <div className="integration-status">
            <span className="connection-dot" />
            <div>
              <strong>
                {health?.stale_sensor_hours ?? 72}-hour unchanged-value check
              </strong>
              <small>
                Moisture, temperature, and illuminance are checked. Battery is
                excluded to avoid false alarms.
              </small>
            </div>
          </div>
        </section>
        <section className="settings-card settings-card--wide">
          <h3>Home Assistant notifications</h3>
          <div className="integration-status">
            <span
              className={`connection-dot ${notificationReady ? "" : "connection-dot--inactive"}`}
            />
            <div>
              <strong>
                {notificationReady
                  ? "Care notifications enabled"
                  : health?.simulator
                    ? "Disabled in the local simulator"
                    : "Disabled in app configuration"}
              </strong>
              <small>
                Care alerts follow the existing plant monitoring rules. When a
                condition recovers, PlantCare asks Home Assistant to clear its
                alert; phone restrictions may delay removal.
              </small>
            </div>
          </div>
          <NotificationSettings enabled={Boolean(notificationReady)} />
        </section>
        <section className="settings-card settings-card--wide">
          <h3>Home Assistant integration</h3>
          <div className="integration-status">
            <span className="connection-dot" />
            <div>
              <strong>Entity mapping ready</strong>
              <small>
                Open a plant’s Details window and choose Manage sensor mapping.
                Simulator entities are used locally; ingress loads live Home
                Assistant sensors.
              </small>
            </div>
          </div>
        </section>
        <section className="settings-card settings-card--wide">
          <h3>Plant Doctor</h3>
          <div className="integration-status">
            <span
              className={`connection-dot ${health?.plant_doctor_configured ? "" : "connection-dot--inactive"}`}
            />
            <div>
              <strong>
                {health?.plant_doctor_configured
                  ? "AI provider configured"
                  : "AI provider not configured"}
              </strong>
              <small>
                Choose Gemini or Cloudflare in the Home Assistant add-on configuration.
                Save and restart PlantCare after changing credentials.
                Credentials are read by the app backend only. Diagnostic photos
                are sent only after consent for each check.
              </small>
            </div>
          </div>
          <p>Check the saved Gemini key and model without sending a photo or generating an assessment. This checks Gemini only, not Cloudflare fallback.</p>
          <button className="secondary-button" type="button" disabled={verifying} onClick={() => void verify()}>
            {verifying ? "Verifying…" : "Verify Gemini setup"}
          </button>
          {verification && <p role="status">{verification}</p>}
        </section>
      </div>
      <button
        className="primary-button settings-save"
        type="button"
        onClick={onSaved}
      >
        Save display preferences
      </button>
    </div>
  );
}

function HelpView({
  health,
  onRefresh,
}: {
  health: HealthResponse | null;
  onRefresh: () => void;
}) {
  useEffect(() => {
    if (!health) void onRefresh();
  }, [health, onRefresh]);
  return (
    <div className="content page-view">
      <section className="intro">
        <div>
          <h2>Diagnostics</h2>
          <p>
            Live checks for the local API, database, sensor monitor, and
            notification delivery.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </section>
      <section className="diagnostic-card">
        <div>
          <span
            className={`health-indicator ${health?.status === "ready" ? "is-ready" : ""}`}
          />
          <div>
            <h3>
              {health?.status === "ready"
                ? "Portal is ready"
                : "Checking portal…"}
            </h3>
            <p>
              API and database status from <code>/api/v1/health</code>.
            </p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>{health?.version ?? "—"}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>{health?.database ?? "—"}</dd>
          </div>
          <div>
            <dt>Simulator</dt>
            <dd>{health?.simulator ? "Enabled" : "Disabled"}</dd>
          </div>
          <div>
            <dt>Plant Doctor</dt>
            <dd>
              {health?.plant_doctor_configured
                ? "Configured"
                : "Not configured"}
            </dd>
          </div>
          <div>
            <dt>Sensor timeout</dt>
            <dd>{health ? `${health.stale_sensor_hours} hours` : "—"}</dd>
          </div>
          <div>
            <dt>HA notifications</dt>
            <dd>
              {health?.home_assistant_notifications_enabled
                ? "Enabled"
                : "Disabled"}
            </dd>
          </div>
        </dl>
      </section>
      <section className="settings-card help-card">
        <h3>What can be tested now?</h3>
        <ul>
          <li>Dashboard filtering, sorting, and status summaries</li>
          <li>
            Plant details, sensor-first creation, and local private photos
          </li>
          <li>
            Consent-based Plant Doctor checks when Cloudflare is configured
          </li>
          <li>Persistent care-action snooze, completion, and undo</li>
          <li>Home Assistant sensor warnings with plant deep links</li>
          <li>Responsive navigation and shared-password login</li>
        </ul>
      </section>
    </div>
  );
}

function NotificationsMenu({
  actions,
  onClose,
}: {
  actions: CareAction[];
  onClose: () => void;
}) {
  return (
    <div
      className="popover notification-popover"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="popover__head">
        <strong>Needs attention</strong>
        <button
          type="button"
          aria-label="Close notifications"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      {actions.slice(0, 3).map((action) => (
        <a
          className="notification-item"
          href={`#plants/${encodeURIComponent(action.plant_id)}`}
          onClick={onClose}
          key={action.id}
        >
          <span />
          <div>
            <strong>{action.title}</strong>
            <small>{action.recommendation}</small>
          </div>
        </a>
      ))}
      {actions.length === 0 && <p>All clear.</p>}
      <a href="#actions" onClick={onClose}>
        Open care queue
      </a>
    </div>
  );
}

function ProfileMenu({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="popover profile-popover"
      role="dialog"
      aria-label="Profile menu"
    >
      <strong>Home Assistant user</strong>
      <span>Authenticated household member</span>
      <a href="#settings" onClick={onClose}>
        Portal settings
      </a>
      <a href="#help" onClick={onClose}>
        Diagnostics
      </a>
    </div>
  );
}

function PlantTipsSection({ plant, visit }: { plant: Plant; visit: number }) {
  const collection = plantTipCollection(plant);
  const [tipIndex, setTipIndex] = useState(visit % collection.tips.length);
  const [showAll, setShowAll] = useState(false);
  const featured = collection.tips[tipIndex] ?? collection.tips[0]!;

  function shuffleTip() {
    setTipIndex((current) => {
      const offset =
        1 + Math.floor(Math.random() * (collection.tips.length - 1));
      return (current + offset) % collection.tips.length;
    });
  }

  return (
    <section className="detail-tips" aria-labelledby="plant-tips-title">
      <div className="detail-tips__heading">
        <div>
          <span className="eyebrow">GROW WITH CONFIDENCE</span>
          <h3 id="plant-tips-title">Tips for {plant.display_name}</h3>
          <p>
            {collection.label}
            {collection.fallback
              ? " · identify the species for tailored tips"
              : ""}
          </p>
        </div>
        <button
          className="tip-shuffle"
          type="button"
          onClick={shuffleTip}
          aria-label={`Shuffle care tip for ${plant.display_name}`}
        >
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
        {showAll
          ? "Hide all tips"
          : `Show all tips (${collection.tips.length})`}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {showAll && (
        <div className="all-tips" id={`all-tips-${plant.id}`}>
          {collection.tips.map((tip) => (
            <article key={tip.title}>
              <span>{tip.category}</span>
              <div>
                <h4>{tip.title}</h4>
                <p>{tip.body}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PlantDetailDialog({
  plant,
  tipVisit,
  actions,
  onClose,
  onEdit,
  onMapping,
  onDoctor,
  onMarkDone,
  onSimulateWatering,
}: {
  plant: Plant;
  tipVisit: number;
  actions: CareAction[];
  onClose: () => void;
  onEdit: () => void;
  onMapping: () => void;
  onDoctor: () => void;
  onMarkDone: (action: CareAction) => void;
  onSimulateWatering: () => void;
}) {
  const { locale, t } = useI18n();
  const image = plantImage(plant);
  const openActions = actions.filter((action) => action.status !== "completed");
  const wateringActions = openActions.filter(
    (action) => action.type === "low_moisture",
  );
  const hasWateringAction = wateringActions.length > 0;
  const otherActions = openActions.filter((action) => action.type !== "low_moisture");
  const detailPhoto = image && (
    <figure className={`detail-photo ${hasWateringAction ? "detail-photo--after-care" : ""}`}>
      <img src={image.src} alt={image.alt} />
      <figcaption>{image.credit}</figcaption>
    </figure>
  );
  const mappedSensors = plant.entity_mapping
    ? Object.values(plant.entity_mapping).filter(Boolean).length
    : 0;
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="dialog plant-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plant-dialog-title"
      >
        <button
          className="dialog__close"
          type="button"
          aria-label={t("plant.closeDetails", "Close plant details")}
          onClick={onClose}
        >
          <X />
        </button>
        {!hasWateringAction && detailPhoto}
        <span className={`status-pill status-pill--${plant.state}`}>
          {plantStatusLabel(plant, locale)}
        </span>
        <p className="eyebrow">
          {plant.location}
          {plant.specific_position
            ? ` · ${plant.specific_position}`
            : ""} · {plant.environment_type.replaceAll("_", " ")}
        </p>
        <h2 id="plant-dialog-title">{plant.display_name}</h2>
        <p className="dialog-subtitle">
          {plant.common_name}
          {plant.scientific_name ? ` · ${plant.scientific_name}` : ""}
        </p>
        {hasWateringAction && (
          <section className="watering-guide" aria-labelledby="watering-guide-title">
            <div className="watering-guide__heading">
              <Droplets size={24} aria-hidden="true" />
              <h3 id="watering-guide-title">{t("plant.howToWater", "How to water this plant")}</h3>
            </div>
            {wateringActions.map((action) => (
              <p className="watering-guide__instructions" key={action.id}>{action.recommendation}</p>
            ))}
            <small>{t("plant.monitoringManaged", "Monitoring-managed: closes automatically when the condition recovers.")}</small>
            <button className="simulate-button" type="button" onClick={onSimulateWatering}>
              {t("plant.simulateWatering", "Simulate confirmed watering")}
            </button>
          </section>
        )}
        {hasWateringAction && detailPhoto}
        <div className="mapping-banner">
          <div>
            <strong>{t("plant.haSensors", "Home Assistant sensors")}</strong>
            <small>
              {mappedSensors === 0
                ? t("plant.noneMapped", "No entities mapped")
                : t("plant.mappedCount", "{{count}} of 4 entities mapped", { count: mappedSensors })}
            </small>
          </div>
          <button type="button" onClick={onMapping}>
            {t("plant.manageMapping", "Manage sensor mapping")}
          </button>
        </div>
        <div className="detail-readings">
          <div>
            <span>{t("plant.moisture", "Moisture")}</span>
            <strong>
              {plant.moisture === null ? t("plant.noReading", "No reading") : `${plant.moisture}%`}
            </strong>
            <small>{plant.moisture_status}</small>
          </div>
          <div>
            <span>{t("plant.temperature", "Temperature")}</span>
            <strong>
              {plant.temperature === null
                ? t("plant.noReading", "No reading")
                : `${plant.temperature.toFixed(1)}°C`}
            </strong>
            <small>{plant.temperature_status}</small>
          </div>
          <div>
            <span>{t("plant.battery", "Battery")}</span>
            <strong>
              {plant.battery === null ? t("plant.noReading", "No reading") : `${plant.battery}%`}
            </strong>
            <small>{t("plant.sensorPower", "Sensor power")}</small>
          </div>
          <div>
            <span>{t("plant.illuminance", "Illuminance")}</span>
            <strong>
              {plant.illuminance === null
                ? t("plant.notMapped", "Not mapped")
                : `${plant.illuminance} lx`}
            </strong>
            <small>{t("plant.optionalReading", "Optional reading")}</small>
          </div>
        </div>
        <PlantTipsSection plant={plant} visit={tipVisit} />
        {(otherActions.length > 0 || !hasWateringAction || plant.drying_note) && <section className="detail-actions">
          <h3>{t("plant.careActions", "Care actions")}</h3>
          {plant.drying_note && <p className="drying-note">{plant.drying_note}</p>}
          {otherActions.map((action) => {
            const sensorManaged = autoManagedActionTypes.has(action.type);
            return (
              <div className="detail-action-row" key={action.id}>
                <div>
                  {action.type === "ai_recommendation" && (
                    <span className="ai-recommendation-badge">
                      {t("plant.aiRecommendation", "AI recommendation")}
                    </span>
                  )}
                  <strong>{action.title}</strong>
                  <p>{action.recommendation}</p>
                  {sensorManaged && (
                    <small>
                      {t("plant.monitoringManaged", "Monitoring-managed: closes automatically when the condition recovers.")}
                    </small>
                  )}
                </div>
                {!sensorManaged && (
                  <button type="button" onClick={() => onMarkDone(action)}>
                    {t("plant.markDone", "Mark done")}
                  </button>
                )}
              </div>
            );
          })}
          {openActions.length === 0 && <p>{t("plant.noOpenActions", "No open actions for this plant.")}</p>}
        </section>}
        <div className="dialog__footer">
          <button className="secondary-button" type="button" onClick={onEdit}>
            {t("plant.edit", "Edit plant")}
          </button>
          <button className="secondary-button" type="button" onClick={onDoctor}>
            {t("plant.doctor", "Plant doctor")}
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            {t("common.done", "Done")}
          </button>
        </div>
      </section>
    </div>
  );
}

function EntityMappingDialog({
  plant,
  onClose,
  onSave,
}: {
  plant: Plant;
  onClose: () => void;
  onSave: (plant: Plant, mapping: PlantEntityMapping) => Promise<void>;
}) {
  const emptyMapping: PlantEntityMapping = {
    moisture_entity_id: null,
    temperature_entity_id: null,
    battery_entity_id: null,
    illuminance_entity_id: null,
  };
  const [mapping, setMapping] = useState<PlantEntityMapping>(
    plant.entity_mapping ?? emptyMapping,
  );
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getHomeAssistantEntities(controller.signal)
      .then((response) => {
        setEntities(response.entities);
        setSource(response.source);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setMessage(
            reason instanceof Error
              ? reason.message
              : "Entities could not be loaded.",
          );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave(plant, mapping);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "The mapping could not be saved.",
      );
      setSaving(false);
    }
  }
  const optionsFor = (deviceClasses: string[]) =>
    entities.filter(
      (entity) =>
        entity.device_class && deviceClasses.includes(entity.device_class),
    );
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="dialog mapping-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mapping-dialog-title"
      >
        <button
          className="dialog__close"
          type="button"
          aria-label="Close sensor mapping"
          onClick={onClose}
        >
          <X />
        </button>
        <p className="eyebrow">HOME ASSISTANT ENTITIES</p>
        <h2 id="mapping-dialog-title">Map sensors for {plant.display_name}</h2>
        <p className="dialog-subtitle">
          PlantCare keeps the plant and its history if an entity is changed or
          removed. Unavailable entities produce a sensor warning; they never
          delete the plant.
        </p>
        {source && (
          <span className="source-badge">
            {source === "simulator"
              ? "Simulator entity catalog"
              : "Live Home Assistant entities"}
          </span>
        )}
        {loading ? (
          <p className="mapping-loading">Loading sensor entities…</p>
        ) : (
          <form className="mapping-form" onSubmit={submit}>
            <EntitySelect
              label="Soil moisture"
              value={mapping.moisture_entity_id}
              entities={optionsFor(["moisture", "humidity"])}
              onChange={(value) =>
                setMapping({ ...mapping, moisture_entity_id: value })
              }
            />
            <EntitySelect
              label="Temperature"
              value={mapping.temperature_entity_id}
              entities={optionsFor(["temperature"])}
              onChange={(value) =>
                setMapping({ ...mapping, temperature_entity_id: value })
              }
            />
            <EntitySelect
              label="Battery"
              value={mapping.battery_entity_id}
              entities={optionsFor(["battery"])}
              onChange={(value) =>
                setMapping({ ...mapping, battery_entity_id: value })
              }
            />
            <EntitySelect
              label="Illuminance"
              value={mapping.illuminance_entity_id}
              entities={optionsFor(["illuminance"])}
              onChange={(value) =>
                setMapping({ ...mapping, illuminance_entity_id: value })
              }
            />
            {message && (
              <p className="inline-error" role="alert">
                {message}
              </p>
            )}
            <div className="dialog__footer">
              <button
                className="secondary-button"
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save mapping"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function EntitySelect({
  label,
  value,
  entities,
  onChange,
  required = false,
}: {
  label: string;
  value: string | null;
  entities: HomeAssistantEntity[];
  onChange: (value: string | null) => void;
  required?: boolean;
}) {
  const currentMissing =
    value && !entities.some((entity) => entity.entity_id === value);
  return (
    <label>
      {label}
      {required ? " *" : ""}
      <select
        required={required}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Not mapped</option>
        {currentMissing && (
          <option value={value ?? ""}>{value} (currently unavailable)</option>
        )}
        {entities.map((entity) => (
          <option value={entity.entity_id} key={entity.entity_id}>
            {entity.name} — {entity.state}
            {entity.unit ? ` ${entity.unit}` : ""}
            {entity.area_name ? ` · ${entity.area_name}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function AreaSelect({
  value,
  areas,
  onChange,
}: {
  value: string;
  areas: string[];
  onChange: (value: string) => void;
}) {
  const options = areas.includes(value) || !value ? areas : [value, ...areas];
  return (
    <label>
      Home Assistant area
      <select
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {areas.length
            ? "Select a Home Assistant area"
            : "No Home Assistant areas found"}
        </option>
        {options.map((area) => (
          <option value={area} key={area}>
            {area}
          </option>
        ))}
      </select>
    </label>
  );
}

function entityHasReading(entity: HomeAssistantEntity): boolean {
  return !["", "unknown", "unavailable", "none", "null"].includes(
    entity.state.trim().toLowerCase(),
  );
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
  onAddAction: (
    plant: Plant,
    recommendation: string,
    visitId: string | null,
  ) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [consent, setConsent] = useState(false);
  const [symptoms, setSymptoms] = useState("");
  const [fallbackConsent, setFallbackConsent] = useState(false);
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
  const diagnosticPhotoInputRef = useRef<HTMLInputElement>(null);
  const doctorDialogRef = useRef<HTMLElement>(null);
  const photoPreview = usePhotoPreview(photoFile);

  useEffect(() => {
    if (doctorDialogRef.current) doctorDialogRef.current.scrollTop = 0;
  }, [result]);

  useEffect(() => {
    const controller = new AbortController();
    void getPlantDoctorUsage(controller.signal)
      .then(setUsage)
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage("Could not load the AI provider details. Close and reopen Plant Doctor to retry; no photo has been sent.");
      });
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
    if (!consent || !photoFile || !usage || usage.configured === false) return;
    setChecking(true);
    setMessage(null);
    try {
      setResult(await diagnosePlant(plant.id, photoFile, symptoms, fallbackConsent, locale));
      setActionAdded(false);
      setActionDeclined(false);
      await refreshDoctorData();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Plant Doctor could not complete the check.",
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
        reason instanceof Error
          ? reason.message
          : "The AI recommendation could not be added.",
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
      await updatePlantDoctorFeedback(plant.id, result.visit_id, {
        decision: "declined",
      });
      setActionDeclined(true);
      await refreshDoctorData();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "The decision could not be saved.",
      );
    } finally {
      setSavingFeedback(null);
    }
  }

  async function recordOutcome(
    visit: PlantDoctorVisit,
    outcome: PlantDoctorOutcome,
  ) {
    setSavingFeedback(visit.id);
    setMessage(null);
    try {
      const updated = await updatePlantDoctorFeedback(plant.id, visit.id, {
        outcome,
      });
      setHistory((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "The outcome could not be saved.",
      );
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
        ref={doctorDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-dialog-title"
      >
        <button
          className="dialog__close"
          type="button"
          aria-label={t("doctor.closeA11y", "Close plant doctor")}
          onClick={onClose}
        >
          <X />
        </button>
        <p className="eyebrow">{t("doctor.eyebrow", "PLANT DOCTOR · {{provider}}", { provider: usage?.provider ?? t("doctor.aiAssessment", "AI assessment") })}</p>
        <h2 id="doctor-dialog-title">{t("doctor.checkPlant", "Check {{name}}", { name: plant.display_name })}</h2>
        {result ? (
          <DoctorResult result={result} photo={photoPreview} plant={plant} />
        ) : (
          <>
            <p className="dialog-subtitle">{t("doctor.intro", "Choose or take a current diagnostic photo. Your cover photo stays unchanged. The selected photo, latest sensor values, a compact seven-day soil-moisture summary, and up to five recent Doctor summaries, decisions, outcomes, and your notes will be sent to {{provider}} for this check.", { provider: usage?.provider ?? t("doctor.configuredProvider", "your configured provider") })}</p>
            {photoPreview ? (
              <div className="doctor-photo-selection">
                <img
                  className="doctor-photo"
                  src={photoPreview}
                  alt={t("doctor.photoAlt", "Photo to diagnose for {{name}}", { name: plant.display_name })}
                />
                <button
                  className="photo-picker doctor-photo-replace"
                  type="button"
                  onClick={() => diagnosticPhotoInputRef.current?.click()}
                >
                  <ImagePlus size={17} />
                  <span>
                    <strong>{t("doctor.chooseDifferent", "Choose a different photo")}</strong>
                    <small>{t("doctor.formats", "JPEG, PNG, WebP, HEIC/HEIF, or AVIF · maximum 10 MB")}</small>
                  </span>
                </button>
                <input
                  ref={diagnosticPhotoInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.jpg,.jpeg,.heic,.heif,.avif,.mpo"
                  onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                />
              </div>
            ) : (
              <div className="doctor-empty">
                <Camera />
                <h3>{t("doctor.chooseCurrent", "Choose a current diagnostic photo")}</h3>
                <p>{t("doctor.iphoneHelp", "On iPhone you can take a new picture or select one from your photo library.")}</p>
                <label className="photo-picker doctor-photo-picker">
                  <ImagePlus size={18} />
                  <span>
                    <strong>{t("doctor.takeOrChoose", "Take or choose a photo")}</strong>
                    <small>{t("doctor.coverUnchanged", "It will not replace the plant's cover photo")}</small>
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.jpg,.jpeg,.heic,.heif,.avif,.mpo"
                    onChange={(event) =>
                      setPhotoFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
              </div>
            )}
            <label className="doctor-symptoms">
              <strong>{t("doctor.whatChanged", "What changed?")} <small>{t("common.optional", "Optional")}</small></strong>
              <textarea
                value={symptoms}
                onChange={(event) => setSymptoms(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder={t("doctor.symptomsPlaceholder", "For example: wilted in the last 24 hours; watered yesterday; recently moved into sun.")}
              />
            </label>
            <DoctorUsage usage={usage} />
            {usage?.provider === "Google Gemini" && (
              <p className="doctor-note">{t("doctor.geminiNotice", "Google's free API tier may use submitted content to improve its products. Review your Google AI Studio data settings before sending.")}</p>
            )}
            {usage?.fallback_available && (
              <label className="consent-row">
                <input type="checkbox" checked={fallbackConsent}
                  onChange={(event) => setFallbackConsent(event.target.checked)} />
                {t("doctor.fallbackConsent", "Also allow Cloudflare to receive this photo and context if Gemini cannot complete the check.")}
              </label>
            )}
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              {t("doctor.consent", "I agree to send this photo, my notes, and limited plant context to {{provider}} for one assessment.", { provider: usage?.provider ?? t("doctor.consentProvider", "the configured AI provider") })}
            </label>
            <p className="doctor-note">{t("doctor.privacy", "PlantCare does not store this diagnostic photo or replace the cover image. Results are saved locally as patient history; you decide whether to add the recommendation to the care queue and whether it helped.")}</p>
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
            {t("common.close", "Close")}
          </button>
          {!result && (
            <button
              className="primary-button"
              type="button"
              disabled={!photoFile || !consent || checking || !usage || usage.configured === false}
              onClick={check}
            >
              {checking ? t("doctor.checking", "Checking…") : t("doctor.send", "Send for diagnosis")}
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
                  setFallbackConsent(false);
                  setActionAdded(false);
                  setActionDeclined(false);
                }}
              >
                {t("doctor.checkAgain", "Check again")}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={
                  !result.visit_id ||
                  actionAdded ||
                  actionDeclined ||
                  savingFeedback !== null
                }
                onClick={declineAction}
              >
                {actionDeclined ? t("doctor.notAdded", "Not added") : t("doctor.dontAdd", "Don't add")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={addingAction || actionAdded || actionDeclined || result.identity_status === "mismatch" || result.next_steps.length === 0}
                onClick={addAction}
              >
                {actionAdded
                  ? t("doctor.added", "Added to care queue")
                  : addingAction
                    ? t("doctor.adding", "Adding…")
                    : t("doctor.addRecommendation", "Add AI recommendation")}
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
  onOutcome: (
    visit: PlantDoctorVisit,
    outcome: PlantDoctorOutcome,
  ) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const outcomeLabels: Record<PlantDoctorOutcome, string> = {
    not_tried: t("doctor.notTried", "Not tried"),
    helped: t("doctor.helped", "Helped"),
    did_not_help: t("doctor.didNotHelp", "Didn't help"),
    not_sure: t("doctor.notSure", "Not sure"),
  };
  return (
    <section className="doctor-history" aria-labelledby="doctor-history-title">
      <div className="doctor-history__heading">
        <div>
          <h3 id="doctor-history-title">{t("doctor.history", "Patient history")}</h3>
          <p>{t("doctor.historyHelp", "Stored locally; only the five most recent entries inform the next check.")}</p>
        </div>
        <span>{visits.length}</span>
      </div>
      <div className="doctor-history__list">
        {visits.map((visit) => (
          <article key={visit.id}>
            <div className="doctor-history__meta">
              <time dateTime={visit.created_at}>
                {formatDateTime(visit.created_at, locale)}
              </time>
              <span
                className={`doctor-decision doctor-decision--${visit.decision}`}
              >
                {visit.decision === "accepted"
                  ? t("doctor.addedQueue", "Added to queue")
                  : visit.decision === "declined"
                    ? t("doctor.notAdded", "Not added")
                    : t("doctor.awaiting", "Awaiting decision")}
              </span>
            </div>
            <strong>{visit.summary}</strong>
            {visit.symptoms && <p><strong>{t("doctor.yourNotes", "Your notes:")}</strong> {visit.symptoms}</p>}
            {visit.care_plan?.reassess && <p><strong>{t("doctor.followUp", "Follow-up:")}</strong> {visit.care_plan.reassess}</p>}
            <small>{visit.provider}{visit.fallback_used ? t("doctor.fallbackUsed", " · fallback used") : ""}</small>
            {visit.next_steps.length > 0 && (
              <p>{visit.next_steps.join(" · ")}</p>
            )}
            {visit.decision === "accepted" && (
              <div
                className="doctor-outcome"
                aria-label={t("doctor.outcome", "Recommendation outcome")}
              >
                <span>{t("doctor.didHelp", "Did it help?")}</span>
                {(
                  ["helped", "did_not_help", "not_sure"] as PlantDoctorOutcome[]
                ).map((outcome) => (
                  <button
                    type="button"
                    key={outcome}
                    aria-pressed={visit.outcome === outcome}
                    disabled={savingVisitId === visit.id}
                    onClick={() => void onOutcome(visit, outcome)}
                  >
                    {outcomeLabels[outcome]}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
function DoctorUsage({ usage }: { usage: PlantDoctorUsageResponse | null }) {
  const { locale, t } = useI18n();
  if (!usage)
    return (
      <div className="doctor-usage doctor-usage--loading">
        {t("doctor.loadingUsage", "Loading today's usage…")}
      </div>
    );
  return (
    <aside className="doctor-usage" aria-label={t("doctor.usageA11y", "AI usage reminder")}>
      <strong>
        {t("doctor.completedChecks", "{{count}} completed checks since 00:00 UTC", { count: usage.checks_today })}
      </strong>
      {usage.provider === "Google Gemini" ? <span>
        {t("doctor.geminiLimits", "Gemini limits depend on your model and account. Check Google AI Studio for remaining quota and reset times.")}
      </span> : <span>
        {t("doctor.cloudflareUsage", "Estimated {{estimate}} neurons per check · {{limit}} free neurons/day", {
          estimate: usage.estimated_neurons_per_check,
          limit: usage.daily_free_neuron_limit.toLocaleString(locale === "he" ? "he-IL" : "en-US"),
        })}
      </span>}
      <small>
        {t("doctor.usageHelp", "This local count includes completed PlantCare checks across providers, not remaining credits. Failed attempts and fallback processing may also consume provider quota. Paid accounts may incur charges.")}
      </small>
    </aside>
  );
}

function DoctorResult({
  result,
  photo,
  plant,
}: {
  result: PlantDoctorResponse;
  photo: string | null;
  plant: Plant;
}) {
  const { locale, t } = useI18n();
  return (
    <div className="doctor-result">
      <header className="doctor-gardener">
        <img src={gardenerUrl} alt="" width="72" height="72" />
        <div>
          <span>{t("doctor.gardener", "YOUR AI GARDENER")}</span>
          <h3>{result.identity_status === "mismatch"
            ? t("doctor.photoReview", "Photo review for {{name}}", { name: plant.display_name })
            : t("doctor.carePlan", "A care plan for {{name}}", { name: plant.display_name })}</h3>
          <p>{t("doctor.oneStep", "Plant-specific guidance, one step at a time.")}</p>
        </div>
      </header>
      {result.identity_status !== "match" && (
        <aside className="doctor-disclaimer" role="status">
          <strong>{result.identity_status === "mismatch" ? t("doctor.differentPlant", "This may be a different plant.") : t("doctor.identityUnknown", "Plant identity is not confirmed.")}</strong>
          <p>{result.identity_explanation || t("doctor.identityFallback", "Species is uncertain; guidance is based on visible symptoms.")}</p>
        </aside>
      )}
      {photo && (
        <img
          className="doctor-result__photo"
          src={photo}
          alt={t("doctor.diagnosedAlt", "Diagnosed photo of {{name}}", { name: plant.display_name })}
        />
      )}
      <p className="doctor-result__identity">
        <strong>{t("doctor.assessmentFor", "Assessment for {{name}}", { name: plant.display_name })}</strong>
        <span>
          {plant.common_name}
          {plant.scientific_name
            ? ` · ${plant.scientific_name}`
            : ` · ${t("plant.speciesUnknown", "species not confirmed")}`}
        </span>
      </p>
      <div className="doctor-result__summary">
        <span className={`confidence confidence--${result.confidence}`}>
          {t("doctor.careConfidence", "{{value}} care confidence", { value: result.confidence })}
        </span>
        {result.care_plan && result.care_plan.urgency !== "unknown" && (
          <span className={`confidence confidence--${result.care_plan.urgency === "urgent" ? "low" : "medium"}`}>
            {({routine: t("doctor.routine", "Routine care"), soon: t("doctor.soon", "Attention soon"), urgent: t("doctor.urgent", "Act today"), unknown: ""})[result.care_plan.urgency]}
          </span>
        )}
        <blockquote className="doctor-quote">{result.summary}</blockquote>
      </div>
      {result.next_steps.length > 0 && (
        <DoctorList title={t("doctor.now", "What to do now")} items={result.next_steps} recommendation />
      )}
      {!!result.care_plan?.evidence.length && <DoctorList title={t("doctor.why", "Why this may be happening")} items={result.care_plan.evidence} />}
      {!!result.care_plan?.avoid.length && <DoctorList title={t("doctor.avoid", "What to avoid")} items={result.care_plan.avoid} />}
      {result.care_plan?.expected_improvement && <section><h4>{t("doctor.expected", "Expected improvement")}</h4><p>{result.care_plan.expected_improvement}</p></section>}
      {result.care_plan?.reassess && <section><h4>{t("doctor.reassess", "When to reassess")}</h4><p>{result.care_plan.reassess}</p></section>}
      {result.observations.length > 0 && (
        <DoctorList title={t("doctor.observations", "Visible observations")} items={result.observations} />
      )}
      {result.possible_issues.length > 0 && (
        <DoctorList title={t("doctor.issues", "Possible issues")} items={result.possible_issues} />
      )}
      <section
        className="doctor-watering-plan"
        aria-labelledby="doctor-watering-title"
      >
        <h4 id="doctor-watering-title">{t("doctor.watering", "Watering plan")}</h4>
        <blockquote className="doctor-quote">{result.watering_guidance.assessment}</blockquote>
        <div className="doctor-watering-threshold">
          <strong>{t("doctor.notificationPoint", "Suggested notification point")}</strong>
          <span>{result.watering_guidance.notification_point}</span>
        </div>
        {result.watering_guidance.manual_checks.length > 0 && (
          <DoctorList
            title={t("doctor.checkPot", "Check this pot first")}
            items={result.watering_guidance.manual_checks}
            recommendation
          />
        )}
        {result.watering_guidance.watering_steps.length > 0 && (
          <DoctorList
            title={t("doctor.ifWater", "If it is ready for water")}
            items={result.watering_guidance.watering_steps}
            recommendation
          />
        )}
        {result.watering_guidance.drying_steps.length > 0 && (
          <DoctorList
            title={t("doctor.ifWet", "If it has stayed too wet")}
            items={result.watering_guidance.drying_steps}
            recommendation
          />
        )}
      </section>
      <p className="doctor-disclaimer">{result.disclaimer}</p>
      <small>
        {result.provider} ·{" "}
        {result.total_tokens != null
          ? t("doctor.tokens", "{{count}} tokens", { count: result.total_tokens.toLocaleString(locale === "he" ? "he-IL" : "en-US") })
          : result.neurons === null
            ? t("doctor.usageUnavailable", "Usage unavailable")
            : t("doctor.neurons", "{{count}} neurons", { count: result.neurons.toFixed(2) })}
        {result.fallback_used && t("doctor.cloudflareFallback", " · Cloudflare fallback used; usage shown covers that provider only.")}
      </small>
    </div>
  );
}

function DoctorList({ title, items, recommendation = false }: {
  title: string;
  items: string[];
  recommendation?: boolean;
}) {
  return (
    <section>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>
            {recommendation ? <q>{item}</q> : item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function suggestedPlantName(entity: HomeAssistantEntity): string {
  const cleaned = entity.name
    .replace(
      /\s+(soil\s+)?(moisture|humidity|temperature|battery|illuminance|light)(\s+(sensor|level))?$/i,
      "",
    )
    .replace(/[_-]+/g, " ")
    .trim();
  return cleaned || entity.name;
}

function AddPlantDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (payload: PlantCreate, photo: File | null) => Promise<void>;
}) {
  const emptyMapping: PlantEntityMapping = {
    moisture_entity_id: null,
    temperature_entity_id: null,
    battery_entity_id: null,
    illuminance_entity_id: null,
  };
  const [form, setForm] = useState<Omit<PlantCreate, "entity_mapping">>({
    display_name: "",
    location: "",
    specific_position: null,
    common_name: "",
    scientific_name: null,
    environment_type: "indoor",
    moisture_check_threshold_override: null,
    moisture_wet_threshold_override: null,
  });
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
      .then((response) => {
        setEntities(response.entities);
        setAreas(response.areas);
        setSource(response.source);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setMessage(
            reason instanceof Error
              ? reason.message
              : "Entities could not be loaded.",
          );
      })
      .finally(() => setLoadingSensors(false));
    return () => controller.abort();
  }, []);
  const optionsFor = (deviceClasses: string[]) =>
    entities.filter(
      (entity) =>
        entity.device_class && deviceClasses.includes(entity.device_class),
    );
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
        const companion =
          entities.find(
            (entity) =>
              selected.device_id &&
              entity.device_id === selected.device_id &&
              entity.device_class &&
              deviceClasses.includes(entity.device_class) &&
              entityHasReading(entity),
          ) ??
          (companionField === "illuminance_entity_id"
            ? entities.find(
                (entity) =>
                  entity.area_name === selected.area_name &&
                  entity.device_class === "illuminance" &&
                  entityHasReading(entity),
              )
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
    event.preventDefault();
    setMessage(null);
    if (!mapping.moisture_entity_id) {
      setMessage("Choose a soil-moisture sensor first.");
      return;
    }
    setSaving(true);
    try {
      await onCreate({ ...form, entity_mapping: mapping }, photoFile);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "The plant could not be added.",
      );
      setSaving(false);
    }
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog add-plant-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-plant-title"
      >
        <button
          className="dialog__close"
          type="button"
          aria-label="Close add plant"
          onClick={onClose}
        >
          <X />
        </button>
        <p className="eyebrow">SENSOR-FIRST SETUP</p>
        <h2 id="add-plant-title">Add a plant</h2>
        <p className="dialog-subtitle">
          Choose the Home Assistant sensors first. PlantCare suggests editable
          identity and area values from their metadata.
        </p>
        <form className="dialog-form sensor-first-form" onSubmit={submit}>
          <fieldset className="sensor-first-fields">
            <legend>1. Choose sensors</legend>
            {source && (
              <span className="source-badge">
                {source === "simulator"
                  ? "Simulator entity catalog"
                  : "Live Home Assistant entities"}
              </span>
            )}
            {loadingSensors ? (
              <p className="mapping-loading">Loading sensor entities…</p>
            ) : (
              <div className="sensor-grid">
                <EntitySelect
                  required
                  label="Soil moisture"
                  value={mapping.moisture_entity_id}
                  entities={optionsFor(["moisture", "humidity"])}
                  onChange={(value) =>
                    chooseSensor("moisture_entity_id", value)
                  }
                />
                <EntitySelect
                  label="Temperature"
                  value={mapping.temperature_entity_id}
                  entities={optionsFor(["temperature"])}
                  onChange={(value) =>
                    chooseSensor("temperature_entity_id", value)
                  }
                />
                <EntitySelect
                  label="Battery"
                  value={mapping.battery_entity_id}
                  entities={optionsFor(["battery"])}
                  onChange={(value) => chooseSensor("battery_entity_id", value)}
                />
                <EntitySelect
                  label="Illuminance (any sensor)"
                  value={mapping.illuminance_entity_id}
                  entities={optionsFor(["illuminance"])}
                  onChange={(value) =>
                    chooseSensor("illuminance_entity_id", value)
                  }
                />
              </div>
            )}
          </fieldset>
          <p className="sensor-hint">
            If the plant device has no usable illuminance reading, PlantCare
            suggests one from the same Home Assistant area. You can select any
            illuminance sensor.
          </p>
          <p className="form-step">2. Review editable plant details</p>
          <label>
            Friendly name
            <input
              required
              maxLength={120}
              value={form.display_name}
              onChange={(event) =>
                setForm({ ...form, display_name: event.target.value })
              }
            />
          </label>
          <AreaSelect
            value={form.location}
            areas={areas}
            onChange={(location) => setForm({ ...form, location })}
          />
          <label>
            Specific position <small>optional</small>
            <input
              maxLength={160}
              placeholder="e.g. right side, beside the railing"
              value={form.specific_position ?? ""}
              onChange={(event) =>
                setForm({
                  ...form,
                  specific_position: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            Common name
            <input
              required
              maxLength={120}
              value={form.common_name}
              onChange={(event) =>
                setForm({ ...form, common_name: event.target.value })
              }
            />
          </label>
          <label>
            Scientific name <small>optional</small>
            <input
              maxLength={160}
              value={form.scientific_name ?? ""}
              onChange={(event) =>
                setForm({
                  ...form,
                  scientific_name: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            Exposure
            <select
              value={form.environment_type}
              onChange={(event) =>
                setForm({
                  ...form,
                  environment_type: event.target
                    .value as PlantCreate["environment_type"],
                })
              }
            >
              <option value="indoor">Indoor</option>
              <option value="outdoor_covered">Outdoor, covered</option>
              <option value="outdoor_exposed">Outdoor, exposed</option>
            </select>
          </label>
          <fieldset className="edit-photo-section add-photo-section">
            <legend>
              3. Add a cover photo <small>optional</small>
            </legend>
            <div className="edit-photo-layout">
              <div
                className={`edit-photo-preview ${photoPreview ? "edit-photo-preview--image" : ""}`}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="New plant cover preview" />
                ) : (
                  <>
                    <Camera />
                    <span>You can add a cover now or later</span>
                  </>
                )}
              </div>
              <div className="edit-photo-controls">
                <p>
                  This is the lasting image shown on the plant card. Doctor
                  checks use a separate temporary photo.
                </p>
                <label className="photo-picker">
                  <ImagePlus size={18} />
                  <span>
                    <strong>Choose or take a cover photo</strong>
                    <small>JPEG, PNG, WebP, HEIC/HEIF, or AVIF · maximum 10 MB</small>
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.jpg,.jpeg,.heic,.heif,.avif,.mpo"
                    onChange={(event) =>
                      setPhotoFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
                {photoFile && (
                  <small className="selected-photo">
                    Selected: {photoFile.name} ·{" "}
                    {(photoFile.size / 1024 / 1024).toFixed(1)} MB
                  </small>
                )}
              </div>
            </div>
          </fieldset>
          {message && (
            <p className="inline-error" role="alert">
              {message}
            </p>
          )}
          <div className="dialog__footer">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={saving || loadingSensors}
            >
              {saving ? "Adding…" : "Add connected plant"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EditPlantDialog({
  plant,
  onClose,
  onUpdate,
  onArchive,
}: {
  plant: Plant;
  onClose: () => void;
  onUpdate: (
    plant: Plant,
    payload: PlantCreate,
    photoChange: PlantPhotoChange,
  ) => Promise<void>;
  onArchive: (plant: Plant) => Promise<void>;
}) {
  const [form, setForm] = useState<PlantCreate>({
    display_name: plant.display_name,
    location: plant.location,
    specific_position: plant.specific_position,
    common_name: plant.common_name,
    scientific_name: plant.scientific_name,
    environment_type: plant.environment_type as PlantCreate["environment_type"],
    moisture_check_threshold_override:
      plant.moisture_check_threshold_override,
    moisture_wet_threshold_override: plant.moisture_wet_threshold_override,
    wet_duration_hours_override: plant.wet_duration_hours_override ?? null,
  });
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
      .then((response) =>
        setAreas(Array.from(new Set([plant.location, ...response.areas]))),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [plant.location]);
  useEffect(() => {
    if (!photoFile || typeof URL.createObjectURL !== "function") {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => {
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    };
  }, [photoFile]);
  const personalPhoto = plantPhotoUrl(plant);
  const fallbackImage = plantImage({ ...plant, photo_updated_at: null });
  const shownPhoto =
    photoPreview ??
    (!deleteCurrentPhoto ? personalPhoto : null) ??
    fallbackImage?.src ??
    null;
  const shownPhotoAlt = photoPreview
    ? `New photo preview for ${plant.display_name}`
    : personalPhoto && !deleteCurrentPhoto
      ? `Current photo of ${plant.display_name}`
      : (fallbackImage?.alt ?? `${plant.display_name} photo placeholder`);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checkThreshold =
      form.moisture_check_threshold_override ??
      plant.moisture_check_threshold;
    const wetThreshold =
      form.moisture_wet_threshold_override ?? plant.moisture_wet_threshold;
    if (checkThreshold >= wetThreshold) {
      setMessage(
        "The watering-check trigger must be lower than the prolonged-wet trigger.",
      );
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onUpdate(plant, form, {
        file: photoFile,
        deleteCurrent: deleteCurrentPhoto,
      });
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "The plant could not be updated.",
      );
      setSaving(false);
    }
  }
  async function archive() {
    setSaving(true);
    setMessage(null);
    try {
      await onArchive(plant);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "The plant could not be removed.",
      );
      setSaving(false);
    }
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog edit-plant-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-plant-title"
      >
        <button
          className="dialog__close"
          type="button"
          aria-label="Close edit plant"
          onClick={onClose}
        >
          <X />
        </button>
        <p className="eyebrow">LOCAL PLANT IDENTITY</p>
        <h2 id="edit-plant-title">Edit {plant.display_name}</h2>
        <p className="dialog-subtitle">
          Names, care identity, and the private photo stay in PlantCare. Home
          Assistant supplies areas and sensor values.
        </p>
        <form className="dialog-form" onSubmit={submit}>
          <fieldset className="edit-photo-section">
            <legend>Plant photo</legend>
            <div className="edit-photo-layout">
              <div
                className={`edit-photo-preview ${shownPhoto ? "edit-photo-preview--image" : ""}`}
              >
                {shownPhoto ? (
                  <img src={shownPhoto} alt={shownPhotoAlt} />
                ) : (
                  <>
                    <Camera />
                    <span>No photo or species illustration available</span>
                  </>
                )}
              </div>
              <div className="edit-photo-controls">
                <p>
                  {photoPreview
                    ? "This new photo will replace the current image when you save."
                    : deleteCurrentPhoto
                      ? "The personal photo will be deleted when you save."
                      : personalPhoto
                        ? "Current private photo"
                        : "Using the bundled species illustration"}
                </p>
                <label className="photo-picker">
                  <ImagePlus size={18} />
                  <span>
                    <strong>
                      {personalPhoto
                        ? "Choose a replacement"
                        : "Choose or take a photo"}
                    </strong>
                    <small>JPEG, PNG, WebP, HEIC/HEIF, or AVIF · maximum 10 MB</small>
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.jpg,.jpeg,.heic,.heif,.avif,.mpo"
                    onChange={(event) => {
                      setPhotoFile(event.target.files?.[0] ?? null);
                      setDeleteCurrentPhoto(false);
                    }}
                  />
                </label>
                {photoFile && (
                  <small className="selected-photo">
                    Selected: {photoFile.name} ·{" "}
                    {(photoFile.size / 1024 / 1024).toFixed(1)} MB
                  </small>
                )}
                {personalPhoto && !photoFile && (
                  <button
                    className={
                      deleteCurrentPhoto ? "secondary-button" : "danger-button"
                    }
                    type="button"
                    onClick={() => setDeleteCurrentPhoto((current) => !current)}
                  >
                    {deleteCurrentPhoto ? (
                      "Keep current photo"
                    ) : (
                      <>
                        <Trash2 size={15} />
                        Remove current photo
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
            <small className="photo-privacy-note">
              PlantCare resizes the image and removes embedded metadata before
              storing it in the Home Assistant add-on data.
            </small>
          </fieldset>
          <label>
            Friendly name
            <input
              required
              maxLength={120}
              value={form.display_name}
              onChange={(event) =>
                setForm({ ...form, display_name: event.target.value })
              }
            />
          </label>
          <AreaSelect
            value={form.location}
            areas={areas}
            onChange={(location) => setForm({ ...form, location })}
          />
          <label>
            Specific position <small>optional</small>
            <input
              maxLength={160}
              placeholder="e.g. right side, beside the railing"
              value={form.specific_position ?? ""}
              onChange={(event) =>
                setForm({
                  ...form,
                  specific_position: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            Common name
            <input
              required
              maxLength={120}
              value={form.common_name}
              onChange={(event) =>
                setForm({ ...form, common_name: event.target.value })
              }
            />
          </label>
          <label>
            Scientific name <small>optional</small>
            <input
              maxLength={160}
              value={form.scientific_name ?? ""}
              onChange={(event) =>
                setForm({
                  ...form,
                  scientific_name: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            Exposure
            <select
              value={form.environment_type}
              onChange={(event) =>
                setForm({
                  ...form,
                  environment_type: event.target
                    .value as PlantCreate["environment_type"],
                })
              }
            >
              <option value="indoor">Indoor</option>
              <option value="outdoor_covered">Outdoor, covered</option>
              <option value="outdoor_exposed">Outdoor, exposed</option>
            </select>
          </label>
          <fieldset className="monitoring-thresholds">
            <legend>Moisture monitoring</legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={
                  form.moisture_check_threshold_override !== null ||
                  form.moisture_wet_threshold_override !== null
                }
                onChange={(event) =>
                  setForm({
                    ...form,
                    moisture_check_threshold_override: event.target.checked
                      ? plant.moisture_check_threshold
                      : null,
                    moisture_wet_threshold_override: event.target.checked
                      ? plant.moisture_wet_threshold
                      : null,
                  })
                }
              />
              Customize thresholds for this plant
            </label>
            <div className="threshold-grid">
              <label>
                Watering-check trigger
                <span className="input-with-unit">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={
                      form.moisture_check_threshold_override === null &&
                      form.moisture_wet_threshold_override === null
                    }
                    value={
                      form.moisture_check_threshold_override ??
                      plant.moisture_check_threshold
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        moisture_check_threshold_override: Number(
                          event.target.value,
                        ),
                      })
                    }
                  />
                  <span>% or below</span>
                </span>
              </label>
              <label>
                Prolonged-wet trigger
                <span className="input-with-unit">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={
                      form.moisture_check_threshold_override === null &&
                      form.moisture_wet_threshold_override === null
                    }
                    value={
                      form.moisture_wet_threshold_override ??
                      plant.moisture_wet_threshold
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        moisture_wet_threshold_override: Number(
                          event.target.value,
                        ),
                      })
                    }
                  />
                  <span>% or above</span>
                </span>
              </label>
            </div>
            <small>
              {plant.care_profile_basis}. Watering alerts need three fresh readings.
              Wetness is compared with this pot's drying history after three complete
              cycles. A 14-day high plateau prompts review, not an overwatering diagnosis.
            </small>
            <label>
              Optional wet-duration alert (hours)
              <input type="number" min="24" max="720" step="1"
                placeholder="Automatic — learn this pot"
                value={form.wet_duration_hours_override ?? ""}
                onChange={(event) => setForm({ ...form,
                  wet_duration_hours_override: event.target.value === "" ? null : Number(event.target.value),
                })} />
              <small>Leave blank for automatic tracking. A custom timer starts while moisture is above the wet threshold; the 14-day review still applies.</small>
            </label>
          </fieldset>
          {message && (
            <p className="inline-error" role="alert">
              {message}
            </p>
          )}
          <div className="dialog__footer dialog__footer--split">
            <button
              className="danger-button"
              type="button"
              onClick={() => setConfirmArchive(true)}
            >
              Remove from dashboard
            </button>
            <span />
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
        {confirmArchive && (
          <div
            className="archive-confirm"
            role="alertdialog"
            aria-labelledby="archive-title"
          >
            <h3 id="archive-title">Remove {plant.display_name}?</h3>
            <p>
              The plant disappears from the dashboard, but readings, actions,
              and audit history are preserved. Deleting a Home Assistant entity
              will follow the same non-destructive rule.
            </p>
            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirmArchive(false)}
              >
                Keep plant
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={saving}
                onClick={archive}
              >
                Remove plant
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDateTime(value: string | null, locale: "en" | "he" = "en"): string {
  return value
    ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not scheduled";
}

function DropletGlyph() {
  return <span aria-hidden="true" className="droplet-glyph" />;
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await onLogin(password);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Login failed.");
      setSubmitting(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand__mark">
            <Sprout size={25} />
          </span>
          <span>
            Plant<span>Care</span>
          </span>
        </div>
        <div className="login-lock">
          <LockKeyhole size={24} aria-hidden="true" />
        </div>
        <p className="eyebrow">HOME LAN ACCESS</p>
        <h1 id="login-title">Welcome back</h1>
        <p>Use the shared household password to open your plant dashboard.</p>
        <form onSubmit={submit}>
          <label htmlFor="household-password">Shared password</label>
          <input
            id="household-password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {message && (
            <p className="login-error" role="alert">
              {message}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? "Opening dashboard…" : "Open dashboard"}
          </button>
        </form>
        <p className="login-help">
          The password can only be created or changed from the authenticated
          Home Assistant view.
        </p>
      </section>
    </main>
  );
}

export default App;
