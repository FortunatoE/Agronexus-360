"use client";

import {
  Fragment,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  buildCommercialClosingOverview,
  commercialPlanningKey,
  matchesCommercialClosing,
  resolveCommercialClosings,
  type CommercialPlanningCoverage,
} from "@/lib/commercial-closings";
import {
  buildNotificationMailto,
  buildOutlookEml,
  buildTaskNotification,
  buildTransitNotification,
  formatTransitNotificationCells,
  listTransitNotificationOrders,
  parseNotificationRecipients,
  resolveTaskNotificationOrders,
  transitNotificationHeaders,
} from "@/lib/task-notification";
import { base64ToBytes } from "@/lib/workspace-base64";
import { buildLogisticsEmail, type LogisticsEmailKind, type LogisticsEmailRow } from "@/lib/logistics-email";
import { indexLogisticsLots, logisticsUnit, matchPendingTransit, pendingSapQuantity, sapIdentifier } from "@/lib/logistics-sap";
import { sapOrderHeaders, sapUnitHeaders, sapTransitDestinationHeaders } from "@/lib/sap-logistics-fields.mjs";
import { CommercialClosingBalances } from "@/components/commercial-closing-balances";
import {
  CommercialClosingCalendar,
  type ClosingCalendarPeriod,
} from "@/components/commercial-closing-calendar";
import {
  CommercialDeliveryTracker,
  type CommercialDeliveryTrackingRow,
} from "@/components/commercial-delivery-tracker";
import { DimensionUpload } from "@/components/dimension-upload";
import { FarmTransfers } from "@/components/farm-transfers";
import {
  emptyDimensionBundle,
  normalizeMaterial,
  type DimensionBundle,
} from "@/lib/material-dimension";
import {
  buildFarmToNucleus,
  buildReconciliation,
  consumptionNucleusFor,
  cultureFor,
  cycleFor,
  headerKey,
  numberFrom,
  planningNucleusFor,
  productFor,
  quantityFor,
  readNumber,
  readPendingOrderDetails,
  readText,
  nucleusFor,
  stockLocationFor,
  stockNucleusFor,
  standardAmount,
  standardQuantity,
  type OperationalRow,
  type ReconciliationRow,
} from "@/lib/reconciliation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileUp,
  LayoutDashboard,
  Moon,
  PackageSearch,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Sun,
  Upload,
  Truck,
  UsersRound,
  X,
} from "lucide-react";

type Row = OperationalRow;
type SourceKey =
  | "planejamento"
  | "execucao"
  | "consumo"
  | "estoque"
  | "estoqueMb52"
  | "transito"
  | "pedidos"
  | "estoqueWeb"
  | "solicitacoesWeb"
  | "pedidosCompra";
type ImportKey = SourceKey | "dimensoes";
type Datasets = Record<SourceKey, Row[]>;
type ImportSummary = {
  fileName: string;
  fileModifiedAt: string;
  importedAt: string;
  rows: number;
  sheets: string[];
};
type ImportHistoryItem = ImportSummary & {
  id: string;
  source: SourceKey;
  version: number;
  previousRows: number;
  warnings: number;
};
type AuditEvent = {
  id: string;
  actor: string;
  detail: string;
  kind: "import" | "premise" | "task" | "workspace";
  createdAt: string;
};
type Premises = {
  tolerance: string;
  sample: string;
  horizon: string;
  excludedStatus: string;
};
type DimensionPremise = { domain: string; key: string; value: string };
type EmailSettings = {
  defaultCopy: string;
  nucleusRecipients: Record<string, string>;
};
type DashboardSettings = { daeCycle: "Safra" | "Safrinha" | "Ambos" };
type AppUser = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "viewer" | string;
  nucleus?: string;
};
type ManagedUser = AppUser & { createdAt: string };
type UserDraft = {
  id?: string;
  name: string;
  nucleus: string;
  password: string;
  role: "admin" | "viewer";
  username: string;
};
type TaskAction = { id: string; note: string; createdAt: string };
type TaskStatus = "Aberta" | "Em andamento" | "Aguardando" | "Concluída";
type TaskItem = {
  id: string;
  pendingId: string;
  material?: string;
  nucleus?: string;
  title: string;
  createdAt: string;
  actions: TaskAction[];
  owner?: string;
  dueDate?: string;
  evidence?: string;
  status?: TaskStatus;
  updatedAt?: string;
};
type RoadDriver = {
  id: string;
  fullName: string;
  cpf: string;
  phone?: string;
  createdAt: string;
};
type RoadVehicle = {
  id: string;
  plate: string;
  capacity: number;
  palletCapacity?: number;
  model: string;
  trackerNumber?: string;
  ownership?: "interno" | "terceiro";
  defaultDriverId?: string;
  createdAt: string;
};
type TripRecipe = {
  id?: string;
  culture: string;
  destination: string;
  dose: string;
  product: string;
  target: string;
  unit?: string;
  volume: number;
};
type LogisticsTripItem = {
  active?: string;
  id: string;
  requestId: string;
  requestDate: string;
  product: string;
  productCode: string;
  lot: string;
  quantity: number;
  unit: string;
  sourceWarehouse: string;
  destination: string;
  destinationCode: string;
  requestProduct?: string;
  requestLineId?: string;
  standardProduct?: string;
  sourceMode?: "armazem" | "coleta" | "manual";
  sourceNucleus?: string;
  stockReference?: string;
  responsibleName?: string;
  culture?: string;
  adjustmentRequired?: boolean;
  weightKg?: number;
  pallets?: number;
  estimatedValue?: number;
};
type LogisticsFiscalAllocation = {
  batchId: string;
  createdAt: string;
  id: string;
  invoiceNumber: string;
  quantity: number;
  requestId: string;
  requestLineId: string;
  tripItemId?: string;
  webLine?: LogisticsRequestLine;
  webDestination?: string;
  webDestinationCode?: string;
  sapLot?: string;
  sapProduct?: string;
  sapCode?: string;
  center?: string;
};
type TripRecipeExemption = {
  destination: string;
  id: string;
  product: string;
  unit: string;
};
type LogisticsRequestLine = {
  active: string;
  culture?: string;
  id: string;
  lot: string;
  legacyId?: string;
  sapLot?: string;
  sapProduct?: string;
  sapCode?: string;
  center?: string;
  invoiceNumber?: string;
  product: string;
  productCode: string;
  quantity: number;
  inTransit?: number;
  standardProduct: string;
  unit: string;
  planningDate?: string;
  planningCycle?: string;
  cycleWarning?: string;
  daysBeforePlanning?: number | null;
  plannedUntilRequest?: number;
  planningStatus?: string;
};
type LogisticsRequest = {
  date: string;
  destination: string;
  destinationCode: string;
  id: string;
  requestNumber: string;
  sourceWarehouse: string;
  status: string;
  lines: LogisticsRequestLine[];
};
type LogisticsTrip = {
  id: string;
  requestId: string;
  requestDate: string;
  product: string;
  productCode: string;
  lot: string;
  quantity: number;
  unit: string;
  sourceWarehouse: string;
  destination: string;
  destinationCode: string;
  driverId: string;
  vehicleId: string;
  invoiceNumber: string;
  tripDate?: string;
  createdAt: string;
  status?: "Em progresso" | "Rota ativa" | "Concluído";
  recipe?: TripRecipe;
  recipes?: TripRecipe[];
  recipeExemptions?: TripRecipeExemption[];
  items?: LogisticsTripItem[];
  invoiceNumbers?: string[];
  invoiceBatchByNumber?: Record<string, string>;
  fiscalAllocations?: LogisticsFiscalAllocation[];
  fiscalEmailSentAtByBatch?: Record<string, string>;
  appointmentNumber?: string;
  appointmentRegisteredAt?: string;
  webRequestIds?: string[];
  webAgilLinkedAt?: string;
  departureTime?: string;
  routeStopOrder?: string[];
  routeGroupSentAt?: string;
  recipeRequestSentAt?: string;
};
type LogisticsFiscalBatch = {
  id: string;
  destination: string;
  invoices: string[];
  items: LogisticsTripItem[];
  responsibleName: string;
};
type LogisticsFiscalCandidate = {
  available: number;
  item: LogisticsTripItem;
  key: string;
  line: LogisticsRequestLine;
  request: LogisticsRequest;
};
type TripRecipeOption = {
  allocated: number;
  available: number;
  culture: string;
  destination: string;
  id: string;
  product: string;
  total: number;
  unit: string;
};
type LogisticsState = {
  addressByLocation?: Record<string, string>;
  addressSourceUrlByLocation?: Record<string, string>;
  drivers: RoadDriver[];
  trips: LogisticsTrip[];
  vehicles: RoadVehicle[];
  municipalityByLocation?: Record<string, string>;
  webMaterialLinks?: Record<string, string>;
};
type ClosingDistribution = Record<string, number>;
type CommercialCurrency = "" | "BRL" | "USD";
type CommercialClosing = {
  id: string;
  supplier: string;
  paymentDue: string;
  paymentMethod: string;
  destination: string;
  deliveryLocation: string;
  cycle: "Safra" | "Safrinha";
  culture: string;
  active: string;
  product: string;
  unit: string;
  currency: CommercialCurrency;
  unitPrice: number;
  packaging: string;
  totalVolume: number;
  distribution: ClosingDistribution;
  orderKey: string;
  orderNumber: string;
  orderItem?: string;
  invoicedVolume?: number;
  createdAt: string;
  updatedAt: string;
};
type ClosingAnnotation = {
  id: string;
  closingId: string;
  materialSent: string;
  purchaseVolume: number | null;
  invoicedVolume: number | null;
  note: string;
  resolved: boolean;
  createdAt: string;
};
type CommercialClosingsState = {
  annotations: ClosingAnnotation[];
  closings: CommercialClosing[];
};
type PersistedWorkspace = {
  bundle: DimensionBundle;
  datasets: Datasets;
  dimensionPremises: DimensionPremise[];
  imports: Partial<Record<ImportKey, ImportSummary>>;
  premises: Premises;
  tasks: TaskItem[] | string[];
  emailSettings?: EmailSettings;
  dashboardSettings?: DashboardSettings;
  importHistory?: ImportHistoryItem[];
  auditEvents?: AuditEvent[];
  logistics?: LogisticsState;
  commercialClosings?: CommercialClosingsState;
};
type ReconciliationIssue = {
  action: string;
  code: string;
  count: number;
  detail: string;
  material: string;
  source: string;
};
type PremiseSection = {
  id: "operacionais" | "materiais" | "nucleos" | "culturas" | "conversoes";
  title: string;
  description: string;
  headers: string[];
  rows: Array<Array<string | number>>;
};
type PendingSignal = {
  id: string;
  dueDate: Date | null;
  daysUntil: number | null;
  material: string;
  physicalMaterial: string;
  nucleus: string;
  quantity: number;
  reference: string;
  row: Row;
  status:
    | "Demanda próxima"
    | "Possível atraso"
    | "Ponto de atenção"
    | "Alerta"
    | "Programado"
    | "Sem data";
  tone: "emerald" | "sky" | "amber" | "rose" | "slate";
};
type OperationalAlert = {
  id: string;
  category: string;
  severity: "attention" | "critical" | "info";
  title: string;
  detail: string;
  metric: string;
  warehouseBalances?: ReconciliationRow["locations"];
};

const workspaceDatabase = "agronexus-360";
const workspaceStore = "workspace";
const workspaceRecord = "current";
const emptyDatasets: Datasets = {
  planejamento: [],
  execucao: [],
  consumo: [],
  estoque: [],
  estoqueMb52: [],
  transito: [],
  pedidos: [],
  estoqueWeb: [],
  solicitacoesWeb: [],
  pedidosCompra: [],
};
const initialPremises: Premises = {
  tolerance: "5",
  sample: "3",
  horizon: "7, 15, 30",
  excludedStatus: "EXCL",
};
const initialEmailSettings: EmailSettings = {
  defaultCopy: "",
  nucleusRecipients: {},
};
const initialDashboardSettings: DashboardSettings = { daeCycle: "Safra" };
const initialLogistics: LogisticsState = {
  addressByLocation: {},
  addressSourceUrlByLocation: {},
  drivers: [],
  trips: [],
  vehicles: [],
  municipalityByLocation: {},
  webMaterialLinks: {},
};
const initialCommercialClosings: CommercialClosingsState = {
  annotations: [],
  closings: [],
};
const emptyUserDraft: UserDraft = {
  name: "",
  nucleus: "",
  password: "",
  role: "viewer",
  username: "",
};
function logisticsTripItems(trip: LogisticsTrip): LogisticsTripItem[] {
  return trip.items?.length
    ? trip.items
    : [
        {
          id: `legado-${trip.id}`,
          requestId: trip.requestId,
          requestDate: trip.requestDate,
          product: trip.product,
          productCode: trip.productCode,
          lot: trip.lot,
          quantity: trip.quantity,
          unit: trip.unit,
          sourceWarehouse: trip.sourceWarehouse,
          destination: trip.destination,
          destinationCode: trip.destinationCode,
        },
      ];
}
function logisticsTripInvoices(trip: LogisticsTrip) {
  const values = trip.invoiceNumbers?.length
    ? trip.invoiceNumbers
    : [trip.invoiceNumber];
  return [...new Set(values.map((value) => value.trim()).filter((value) => value && !isPhysicalReturn(value)))];
}
function isPhysicalReturn(value: string) {
  return normalizeMaterial(value) === "RETORNOFISICO";
}
function logisticsTripDate(trip: LogisticsTrip) {
  return trip.tripDate || dateKey(new Date(trip.createdAt));
}
function logisticsFiscalBatchId(destination: string, responsibleName: string) {
  return [normalizeMaterial(destination), normalizeMaterial(responsibleName)].join(
    "|",
  );
}
function logisticsTripFiscalBatches(trip: LogisticsTrip): LogisticsFiscalBatch[] {
  const batches = new Map<string, LogisticsFiscalBatch>();
  logisticsTripItems(trip).forEach((item) => {
    const destination = item.destination || "Destino não informado";
    const responsibleName =
      item.responsibleName || "BOA ESPERANCA AGROPECUARIA LTDA";
    const id = logisticsFiscalBatchId(destination, responsibleName);
    const current = batches.get(id) || {
      destination,
      id,
      invoices: [],
      items: [],
      responsibleName,
    };
    current.items.push(item);
    batches.set(id, current);
  });
  const assignment = trip.invoiceBatchByNumber || {};
  const allocatedInvoices = new Map<string, string[]>();
  (trip.fiscalAllocations || []).forEach((allocation) => {
    if (!allocation.invoiceNumber || isPhysicalReturn(allocation.invoiceNumber)) return;
    const current = allocatedInvoices.get(allocation.batchId) || [];
    current.push(allocation.invoiceNumber);
    allocatedInvoices.set(allocation.batchId, current);
  });
  logisticsTripInvoices(trip).forEach((invoice) => {
    const batch = batches.get(assignment[invoice]);
    if (batch) batch.invoices.push(invoice);
  });
  allocatedInvoices.forEach((invoices, batchId) => {
    const batch = batches.get(batchId);
    if (batch) batch.invoices.push(...invoices);
  });
  batches.forEach((batch) => {
    batch.invoices = [...new Set(batch.invoices)];
  });
  return [...batches.values()].sort(
    (left, right) =>
      left.destination.localeCompare(right.destination, "pt-BR") ||
      left.responsibleName.localeCompare(right.responsibleName, "pt-BR"),
  );
}
function fiscalLineMatchesRouteItem(
  line: LogisticsRequestLine,
  item: LogisticsTripItem,
) {
  if (line.unit && item.unit && logisticsUnit(line.unit) !== logisticsUnit(item.unit)) return false;
  if (line.sapCode && sapIdentifier(line.sapCode) === sapIdentifier(item.productCode)) return true;
  const lineMaterials = [line.product, line.standardProduct]
    .map(normalizeMaterial)
    .filter(Boolean);
  const itemMaterials = [
    item.product,
    item.requestProduct || "",
    item.standardProduct || "",
  ]
    .map(normalizeMaterial)
    .filter(Boolean);
  if (lineMaterials.some((material) => itemMaterials.includes(material))) {
    return true;
  }
  const active = normalizeMaterial(line.active);
  return Boolean(
    active &&
      active !== "NAOCONCILIADO" &&
      active === normalizeMaterial(item.active || ""),
  );
}

function fiscalRequestLineFor(allocation: LogisticsFiscalAllocation, requests: LogisticsRequest[]) {
  return allocation.webLine || requests.find((request) => request.id === allocation.requestId)
    ?.lines.find((line) => line.id === allocation.requestLineId || line.legacyId === allocation.requestLineId);
}

function fiscalAllocationMatchesLine(allocation: LogisticsFiscalAllocation, request: LogisticsRequest, line: LogisticsRequestLine) {
  return allocation.requestId === request.id &&
    (allocation.requestLineId === line.id || allocation.requestLineId === line.legacyId);
}

function fiscalRequestsForTrip(trip: LogisticsTrip, requests: LogisticsRequest[]) {
  const linked = new Set(trip.webRequestIds || []);
  const values = new Map(requests.filter((request) => linked.has(request.id)).map((request) => [
    request.id, { ...request, lines: [...request.lines] },
  ]));
  for (const allocation of trip.fiscalAllocations || []) {
    if (!linked.has(allocation.requestId) || !allocation.webLine) continue;
    const request = values.get(allocation.requestId) || {
      id: allocation.requestId, requestNumber: allocation.requestId, date: "", status: "",
      destination: allocation.webDestination || "", destinationCode: allocation.webDestinationCode || "",
      sourceWarehouse: "", lines: [],
    };
    if (!request.lines.some((line) => fiscalAllocationMatchesLine(allocation, request, line))) {
      request.lines.push(allocation.webLine);
    }
    values.set(request.id, request);
  }
  return [...values.values()];
}

function logisticsFiscalCandidates(
  trip: LogisticsTrip,
  batch: LogisticsFiscalBatch,
  requests: LogisticsRequest[],
  excludedAllocationId = "",
): LogisticsFiscalCandidate[] {
  const allocations = (trip.fiscalAllocations || []).filter(
    (allocation) => allocation.id !== excludedAllocationId,
  );
  const linkedRequests = fiscalRequestsForTrip(trip, requests);
  const routeBalances = new Map(batch.items.map((item) => [item.id, item.quantity]));
  const orderedAllocations = [...allocations].sort((left, right) => Number(Boolean(right.tripItemId)) - Number(Boolean(left.tripItemId)));
  for (const allocation of orderedAllocations) {
    if (allocation.batchId !== batch.id) continue;
    const line = fiscalRequestLineFor(allocation, linkedRequests);
    const items = allocation.tripItemId
      ? batch.items.filter((item) => item.id === allocation.tripItemId)
      : batch.items.filter((item) => !line || fiscalLineMatchesRouteItem(line, item));
    let left = allocation.quantity;
    for (const item of items) {
      const available = routeBalances.get(item.id) || 0;
      const used = Math.min(left, available);
      routeBalances.set(item.id, available - used);
      left -= used;
      if (left <= 0) break;
    }
  }
  return linkedRequests.flatMap((request) =>
    request.lines.flatMap((line) => {
      const lineAllocated = allocations
        .filter((allocation) => fiscalAllocationMatchesLine(allocation, request, line))
        .reduce((total, allocation) => total + allocation.quantity, 0);
      return batch.items.filter((item) => fiscalLineMatchesRouteItem(line, item)).map((item): LogisticsFiscalCandidate => ({
        available: Math.max(0, Math.min(line.quantity - lineAllocated, routeBalances.get(item.id) || 0)),
        item,
        key: [request.id, line.id, item.id].join("|"),
        line,
        request,
      }));
    }),
  )
    .filter((candidate) => candidate.available > 0.000001)
    .sort(
      (left, right) =>
        left.request.requestNumber.localeCompare(
          right.request.requestNumber,
          "pt-BR",
          { numeric: true },
        ) || left.line.product.localeCompare(right.line.product, "pt-BR"),
    );
}
function logisticsFiscalBatchAllocated(
  trip: LogisticsTrip,
  batch: LogisticsFiscalBatch,
) {
  return (trip.fiscalAllocations || [])
    .filter((allocation) => allocation.batchId === batch.id)
    .reduce((total, allocation) => total + allocation.quantity, 0);
}
type LogisticsRouteStop = {
  id: string;
  items: LogisticsTripItem[];
  location: string;
  type: "collect" | "deliver";
};
function logisticsRouteStops(trip: LogisticsTrip): LogisticsRouteStop[] {
  const collectByLocation = new Map<string, LogisticsTripItem[]>();
  const deliverByDestination = new Map<string, LogisticsTripItem[]>();
  logisticsTripItems(trip).forEach((item) => {
    const collection = collectByLocation.get(item.sourceWarehouse) || [];
    collection.push(item);
    collectByLocation.set(item.sourceWarehouse, collection);
    const delivery = deliverByDestination.get(item.destination) || [];
    delivery.push(item);
    deliverByDestination.set(item.destination, delivery);
  });
  const available = [
    ...[...collectByLocation.entries()].map(([location, items]) => ({
      id: `collect:${normalizeMaterial(location)}`,
      items,
      location,
      type: "collect" as const,
    })),
    ...[...deliverByDestination.entries()].map(([location, items]) => ({
      id: `deliver:${normalizeMaterial(location)}`,
      items,
      location,
      type: "deliver" as const,
    })),
  ];
  const byId = new Map(available.map((stop) => [stop.id, stop]));
  const ordered = (trip.routeStopOrder || [])
    .map((id) => byId.get(id))
    .filter((stop): stop is LogisticsRouteStop => Boolean(stop));
  const used = new Set(ordered.map((stop) => stop.id));
  return [...ordered, ...available.filter((stop) => !used.has(stop.id))];
}
function logisticsRouteBrief(
  trip: LogisticsTrip,
  driverName: string,
  plate: string,
) {
  const stops = logisticsRouteStops(trip);
  const formatItems = (items: LogisticsTripItem[]) =>
    items
      .map(
        (item) => `* ${item.product} – ${formatNumber(item.quantity)} ${item.unit}`,
      )
      .join("\n");
  const routeDate = new Intl.DateTimeFormat("pt-BR").format(
    new Date(`${logisticsTripDate(trip)}T00:00:00`),
  );
  const heading = `ROTA ${routeDate}${trip.departureTime ? ` · ${trip.departureTime}` : ""}\n@${driverName || "Motorista"}${plate ? ` · ${plate}` : ""}`;
  const routeStops = stops
    .map(
      (stop, index) =>
        `${index + 1}° 📍${stop.location}${stop.type === "collect" && trip.departureTime ? `  ⏰${trip.departureTime}` : ""}\n\n${stop.type === "collect" ? "COLETAR" : "DESCARREGAR"}\n${formatItems(stop.items)}`,
    )
    .join("\n\n");
  return [heading, routeStops].filter(Boolean).join("\n\n");
}
type LogisticsDeliverySummary = {
  destination: string;
  product: string;
  quantity: number;
  unit: string;
};
function logisticsTripDeliverySummary(
  trip: LogisticsTrip,
): LogisticsDeliverySummary[] {
  const rows = new Map<string, LogisticsDeliverySummary>();
  logisticsTripItems(trip).forEach((item) => {
    const destination = item.destination || "Destino não informado";
    const product = item.product || "Material não informado";
    const unit = item.unit || "UN";
    const key = [normalizeMaterial(destination), normalizeMaterial(product), normalizeMaterial(unit)].join("|");
    const current = rows.get(key) || {
      destination,
      product,
      quantity: 0,
      unit,
    };
    current.quantity += item.quantity;
    rows.set(key, current);
  });
  return [...rows.values()].sort(
    (left, right) =>
      left.destination.localeCompare(right.destination, "pt-BR") ||
      left.product.localeCompare(right.product, "pt-BR"),
  );
}
type LogisticsRecipeRequestRow = {
  culture: string;
  destination: string;
  product: string;
  quantity: number;
  target: string;
  unit: string;
};
function logisticsRecipeRequestRows(trip: LogisticsTrip): LogisticsRecipeRequestRow[] {
  const rows = new Map<
    string,
    LogisticsRecipeRequestRow
  >();
  logisticsTripRecipes(trip).forEach((item) => {
    const key = [
      normalizeMaterial(item.destination),
      normalizeMaterial(item.product),
      normalizeMaterial(item.culture || "Sem cultura"),
      normalizeMaterial(item.target || "Não informado"),
      normalizeMaterial(item.unit || "UN"),
    ].join("|");
    const current = rows.get(key) || {
      culture: item.culture || "Sem cultura",
      destination: item.destination || "Destino não informado",
      product: item.product,
      quantity: 0,
      target: item.target || "Não informado",
      unit: item.unit || "UN",
    };
    current.quantity += item.volume;
    rows.set(key, current);
  });
  return [...rows.values()].sort(
    (left, right) =>
      left.destination.localeCompare(right.destination, "pt-BR") ||
      left.product.localeCompare(right.product, "pt-BR") ||
      left.target.localeCompare(right.target, "pt-BR"),
  );
}
function logisticsRecipeRequestText(trip: LogisticsTrip) {
  const routeDate = new Intl.DateTimeFormat("pt-BR").format(
    new Date(`${logisticsTripDate(trip)}T00:00:00`),
  );
  const body = logisticsRecipeRequestRows(trip)
    .map((row) =>
      [
        row.destination,
        row.product,
        `${formatNumber(row.quantity)} ${row.unit}`,
        row.culture,
        row.target,
      ].join(" | "),
    )
    .join("\n");
  return `SOLICITAÇÃO DE RECEITAS · ROTA ${routeDate}\n\nPor gentileza, emitir as receitas dos volumes abaixo.\n\nFazenda destino | Produto | Volume | Cultura | Alvo\n${body || "Nenhuma receita registrada."}`;
}
function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function logisticsRecipeRequestHtml(trip: LogisticsTrip) {
  const routeDate = new Intl.DateTimeFormat("pt-BR").format(
    new Date(`${logisticsTripDate(trip)}T00:00:00`),
  );
  const rows = logisticsRecipeRequestRows(trip)
    .map(
      (row) => `
        <tr>
          <td>${escapeEmailHtml(row.destination)}</td>
          <td>${escapeEmailHtml(row.product)}</td>
          <td style="text-align:right">${escapeEmailHtml(`${formatNumber(row.quantity)} ${row.unit}`)}</td>
          <td>${escapeEmailHtml(row.culture)}</td>
          <td>${escapeEmailHtml(row.target)}</td>
        </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif">
  <main style="max-width:860px;margin:auto;background:#ffffff;border:1px solid #dbe4e8;border-radius:12px;padding:24px">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#047857">SOLICITAÇÃO DE RECEITAS · ROTA ${escapeEmailHtml(routeDate)}</p>
    <p style="margin:0 0 20px;font-size:15px">Por gentileza, emitir as receitas dos volumes abaixo.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#065f46;color:#ffffff">
        <th style="padding:10px;text-align:left">Fazenda destino</th><th style="padding:10px;text-align:left">Produto</th><th style="padding:10px;text-align:right">Volume</th><th style="padding:10px;text-align:left">Cultura</th><th style="padding:10px;text-align:left">Alvo</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:12px">Nenhuma receita registrada.</td></tr>'}</tbody>
    </table>
  </main>
</body></html>`;
}
function logisticsRecipeEmailSubject(trip: LogisticsTrip, driverName: string) {
  const routeDate = new Intl.DateTimeFormat("pt-BR").format(
    new Date(`${logisticsTripDate(trip)}T00:00:00`),
  );
  const driver = (driverName || "Motorista não informado")
    .trim()
    .split(/\s+/)[0]
    .toLocaleUpperCase("pt-BR");
  return `CARREGAMENTO ${driver} - ${routeDate}`;
}
function encodeEmailHeader(value: string) {
  const binary = Array.from(new TextEncoder().encode(value), (byte) =>
    String.fromCharCode(byte),
  ).join("");
  return `=?UTF-8?B?${btoa(binary)}?=`;
}
function logisticsFiscalBatchTotal(batch: LogisticsFiscalBatch) {
  return batch.items.reduce((total, item) => total + item.quantity, 0);
}
function isFiscalBatchReady(trip: LogisticsTrip, batch: LogisticsFiscalBatch) {
  const invoiced = (trip.fiscalAllocations || [])
    .filter((allocation) => allocation.batchId === batch.id && allocation.invoiceNumber.trim())
    .reduce((total, allocation) => total + allocation.quantity, 0);
  return invoiced >= logisticsFiscalBatchTotal(batch) - 0.000001;
}
function logisticsTripRecipes(trip: LogisticsTrip) {
  if (trip.recipes?.length) return trip.recipes;
  return trip.recipe
    ? [
        {
          ...trip.recipe,
          id: trip.recipe.id || `legado-${trip.id}`,
          destination: trip.recipe.destination || trip.destination,
          product: trip.recipe.product || trip.product,
          volume: trip.recipe.volume || trip.quantity,
        },
      ]
    : [];
}
function isRecipeExempt(
  trip: LogisticsTrip,
  destination: string,
  product: string,
  unit = "",
) {
  return (trip.recipeExemptions || []).some(
    (item) =>
      normalizeMaterial(item.destination) === normalizeMaterial(destination) &&
      normalizeMaterial(item.product) === normalizeMaterial(product) &&
      (!unit || normalizeMaterial(item.unit) === normalizeMaterial(unit)),
  );
}
function logisticsTripRecipeOptions(trip: LogisticsTrip): TripRecipeOption[] {
  const totals = new Map<
    string,
    Omit<TripRecipeOption, "allocated" | "available">
  >();
  logisticsTripItems(trip).forEach((item) => {
    const destination = item.destination || "Destino não informado";
    const product = item.product || "Produto não informado";
    const unit = item.unit || "UN";
    const id = [
      normalizeMaterial(destination),
      normalizeMaterial(product),
      normalizeMaterial(unit),
    ].join("|");
    const current = totals.get(id) || {
      culture: item.culture || "",
      destination,
      id,
      product,
      total: 0,
      unit,
    };
    current.total += item.quantity;
    if (!current.culture && item.culture) current.culture = item.culture;
    totals.set(id, current);
  });
  const recipes = logisticsTripRecipes(trip);
  return [...totals.values()]
    .map((item) => {
      const allocated = recipes
        .filter(
          (recipe) =>
            normalizeMaterial(recipe.destination) ===
              normalizeMaterial(item.destination) &&
            normalizeMaterial(recipe.product) ===
              normalizeMaterial(item.product) &&
            (!recipe.unit ||
              normalizeMaterial(recipe.unit) === normalizeMaterial(item.unit)),
        )
        .reduce((total, recipe) => total + recipe.volume, 0);
      return {
        ...item,
        allocated,
        available: Math.max(0, item.total - allocated),
      };
    })
    .sort(
      (left, right) =>
        left.destination.localeCompare(right.destination, "pt-BR") ||
        left.product.localeCompare(right.product, "pt-BR"),
    );
}
function logisticsPendingRecipeOptions(trip: LogisticsTrip) {
  return logisticsTripRecipeOptions(trip).filter(
    (option) =>
      option.available > 0.000001 &&
      !isRecipeExempt(trip, option.destination, option.product, option.unit),
  );
}
function logisticsMunicipalityFor(
  location: string,
  municipalities: Record<string, string> | undefined,
) {
  const key = normalizeMaterial(location);
  if (!key || !municipalities) return location;
  const exact = municipalities[key];
  if (exact) return exact;
  const matchedKey = Object.keys(municipalities).find(
    (entry) => key.includes(entry) || entry.includes(key),
  );
  return matchedKey ? municipalities[matchedKey] : location;
}
function logisticsAddressFor(
  location: string,
  addresses: Record<string, string> | undefined,
) {
  const key = normalizeMaterial(location);
  if (!key || !addresses) return "";
  return (
    addresses[key] ||
    Object.entries(addresses).find(
      ([saved]) => key.includes(saved) || saved.includes(key),
    )?.[1] ||
    ""
  );
}
function isGoogleMapsUrl(value: string) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase();
    return (
      host === "maps.app.goo.gl" ||
      host === "goo.gl" ||
      host.endsWith(".goo.gl") ||
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "google.com.br" ||
      host.endsWith(".google.com.br")
    );
  } catch {
    return false;
  }
}
function googleMapsSearchUrl(value: string) {
  const address = String(value || "").trim();
  if (!address) return "";
  if (isGoogleMapsUrl(address)) return address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
function inferredPackageWeightKg(product: string, unit: string) {
  const normalized = `${product} ${unit}`.toUpperCase().replace(",", ".");
  const multiplied = normalized.match(
    /(\d+(?:\.\d+)?)\s*[X×]\s*(\d+(?:\.\d+)?)\s*(KG|G|L|ML)\b/,
  );
  const direct = normalized.match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML)\b/);
  const rawAmount = multiplied
    ? Number(multiplied[1]) * Number(multiplied[2])
    : Number(direct?.[1] || 0);
  const rawUnit = multiplied?.[3] || direct?.[2] || "";
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return 0;
  if (rawUnit === "KG") return rawAmount;
  if (rawUnit === "G") return rawAmount / 1000;
  // Litros e mililitros são volume, não massa. Sem densidade cadastrada,
  // não podem ser usados para ocupar a capacidade em kg do veículo.
  return 0;
}
let xlsxLoader: Promise<typeof import("xlsx")> | null = null;
function loadXlsx() {
  xlsxLoader ??= import("xlsx");
  return xlsxLoader;
}
const sourceConfig: Array<{
  key: SourceKey;
  title: string;
  hint: string;
  header: number;
}> = [
  {
    key: "planejamento",
    title: "Planejamento",
    hint: "PLANEJAMENTO.xlsx",
    header: 0,
  },
  { key: "execucao", title: "Execução SAP", hint: "ZPS007.xlsx", header: 1 },
  { key: "consumo", title: "Consumo SAP", hint: "CN52.xlsx", header: 3 },
  {
    key: "estoque",
    title: "Estoque por lote",
    hint: "ZMM_BATCH.xlsx",
    header: 0,
  },
  {
    key: "estoqueMb52",
    title: "Estoque complementar",
    hint: "MB52.xlsx — somente materiais ausentes na BATCH",
    header: 1,
  },
  {
    key: "transito",
    title: "Materiais em trânsito",
    hint: "MB5T.xlsx",
    header: 1,
  },
  {
    key: "pedidos",
    title: "Pedidos pendentes",
    hint: "PEDIDOS PENDENTES.xlsx",
    header: 0,
  },
  {
    key: "estoqueWeb",
    title: "Estoque webAgil",
    hint: "Estoque webAgil.xlsx",
    header: 0,
  },
  {
    key: "solicitacoesWeb",
    title: "Solicitações webAgil",
    hint: "Relação de solicitação webAgil.xlsx",
    header: 0,
  },
  {
    key: "pedidosCompra",
    title: "Pedidos de compra",
    hint: "PEDIDOS COMPRA.xlsx",
    header: 1,
  },
];
const nav = [
  ["Visão geral", LayoutDashboard],
  ["Calendarização", CalendarDays],
  ["Acompanhamento", ClipboardCheck],
  ["Execução", PackageSearch],
  ["Importações", FileUp],
  ["Logística", Truck],
  ["Transferências", Truck],
  ["Fechamentos", BarChart3],
  ["Alertas", Bell],
  ["Tarefas", ClipboardCheck],
  ["Usuários", UsersRound],
  ["Configurações", Settings],
] as const;
const crops = [
  { code: "ST1", name: "Soja", cycle: "Safra" },
  { code: "AL1", name: "Algodão", cycle: "Safrinha" },
  { code: "MI1", name: "Milho", cycle: "Safrinha" },
  { code: "CC1", name: "Capim", cycle: "Safrinha" },
];

function cn(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}
function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    value || 0,
  );
}
function formatCurrency(value: number, currency: CommercialCurrency) {
  return currency
    ? new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value || 0)
    : `${formatNumber(value)} · moeda pendente`;
}
function formatDose(value: number | null) {
  return value === null
    ? "n.a."
    : new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
}
function amountToDeliver(
  row: Pick<
    ReconciliationRow,
    "farmBalance" | "warehouseBalance" | "applied" | "transit" | "planned"
  >,
) {
  return (
    row.farmBalance +
    row.warehouseBalance +
    row.applied +
    row.transit -
    row.planned
  );
}
function amountToDeliverColor(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-slate-950";
}
function percent(value: number, total: number) {
  return total ? Math.max(0, Math.min(100, (value * 100) / total)) : 0;
}
function rawPercent(value: number, total: number) {
  return total ? (value * 100) / total : 0;
}
function percentageText(value: number, total: number) {
  return total > 0 ? rawPercent(value, total).toFixed(1) + "%" : "n.a.";
}
function signedNumber(value: number | null) {
  return value === null ? "n.a." : (value > 0 ? "+" : "") + formatNumber(value);
}
function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
function monthKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
  ].join("-");
}
function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month)
    ? new Intl.DateTimeFormat("pt-BR", {
        month: "short",
        year: "numeric",
      }).format(new Date(year, month - 1, 1))
    : value;
}
function closingSupplierKey(supplier: string) {
  return (
    normalizeMaterial(supplier) || supplier.trim().toLocaleUpperCase("pt-BR")
  );
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}
function elapsedLabel(value?: string, now = Date.now()) {
  if (!value) return "Aguardando importação";
  const hours = Math.max(
    0,
    Math.floor((now - new Date(value).getTime()) / 3_600_000),
  );
  const days = Math.floor(hours / 24);
  return days
    ? `há ${days} dia${days === 1 ? "" : "s"} e ${hours % 24} hora${hours % 24 === 1 ? "" : "s"}`
    : `há ${hours} hora${hours === 1 ? "" : "s"}`;
}
function freshnessStatus(value?: string, now = Date.now()) {
  if (!value) return { label: "Aguardando dados", tone: "slate" as const };
  const hours = Math.max(0, (now - new Date(value).getTime()) / 3_600_000);
  if (hours <= 12) return { label: "OK", tone: "emerald" as const };
  if (hours <= 48) return { label: "Em atenção", tone: "amber" as const };
  return { label: "Necessita atualizar", tone: "rose" as const };
}
function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function daysFromToday(value: Date, now = new Date()) {
  return Math.round(
    (startOfDay(value).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
}
function pendingSignalStatus(
  daysUntil: number | null,
): Pick<PendingSignal, "status" | "tone"> {
  if (daysUntil === null) return { status: "Sem data", tone: "slate" };
  if (daysUntil <= -6) return { status: "Alerta", tone: "rose" };
  if (daysUntil <= -1) return { status: "Ponto de atenção", tone: "amber" };
  if (daysUntil <= 1) return { status: "Possível atraso", tone: "amber" };
  if (daysUntil <= 3) return { status: "Demanda próxima", tone: "sky" };
  return { status: "Programado", tone: "emerald" };
}
function taskId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function persistedTasks(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `legada-${index}-${item}`,
        pendingId: "",
        title: item,
        createdAt: new Date().toISOString(),
        actions: [],
      };
    }
    const candidate = item as Partial<TaskItem>;
    return {
      id: candidate.id || `tarefa-${index}`,
      pendingId: candidate.pendingId || "",
      material: candidate.material || "",
      nucleus: candidate.nucleus || "",
      title: candidate.title || "Ação sem título",
      createdAt: candidate.createdAt || new Date().toISOString(),
      owner: candidate.owner || "Não atribuído",
      dueDate: candidate.dueDate || "",
      evidence: candidate.evidence || "",
      status:
        candidate.status === "Concluída" ||
        candidate.status === "Em andamento" ||
        candidate.status === "Aguardando"
          ? candidate.status
          : "Aberta",
      updatedAt:
        candidate.updatedAt || candidate.createdAt || new Date().toISOString(),
      actions: Array.isArray(candidate.actions)
        ? candidate.actions
            .filter((action): action is TaskAction => Boolean(action?.note))
            .map((action, actionIndex) => ({
              id: action.id || `acao-${index}-${actionIndex}`,
              note: action.note,
              createdAt: action.createdAt || new Date().toISOString(),
            }))
        : [],
    };
  });
}

function openWorkspaceDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(workspaceDatabase, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(workspaceStore))
        request.result.createObjectStore(workspaceStore);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function loadWorkspace() {
  const database = await openWorkspaceDatabase();
  return new Promise<PersistedWorkspace | null>((resolve, reject) => {
    const request = database
      .transaction(workspaceStore, "readonly")
      .objectStore(workspaceStore)
      .get(workspaceRecord);
    request.onerror = () => reject(request.error);
    request.onsuccess = () =>
      resolve((request.result as PersistedWorkspace | undefined) || null);
  }).finally(() => database.close());
}
async function saveWorkspace(workspace: PersistedWorkspace) {
  const database = await openWorkspaceDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(workspaceStore, "readwrite");
    transaction.objectStore(workspaceStore).put(workspace, workspaceRecord);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  }).finally(() => database.close());
}
function localWorkspaceSnapshot(
  workspace: PersistedWorkspace,
): PersistedWorkspace {
  // A fonte operacional é central. Manter planilhas completas no IndexedDB
  // duplicava dezenas de MB e podia travar a aba depois de uma importação.
  // Localmente ficam apenas configurações, dimensões e histórico de tarefas.
  return { ...workspace, datasets: { ...emptyDatasets } };
}

function bytesToBase64(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    output += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return window.btoa(output);
}
function workspaceCodec<T>(action: "decode" | "encode", value: unknown) {
  if (typeof Worker === "undefined")
    return Promise.reject(new Error("Worker indisponível"));
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/workspace-codec.worker.ts", import.meta.url),
      { type: "module" },
    );
    const id = `workspace-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => worker.terminate();
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Não foi possível processar a base central em segundo plano.",
        ),
      );
    };
    worker.onmessage = ({
      data,
    }: MessageEvent<{ error?: string; id: string; value?: T }>) => {
      if (data.id !== id) return;
      cleanup();
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      resolve(data.value as T);
    };
    worker.postMessage({ action, id, value });
  });
}
async function encodeRemoteWorkspace(workspace: PersistedWorkspace) {
  try {
    return await workspaceCodec<{
      encoding: "gzip-base64" | "json";
      data: unknown;
    }>("encode", workspace);
  } catch {
    const bytes = new TextEncoder().encode(JSON.stringify(workspace));
    if (!("CompressionStream" in window))
      return { encoding: "json", data: workspace };
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return { encoding: "gzip-base64", data: bytesToBase64(compressed) };
  }
}
async function decodeRemoteWorkspace(
  payload: unknown,
): Promise<PersistedWorkspace | null> {
  if (!payload || typeof payload !== "object") return null;
  const stored = payload as { encoding?: string; data?: unknown };
  try {
    return await workspaceCodec<PersistedWorkspace | null>("decode", stored);
  } catch {
    if (stored.encoding === "json") return stored.data as PersistedWorkspace;
    if (
      stored.encoding !== "gzip-base64" ||
      typeof stored.data !== "string" ||
      !("DecompressionStream" in window)
    )
      return null;
    const stream = new Blob([base64ToBytes(stored.data)])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text()) as PersistedWorkspace;
  }
}

function dateFromPlan(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value ?? "").trim();
  const serial = Number(raw.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    // Excel conta dias desde 30/12/1899. A conversão local evita carregar a
    // biblioteca de planilhas apenas para interpretar uma data de planejamento.
    const date = new Date(1899, 11, 30);
    date.setDate(date.getDate() + Math.floor(serial));
    return date;
  }
  const match = /^(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{2,4})$/.exec(raw);
  if (match) {
    const year = Number(match[3].length === 2 ? "20" + match[3] : match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1]));
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function logisticsDimensionFor(value: string, bundle: DimensionBundle) {
  const key = normalizeMaterial(value);
  if (!key) return undefined;
  const exact = bundle.materials[key];
  if (exact) return exact;
  // O WebAgil pode trazer a apresentação completa (por exemplo, PRETORIAN
  // 240 SC 4X5L) enquanto a dimensão está cadastrada como PRETORIAN.
  // Usa somente um nome de dimensão com tamanho suficiente, escolhendo o
  // mais específico, para não transformar códigos SAP em chave de negócio.
  const matches = Object.entries(bundle.materials)
    .filter(([candidate]) => candidate.length >= 5 && key.includes(candidate))
    .sort(([left], [right]) => right.length - left.length);
  return matches[0]?.[1];
}

async function parseImportFile(
  file: File,
  source: Pick<(typeof sourceConfig)[number], "key" | "header">,
) {
  const buffer = await file.arrayBuffer();
  return new Promise<{ rows: Row[]; rowCount: number; sheets: string[] }>(
    (resolve, reject) => {
      const worker = new Worker(
        new URL("../workers/import-worker.ts", import.meta.url),
        { type: "module" },
      );
      const id = `${source.key}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const cleanup = () => worker.terminate();
      worker.onerror = () => {
        cleanup();
        reject(new Error(`Não foi possível processar ${file.name}.`));
      };
      worker.onmessage = ({
        data,
      }: MessageEvent<{
        error?: string;
        id: string;
        rowCount?: number;
        rows?: Row[];
        sheets?: string[];
      }>) => {
        if (data.id !== id) return;
        cleanup();
        if (data.error || !data.rows) {
          reject(
            new Error(data.error || `Não foi possível processar ${file.name}.`),
          );
          return;
        }
        resolve({
          rows: data.rows,
          rowCount: data.rowCount || data.rows.length,
          sheets: data.sheets || [],
        });
      };
      worker.postMessage(
        { buffer, header: source.header, id, key: source.key },
        [buffer],
      );
    },
  );
}
function importWarnings(rows: Row[], source: SourceKey) {
  const materialRequired = source !== "planejamento" && source !== "execucao";
  let missingMaterial = 0;
  let missingQuantity = 0;
  rows.forEach((row) => {
    const material = readText(
      row,
      "Produto",
      "Texto breve material",
      "Descrição Material",
      "Descricao Material",
      "Descrição Produto",
      "Descricao Produto",
      "Texto material",
    );
    const quantity = readText(
      row,
      "Quantidade",
      "Qt. Solicitada",
      "Qt Solicitada",
      "Saldo",
      "Util.livre",
      "Saldo Forn",
      "Qtd.pedido",
      "Qtde. talhão",
      "Qtd.retirada",
    );
    if (materialRequired && !material) missingMaterial += 1;
    if (material && !quantity) missingQuantity += 1;
  });
  return {
    missingMaterial,
    missingQuantity,
    total: missingMaterial + missingQuantity,
  };
}
function statusExcluded(row: Row, status: string) {
  return (
    headerKey(readText(row, "Status", "Situação", "Situacao")) ===
    headerKey(status)
  );
}
function planningProduct(row: Row, excluded: string) {
  if (statusExcluded(row, excluded)) return false;
  const classification = readText(
    row,
    "Classificação",
    "Classificacao",
    "Classificac�o",
    "Tipo",
  );
  return !classification || headerKey(classification).includes("PRODUTO");
}


function plannedApplicationDate(row: Row) {
  const value = readText(row, "DT_Aplicacao", "Data prevista", "Data planejada", "Data aplicação", "Data");
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return dateKey(date) === iso[1] + "-" + iso[2] + "-" + iso[3] ? date : null;
  }
  return dateFromPlan(value);
}

function applicationCulture(row: Row) {
  const culture = cultureFor(row);
  const key = headerKey(culture);
  if (key.startsWith("SOJA")) return "Soja";
  if (key.startsWith("ALGODAO")) return "Algodão";
  if (key.startsWith("MILHO")) return "Milho";
  return culture;
}

type ApplicationCalendarEvent = {
  id: string;
  day: string;
  cycle: string;
  culture: string;
  nucleus: string;
  operation: string;
  products: Set<string>;
  fields: Set<string>;
  sourceRows: Row[];
};

type CalendarApplicationDetail = {
  id: string;
  farm: string;
  field: string;
  activity: string;
  material: string;
  unit: string;
  volume: number;
  knownVolumes: number;
  missingVolumes: number;
  dose: number | null;
  dap: number | null;
  estimatedDose: boolean;
  estimatedDap: boolean;
};

function calendarSourceValue(row: Row, compactKey: string, ...aliases: string[]) {
  if (row._c === 1) return row[compactKey];
  for (const alias of aliases) {
    const key = Object.keys(row).find((name) => headerKey(name) === headerKey(alias));
    const value = key === undefined ? undefined : row[key];
    if (value !== undefined && value !== null && (typeof value === "number" || String(value).trim())) return value;
  }
  return undefined;
}

function calendarNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!/^[+-]?\d[\d.,\s]*$/.test(String(value ?? "").trim())) return null;
  return numberFrom(value);
}

function calendarFarmField(row: Row) {
  const wbs = readText(row, "WBS element", "WBS", "Elemento PEP");
  const parts = wbs.split(".");
  const farm = String(calendarSourceValue(row, "fa", "Fazenda", "Nome Fazenda") ?? "").trim()
    || readText(row, "Fazenda", "Centro") || parts[1] || "Não informada";
  const field = readText(row, "Talhão", "Talhao")
    || parts.slice(3).join(".") || (parts[2] || "").split("-").slice(1).join("-") || "Não informado";
  return { farm, field };
}

function calendarApplicationDetails(event: ApplicationCalendarEvent, dimensions: DimensionBundle, byField: boolean) {
  const values = new Map<string, CalendarApplicationDetail>();
  event.sourceRows.forEach((row, index) => {
    const { farm, field } = calendarFarmField(row);
    const product = productFor(row, "planning", dimensions);
    const activity = readText(row, "Atividade", "Operação", "Tar.") || event.operation;
    const unit = String(calendarSourceValue(row, "um", ...sapUnitHeaders) ?? "").trim();
    let volume = calendarNumeric(calendarSourceValue(row, "q", "Qtde. talhão", "Qtde talhão", "Quantidade"));
    // Older compacted rows may have stored an already adjusted volume in q.
    // Never present ambiguous standardized volume as the original material.
    if (row._c === 1 && row.qr !== 1 && product.canonicalKey !== normalizeMaterial(product.rawName)
      && volume !== null && volume === calendarNumeric(row.aq)) volume = null;
    let dose = calendarNumeric(calendarSourceValue(row, "dp", "Dose planejada", "Dose", "Dose por ha", "Dose/ha"));
    let estimatedDose = false;
    const area = planningArea(row);
    if (dose === null && volume !== null && area > 0) {
      dose = volume / area;
      estimatedDose = true;
    }
    let dap = calendarNumeric(calendarSourceValue(row, "dap", "DAP planejado", "DAP", "Dias após plantio", "Dias apos plantio", "Dias"));
    let estimatedDap = false;
    if (dap === null) {
      const planted = plannedApplicationDate({ DT_Aplicacao: readText(row, "DT_Plantio", "Data de plantio", "Data Plantio", "Dt. Plantio", "Plantio") });
      const application = plannedApplicationDate(row);
      if (planted && application) {
        const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
        dap = (day(application) - day(planted)) / 86400000;
        estimatedDap = true;
      }
    }
    // Different doses, DAPs or units must not be averaged or summed together.
    // Missing farm/field information must not merge unrelated source records.
    const key = JSON.stringify([farm, byField ? field : "", activity, product.rawName, unit, dose, dap,
      farm === "Não informada" || (byField && field === "Não informado") ? index : null]);
    const item = values.get(key) || {
      id: key, farm, field: byField ? field : "", activity, material: product.rawName, unit,
      volume: 0, knownVolumes: 0, missingVolumes: 0, dose, dap, estimatedDose: false, estimatedDap: false,
    };
    if (volume === null) item.missingVolumes += 1;
    else { item.volume += volume; item.knownVolumes += 1; }
    item.estimatedDose ||= estimatedDose;
    item.estimatedDap ||= estimatedDap;
    values.set(key, item);
  });
  return [...values.values()].sort((a,b) => a.farm.localeCompare(b.farm, "pt-BR", { numeric: true }) || a.field.localeCompare(b.field, "pt-BR", { numeric: true }) || a.activity.localeCompare(b.activity) || a.material.localeCompare(b.material) || (a.dap ?? 0) - (b.dap ?? 0));
}

function calendarDetailNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 }).format(value);
}

function calendarCycleTone(cycle: string) {
  return cycle === "Safra"
    ? "border-emerald-600 bg-emerald-50 text-emerald-950"
    : cycle === "Safrinha"
      ? "border-amber-500 bg-amber-50 text-amber-950"
      : "border-slate-400 bg-slate-100 text-slate-800";
}

function calendarAddDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function calendarMonday(date: Date) {
  return calendarAddDays(date, -((date.getDay() + 6) % 7));
}

function PlanningApplicationCalendar({
  rows, dimensions, farmToNucleus, operatorNucleus,
}: {
  rows: Row[];
  dimensions: DimensionBundle;
  farmToNucleus: Record<string, string>;
  operatorNucleus: string;
}) {
  const [view, setView] = useState<"Anual" | "Mensal" | "Semanal">("Mensal");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [cycle, setCycle] = useState("Todos");
  const [culture, setCulture] = useState("Todas");
  const [nucleus, setNucleus] = useState("Todos");
  const [search, setSearch] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [byField, setByField] = useState(false);
  const closeDetailRef = useRef<HTMLButtonElement>(null);
  const data = useMemo(() => {
    const entries = new Map<string, ApplicationCalendarEvent>();
    const cultures = new Set<string>();
    const nuclei = new Set<string>();
    let missingDates = 0;
    rows.forEach((row) => {
      const unit = planningNucleusFor(row, dimensions, farmToNucleus);
      if (operatorNucleus && unit !== operatorNucleus) return;
      const product = productFor(row, "planning", dimensions);
      if (product.rawName === "Sem descrição") return;
      const crop = applicationCulture(row);
      const season = cycleFor(row, dimensions);
      cultures.add(crop);
      nuclei.add(unit);
      const date = plannedApplicationDate(row);
      if (!date) { missingDates += 1; return; }
      const day = dateKey(date);
      const operation = readText(row, "Atividade", "Operação", "Tar.") || product.subgroup || "Aplicação";
      const id = JSON.stringify([day, season, crop, unit, operation]);
      const event = entries.get(id) || {
        id, day, cycle: season, culture: crop, nucleus: unit, operation,
        products: new Set<string>(), fields: new Set<string>(), sourceRows: [],
      };
      event.products.add(product.rawName);
      event.sourceRows.push(row);
      const { farm, field } = calendarFarmField(row);
      if (field !== "Não informado") event.fields.add([farm, field].join(" / "));
      entries.set(id, event);
    });
    return {
      events: [...entries.values()].sort((a,b) => a.day.localeCompare(b.day) || a.nucleus.localeCompare(b.nucleus) || a.operation.localeCompare(b.operation)),
      cultures: [...cultures].sort(), nuclei: [...nuclei].sort(), missingDates,
    };
  }, [rows, dimensions, farmToNucleus, operatorNucleus]);
  const filtered = useMemo(() => {
    const term = headerKey(search);
    const days = new Map<string, ApplicationCalendarEvent[]>();
    const months = new Map<string, ApplicationCalendarEvent[]>();
    data.events.forEach((event) => {
      if (cycle !== "Todos" && event.cycle !== cycle) return;
      if (culture !== "Todas" && event.culture !== culture) return;
      if (nucleus !== "Todos" && event.nucleus !== nucleus) return;
      if (term && !headerKey([event.operation, ...event.products, ...event.fields, event.nucleus].join(" ")).includes(term)) return;
      const dayEvents = days.get(event.day) || [];
      dayEvents.push(event);
      days.set(event.day, dayEvents);
      const month = event.day.slice(0, 7);
      const monthEvents = months.get(month) || [];
      monthEvents.push(event);
      months.set(month, monthEvents);
    });
    return { days, months };
  }, [data.events, cycle, culture, nucleus, search]);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = view === "Semanal" ? calendarMonday(cursor) : calendarMonday(new Date(year, month, 1));
  const count = view === "Semanal" ? 7 : Math.ceil(((new Date(year, month, 1).getDay() + 6) % 7 + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const days = Array.from({ length: count }, (_, index) => calendarAddDays(first, index));
  const shortDate = (date: Date) => date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const heading = view === "Anual" ? String(year) : view === "Mensal"
    ? cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : shortDate(first) + " – " + shortDate(calendarAddDays(first, 6)) + " de " + calendarAddDays(first, 6).getFullYear();
  const today = dateKey(new Date());
  const changeDate = (next: Date) => { setCursor(next); setSelectedDay(dateKey(next)); setSelectedEventId(null); };
  const move = (direction: number) => changeDate(view === "Semanal" ? calendarAddDays(cursor, direction * 7) : new Date(year + (view === "Anual" ? direction : 0), view === "Anual" ? month : month + direction, 1));
  const chooseDay = (date: Date) => changeDate(date);
  const monthName = (date: Date) => date.toLocaleDateString("pt-BR", { month: "long" });
  const visibleEvents = filtered.days.get(selectedDay) || [];
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId);
  const detailRows = useMemo(() => selectedEvent ? calendarApplicationDetails(selectedEvent, dimensions, byField) : [], [selectedEvent, dimensions, byField]);
  const openEvent = (event: ApplicationCalendarEvent) => {
    setSelectedDay(event.day);
    setSelectedEventId(event.id);
    setByField(false);
  };
  useEffect(() => {
    if (!selectedEventId) return;
    closeDetailRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedEventId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEventId]);
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Período anterior" className="rounded-lg border border-slate-200 px-3 py-2" onClick={() => move(-1)}>‹</button>
          <button type="button" aria-label="Próximo período" className="rounded-lg border border-slate-200 px-3 py-2" onClick={() => move(1)}>›</button>
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold" onClick={() => changeDate(new Date())}>Hoje</button>
          <h3 className="text-lg font-semibold capitalize">{heading}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 p-1" aria-label="Visão do calendário">
            {(["Anual", "Mensal", "Semanal"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={cn("rounded-md px-3 py-1.5 text-xs font-semibold", view === mode ? "bg-emerald-700 text-white" : "text-slate-600")}>{mode}</button>
            ))}
          </div>
          <input aria-label="Data do calendário" type="date" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={dateKey(cursor)} onChange={(event) => { if (event.target.value) changeDate(new Date(event.target.value + "T00:00:00")); }} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs font-medium">Ciclo
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={cycle} onChange={(event) => setCycle(event.target.value)}>{["Todos","Safra","Safrinha","Sem ciclo"].map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs font-medium">Cultura
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={culture} onChange={(event) => setCulture(event.target.value)}>{["Todas", ...data.cultures].map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs font-medium">Núcleo
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={nucleus} onChange={(event) => setNucleus(event.target.value)}>{["Todos", ...data.nuclei].map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs font-medium">Buscar operação ou produto
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Produto, operação, talhão..." />
        </label>
      </div>
      {view === "Anual" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, index) => {
            const date = new Date(year, index, 1);
            const events = filtered.months.get(monthKey(date)) || [];
            const seasons = new Map<string, number>();
            events.forEach((event) => seasons.set(event.cycle, (seasons.get(event.cycle) || 0) + 1));
            return (
              <button key={index} type="button" onClick={() => { changeDate(date); setView("Mensal"); }} className="min-h-32 rounded-xl border border-slate-200 p-4 text-left hover:border-emerald-600">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold capitalize">{monthName(date)}</span><span className="text-xs text-slate-500">{events.length} grupos</span></div>
                <div className="mt-3 flex flex-wrap gap-1">{[...seasons].map(([season, total]) => <span key={season} className={cn("rounded border-l-2 px-2 py-1 text-xs", calendarCycleTone(season))}>{season}: {total}</span>)}</div>
                <p className="mt-2 text-xs text-slate-500">{events.length ? [...new Set(events.map((event) => event.culture))].sort().join(" · ") : "Sem aplicações"}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <div className="grid min-w-[770px] grid-cols-7">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <div key={day} className="border-b border-r border-slate-200 bg-slate-50 px-2 py-3 text-center text-xs font-semibold">{day}</div>)}
            {days.map((date) => {
              const key = dateKey(date);
              const events = filtered.days.get(key) || [];
              const limit = view === "Semanal" ? 5 : 2;
              return (
                <div key={key} className={cn("min-w-0 border-b border-r border-slate-200 p-2", view === "Semanal" ? "min-h-56" : "min-h-32", view === "Mensal" && date.getMonth() !== month && "bg-slate-50/80", key === selectedDay && "ring-2 ring-inset ring-emerald-600")}>
                  <button type="button" className={cn("mb-2 flex w-full items-center justify-between gap-1 rounded px-1 py-1 text-left text-xs font-semibold", key === today ? "text-emerald-700" : "text-slate-600")} onClick={() => chooseDay(date)}><span>{String(date.getDate()).padStart(2,"0")}/{String(date.getMonth()+1).padStart(2,"0")}{key === today ? " · Hoje" : ""}</span><span>{events.length || ""}</span></button>
                  <div className="space-y-1">
                    {events.slice(0,limit).map((event) => (
                      <button key={event.id} type="button" onClick={() => openEvent(event)} title={event.operation + " · " + [...event.products].join(", ") + " · Ver planejamento"} className={cn("block w-full overflow-hidden rounded-md border-l-2 px-2 py-1.5 text-left text-xs", calendarCycleTone(event.cycle))}>
                        <span className="block truncate font-semibold">{event.operation}</span>
                        <span className="block truncate">{event.culture} · {event.cycle}</span>
                        <span className="block truncate opacity-80">{event.nucleus}</span>
                      </button>
                    ))}
                    {events.length > limit && <button type="button" className="text-xs font-semibold text-emerald-700" onClick={() => chooseDay(date)}>+{events.length - limit} grupos · Ver dia</button>}
                    {!events.length && view === "Semanal" && <p className="text-xs text-slate-400">Sem aplicações</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {["Safra", "Safrinha", "Sem ciclo"].map((item) => <span key={item} className={cn("rounded border-l-2 px-2 py-1", calendarCycleTone(item))}>{item}</span>)}
        <span className="text-slate-500">Agrupamento por dia, ciclo, cultura, núcleo e operação. Datas previstas, não execução confirmada.</span>
      </div>
      {data.missingDates > 0 && <p className="text-xs text-amber-700">{data.missingDates} registros de planejamento sem data reconhecida no escopo de acesso não aparecem no calendário.</p>}
      {view !== "Anual" && (
        <div className="rounded-xl border border-slate-200 p-4">
          <h4 className="font-semibold">Aplicações de {new Date(selectedDay + "T00:00:00").toLocaleDateString("pt-BR")} <span className="text-xs font-normal text-slate-500">· {visibleEvents.length} grupos</span></h4>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {visibleEvents.map((event) => (
              <button key={event.id} type="button" onClick={() => openEvent(event)} className={cn("rounded-lg border-l-4 p-3 text-left text-sm hover:ring-1 hover:ring-emerald-600", calendarCycleTone(event.cycle))}>
                <span className="block font-semibold">{event.operation} · {event.culture} · {event.cycle} · {event.nucleus}</span>
                <span className="mt-2 block text-xs"><strong>Produtos:</strong> {[...event.products].sort().join(", ")}</span>
                <span className="mt-2 block text-xs font-semibold">Ver planejamento · {event.fields.size} talhões identificados</span>
              </button>
            ))}
            {!visibleEvents.length && <p className="text-sm text-slate-500">Sem aplicações para este dia e filtros.</p>}
          </div>
        </div>
      )}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-3 sm:p-6" onClick={() => setSelectedEventId(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="calendar-application-title" className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-6">
              <div>
                <h3 id="calendar-application-title" className="text-lg font-semibold">{selectedEvent.operation}</h3>
                <p className="mt-1 text-sm text-slate-600">{new Date(selectedEvent.day + "T00:00:00").toLocaleDateString("pt-BR")} · {selectedEvent.nucleus} · {selectedEvent.culture} · {selectedEvent.cycle}</p>
                <p className="mt-1 text-xs text-slate-500">{byField ? "Detalhamento por talhão" : "Resumo por fazenda"} · {detailRows.length} linhas</p>
              </div>
              <button ref={closeDetailRef} type="button" aria-label="Fechar planejamento" onClick={() => setSelectedEventId(null)} className="rounded-lg border border-slate-200 p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
              <span className="text-xs text-slate-600">Volumes do material originalmente planejado. Doses e DAP diferentes ficam em linhas separadas.</span>
              <button type="button" onClick={() => setByField(!byField)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">{byField ? "Voltar ao resumo por fazenda" : "Ver mais detalhes · Por talhão"}</button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>{["Fazenda", ...(byField ? ["Talhão"] : []), "Atividade", "Material", "Volume", "Dose", "DAP planejado"].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-medium">{row.farm}</td>
                      {byField && <td className="whitespace-nowrap px-4 py-3 font-medium">{row.field}</td>}
                      <td className="px-4 py-3">{row.activity}</td>
                      <td className="px-4 py-3">{row.material}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.knownVolumes ? calendarDetailNumber(row.volume) + (row.unit ? " " + row.unit : "") : "—"}{row.missingVolumes > 0 && <span className="block text-xs text-amber-700">{row.missingVolumes} sem volume original</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.dose === null ? "—" : calendarDetailNumber(row.dose) + (row.unit ? " " + row.unit + "/ha" : "")}{row.estimatedDose && <span className="block text-xs text-slate-500">Calculada</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.dap === null ? "—" : calendarDetailNumber(row.dap)}{row.estimatedDap && <span className="block text-xs text-slate-500">Calculado</span>}</td>
                    </tr>
                  ))}
                  {!detailRows.length && <tr><td colSpan={byField ? 7 : 6} className="px-4 py-8 text-center text-slate-500">Nenhum registro de planejamento.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:px-6">Dose e DAP são lidos do arquivo quando disponíveis. Na ausência desses campos, são calculados a partir de volume/área e data de aplicação menos data de plantio, quando possível. DAP negativo indica aplicação anterior ao plantio. Reimporte o planejamento para recuperar campos não preservados nas cargas antigas.</p>
          </section>
        </div>
      )}
    </div>
  );
}


type DapPurchase = { key: string; product: string; balance: number; center: string; dueDate: string; unit: string };
type DapPlanLine = { row: Row; id: string; nucleus: string; cycle: string; culture: string; dap: number | null; date: string; amount: number; applied: number; match: string };
function plannedDap(row: Row) {
  const explicit = calendarNumeric(calendarSourceValue(row, "dap", "DAP planejado", "DAP", "Dias após plantio", "Dias apos plantio", "Dias"));
  if (explicit !== null) return explicit;
  const planted = plannedApplicationDate({ DT_Aplicacao: readText(row, "DT_Plantio", "Data de plantio", "Data Plantio", "Dt. Plantio", "Plantio") });
  const application = plannedApplicationDate(row);
  const utc = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return planted && application ? (utc(application) - utc(planted)) / 86400000 : null;
}
function dapOperationMatch(row: Row, canonical: string) {
  const wbs = headerKey(readText(row, "WBS element", "WBS", "Elemento PEP", "Def.proj."));
  const diagram = headerKey(readText(row, "DiagRede", "Diagrama"));
  const operation = headerKey(readText(row, "Tar.", "Operação", "Operacao"));
  return wbs && diagram && operation ? JSON.stringify([wbs, diagram, operation, canonical]) : "";
}
function DapProvision({ plans, consumption, ledger, transitRows, orders, dimensions, farmToNucleus, operatorNucleus, purchasesLoaded, stockLoaded, transitLoaded, consumptionLoaded }: {
  plans: Row[]; consumption: Row[]; ledger: ReconciliationRow[]; transitRows: Row[]; orders: DapPurchase[]; dimensions: DimensionBundle;
  farmToNucleus: Record<string, string>; operatorNucleus: string; purchasesLoaded: boolean; stockLoaded: boolean; transitLoaded: boolean; consumptionLoaded: boolean;
}) {
  const [cycle, setCycle] = useState("Safrinha");
  const [culture, setCulture] = useState("Todas");
  const [initial, setInitial] = useState("-30");
  const [final, setFinal] = useState("30");
  const [nucleus, setNucleus] = useState("Todos");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState("");
  const [byField, setByField] = useState(false);
  const [exportError, setExportError] = useState("");
  const [transferMaterial, setTransferMaterial] = useState("");
  const [grain, setGrain] = useState<"Grupo" | "Subgrupo" | "Material">("Material");
  const [drill, setDrill] = useState<{ level: "Grupo" | "Subgrupo" | "Material"; key: string; label: string }[]>([]);
  const [pageSize, setPageSize] = useState("20");
  const [page, setPage] = useState(1);
  const [detailPage, setDetailPage] = useState(1);
  const lo = Number(initial), hi = Number(final);
  const valid = initial.trim() !== "" && final.trim() !== "" && Number.isInteger(lo) && Number.isInteger(hi) && lo <= hi;
  const base = useMemo(() => {
    const lines: DapPlanLine[] = [];
    const groups = new Map<string, DapPlanLine[]>();
    for (const row of plans) {
      const product = productFor(row, "planning", dimensions);
      if (product.rawName === "Sem descrição") continue;
      const amount = standardQuantity(row, "planning", product, dimensions);
      if (!(amount > 0)) continue;
      const unit = planningNucleusFor(row, dimensions, farmToNucleus);
      const match = dapOperationMatch(row, product.canonicalKey);
      const date = plannedApplicationDate(row);
      const line = { row, id: product.canonicalKey + "|" + normalizeMaterial(unit), nucleus: unit, cycle: cycleFor(row, dimensions), culture: applicationCulture(row), dap: plannedDap(row), date: date ? dateKey(date) : "", amount, applied: 0, match };
      lines.push(line);
      if (match) { const list = groups.get(match) || []; list.push(line); groups.set(match, list); }
    }
    const used = new Map<string, number>();
    let unmatched = 0;
    for (const row of consumption) {
      const p = productFor(row, "consumption", dimensions);
      const key = dapOperationMatch(row, p.canonicalKey);
      const amount = standardQuantity(row, "consumption", p, dimensions);
      const candidates = groups.get(key);
      if (!key || !candidates?.length || new Set(candidates.map((line) => JSON.stringify([line.id,line.cycle,line.culture,line.dap,line.date]))).size !== 1) { if (amount !== 0) unmatched += 1; continue; }
      used.set(key, (used.get(key) || 0) + amount);
    }
    for (const [key, amount] of used) {
      const candidates = groups.get(key)!;
      const total = candidates.reduce((sum, line) => sum + line.amount, 0);
      for (const line of candidates) line.applied = Math.max(0, Math.min(line.amount, amount * line.amount / total));
    }
    const purchase = new Map<string, { amount: number; dates: string[]; missing: number }>();
    const seen = new Set<string>();
    let unlinked = 0;
    for (const order of orders) {
      if (seen.has(order.key) || !(order.balance > 0)) continue;
      seen.add(order.key);
      const p = productFor({ Produto: order.product }, "planning", dimensions);
      const center = normalizeMaterial(order.center);
      const unit = center === "0714" ? "ARMAZÉM" : dimensions.centerToNucleus[center] || farmToNucleus[center];
      if (!unit || !p.resolvedByDimension || !order.unit || order.unit === "—") { unlinked += 1; continue; }
      const id = p.canonicalKey + "|" + normalizeMaterial(unit);
      const current = purchase.get(id) || { amount: 0, dates: [], missing: 0 };
      current.amount += standardAmount(order.balance, p, dimensions);
      const due = plannedApplicationDate({ DT_Aplicacao: order.dueDate });
      if (due) current.dates.push(dateKey(due)); else current.missing += 1;
      purchase.set(id, current);
    }
    return { lines, purchase, unmatched, unlinked, nuclei: [...new Set(lines.map((line) => line.nucleus))].sort() };
  }, [plans, consumption, orders, dimensions, farmToNucleus]);
  const report = useMemo(() => {
    const eligible = (line: DapPlanLine) => line.cycle === cycle && (culture === "Todas" || line.culture === culture);
    const selected = valid ? base.lines.filter((line) => eligible(line) && line.dap !== null && line.dap >= lo && line.dap <= hi) : [];
    const selectedSet = new Set(selected);
    const inScope = (unit: string) => (!operatorNucleus || unit === operatorNucleus) && (nucleus === "Todos" || unit === nucleus);
    const targetMaterials = new Set(selected.filter(line => inScope(line.nucleus)).map(line => productFor(line.row,"planning",dimensions).canonicalKey));
    const horizon = selected.reduce((max, line) => line.date > max ? line.date : max, "");
    const selectedById = new Map<string, DapPlanLine[]>();
    const competition = new Map<string, number>();
    const ledgers = new Map(ledger.map((row) => [row.id, row]));
    for (const line of selected) { const list = selectedById.get(line.id) || []; list.push(line); selectedById.set(line.id, list); }
    let undated = 0;
    for (const line of base.lines) {
      if (selectedSet.has(line)) continue;
      if (!line.date && line.amount > line.applied) undated += 1;
      // Demand without dates is conservatively reserved, not offered for transfers.
      if (!line.date || !horizon || line.date <= horizon) competition.set(line.id, (competition.get(line.id) || 0) + Math.max(0, line.amount - line.applied));
    }
    type CentralPool = { stock: number; transit: number; bought: number; overlap: number; stockLeft: number; transitLeft: number; boughtLeft: number; prior: number; allocatedStock: number; allocatedTransit: number; allocatedBought: number };
    const central = new Map<string, CentralPool>();
    const centralFor = (key: string) => {
      let item = central.get(key);
      if (!item) { item = { stock:0, transit:0, bought:0, overlap:0, stockLeft:0, transitLeft:0, boughtLeft:0, prior:0, allocatedStock:0, allocatedTransit:0, allocatedBought:0 }; central.set(key,item); }
      return item;
    };
    const allTransit = new Map<string, number>();
    const centralTransitByLedger = new Map<string, number>();
    for (const row of ledger) {
      centralFor(row.canonicalKey).stock += Math.max(0,row.warehouseBalance);
      allTransit.set(row.canonicalKey, (allTransit.get(row.canonicalKey) || 0) + Math.max(0,row.transit));
    }
    for (const row of transitRows) {
      const dest = readText(row,...sapTransitDestinationHeaders) || readText(row,"Cen.","Centro","CEN");
      if (!/^0*714$/.test(dest.trim())) continue;
      const product = productFor(row,"transit",dimensions);
      if (product.rawName === "Sem descrição") continue;
      const qty = standardQuantity(row,"transit",product,dimensions);
      const id = product.canonicalKey+"|"+normalizeMaterial(nucleusFor(row,dimensions,farmToNucleus));
      centralFor(product.canonicalKey).transit += qty;
      centralTransitByLedger.set(id,(centralTransitByLedger.get(id)||0)+qty);
    }
    for (const key of targetMaterials) centralFor(key);
    for (const [key,item] of central) {
      item.transit = Math.max(0,item.transit);
      item.bought = Math.max(0,base.purchase.get(key+"|"+normalizeMaterial("ARMAZÉM"))?.amount||0);
    }
    const keys = new Set([...selectedById.keys(), ...competition.keys()]);
    // Include stock-only nuclei for materials in the selected window, without treating central stock as a farm donor.
    for (const row of ledger) if (targetMaterials.has(row.canonicalKey) && /^NC-/i.test(row.nucleus) && (row.farmBalance > 0 || row.transit > 0 || (base.purchase.get(row.id)?.amount || 0) > 0)) keys.add(row.id);
    const pools = [...keys].map((id) => {
      const row = ledgers.get(id);
      if (!row) return null;
      const lines = selectedById.get(id) || [];
      const planned = lines.reduce((sum, line) => sum + line.amount, 0);
      const applied = lines.reduce((sum, line) => sum + line.applied, 0);
      const demand = Math.max(0, planned - applied);
      const prior = competition.get(id) || 0;
      const stock = Math.max(0, row.farmBalance);
      const transit = Math.max(0, row.transit - (centralTransitByLedger.get(id)||0));
      const order = base.purchase.get(id);
      const bought = normalizeMaterial(row.nucleus) === normalizeMaterial("ARMAZÉM") ? 0 : order?.amount || 0;
      return { row, lines, planned, applied, demand, prior, stock, transit, bought, warehouse: 0, warehouseTransit: 0, warehouseBought: 0, stockAfter: 0, transitAfter: 0, boughtAfter: 0, overlap: 0, shortage: 0, priorUncovered: 0, net: 0, surplus: 0, physicalSurplus: 0, transferIn: 0, transferOut: 0, projectedIn: 0, projectedOut: 0, buyNeed: 0, first: lines.filter((line) => line.amount > line.applied && line.date).map((line) => line.date).sort()[0] || "", due: order?.dates.slice().sort()[0] || "", missingDue: order?.missing || 0, status: "" };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
    // Deduct all potentially overlapping transit from supplier balances once per material.
    // No exact PO/MB5T link is assumed: this is deliberately a lower bound.
    const overlapPool = new Map(allTransit);
    // Prefer same receiving center; deduct possible overlaps once, including 0714.
    for (const [key,item] of central) {
      const available=overlapPool.get(key)||0;
      item.overlap=Math.min(item.bought,item.transit,available);
      overlapPool.set(key,available-item.overlap);
    }
    for (const p of pools) {
      const available = overlapPool.get(p.row.canonicalKey) || 0;
      p.overlap = Math.min(p.bought, p.transit, available);
      overlapPool.set(p.row.canonicalKey, available - p.overlap);
    }
    for (const p of [...pools].sort((a,b) => a.row.id.localeCompare(b.row.id))) {
      const available = overlapPool.get(p.row.canonicalKey) || 0;
      const extra = Math.min(p.bought - p.overlap, available);
      p.overlap += extra;
      overlapPool.set(p.row.canonicalKey, available - extra);
    }
    for (const [key,item] of central) {
      const available=overlapPool.get(key)||0;
      const extra=Math.min(Math.max(0,item.bought-item.overlap),available);
      item.overlap+=extra; overlapPool.set(key,available-extra);
      item.stockLeft=item.stock; item.transitLeft=item.transit; item.boughtLeft=Math.max(0,item.bought-item.overlap);
    }
    function takeCentral(key: string, need: number, prior: boolean) {
      const item=centralFor(key);
      const stock=Math.min(item.stockLeft,Math.max(0,need)); item.stockLeft-=stock; need-=stock;
      const transit=Math.min(item.transitLeft,Math.max(0,need)); item.transitLeft-=transit; need-=transit;
      const bought=Math.min(item.boughtLeft,Math.max(0,need)); item.boughtLeft-=bought;
      if (prior) item.prior+=stock+transit+bought;
      else { item.allocatedStock+=stock; item.allocatedTransit+=transit; item.allocatedBought+=bought; }
      return {stock,transit,bought};
    }
    // Reserve stock for every competing demand before allocating the target window.
    for (const p of pools) {
      let prior = p.prior;
      const used = Math.min(prior, p.stock); prior -= used; p.stockAfter = p.stock - used;
      const transit = Math.min(prior, p.transit); prior -= transit; p.transitAfter = p.transit - transit;
      const netBought = Math.max(0, p.bought - p.overlap);
      const bought = Math.min(prior, netBought); prior -= bought; p.boughtAfter = netBought - bought;
      p.priorUncovered = prior;
    }
    // Shared warehouse is reserved for competing needs before assigning the target.
    for (const p of [...pools].sort((a,b) => a.row.id.localeCompare(b.row.id))) {
      const used=takeCentral(p.row.canonicalKey,p.priorUncovered,true);
      p.priorUncovered=Math.max(0,p.priorUncovered-used.stock-used.transit-used.bought);
    }
    for (const p of [...pools].sort((a,b) => (a.first || "9999").localeCompare(b.first || "9999") || a.row.id.localeCompare(b.row.id))) {
      const used=takeCentral(p.row.canonicalKey,Math.max(0,p.demand-p.stockAfter-p.transitAfter-p.boughtAfter),false);
      p.warehouse=used.stock; p.warehouseTransit=used.transit; p.warehouseBought=used.bought;
      p.shortage = Math.max(0, p.demand - p.stockAfter - p.warehouse - p.transitAfter - p.boughtAfter - p.warehouseTransit - p.warehouseBought);
      p.status = !p.lines.length ? "Sem demanda na janela" : p.demand <= 0.000001 ? "Aplicado" : p.demand <= p.stockAfter + p.warehouse + 0.000001 ? "Atendido com estoque" : p.demand <= p.stockAfter + p.warehouse + p.transitAfter + p.warehouseTransit + 0.000001 ? "Dependente de trânsito" : p.shortage <= 0.000001 ? "Dependente de fornecedor" : purchasesLoaded ? "Falta cobertura identificada" : "Compras não importadas";
    }
    // Remanejamento is a scenario, not a stock reservation or SAP transfer.
    // Only pools inside the visible scope may exchange quantities.
    const transfers: { material: string; canonical: string; origin: string; destination: string; amount: number; type: "Estoque físico" | "Dependente de entrega" }[] = [];
    const visiblePools = pools.filter(p => inScope(p.row.nucleus) && targetMaterials.has(p.row.canonicalKey) && (p.lines.length > 0 || (/^NC-/i.test(p.row.nucleus) && (p.stock > 0 || p.transit > 0 || p.bought > 0))));
    const byMaterial = new Map<string, typeof visiblePools>();
    for (const p of visiblePools) {
      p.net = p.stockAfter + p.warehouse + p.transitAfter + p.boughtAfter + p.warehouseTransit + p.warehouseBought - p.demand;
      p.surplus = p.priorUncovered > 0.000001 ? 0 : Math.max(0, p.net);
      // Physical surplus must cover own entire remaining window without relying on receipts.
      p.physicalSurplus = Math.min(p.surplus, Math.max(0, p.stockAfter - p.demand));
      p.buyNeed = p.shortage;
      if (/^NC-/i.test(p.row.nucleus)) {
        const group = byMaterial.get(p.row.canonicalKey) || [];
        group.push(p); byMaterial.set(p.row.canonicalKey, group);
      }
    }
    for (const group of byMaterial.values()) {
      const recipients = group.filter(p=>p.shortage>0.000001).sort((a,b)=>(a.first||"9999").localeCompare(b.first||"9999") || a.row.id.localeCompare(b.row.id));
      const donors = group.filter(p=>p.surplus>0.000001).sort((a,b)=>b.physicalSurplus-a.physicalSurplus || a.row.id.localeCompare(b.row.id));
      for (const kind of ["Estoque físico","Dependente de entrega"] as const) {
        for (const receiver of recipients) for (const donor of donors) {
          if (receiver.row.id === donor.row.id || receiver.buyNeed <= 0.000001) continue;
          const left = kind === "Estoque físico" ? donor.physicalSurplus-donor.transferOut : donor.surplus-donor.transferOut-donor.projectedOut;
          const amount = Math.min(receiver.buyNeed, Math.max(0,left));
          if (amount <= 0.000001) continue;
          if (kind === "Estoque físico") { donor.transferOut += amount; receiver.transferIn += amount; }
          else { donor.projectedOut += amount; receiver.projectedIn += amount; }
          receiver.buyNeed = Math.max(0,receiver.buyNeed-amount);
          transfers.push({ material:receiver.row.standardMaterial, canonical:receiver.row.canonicalKey, origin:donor.row.nucleus, destination:receiver.row.nucleus, amount, type:kind });
        }
      }
    }
    const scoped = (line: DapPlanLine) => inScope(line.nucleus);
    const visibleDates = selected.filter(scoped).map((line) => line.date).filter(Boolean).sort();
    return { transfers, central, rows: visiblePools.sort((a,b) => b.shortage - a.shortage || a.row.standardMaterial.localeCompare(b.row.standardMaterial)), first: visibleDates[0] || "", horizon: visibleDates[visibleDates.length - 1] || "", undated,
      missingDap: base.lines.filter((line) => eligible(line) && scoped(line) && line.dap === null).length,
      missingDate: selected.filter((line) => scoped(line) && !line.date).length };
  }, [base, cycle, culture, valid, lo, hi, ledger, operatorNucleus, nucleus, purchasesLoaded, dimensions, transitRows, farmToNucleus]);
  type Pool = typeof report.rows[number];
  type Level = "Grupo" | "Subgrupo" | "Material" | "Núcleo";
  const groupKey = (p: Pool) => p.row.merchandiseGroup || "Sem grupo";
  const subgroupKey = (p: Pool) => JSON.stringify([groupKey(p), p.row.subgroup || "Sem subgrupo"]);
  const keyFor = (p: Pool, level: Level) => level === "Grupo" ? groupKey(p) : level === "Subgrupo" ? subgroupKey(p) : level === "Material" ? p.row.canonicalKey : p.row.id;
  const labelFor = (p: Pool, level: Level) => level === "Grupo" ? groupKey(p) : level === "Subgrupo" ? p.row.subgroup || "Sem subgrupo" : level === "Material" ? p.row.standardMaterial : p.row.nucleus;
  const shown = report.rows.filter((p) => !search.trim() || headerKey([p.row.standardMaterial,p.row.active,p.row.nucleus,groupKey(p),p.row.subgroup,...p.lines.map((line) => line.culture)].join(" ")).includes(headerKey(search)));
  const scopedRows = shown.filter((p) => drill.every((step) => keyFor(p, step.level) === step.key));
  const lastLevel = drill[drill.length - 1]?.level;
  const level: Level = !lastLevel ? grain : lastLevel === "Grupo" ? "Subgrupo" : lastLevel === "Subgrupo" ? "Material" : "Núcleo";
  function bucketRows(rows: Pool[], bucketLevel: Level) {
    const map = new Map<string, Pool[]>();
    for (const p of rows) {
      const key = keyFor(p, bucketLevel);
      const entries = map.get(key) || [];
      entries.push(p); map.set(key, entries);
    }
    return [...map].map(([key, pools]) => {
      const first = pools[0];
      const sum = (field: "planned" | "applied" | "demand" | "prior" | "stock" | "stockAfter" | "warehouse" | "warehouseTransit" | "warehouseBought" | "transit" | "transitAfter" | "bought" | "boughtAfter" | "shortage" | "net" | "surplus" | "physicalSurplus" | "transferIn" | "transferOut" | "projectedIn" | "projectedOut" | "buyNeed") => pools.reduce((total,p) => total + p[field], 0);
      const materials = new Set(pools.map((p) => p.row.canonicalKey));
      const uncovered = new Set(pools.filter((p) => p.buyNeed > 0.000001).map((p) => p.row.canonicalKey));
      const delivery = new Set(pools.filter((p) => p.status.startsWith("Dependente") || p.projectedIn > 0.000001 || p.transferIn > 0.000001).map((p) => p.row.canonicalKey));
      const covered = [...materials].filter((key) => !uncovered.has(key) && !delivery.has(key)).length;
      const lack = sum("shortage");
      const purchaseNeed = sum("buyNeed");
      const transfer = sum("transferIn")+sum("projectedIn");
      return { key, label: labelFor(first, bucketLevel), pools, group: groupKey(first), subgroup: first.row.subgroup, active: first.row.active,
        cultures: [...new Set(pools.flatMap((p) => p.lines.map((line) => line.culture)))].sort().join(", "),
        materialCount: materials.size, nucleusCount: new Set(pools.map((p) => p.row.nucleus)).size,
        uncoveredCount: uncovered.size, deliveryCount: [...delivery].filter((key) => !uncovered.has(key)).length, coveredCount: covered,
        shortage: lack, net:sum("net"), surplus:sum("surplus"), physicalSurplus:sum("physicalSurplus"), transferIn:sum("transferIn"), transferOut:sum("transferOut"), projectedIn:sum("projectedIn"), projectedOut:sum("projectedOut"), buyNeed:purchaseNeed, planned: sum("planned"), applied: sum("applied"), demand: sum("demand"), prior: sum("prior"), stock: sum("stock"), stockAfter: sum("stockAfter"), warehouse: sum("warehouse"), warehouseTransit:sum("warehouseTransit"), warehouseBought:sum("warehouseBought"), transit: sum("transit"), transitAfter: sum("transitAfter"), bought: sum("bought"), boughtAfter: sum("boughtAfter"),
        status: lack > 0.000001 ? (!purchasesLoaded ? "Compras não importadas" : purchaseNeed > 0.000001 ? "Compra potencial necessária" : transfer > 0.000001 ? "Remanejamento potencial" : "Falta cobertura identificada") : pools.some((p) => p.status === "Dependente de fornecedor") ? "Dependente de fornecedor" : pools.some((p) => p.status === "Dependente de trânsito") ? "Dependente de trânsito" : pools.every((p) => p.status === "Sem demanda na janela") ? "Sem demanda na janela" : pools.every((p) => p.status === "Aplicado" || p.status === "Sem demanda na janela") ? "Aplicado" : "Atendido com estoque",
      };
    }).sort((a,b) => (bucketLevel === "Grupo" || bucketLevel === "Subgrupo" ? b.uncoveredCount - a.uncoveredCount : Number(b.shortage > 0.000001) - Number(a.shortage > 0.000001)) || a.label.localeCompare(b.label,"pt-BR"));
  }
  const buckets = bucketRows(scopedRows, level);
  const materialBuckets = bucketRows(shown, "Material");
  const groupBuckets = bucketRows(shown, "Grupo");
  const subgroupBuckets = bucketRows(shown, "Subgrupo");
  const macro = level === "Grupo" || level === "Subgrupo";
  const showCentralTotals = !operatorNucleus && nucleus === "Todos";
  const centralTotals = (key: string) => report.central.get(key);
  const centralResidual = (key: string) => { const item=centralTotals(key); return item ? item.stockLeft+item.transitLeft+item.boughtLeft : 0; };
  const size = pageSize === "Todos" ? Math.max(1,buckets.length) : Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(buckets.length / size));
  const currentPage = Math.min(page,pageCount);
  const visible = buckets.slice((currentPage-1)*size,currentPage*size);
  useEffect(() => { setPage(1); setDrill([]); setDetailId(""); setTransferMaterial(""); }, [cycle,culture,initial,final,nucleus,search,grain]);
  useEffect(() => { setPage(1); setDetailPage(1); }, [pageSize]);
  useEffect(() => { setDetailPage(1); }, [detailId,byField]);
  function openBucket(bucket: typeof buckets[number]) {
    if (level === "Núcleo") { setDetailId(bucket.pools[0].row.id); setByField(true); }
    else { setDrill((previous) => [...previous,{ level, key:bucket.key,label:bucket.label }]); setPage(1); }
  }
  const selected = shown.find((p) => p.row.id === detailId);
  const detail = (p: typeof report.rows[number]) => p.lines.map((line) => {
    const field = calendarFarmField(line.row);
    return { Núcleo: line.nucleus, Fazenda: field.farm, Talhão: field.field, Ciclo: line.cycle, Cultura: line.culture, Atividade: readText(line.row,"Atividade","Operação","Tar."), Material: productFor(line.row,"planning",dimensions).rawName, DAP: line.dap, "Data prevista": line.date, "Planejado equivalente": line.amount, "Aplicado conciliado": line.applied, "Demanda remanescente": Math.max(0,line.amount-line.applied) };
  });
  const details = selected ? detail(selected) : [];
  const shownMaterials = new Set(shown.map(p=>p.row.canonicalKey));
  const transferRows = report.transfers.filter(t=>shownMaterials.has(t.canonical));
  const visibleTransfers = transferRows.filter(t=>t.canonical===transferMaterial);
  const summaryDetails = new Map<string, typeof details[number]>();
  for (const line of details) {
    const key = JSON.stringify([line.Fazenda, line.Ciclo, line.Cultura, line.Atividade, line.Material, line.DAP, line["Data prevista"], byField ? line.Talhão : ""]);
    const current = summaryDetails.get(key);
    if (current) { current["Planejado equivalente"] += line["Planejado equivalente"]; current["Aplicado conciliado"] += line["Aplicado conciliado"]; current["Demanda remanescente"] += line["Demanda remanescente"]; }
    else summaryDetails.set(key, { ...line });
  }
  const detailEntries = [...summaryDetails.entries()];
  const detailSize = pageSize === "Todos" ? Math.max(1, detailEntries.length) : Number(pageSize);
  const detailPageCount = Math.max(1, Math.ceil(detailEntries.length/detailSize));
  const currentDetailPage = Math.min(detailPage,detailPageCount);
  const visibleDetails = detailEntries.slice((currentDetailPage-1)*detailSize,currentDetailPage*detailSize);
  const risk = (p: typeof report.rows[number]) => p.demand <= p.stockAfter + p.warehouse + 0.000001 ? "—" : p.warehouseBought > 0.000001 || p.warehouseTransit > 0.000001 ? "Entrega central a validar" : p.first && p.due && !p.missingDue && p.due > p.first && p.demand > p.stockAfter + p.warehouse + p.transitAfter ? "Primeira compra após início" : "Prazo a validar";
  async function exportDap() {
    setExportError("");
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.utils.book_new();
      const exportMacro = (entries: typeof buckets) => entries.map((p) => ({ Classificação:p.label, Grupo:p.group, Materiais:p.materialCount, Núcleos:p.nucleusCount, "Atendidos":p.coveredCount, "Dependentes de entregas":p.deliveryCount, "Sem cobertura":p.uncoveredCount }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(materialBuckets.map((p) => ({ "Material padrão":p.label, Grupo:p.group, Subgrupo:p.subgroup, "Princípio ativo":p.active, Núcleos:p.nucleusCount, Planejado:p.planned, Aplicado:p.applied, Demanda:p.demand, Concorrente:p.prior, "Estoque atual":p.stock, "Estoque residual":p.stockAfter, "Armazém físico alocado":p.warehouse, "Armazém trânsito alocado":p.warehouseTransit, "Armazém compra alocada":p.warehouseBought, "Trânsito atual":p.transit, "Trânsito residual":p.transitAfter, "Comprado a entregar":purchasesLoaded?p.bought:null, "Compra residual":purchasesLoaded?p.boughtAfter:null, "Falta cobertura por núcleo somada":p.shortage, "Saldo consolidado":p.net, "Excedente físico":p.physicalSurplus, "Excedente projetado":p.surplus, "Transferência física potencial":p.transferIn, "Transferência dependente de entrega":p.projectedIn, "Compra potencial após remanejamento":purchasesLoaded?p.buyNeed:null, Situação:p.status }))), "Materiais");
      if (showCentralTotals) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(materialBuckets.map(p=>{const item=centralTotals(p.key);return {"Material padrão":p.label,"Estoque central":item?.stock||0,"Trânsito para 0714":item?.transit||0,"Compra central bruta":purchasesLoaded?(item?.bought||0):null,"Dedução de trânsito":item?.overlap||0,"Reserva concorrente":item?.prior||0,"Físico alocado":item?.allocatedStock||0,"Trânsito alocado":item?.allocatedTransit||0,"Compra alocada":item?.allocatedBought||0,"Estoque residual":item?.stockLeft||0,"Trânsito residual":item?.transitLeft||0,"Compra residual":item?.boughtLeft||0,"Residual total":centralResidual(p.key)};})), "Armazem 0714");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportMacro(groupBuckets)), "Grupos");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportMacro(subgroupBuckets)), "Subgrupos");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(shown.map((p) => ({ Núcleo:p.row.nucleus, Grupo:p.row.merchandiseGroup, Subgrupo:p.row.subgroup, "Material padrão":p.row.standardMaterial, "Princípio ativo":p.row.active, Planejado:p.planned, "Aplicado conciliado":p.applied, Demanda:p.demand, "Demanda concorrente":p.prior, "Estoque atual":p.stock, "Estoque residual":p.stockAfter, "Armazém físico alocado":p.warehouse, "Armazém trânsito alocado":p.warehouseTransit, "Armazém compra alocada":p.warehouseBought, "Trânsito atual":p.transit, "Trânsito residual":p.transitAfter, "Comprado saldo fornecedor":purchasesLoaded ? p.bought : null, "Dedução conservadora de trânsito":p.overlap, "Compra residual":p.boughtAfter, "Falta cobertura identificada":p.shortage, "Saldo líquido":p.net, "Excedente físico":p.physicalSurplus, "Excedente projetado":p.surplus, "Receber estoque físico":p.transferIn, "Ceder estoque físico":p.transferOut, "Receber após entrega":p.projectedIn, "Ceder após entrega":p.projectedOut, "Compra potencial após remanejamento":purchasesLoaded?p.buyNeed:null, "Primeira aplicação":p.first, "Primeiro vencimento fornecedor":p.due, "Risco indicativo":risk(p), Situação:p.status }))), "Núcleos");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(shown.flatMap(detail)), "Talhões");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(transferRows.map(t=>({Material:t.material,Origem:t.origin,Destino:t.destination,"Volume equivalente":t.amount,Tipo:t.type}))), "Remanejamentos");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Ciclo:cycle,Cultura:culture,"DAP inicial":lo,"DAP final":hi,Núcleo:nucleus,"Início calendário":report.first,"Fim calendário":report.horizon, "Sem DAP":report.missingDap,"Sem data":report.missingDate,"Compras importadas":purchasesLoaded,"Estoque importado":stockLoaded,"Trânsito importado":transitLoaded,"Consumo importado":consumptionLoaded,Nota:"Exportação de todos os registros dos filtros, independente da página ou expansão. Grupo e subgrupo exibem contagem de materiais, sem somar unidades diferentes. Falta operacional soma faltas por núcleo. Remanejamento potencial usa excedente físico primeiro e excedente projetado depois, somente dentro do escopo selecionado; compra potencial é a falta restante. Não confirma viabilidade logística, validade ou chegada. Demandas sem data são reservadas conservadoramente. Projeção conservadora; demanda concorrente até o fim da janela, consumo conciliado somente por WBS/diagrama/operação/material; dedução de trânsito potencialmente sobreposto ao saldo fornecedor. Não garante chegada; compras destinadas ao 0714 rateadas em pool compartilhado; saldos sem centro reconhecido não rateados." }]), "Premissas");
      XLSX.writeFile(workbook, "provisionamento_DAP_" + cycle + "_" + lo + "_" + hi + ".xlsx");
    } catch (error) { setExportError(error instanceof Error ? error.message : "Falha ao exportar."); }
  }
  const inputClass = "rounded-lg border border-slate-200 px-3 py-2 text-sm";
  const value = (v: number) => calendarDetailNumber(v);
  return <div className="mt-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Provisionamento por DAP</h3><p className="text-xs text-slate-500">Janela relativa ao plantio de cada talhão. Volumes equivalentes ao material padrão.</p></div><button type="button" disabled={!shown.length || !valid} onClick={() => void exportDap()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Exportar Excel</button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <label className="grid gap-1 text-xs font-semibold">Ciclo<select className={inputClass} value={cycle} onChange={(e) => setCycle(e.target.value)}>{["Safra","Safrinha"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold">Cultura<select className={inputClass} value={culture} onChange={(e) => setCulture(e.target.value)}>{["Todas","Soja","Algodão","Milho"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold">DAP inicial<input type="number" step="1" className={inputClass} value={initial} onChange={(e) => setInitial(e.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold">DAP final<input type="number" step="1" className={inputClass} value={final} onChange={(e) => setFinal(e.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold">Núcleo<select className={inputClass} disabled={!!operatorNucleus} value={operatorNucleus || nucleus} onChange={(e) => setNucleus(e.target.value)}>{(operatorNucleus ? [operatorNucleus] : ["Todos", ...base.nuclei]).map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold">Buscar material<input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    </div>
    {!valid && <p className="text-sm text-rose-700">Informe DAPs inteiros, com início menor ou igual ao fim.</p>}
    <div className="grid gap-2 sm:grid-cols-4">{[["Materiais",materialBuckets.length],["Atendidos com estoque",materialBuckets.filter((p) => p.status === "Atendido com estoque" || p.status === "Aplicado").length],["Dependentes de entregas",materialBuckets.filter((p) => p.status.startsWith("Dependente")).length],["Com compra potencial",materialBuckets.filter((p) => p.buyNeed > 0.000001).length]].map(([label,count]) => <div key={label} className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-semibold">{count}</p></div>)}</div>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
      <p>Datas de aplicação no filtro: {report.first || "sem data"} a {report.horizon || "sem data"}. Reserva conservadora para demais demandas com data até o fim da janela, incluindo Safra. Saldo de fornecedor líquido estimado desconta trânsito potencialmente sobreposto; pedidos internos não são compras. O armazém compartilha estoque físico, trânsito receptor 0714 e compras com destino 0714; primeiro atende concorrentes, depois faltas após a cobertura local.</p>
      <p>{report.missingDap} registros no filtro sem DAP excluídos; {report.missingDate} selecionados sem data. {operatorNucleus ? "" : report.undated + " registros concorrentes sem data reservados conservadoramente. "}{consumptionLoaded ? "Consumo abatido somente por vínculo único WBS/diagrama/operação/material." : "CN52 não importada."} {stockLoaded ? "" : "Estoque não importado. "}{transitLoaded ? "" : "MB5T não importada. "}{purchasesLoaded ? "" : "Pedidos de compra não importados: falta comprar não pode ser concluída. "}{operatorNucleus ? "" : base.unlinked + " pedidos sem material/destino/unidade conciliados; compras destinadas ao 0714 rateadas em pool compartilhado; saldos sem centro reconhecido não rateados."}</p>
      <p>Falta operacional não é necessariamente compra. Remanejamentos são sugestões dentro do escopo selecionado: estoque físico primeiro, depois excedente dependente de entrega. Compra potencial restante pressupõe inclusive os remanejamentos futuros indicados; sem eles, some a transferência futura à compra potencial. O filtro de núcleo restringe o remanejamento ao escopo selecionado. A compra depende de validação dos dados, logística e prazos; não cria transferência nem reserva no SAP.</p>
    </div>
    {exportError && <p className="text-sm text-rose-700">{exportError}</p>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600">Segmentar por</span>
        {(["Grupo","Subgrupo","Material"] as const).map((item) => <button key={item} type="button" aria-pressed={grain===item} className={cn("rounded-lg border px-3 py-2 text-xs font-semibold",grain===item?"border-emerald-700 bg-emerald-700 text-white":"border-slate-200")} onClick={() => { setGrain(item); setDrill([]); setPage(1); setDetailId(""); }}>{item}</button>)}
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold">Linhas por página<select className={inputClass} value={pageSize} onChange={(e) => setPageSize(e.target.value)}>{["20","50","100","Todos"].map((v) => <option key={v}>{v}</option>)}</select></label>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" aria-label="Hierarquia do provisionamento">
      <button type="button" className="font-semibold text-emerald-700" onClick={() => {setDrill([]);setPage(1);}}>{grain}</button>
      {drill.map((step,index) => <span key={step.level+step.key} className="flex items-center gap-2"><span>/</span><button type="button" className="font-semibold text-emerald-700" onClick={() => {setDrill(drill.slice(0,index+1));setPage(1);}}>{step.label}</button></span>)}
      <span>/ {level}</span>
      {!!drill.length && <button type="button" className="ml-2 rounded border border-slate-200 px-2 py-1" onClick={() => {setDrill(drill.slice(0,-1));setPage(1);}}>Voltar um nível</button>}
    </div>
    <p className="text-xs text-slate-500">{macro ? "Grupos e subgrupos: indicadores por quantidade de materiais, sem somar volumes de unidades diferentes." : "Consolidado por material padrão. Falta operacional é a soma das faltas locais; saldo líquido, excedentes e remanejamentos potenciais explicam a compra restante. Núcleos sem demanda podem aparecer como doadores."} Clique na linha para detalhar.</p>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className={cn("w-full text-left text-xs", macro ? "min-w-[680px]" : "min-w-[3100px]")}><thead className="bg-slate-50"><tr>{(macro ? [level,"Materiais","Núcleos","Atendidos","Dependentes de entregas","Sem cobertura",""] : [level,"Cultura","Planejado","Aplicado","Demanda","Concorrente","Estoque atual","Estoque residual","Armazém físico alocado","Armazém trânsito alocado","Armazém compra alocada",...(level==="Material"&&showCentralTotals?["Armazém estoque total","Armazém trânsito total","Armazém comprado bruto","Armazém residual"]:[]),"Trânsito atual","Trânsito residual","Comprado a entregar (bruto)","Compra residual","Falta operacional","Saldo líquido","Excedente físico","Excedente projetado","Transferência física (receber)","Transferência futura (receber)","Ceder (físico / futuro)","Compra potencial","Prazo","Situação",""]).map((h,i) => <th key={i} className="p-3">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{visible.map((p) => <tr key={p.key} className="hover:bg-slate-50">
        <td className="p-3"><button type="button" className="text-left font-semibold text-emerald-800" onClick={() => openBucket(p)}>{p.label}<span className="block text-xs font-normal text-slate-500">{level === "Material" ? p.group+" · "+p.subgroup+" · "+p.active : level === "Subgrupo" ? p.group : level === "Núcleo" ? p.pools[0].row.standardMaterial : ""}</span></button></td>
        {macro ? <><td className="p-3">{p.materialCount}</td><td className="p-3">{p.nucleusCount}</td><td className="p-3 text-emerald-700">{p.coveredCount}</td><td className="p-3 text-amber-700">{p.deliveryCount}</td><td className="p-3 font-semibold text-rose-700">{p.uncoveredCount}</td></> : <>
          <td className="p-3">{p.cultures}</td>{[p.planned,p.applied,p.demand,p.prior,p.stock,p.stockAfter,p.warehouse,p.warehouseTransit,p.warehouseBought].map((v,i) => <td key={i} className="p-3 tabular-nums">{value(v)}</td>)}{level==="Material"&&showCentralTotals&&<><td className="p-3">{value(centralTotals(p.key)?.stock||0)}</td><td className="p-3">{value(centralTotals(p.key)?.transit||0)}</td><td className="p-3">{purchasesLoaded?value(centralTotals(p.key)?.bought||0):"—"}</td><td className="p-3">{value(centralResidual(p.key))}</td></>}{[p.transit,p.transitAfter].map((v,i)=><td key={"transit"+i} className="p-3 tabular-nums">{value(v)}</td>)}
          <td className="p-3">{purchasesLoaded?value(p.bought):"—"}</td><td className="p-3">{purchasesLoaded?value(p.boughtAfter):"—"}</td>
          <td className={cn("p-3 font-semibold",p.shortage>0.000001?"text-rose-700":"text-emerald-700")}>{value(p.shortage)}</td>
          <td className={cn("p-3 font-semibold",p.net<0?"text-rose-700":"text-emerald-700")}>{value(p.net)}</td>
          <td className="p-3">{value(p.physicalSurplus)}</td><td className="p-3">{value(p.surplus)}</td>
          <td className="p-3">{value(p.transferIn)}</td><td className="p-3">{value(p.projectedIn)}</td>
          <td className="p-3">{value(p.transferOut)} / {value(p.projectedOut)}</td>
          <td className={cn("p-3 font-semibold",p.buyNeed>0.000001?"text-rose-700":"text-emerald-700")}>{purchasesLoaded?value(p.buyNeed):"—"}</td>
          <td className="p-3">{level==="Núcleo"?risk(p.pools[0]):p.pools.some((pool)=>risk(pool)==="Primeira compra após início")?"Risco em algum núcleo":p.pools.some((pool)=>risk(pool)!=="—")?"Prazo a validar":"—"}{level==="Núcleo"&&<span className="block text-slate-500">{p.pools[0].first||"Sem data"} / {p.pools[0].due||"Sem previsão"}</span>}</td>
          <td className="p-3">{p.status}{level==="Material"&&<span className="block text-slate-500">{p.nucleusCount} núcleos · {p.pools.filter(pool=>pool.shortage>0.000001).length} com falta</span>}</td>
        </>}
        <td className="p-3"><button type="button" className="whitespace-nowrap font-semibold text-emerald-700" onClick={() => openBucket(p)}>{level==="Grupo"?"Ver subgrupos":level==="Subgrupo"?"Ver materiais":level==="Material"?"Ver núcleos":"Ver talhões"}</button>{!macro && (p.transferIn+p.transferOut+p.projectedIn+p.projectedOut)>0.000001 && <button type="button" className="mt-2 block whitespace-nowrap text-emerald-700 underline" onClick={()=>setTransferMaterial(p.pools[0].row.canonicalKey)}>Remanejamentos</button>}</td>
      </tr>)}{!visible.length&&<tr><td colSpan={macro?7:26+(level==="Material"&&showCentralTotals?4:0)} className="p-8 text-center text-slate-500">Nenhuma demanda neste filtro.</td></tr>}</tbody></table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{buckets.length ? (currentPage-1)*size+1 : 0}–{Math.min(currentPage*size,buckets.length)} de {buckets.length} registros · Página {currentPage} de {pageCount}</span><div className="flex gap-2"><button type="button" className={inputClass+" disabled:opacity-40"} disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>Anterior</button><button type="button" className={inputClass+" disabled:opacity-40"} disabled={currentPage>=pageCount} onClick={()=>setPage(currentPage+1)}>Próxima</button></div></div>
    {transferMaterial && <div role="dialog" aria-modal="true" aria-label="Remanejamentos potenciais" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-5"><div className="flex justify-between gap-2"><h3 className="font-semibold">Remanejamentos potenciais · {visibleTransfers[0]?.material||transferMaterial}</h3><button type="button" className={inputClass} onClick={()=>setTransferMaterial("")}>Fechar</button></div><p className="my-3 text-xs text-slate-500">Volumes equivalentes, não ordens de transferência. Conferir lote, disponibilidade física, validade e prazo antes da execução.</p><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{["Origem","Destino","Volume equivalente","Tipo"].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{visibleTransfers.map((t,i)=><tr key={i} className="border-b border-slate-100"><td className="p-3">{t.origin}</td><td className="p-3">{t.destination}</td><td className="p-3 font-semibold">{value(t.amount)}</td><td className="p-3">{t.type}</td></tr>)}</tbody></table></div></div>}
    {selected && <div role="dialog" aria-modal="true" aria-label="Detalhamento do provisionamento" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-2xl bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{selected.row.standardMaterial} · {selected.row.nucleus}</h3><div className="flex gap-2"><button type="button" className={inputClass} onClick={() => setByField(!byField)}>{byField ? "Resumo por fazenda" : "Ver por talhão"}</button><button type="button" className={inputClass} onClick={() => setDetailId("")}>Fechar</button></div></div><div className="mt-3 overflow-auto"><table className="w-full min-w-[850px] text-xs"><thead className="bg-slate-50"><tr>{["Fazenda",...(byField?["Talhão"]:[]),"Cultura","Atividade","Material","DAP","Data","Planejado equiv.","Aplicado","Demanda"].map((h) => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{visibleDetails.map(([key,line]) => <tr key={key} className="border-b border-slate-100"><td className="p-2">{line.Fazenda}</td>{byField && <td className="p-2">{line.Talhão}</td>}<td className="p-2">{line.Cultura}</td><td className="p-2">{line.Atividade}</td><td className="p-2">{line.Material}</td><td className="p-2">{line.DAP}</td><td className="p-2">{line["Data prevista"] || "—"}</td><td className="p-2">{value(line["Planejado equivalente"])}</td><td className="p-2">{value(line["Aplicado conciliado"])}</td><td className="p-2">{value(line["Demanda remanescente"])}</td></tr>)}</tbody></table></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{detailEntries.length} registros · Página {currentDetailPage} de {detailPageCount}</span><div className="flex items-center gap-2"><select aria-label="Linhas por página no detalhe" className={inputClass} value={pageSize} onChange={e=>setPageSize(e.target.value)}>{["20","50","100","Todos"].map(v=><option key={v}>{v}</option>)}</select><button type="button" className={inputClass+" disabled:opacity-40"} disabled={currentDetailPage<=1} onClick={()=>setDetailPage(currentDetailPage-1)}>Anterior</button><button type="button" className={inputClass+" disabled:opacity-40"} disabled={currentDetailPage>=detailPageCount} onClick={()=>setDetailPage(currentDetailPage+1)}>Próxima</button></div></div></div></div>}
  </div>;
}

function mergePremises(
  bundle: DimensionBundle,
  items: DimensionPremise[],
): DimensionBundle {
  const materials = { ...bundle.materials };
  const centerToNucleus = { ...bundle.centerToNucleus };
  const cultureToCycle = { ...bundle.cultureToCycle };
  const conversions = { ...bundle.conversions };
  items.forEach((item) => {
    const domain = headerKey(item.domain);
    const key = normalizeMaterial(item.key);
    const value = item.value.trim();
    if (!key || !value) return;
    if (domain === "MATERIAL") {
      const existing = materials[key];
      materials[key] = {
        material: item.key.trim(),
        aggregateMaterial: value,
        principleActive: existing?.principleActive || "Não informado",
        merchandiseGroup: existing?.merchandiseGroup || "Sem grupo",
        subgroup: existing?.subgroup || "Sem subgrupo",
        target: existing?.target || "",
        standardDose: existing?.standardDose || 0,
      };
    } else if (domain === "PRINCIPIOATIVO") {
      const existing = materials[key];
      materials[key] = {
        material: existing?.material || item.key.trim(),
        aggregateMaterial: existing?.aggregateMaterial || item.key.trim(),
        principleActive: value,
        merchandiseGroup: existing?.merchandiseGroup || "Sem grupo",
        subgroup: existing?.subgroup || "Sem subgrupo",
        target: existing?.target || "",
        standardDose: existing?.standardDose || 0,
      };
    } else if (
      domain === "CENTRO" ||
      domain === "FAZENDA" ||
      domain === "NUCLEO"
    ) {
      centerToNucleus[key] = value;
    } else if (domain === "CULTURA") {
      cultureToCycle[key] = value;
    } else if (domain === "CONVERSAO" || domain === "CONVERSAODEDOSE") {
      const pair = item.key.split("|").map(normalizeMaterial);
      const factor = numberFrom(value);
      if (pair[0] && pair[1] && factor > 0)
        conversions[pair[0] + "|" + pair[1]] = factor;
    }
  });
  return { materials, centerToNucleus, cultureToCycle, conversions };
}

function Card({
  label,
  value,
  note,
  tone = "slate",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "slate" | "amber" | "rose" | "emerald";
}) {
  const color = {
    slate: "border-slate-200 bg-white",
    amber: "border-amber-200 bg-amber-50/70",
    rose: "border-rose-200 bg-rose-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
  }[tone];
  return (
    <div className={cn("metric-card rounded-2xl border p-4", color)}>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">
        {value}
      </p>
      {note ? (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{note}</p>
      ) : null}
    </div>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-emerald-600"
        style={{ width: String(Math.max(0, Math.min(100, value))) + "%" }}
      />
    </div>
  );
}
function Table({
  headers,
  rows,
  empty = "Nenhum dado no recorte.",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="data-table overflow-x-auto border-y border-slate-200">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="bg-emerald-950 text-[11px] uppercase tracking-wide text-emerald-100">
          <tr>
            {headers.map((head) => (
              <th
                className="whitespace-nowrap px-3 py-3 font-semibold"
                key={head}
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td className="px-3 py-3 align-top" key={cellIndex}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                className="px-4 py-10 text-center text-slate-500"
                colSpan={headers.length}
              >
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Empty({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state grid min-h-[280px] place-items-center rounded-2xl border border-dashed border-emerald-200 bg-white p-8 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-950 text-emerald-100">
          <PackageSearch className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-xl font-bold tracking-tight">{title}</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">
          {description}
        </p>
        {actionLabel && onAction ? (
          <button
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            onClick={onAction}
            type="button"
          >
            <FileUp className="h-4 w-4" />
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
function ContentLoading({
  detail = "Lendo arquivos, conciliando materiais e atualizando os visuais.",
}: {
  detail?: string;
}) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="content-loading grid min-h-[min(68vh,620px)] place-items-center rounded-3xl p-5"
      role="status"
    >
      <div className="content-loading-card w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl">
        <div aria-hidden="true" className="pacman-scene mx-auto">
          <svg className="pacman-loader" viewBox="0 0 64 64">
            <path className="pacman-jaw-upper" d="M4 32 A28 28 0 0 1 60 32 Z" />
            <path className="pacman-jaw-lower" d="M60 32 A28 28 0 0 1 4 32 Z" />
          </svg>
          <span className="pacman-dot pacman-dot-one" />
          <span className="pacman-dot pacman-dot-two" />
          <span className="pacman-dot pacman-dot-three" />
        </div>
        <p className="mt-7 text-[11px] font-bold uppercase tracking-[.18em] text-emerald-300">
          AgroNexus 360°
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">
          Carregando conteúdo
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-emerald-100">
          {detail}
        </p>
      </div>
    </section>
  );
}
function LoginScreen({
  error,
  loading,
  onPasswordChange,
  onSubmit,
  onUsernameChange,
  password,
  username,
}: {
  error: string;
  loading: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUsernameChange: (value: string) => void;
  password: string;
  username: string;
}) {
  return (
    <main className="login-screen grid min-h-screen place-items-center p-5">
      <form
        className="login-card w-full max-w-md rounded-3xl p-7 shadow-2xl sm:p-9"
        onSubmit={onSubmit}
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-300 text-emerald-950">
          <Sprout className="h-6 w-6" />
        </div>
        <p className="mt-7 text-[11px] font-bold uppercase tracking-[.18em] text-emerald-300">
          Planejamento agrícola 360°
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
          Bem-vindo ao AgroNexus
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-emerald-100">
          Entre para acessar a base central de planejamento, insumos e tarefas.
        </p>
        <div className="mt-7 grid gap-4">
          <label className="grid gap-1.5 text-sm font-semibold text-emerald-50">
            Login
            <input
              autoComplete="username"
              className="rounded-xl border border-emerald-700/80 bg-emerald-950/50 px-3 py-3 text-base font-normal text-white outline-none placeholder:text-emerald-200/50 focus:border-emerald-300"
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder="seu.login"
              required
              value={username}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-emerald-50">
            Senha
            <input
              autoComplete="current-password"
              className="rounded-xl border border-emerald-700/80 bg-emerald-950/50 px-3 py-3 text-base font-normal text-white outline-none placeholder:text-emerald-200/50 focus:border-emerald-300"
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Sua senha"
              required
              type="password"
              value={password}
            />
          </label>
          {error ? (
            <p className="rounded-xl border border-rose-400/30 bg-rose-950/30 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          ) : null}
          <button
            className="mt-2 rounded-xl bg-emerald-300 px-4 py-3 text-sm font-bold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-70"
            disabled={loading}
            type="submit"
          >
            {loading ? "Entrando..." : "Entrar na plataforma"}
          </button>
        </div>
        <p className="mt-6 text-center text-xs leading-relaxed text-emerald-200/80">
          A carga operacional, as tarefas e os históricos são protegidos em uma
          base central.
        </p>
      </form>
    </main>
  );
}
function Navigation({
  active,
  alertCount,
  lastUpdatedAt,
  onSelect,
}: {
  active: string;
  alertCount: number;
  lastUpdatedAt?: string;
  onSelect: (value: string) => void;
}) {
  return (
    <aside className="command-sidebar fixed inset-y-0 left-0 z-20 hidden w-[264px] flex-col border-r border-emerald-950 bg-emerald-950 px-4 py-5 text-emerald-50 lg:flex">
      <div className="px-3 pb-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-300 text-emerald-950">
            <Sprout className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight">AgroNexus</p>
            <p className="text-[10px] font-semibold tracking-[.12em] text-emerald-300">
              PLANEJAMENTO 360°
            </p>
          </div>
        </div>
        <div className="mt-5 border-t border-emerald-800 pt-4">
          <p className="text-[10px] font-semibold tracking-[.1em] text-emerald-300">
            BASE OPERACIONAL
          </p>
          <p className="mt-1 text-xs font-semibold text-emerald-50">
            {lastUpdatedAt
              ? `Atualizada ${formatDateTime(lastUpdatedAt)}`
              : "Aguardando primeira importação"}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <p className="px-3 pb-2 text-[10px] font-bold tracking-[.12em] text-emerald-300">
          ANÁLISE
        </p>
        <div className="space-y-1">
          {nav.map(([label, Icon], index) => (
            <Fragment key={label}>
              {index === 4 ? (
                <p className="px-3 pb-2 pt-6 text-[10px] font-bold tracking-[.12em] text-emerald-300">
                  GESTÃO
                </p>
              ) : null}
              <button
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition",
                  active === label
                    ? "bg-emerald-300 text-emerald-950 shadow-sm"
                    : "text-emerald-100 hover:bg-emerald-900",
                )}
                onClick={() => onSelect(label)}
                type="button"
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
                {label === "Alertas" && alertCount ? (
                  <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    {alertCount > 99 ? "99+" : alertCount}
                  </span>
                ) : null}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-5 rounded-2xl border border-emerald-800 bg-emerald-900/70 p-4">
        <ShieldCheck className="h-5 w-5 text-emerald-300" />
        <p className="mt-3 text-xs font-bold text-white">
          Conciliação pelo material
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-emerald-100">
          A decisão usa o nome do material; códigos SAP servem somente ao
          diagnóstico.
        </p>
      </div>
    </aside>
  );
}

type AnalysisFiltersProps = {
  cultures: string[];
  cultureFilter: string;
  cycleFilter: string;
  cycles: string[];
  groupFilter: string;
  groups: string[];
  onCultureChange: (value: string) => void;
  onCycleChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onNucleusChange?: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSubgroupChange: (value: string) => void;
  nuclei?: string[];
  nucleusFilter?: string;
  query: string;
  subgroupFilter: string;
  subgroups: string[];
};

function AnalysisFilters({
  cultures,
  cultureFilter,
  cycleFilter,
  cycles,
  groupFilter,
  groups,
  onCultureChange,
  onCycleChange,
  onGroupChange,
  onNucleusChange,
  onQueryChange,
  onSubgroupChange,
  nuclei,
  nucleusFilter,
  query,
  subgroupFilter,
  subgroups,
}: AnalysisFiltersProps) {
  return (
    <div
      className={cn(
        "filter-bar grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2",
        nuclei ? "xl:grid-cols-6" : "xl:grid-cols-5",
      )}
    >
      <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">
        Ciclo
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
          onChange={(event) => onCycleChange(event.target.value)}
          value={cycleFilter}
        >
          {cycles.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">
        Grupo
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
          onChange={(event) => onGroupChange(event.target.value)}
          value={groupFilter}
        >
          {groups.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">
        Subgrupo
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
          onChange={(event) => onSubgroupChange(event.target.value)}
          value={subgroupFilter}
        >
          {subgroups.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">
        Cultura
        <select
          className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
          onChange={(event) => onCultureChange(event.target.value)}
          value={cultureFilter}
        >
          {cultures.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      {nuclei && nucleusFilter !== undefined && onNucleusChange ? (
        <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">
          Núcleo
          <select
            className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
            onChange={(event) => onNucleusChange(event.target.value)}
            value={nucleusFilter}
          >
            {nuclei.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="grid min-w-0 gap-1 rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs font-semibold text-slate-600">
        Buscar
        <span className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm font-normal"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Produto ou princípio ativo"
            value={query}
          />
        </span>
      </label>
    </div>
  );
}

type DemandRow = ReconciliationRow & { demand: number; local: number };
type WarehouseAllocation = {
  allocated: number;
  locations: ReconciliationRow["locations"];
};
type MonitoringRow = ReconciliationRow & { isWarehouseView?: boolean };
type PhysicalStockBalance = {
  converted: number;
  physical: number;
  hasConversion: boolean;
};
type MonitoringGroup = {
  active: string;
  rows: MonitoringRow[];
  totals: {
    applied: number;
    balance: number;
    pendingOrder: number;
    planned: number;
    toInvoice: number;
    toDeliver: number;
    transit: number;
  };
};
type PerformanceAccumulator = {
  active: string;
  appliedArea: number;
  appliedVolume: number;
  canonicalKey: string;
  cultures: Set<string>;
  cycles: Set<string>;
  merchandiseGroup: string;
  neededVolume: number;
  nucleus: string;
  plannedArea: number;
  plannedVolume: number;
  standardMaterial: string;
  subgroup: string;
};

function taskPart(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw.replace(/^0+(?=\d)/, "");
}

function taskKey(row: Row) {
  const diagram = taskPart(readText(row, "DiagRede", "Diagrama"));
  const operation = taskPart(readText(row, "Tar.", "Operação", "Operacao"));
  return diagram ? [diagram, operation].join("|") : "";
}

function planningArea(row: Row) {
  return readNumber(
    row,
    "Área executar (HA)",
    "Area executar (HA)",
    "HA_plantio",
    "HA plantio",
    "HA_talhao",
    "HA talhão",
  );
}
function isPlantingWithoutFertilizer(row: Row, excludedStatus: string) {
  if (statusExcluded(row, excludedStatus)) return false;
  const classification = headerKey(
    readText(row, "Classificação", "Classificacao", "Classificac�o", "Tipo"),
  );
  const activity = headerKey(
    readText(
      row,
      "Atividade",
      "Operação",
      "Operacao",
      "Operações",
      "Operacoes",
      "Descr. Operação",
      "Descr Operação",
      "Tar.",
    ),
  );
  return (
    classification.includes("ATIVIDADE") && activity.includes("PLANTIOSEMADUBO")
  );
}

/**
 * Rateia o estoque central apenas uma vez para cada material agregado. Sem
 * isso, o mesmo saldo 0714 poderia atender vários núcleos simultaneamente.
 */
function allocateCentralWarehouse(
  rows: DemandRow[],
  stockRows: ReconciliationRow[] = rows,
) {
  const pools = new Map<
    string,
    { amount: number; locations: ReconciliationRow["locations"] }
  >();
  stockRows.forEach((row) =>
    row.locations
      .filter((location) => location.type === "Armazém")
      .forEach((location) => {
        const pool = pools.get(row.canonicalKey) || {
          amount: 0,
          locations: [],
        };
        pool.amount += location.amount;
        pool.locations.push({ ...location });
        pools.set(row.canonicalKey, pool);
      }),
  );
  const totalAvailable = [...pools.values()].reduce(
    (sum, pool) => sum + pool.amount,
    0,
  );
  const allocations = new Map<string, WarehouseAllocation>();
  [...rows]
    .sort(
      (left, right) =>
        left.canonicalKey.localeCompare(right.canonicalKey) ||
        right.demand - right.local - (left.demand - left.local) ||
        left.nucleus.localeCompare(right.nucleus),
    )
    .forEach((row) => {
      const pool = pools.get(row.canonicalKey);
      let remaining = Math.max(0, row.demand - row.local);
      let allocated = 0;
      const locations: ReconciliationRow["locations"] = [];
      if (pool) {
        for (const location of pool.locations) {
          if (!remaining) break;
          const used = Math.min(remaining, location.amount);
          if (!used) continue;
          location.amount -= used;
          remaining -= used;
          allocated += used;
          locations.push({ ...location, amount: used });
        }
      }
      allocations.set(row.id, { allocated, locations });
    });
  return { allocations, totalAvailable };
}

function consolidateLocations(locations: ReconciliationRow["locations"]) {
  const consolidated = new Map<
    string,
    ReconciliationRow["locations"][number]
  >();
  locations.forEach((location) => {
    const key = [location.type, location.material, location.location].join(
      "\u0000",
    );
    const current = consolidated.get(key);
    consolidated.set(
      key,
      current
        ? { ...current, amount: current.amount + location.amount }
        : { ...location },
    );
  });
  return [...consolidated.values()].sort(
    (left, right) =>
      left.location.localeCompare(right.location) ||
      left.type.localeCompare(right.type),
  );
}

// Para o aviso, lote e apresentação física não devem fragmentar o saldo:
// a decisão de repasse é feita pelo total disponível em cada armazém.
function consolidateWarehouseBalances(
  locations: ReconciliationRow["locations"],
) {
  const consolidated = new Map<
    string,
    ReconciliationRow["locations"][number]
  >();
  locations
    .filter((location) => location.type === "Armazém" && location.amount > 0)
    .forEach((location) => {
      const key = normalizeMaterial(location.location);
      const current = consolidated.get(key);
      consolidated.set(
        key,
        current
          ? { ...current, amount: current.amount + location.amount }
          : { ...location },
      );
    });
  return [...consolidated.values()].sort((left, right) =>
    left.location.localeCompare(right.location),
  );
}

/**
 * Saldo transferível é uma sugestão: só considera o que sobra na fazenda de
 * outro núcleo depois da demanda da própria janela, sem prometer o mesmo saldo
 * para duas solicitações. O armazém continua sendo a primeira alternativa.
 */
function supportFromOtherNuclei(row: DemandRow, demands: DemandRow[]) {
  const locations = demands
    .filter(
      (candidate) =>
        candidate.canonicalKey === row.canonicalKey &&
        candidate.nucleus !== row.nucleus,
    )
    .flatMap((candidate) => {
      const transferable = Math.max(
        0,
        Math.min(candidate.farmBalance, candidate.local - candidate.demand),
      );
      if (!transferable || !candidate.farmBalance) return [];
      const factor = transferable / candidate.farmBalance;
      return candidate.locations
        .filter(
          (location) => location.type === "Fazenda" && location.amount > 0,
        )
        .map((location) => ({
          ...location,
          amount: location.amount * factor,
          location: `Apoio sugerido — ${candidate.nucleus} — ${location.location}`,
        }));
    });
  return consolidateLocations(locations);
}

function stockDetailKey(
  rowId: string,
  location: ReconciliationRow["locations"][number],
) {
  return [
    rowId,
    normalizeMaterial(location.material),
    location.type,
    location.location,
  ].join("\u0000");
}

function StockDetails({
  row,
  physicalBalances,
}: {
  row: MonitoringRow;
  physicalBalances: Map<string, PhysicalStockBalance>;
}) {
  const groups = new Map<
    string,
    {
      balance: number;
      locations: ReconciliationRow["locations"];
      transit: number;
    }
  >();
  row.locations.forEach((location) => {
    const current = groups.get(location.material) || {
      balance: 0,
      locations: [],
      transit: 0,
    };
    if (location.type === "Trânsito") current.transit += location.amount;
    else current.balance += location.amount;
    current.locations.push(location);
    groups.set(location.material, current);
  });
  const materials = [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white">
      <table className="w-full min-w-[980px] text-left text-xs">
        <thead className="bg-emerald-50 text-[10px] uppercase tracking-wide text-emerald-900">
          <tr>
            {[
              "Nível",
              "Material",
              "Saldo",
              "Trânsito",
              "Aplicado",
              "A entregar",
              "V. solicitado",
              "Localização",
            ].map((head) => (
              <th className="px-3 py-2 font-semibold" key={head}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-emerald-50">
          {materials.flatMap(([material, detail]) => {
            // A ZMM_BATCH possui uma linha por lote. A visão operacional soma os
            // lotes quando material, tipo de saldo e localização são os mesmos.
            const locations = consolidateLocations(detail.locations);
            const locationBalances = locations.map((location) => ({
              location,
              balance: physicalBalances.get(stockDetailKey(row.id, location)),
            }));
            const hasConversion = locationBalances.some(
              ({ balance }) => balance?.hasConversion,
            );
            const physicalBalance = locationBalances.reduce(
              (sum, { location, balance }) =>
                sum +
                (location.type === "Trânsito" ? 0 : balance?.physical || 0),
              0,
            );
            return [
              <tr className="bg-emerald-50/40" key={"material|" + material}>
                <td className="px-3 py-2 font-semibold">
                  Material
                  <br />
                  <span
                    className={cn(
                      "text-[10px]",
                      hasConversion ? "text-emerald-800" : "text-slate-500",
                    )}
                  >
                    {hasConversion ? "Com conversão" : "Sem conversão"}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold">{material}</td>
                <td className="px-3 py-2">
                  {formatNumber(detail.balance)}
                  {hasConversion ? (
                    <span className="mt-1 block text-[10px] font-semibold text-emerald-800">
                      Físico: {formatNumber(physicalBalance)}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{formatNumber(detail.transit)}</td>
                <td className="px-3 py-2 text-slate-400">—</td>
                <td className="px-3 py-2 text-slate-400">—</td>
                <td className="px-3 py-2 text-slate-400">—</td>
                <td className="px-3 py-2 text-slate-500">
                  {row.isWarehouseView
                    ? "Estoque de armazém"
                    : "Estoque do núcleo"}
                </td>
              </tr>,
              ...locationBalances.map(({ location, balance }) => (
                <tr
                  key={[
                    "location",
                    material,
                    location.type,
                    location.location,
                  ].join("|")}
                >
                  <td className="px-3 py-2 pl-7 text-slate-500">
                    ↳ Local
                    {balance?.hasConversion ? (
                      <span className="block text-[10px] font-semibold text-emerald-800">
                        Convertido
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{location.material}</td>
                  <td className="px-3 py-2">
                    {location.type === "Trânsito" ? (
                      "—"
                    ) : (
                      <>
                        {formatNumber(location.amount)}
                        {balance?.hasConversion ? (
                          <span className="mt-1 block text-[10px] font-semibold text-emerald-800">
                            Físico: {formatNumber(balance.physical)}
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {location.type === "Trânsito"
                      ? formatNumber(location.amount)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 text-slate-600">
                    {location.location}
                  </td>
                </tr>
              )),
            ];
          })}
          {!materials.length ? (
            <tr>
              <td className="px-3 py-5 text-center text-slate-500" colSpan={8}>
                Não há saldo ou trânsito detalhado para este material.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState("Visão geral");
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [datasets, setDatasets] = useState<Datasets>(emptyDatasets);
  const [uploads, setUploads] = useState<Partial<Record<SourceKey, File>>>({});
  const [imports, setImports] = useState<
    Partial<Record<ImportKey, ImportSummary>>
  >({});
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [bundle, setBundle] = useState<DimensionBundle>(emptyDimensionBundle);
  const [premises, setPremises] = useState<Premises>(initialPremises);
  const [emailSettings, setEmailSettings] =
    useState<EmailSettings>(initialEmailSettings);
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings>(
    initialDashboardSettings,
  );
  const [dimensionPremises, setDimensionPremises] = useState<
    DimensionPremise[]
  >([]);
  const [draft, setDraft] = useState<DimensionPremise>({
    domain: "Material",
    key: "",
    value: "",
  });
  const [showPremises, setShowPremises] = useState(false);
  const [premiseSection, setPremiseSection] =
    useState<PremiseSection["id"]>("operacionais");
  const [showProvision, setShowProvision] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"calendar" | "dap">("calendar");
  const [dark, setDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("agronexus-theme") === "dark",
  );
  const [cycleFilter, setCycleFilter] = useState("Safra");
  const [groupFilter, setGroupFilter] = useState("Todos");
  const [subgroupFilter, setSubgroupFilter] = useState("Todos");
  const [cultureFilter, setCultureFilter] = useState("Todos");
  const [nucleusFilter, setNucleusFilter] = useState("Todos");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [taskPendingId, setTaskPendingId] = useState("");
  const [taskLinkMode, setTaskLinkMode] = useState<"pedido" | "material">(
    "pedido",
  );
  const [taskMaterialLink, setTaskMaterialLink] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskNote, setTaskNote] = useState("");
  const [taskActionDrafts, setTaskActionDrafts] = useState<
    Record<string, string>
  >({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [logistics, setLogistics] = useState<LogisticsState>(initialLogistics);
  const [commercialClosings, setCommercialClosings] =
    useState<CommercialClosingsState>(initialCommercialClosings);
  const [closingTab, setClosingTab] = useState<
    "calendario" | "painel" | "entregas" | "distribuicoes" | "anotacoes"
  >("calendario");
  const [closingDraft, setClosingDraft] = useState({
    supplier: "",
    paymentDue: "",
    paymentMethod: "",
    destination: "",
    deliveryLocation: "",
    cycle: "Safra" as CommercialClosing["cycle"],
    culture: "",
    active: "",
    product: "",
    unit: "",
    currency: "BRL" as CommercialClosing["currency"],
    unitPrice: "",
    packaging: "",
    totalVolume: "",
    orderKey: "",
  });
  const [closingDistributionDraft, setClosingDistributionDraft] =
    useState<ClosingDistribution>({});
  const [editingClosingId, setEditingClosingId] = useState("");
  const [closingAnnotationDraft, setClosingAnnotationDraft] = useState({
    closingId: "",
    materialSent: "",
    purchaseVolume: "",
    invoicedVolume: "",
    note: "",
    resolved: false,
  });
  const [closingCycleFilter, setClosingCycleFilter] = useState("Todos");
  const [closingSupplierFilter, setClosingSupplierFilter] = useState<
    string | null
  >(null);
  const [closingCalendarPeriod, setClosingCalendarPeriod] =
    useState<ClosingCalendarPeriod>();
  const [closingQuery, setClosingQuery] = useState("");
  const [closingMessage, setClosingMessage] = useState("");
  const [logisticsTab, setLogisticsTab] = useState<
    "emissao" | "viagens" | "rodoviaria"
  >("emissao");
  const [showOrderPicker, setShowOrderPicker] = useState(false);
  const [logisticsProductFilter, setLogisticsProductFilter] = useState("");
  const [logisticsOrderFilter, setLogisticsOrderFilter] = useState("");
  const [logisticsUnitFilter, setLogisticsUnitFilter] = useState("Todos");
  const [logisticsPriorityFilter, setLogisticsPriorityFilter] =
    useState("Todas");
  const [driverDraft, setDriverDraft] = useState({
    cpf: "",
    fullName: "",
    phone: "",
  });
  const [vehicleDraft, setVehicleDraft] = useState({
    capacity: "",
    defaultDriverId: "",
    model: "",
    ownership: "interno" as "interno" | "terceiro",
    palletCapacity: "",
    plate: "",
    trackerNumber: "",
  });
  const [editingDriverId, setEditingDriverId] = useState("");
  const [editingVehicleId, setEditingVehicleId] = useState("");
  const [tripRequestId, setTripRequestId] = useState("");
  const [requestedDateSort, setRequestedDateSort] = useState<"ascending" | "descending">();
  const [tripMaterialKey, setTripMaterialKey] = useState("");
  const [tripSourceMode, setTripSourceMode] = useState<"armazem" | "coleta">(
    "armazem",
  );
  const [tripFulfillmentStockId, setTripFulfillmentStockId] = useState("");
  const [tripCollectionId, setTripCollectionId] = useState("");
  const [tripQuantity, setTripQuantity] = useState("");
  const [manualStockId, setManualStockId] = useState("");
  const [manualDestination, setManualDestination] = useState("");
  const [manualQuantity, setManualQuantity] = useState("");
  const [manualUnit, setManualUnit] = useState("UN");
  const [locationDraft, setLocationDraft] = useState({
    addressUrl: "",
    location: "",
    municipality: "",
  });
  const [editingLocationKey, setEditingLocationKey] = useState("");
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [locationResolution, setLocationResolution] = useState("");
  const [routeItems, setRouteItems] = useState<LogisticsTripItem[]>([]);
  const [tripDriverId, setTripDriverId] = useState("");
  const [tripVehicleId, setTripVehicleId] = useState("");
  const [tripDate, setTripDate] = useState(() => dateKey(new Date()));
  const [tripDepartureTime, setTripDepartureTime] = useState("09:00");
  const [editingTripId, setEditingTripId] = useState("");
  const [tripEditDraft, setTripEditDraft] = useState({
    departureTime: "09:00",
    driverId: "",
    status: "Em progresso" as NonNullable<LogisticsTrip["status"]>,
    tripDate: "",
    vehicleId: "",
  });
  const [tripEditItems, setTripEditItems] = useState<LogisticsTripItem[]>(
    [],
  );
  const [webLinkDrafts, setWebLinkDrafts] = useState<Record<string, string>>(
    {},
  );
  const [invoiceTripId, setInvoiceTripId] = useState("");
  const [tripInvoiceDraft, setTripInvoiceDraft] = useState("");
  const [invoiceBatchKey, setInvoiceBatchKey] = useState("");
  const [fiscalLinkDraft, setFiscalLinkDraft] = useState({
    lineKey: "",
    quantity: "",
    sapLot: "",
  });
  const [editingFiscalAllocationId, setEditingFiscalAllocationId] =
    useState("");
  const [fiscalEmailTripId, setFiscalEmailTripId] = useState("");
  const [fiscalEmailKind, setFiscalEmailKind] = useState<LogisticsEmailKind>("bravo");
  const [fiscalEmailBatchIds, setFiscalEmailBatchIds] = useState<string[]>(
    [],
  );
  const [appointmentTripId, setAppointmentTripId] = useState("");
  const [appointmentDraft, setAppointmentDraft] = useState("");
  const [recipeTripId, setRecipeTripId] = useState("");
  const [workflowTripId, setWorkflowTripId] = useState("");
  const [recipeDraft, setRecipeDraft] = useState<TripRecipe>({
    culture: "",
    destination: "",
    dose: "",
    product: "",
    target: "",
    volume: 0,
  });
  const [logisticsMessage, setLogisticsMessage] = useState("");
  const [taskHistorySize, setTaskHistorySize] = useState(10);
  const [taskHistoryPage, setTaskHistoryPage] = useState(0);
  const [taskSignalFilter, setTaskSignalFilter] = useState("Todos");
  const [taskOrderFilter, setTaskOrderFilter] = useState("Todos");
  const [taskNucleusFilter, setTaskNucleusFilter] = useState("Todos");
  const [taskMaterialFilter, setTaskMaterialFilter] = useState("");
  const [taskView, setTaskView] = useState<"pendentes" | "transito">("pendentes");
  const [taskTransitCenter, setTaskTransitCenter] = useState("");
  const [alertNucleusFilter, setAlertNucleusFilter] = useState("Todos");
  const [alertMaterialFilter, setAlertMaterialFilter] = useState("");
  const [alertGroupFilter, setAlertGroupFilter] = useState("Todos");
  const [alertSubgroupFilter, setAlertSubgroupFilter] = useState("Todos");
  const [notificationKind, setNotificationKind] = useState<"pendentes" | "transito" | null>(null);
  const [notificationCenter, setNotificationCenter] = useState("");
  const [notificationNucleus, setNotificationNucleus] = useState("Todos");
  const [notificationDays, setNotificationDays] = useState("7");
  const [notificationTo, setNotificationTo] = useState("");
  const [notificationCc, setNotificationCc] = useState("");
  const [notificationMessage, setNotificationMessage] = useState<{
    text: string;
    success?: boolean;
  } | null>(null);
  const [notificationSource, setNotificationSource] = useState<{
    name: string;
    rows: Row[];
  } | null>(null);
  const [notificationSourceLoading, setNotificationSourceLoading] =
    useState(false);
  const notificationSourceRequest = useRef(0);
  const [settingsTab, setSettingsTab] = useState<"premissas" | "email">(
    "premissas",
  );
  const [storageReady, setStorageReady] = useState(false);
  const [persistenceError, setPersistenceError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [userDraft, setUserDraft] = useState<UserDraft>(emptyUserDraft);
  const [userManagerLoading, setUserManagerLoading] = useState(false);
  const [userManagerMessage, setUserManagerMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [evaluationDate, setEvaluationDate] = useState(() =>
    dateKey(new Date()),
  );
  const [provisionCycle, setProvisionCycle] = useState("Todos");
  const [provisionCulture, setProvisionCulture] = useState("Todas");
  const [provisionUntil, setProvisionUntil] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 15);
    return dateKey(end);
  });
  // Perfis operacionais nunca podem cair no consolidado por ausência de cadastro.
  // O valor sentinela não existe em nenhuma fonte e, portanto, resulta em visão vazia
  // até que o administrador defina o núcleo do usuário.
  const isOperator = Boolean(currentUser && currentUser.role !== "admin");
  const operatorNucleus = isOperator
    ? currentUser?.nucleus?.trim() || "__NUCLEO_NAO_DEFINIDO__"
    : "";
  const operatorHasNucleus =
    !isOperator || operatorNucleus !== "__NUCLEO_NAO_DEFINIDO__";

  function applyWorkspace(workspace: PersistedWorkspace | null) {
    if (!workspace) return;
    setBundle(workspace.bundle || emptyDimensionBundle);
    setDatasets({ ...emptyDatasets, ...(workspace.datasets || {}) });
    setDimensionPremises(workspace.dimensionPremises || []);
    setImports(workspace.imports || {});
    setImportHistory(workspace.importHistory || []);
    setAuditEvents(workspace.auditEvents || []);
    setPremises({ ...initialPremises, ...(workspace.premises || {}) });
    setEmailSettings({
      ...initialEmailSettings,
      ...(workspace.emailSettings || {}),
      nucleusRecipients: workspace.emailSettings?.nucleusRecipients || {},
    });
    setDashboardSettings({
      ...initialDashboardSettings,
      ...(workspace.dashboardSettings || {}),
    });
    setTasks(persistedTasks(workspace.tasks));
    setLogistics({
      ...initialLogistics,
      ...(workspace.logistics || {}),
      drivers: workspace.logistics?.drivers || [],
      trips: workspace.logistics?.trips || [],
      vehicles: workspace.logistics?.vehicles || [],
    });
    setCommercialClosings({
      ...initialCommercialClosings,
      ...(workspace.commercialClosings || {}),
      annotations: workspace.commercialClosings?.annotations || [],
      closings: workspace.commercialClosings?.closings || [],
    });
  }

  function recordAudit(kind: AuditEvent["kind"], detail: string) {
    const actor = currentUser?.name || "Sistema";
    setAuditEvents((current) =>
      [
        {
          id: taskId("audit"),
          actor,
          detail,
          kind,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, 120),
    );
  }

  async function hydrateCentralWorkspace() {
    const response = await fetch("/api/workspace", { credentials: "include" });
    if (!response.ok)
      throw new Error("Não foi possível recuperar a carga central.");
    const result = (await response.json()) as { workspace?: unknown };
    const central = await decodeRemoteWorkspace(result.workspace);
    const workspace = central || (await loadWorkspace());
    applyWorkspace(workspace);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth", { credentials: "include" });
        if (!response.ok) throw new Error("Não foi possível validar a sessão.");
        const result = (await response.json()) as { user?: AppUser | null };
        if (result.user) {
          setCurrentUser(result.user);
          await hydrateCentralWorkspace();
        }
      } catch (error) {
        if (active)
          setPersistenceError(
            error instanceof Error
              ? error.message
              : "Não foi possível iniciar a base central.",
          );
      } finally {
        if (active) {
          setStorageReady(true);
          setAuthReady(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady || !currentUser) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = await encodeRemoteWorkspace({
            bundle,
            datasets,
            dimensionPremises,
            imports,
            importHistory,
            auditEvents,
            premises,
            tasks,
            logistics,
            commercialClosings,
            emailSettings,
            dashboardSettings,
          });
          const response = await fetch("/api/workspace", {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload }),
          });
          if (!response.ok)
            throw new Error("Não foi possível salvar a carga central.");
          await saveWorkspace(
            localWorkspaceSnapshot({
              bundle,
              datasets,
              dimensionPremises,
              imports,
              importHistory,
              auditEvents,
              premises,
              tasks,
              logistics,
              commercialClosings,
              emailSettings,
              dashboardSettings,
            }),
          );
        } catch (error) {
          setPersistenceError(
            error instanceof Error
              ? error.message
              : "Não foi possível salvar a carga central.",
          );
        }
      })();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    auditEvents,
    bundle,
    commercialClosings,
    currentUser,
    dashboardSettings,
    datasets,
    dimensionPremises,
    emailSettings,
    importHistory,
    imports,
    logistics,
    premises,
    storageReady,
    tasks,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOperator) return;
    // Operadores trabalham no próprio núcleo. Acompanhamento permanece geral
    // para preservar a comparação de materiais entre todos os núcleos.
    setNucleusFilter(active === "Acompanhamento" ? "Todos" : operatorNucleus);
    setAlertNucleusFilter(operatorNucleus);
    setTaskNucleusFilter(operatorNucleus);
  }, [active, isOperator, operatorNucleus]);

  const toggleTheme = () =>
    setDark((current) => {
      window.localStorage.setItem(
        "agronexus-theme",
        current ? "light" : "dark",
      );
      return !current;
    });

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.user)
        throw new Error(result.error || "Não foi possível entrar.");
      setStorageReady(false);
      setCurrentUser(result.user as AppUser);
      await hydrateCentralWorkspace();
      setLoginPassword("");
      setStorageReady(true);
    } catch (error) {
      setCurrentUser(null);
      setLoginError(
        error instanceof Error ? error.message : "Não foi possível entrar.",
      );
      setStorageReady(true);
    } finally {
      setLoggingIn(false);
    }
  }

  async function loadManagedUsers() {
    if (currentUser?.role !== "admin") return;
    setUserManagerLoading(true);
    try {
      const response = await fetch("/api/users", { credentials: "include" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error || "Não foi possível carregar os usuários.",
        );
      setManagedUsers(Array.isArray(result.users) ? result.users : []);
    } catch (error) {
      setUserManagerMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os usuários.",
      );
    } finally {
      setUserManagerLoading(false);
    }
  }

  useEffect(() => {
    if (active === "Usuários" && currentUser?.role === "admin")
      void loadManagedUsers();
  }, [active, currentUser?.id, currentUser?.role]);

  async function saveManagedUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserManagerMessage("");
    if (!userDraft.id && !userDraft.password.trim()) {
      setUserManagerMessage("Informe uma senha para a nova conta.");
      return;
    }
    setUserManagerLoading(true);
    try {
      const response = await fetch("/api/users", {
        method: userDraft.id ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...userDraft,
          nucleus: userDraft.role === "admin" ? "" : userDraft.nucleus,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || "Não foi possível salvar o usuário.");
      setUserDraft(emptyUserDraft);
      setUserManagerMessage(
        userDraft.id ? "Usuário atualizado." : "Usuário criado.",
      );
      await loadManagedUsers();
    } catch (error) {
      setUserManagerMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o usuário.",
      );
      setUserManagerLoading(false);
    }
  }

  function editManagedUser(user: ManagedUser) {
    setUserManagerMessage("");
    setUserDraft({
      id: user.id,
      name: user.name,
      nucleus: user.nucleus || "",
      password: "",
      role: user.role === "admin" ? "admin" : "viewer",
      username: user.username,
    });
  }

  async function removeManagedUser(user: ManagedUser) {
    if (
      !window.confirm(
        `Excluir a conta de ${user.name}? Esta ação não pode ser desfeita.`,
      )
    )
      return;
    setUserManagerMessage("");
    setUserManagerLoading(true);
    try {
      const response = await fetch("/api/users", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || "Não foi possível excluir o usuário.");
      if (userDraft.id === user.id) setUserDraft(emptyUserDraft);
      setUserManagerMessage("Usuário excluído.");
      await loadManagedUsers();
    } catch (error) {
      setUserManagerMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o usuário.",
      );
      setUserManagerLoading(false);
    }
  }

  const dimensions = useMemo(
    () => mergePremises(bundle, dimensionPremises),
    [bundle, dimensionPremises],
  );
  const pendingOrders = datasets.pedidos;
  const plans = useMemo(
    () =>
      datasets.planejamento.filter((row) =>
        planningProduct(row, premises.excludedStatus),
      ),
    [datasets.planejamento, premises.excludedStatus],
  );
  const plantingAreaRows = useMemo(
    () =>
      datasets.planejamento.filter((row) =>
        isPlantingWithoutFertilizer(row, premises.excludedStatus),
      ),
    [datasets.planejamento, premises.excludedStatus],
  );
  const farmToNucleus = useMemo(
    () =>
      buildFarmToNucleus([...plans, ...datasets.execucao], dimensions, plans),
    [plans, datasets.execucao, dimensions],
  );
  const stockRows = useMemo(() => {
    // A BATCH é a fonte prioritária. A MB52 completa somente apresentações
    // físicas que não aparecem nela, evitando duplicar o mesmo saldo.
    const batchMaterials = new Set(
      datasets.estoque.map((row) =>
        normalizeMaterial(productFor(row, "stock", dimensions).rawName),
      ),
    );
    const mb52Fallback = datasets.estoqueMb52.filter(
      (row) =>
        !batchMaterials.has(
          normalizeMaterial(productFor(row, "stock", dimensions).rawName),
        ),
    );
    return [...datasets.estoque, ...mb52Fallback];
  }, [datasets.estoque, datasets.estoqueMb52, dimensions]);
  const stockConversionBalances = useMemo(() => {
    const balances = new Map<
      string,
      { converted: number; physical: number; hasConversion: boolean }
    >();
    stockRows.forEach((row) => {
      const product = productFor(row, "stock", dimensions);
      if (product.rawName === "Sem descrição") return;
      const physical = quantityFor(row, "stock");
      if (!physical) return;
      const nucleus = stockNucleusFor(row, dimensions, farmToNucleus);
      const location = stockLocationFor(row, nucleus);
      const id = `${product.canonicalKey}|${normalizeMaterial(location.type === "Armazém" ? "ARMAZEM" : nucleus)}`;
      const converted = standardAmount(physical, product, dimensions);
      const current = balances.get(id) || {
        converted: 0,
        physical: 0,
        hasConversion: false,
      };
      current.converted += converted;
      current.physical += physical;
      current.hasConversion ||= Math.abs(physical - converted) > 0.000_001;
      balances.set(id, current);
    });
    return balances;
  }, [dimensions, farmToNucleus, stockRows]);
  const stockLocationConversionBalances = useMemo(() => {
    const balances = new Map<string, PhysicalStockBalance>();
    stockRows.forEach((row) => {
      const product = productFor(row, "stock", dimensions);
      if (product.rawName === "Sem descrição") return;
      const physical = quantityFor(row, "stock");
      if (!physical) return;
      const nucleus = stockNucleusFor(row, dimensions, farmToNucleus);
      const stockLocation = stockLocationFor(row, nucleus);
      const rowId = `${product.canonicalKey}|${normalizeMaterial(stockLocation.type === "Armazém" ? "ARMAZEM" : nucleus)}`;
      const converted = standardAmount(physical, product, dimensions);
      const location = {
        amount: converted,
        location: stockLocation.place,
        material: product.rawName,
        type: stockLocation.type,
      } as ReconciliationRow["locations"][number];
      const key = stockDetailKey(rowId, location);
      const current = balances.get(key) || {
        converted: 0,
        physical: 0,
        hasConversion: false,
      };
      current.converted += converted;
      current.physical += physical;
      current.hasConversion ||= Math.abs(physical - converted) > 0.000_001;
      balances.set(key, current);
    });
    return balances;
  }, [dimensions, farmToNucleus, stockRows]);
  const ledger = useMemo(
    () =>
      buildReconciliation({
        bundle: dimensions,
        planningRows: plans,
        stockRows,
        transitRows: datasets.transito,
        consumptionRows: datasets.consumo,
        pendingRows: pendingOrders,
        farmToNucleus,
      }),
    [
      dimensions,
      plans,
      stockRows,
      datasets.transito,
      datasets.consumo,
      pendingOrders,
      farmToNucleus,
    ],
  );
  const logisticsCycleLedger = useMemo(
    () =>
      buildReconciliation({
        bundle: dimensions,
        planningRows:
          dashboardSettings.daeCycle === "Ambos"
            ? plans
            : plans.filter(
                (row) =>
                  cycleFor(row, dimensions) === dashboardSettings.daeCycle,
              ),
        stockRows,
        transitRows: datasets.transito,
        consumptionRows:
          dashboardSettings.daeCycle === "Ambos"
            ? datasets.consumo
            : datasets.consumo.filter(
                (row) =>
                  cycleFor(row, dimensions) === dashboardSettings.daeCycle,
              ),
        pendingRows: pendingOrders,
        farmToNucleus,
      }),
    [
      dashboardSettings.daeCycle,
      datasets.consumo,
      datasets.transito,
      dimensions,
      farmToNucleus,
      pendingOrders,
      plans,
      stockRows,
    ],
  );

  const commercialOrders = useMemo(
    () =>
      datasets.pedidosCompra
        .filter(
          (row) =>
            !["SIM", "S", "X", "TRUE"].includes(
              headerKey(readText(row, "Eliminado?", "Eliminado", "Cancelado")),
            ),
        )
        .map((row, index) => {
          const orderNumber = readText(
            row,
            "Doc.compra",
            "Documento de compra",
            "Pedido",
          );
          const item = readText(row, "Item") || String(index + 1);
          const product = readText(
            row,
            "Descrição Material",
            "Descricao Material",
            "Produto",
          );
          const dimension = dimensions.materials[normalizeMaterial(product)];
          const ordered = readNumber(
            row,
            "Qtd.pedido",
            "Qtd pedido",
            "Quantidade pedido",
          );
          const supplied = readNumber(
            row,
            "Qtde. Forn",
            "Qtde. Fornecida",
            "Quantidade fornecida",
          );
          const balanceText = readText(
            row,
            "Saldo Forn",
            "Saldo fornecer",
            "Saldo fornecedor",
          );
          return {
            key: `${orderNumber}|${item}|${normalizeMaterial(product)}`,
            orderNumber,
            item,
            product,
            standardProduct: dimension?.aggregateMaterial || product,
            active: dimension?.principleActive || "Não conciliado",
            supplier: readText(row, "Nome Fornecedor", "Fornecedor"),
            dueDate: readText(row, "Vencimento"),
            unit: readText(row, "UMP", "Unidade") || "—",
            currency:
              headerKey(readText(row, "Moeda")) === "USD"
                ? ("USD" as const)
                : ("BRL" as const),
            unitPrice: readNumber(
              row,
              "Preco Brut",
              "Preço líq.",
              "Preco liq.",
            ),
            ordered,
            supplied,
            // Quando a coluna Saldo Forn não existir, o saldo aberto ainda
            // pode ser reconciliado pelo pedido menos o já fornecido.
            balance: balanceText
              ? readNumber(
                  row,
                  "Saldo Forn",
                  "Saldo fornecer",
                  "Saldo fornecedor",
                )
              : Math.max(0, ordered - supplied),
            center: readText(row, "Centro"),
            status: readText(
              row,
              "Código de",
              "Codigo de",
              "Status",
              "Aprovador(es)",
            ),
          };
        })
        .filter((order) => Boolean(order.orderNumber && order.product)),
    [datasets.pedidosCompra, dimensions],
  );

  const commercialMaterialOptions = useMemo(() => {
    const entries = new Map<string, { active: string; product: string }>();
    Object.values(dimensions.materials).forEach((material) => {
      const product = material.aggregateMaterial || material.material;
      const key = normalizeMaterial(product);
      if (!entries.has(key))
        entries.set(key, { active: material.principleActive, product });
    });
    return [...entries.values()].sort((left, right) =>
      left.product.localeCompare(right.product),
    );
  }, [dimensions]);

  const planningDistribution = useMemo(() => {
    type PlanningSchedule = {
      active: string;
      cycle: string;
      culture: string;
      merchandiseGroup: string;
      months: Record<string, number>;
      planned: number;
      product: string;
      subgroup: string;
    };
    const values = new Map<string, PlanningSchedule>();
    plans.forEach((row) => {
      const product = productFor(row, "planning", dimensions);
      const cycle = cycleFor(row, dimensions);
      const culture = cultureFor(row);
      const key = commercialPlanningKey(product.canonicalKey, cycle, culture);
      const current = values.get(key) || {
        active: product.active,
        cycle,
        culture,
        merchandiseGroup: product.merchandiseGroup || "Sem grupo",
        months: {},
        planned: 0,
        product: product.canonicalName,
        subgroup: product.subgroup || "Sem subgrupo",
      };
      const amount = standardQuantity(row, "planning", product, dimensions);
      current.planned += amount;
      const scheduledAt = dateFromPlan(
        readText(
          row,
          "DT_Aplicacao",
          "Data prevista",
          "Data planejada",
          "Data aplicação",
          "Data",
        ),
      );
      if (scheduledAt)
        current.months[monthKey(scheduledAt)] =
          (current.months[monthKey(scheduledAt)] || 0) + amount;
      values.set(key, current);
    });
    return values;
  }, [dimensions, plans]);

  const selectedClosingSchedule = useMemo(() => {
    const product = productFor(
      { Produto: closingDraft.product },
      "planning",
      dimensions,
    );
    return planningDistribution.get(
      commercialPlanningKey(
        product.canonicalKey,
        closingDraft.cycle,
        closingDraft.culture,
      ),
    );
  }, [
    closingDraft.cycle,
    closingDraft.culture,
    closingDraft.product,
    dimensions,
    planningDistribution,
  ]);
  const commercialCoverageByPlanningKey = useMemo(() => {
    const planningKeysByMaterial = new Map<string, string[]>();
    planningDistribution.forEach((schedule, key) => {
      const material = key.split("|", 1)[0];
      const keys = planningKeysByMaterial.get(material) || [];
      keys.push(key);
      planningKeysByMaterial.set(material, keys);
    });
    const coverage = new Map<string, CommercialPlanningCoverage>();
    const addCoverage = (
      key: string,
      field: keyof CommercialPlanningCoverage,
      amount: number,
    ) => {
      if (!amount) return;
      const current = coverage.get(key) || { applied: 0, stock: 0 };
      coverage.set(key, { ...current, [field]: current[field] + amount });
    };
    datasets.consumo.forEach((row) => {
      const product = productFor(row, "consumption", dimensions);
      const key = commercialPlanningKey(
        product.canonicalKey,
        cycleFor(row, dimensions),
        cultureFor(row),
      );
      addCoverage(
        key,
        "applied",
        standardQuantity(row, "consumption", product, dimensions),
      );
    });
    const stockByMaterial = new Map<string, number>();
    stockRows.forEach((row) => {
      const product = productFor(row, "stock", dimensions);
      const amount = standardAmount(quantityFor(row, "stock"), product, dimensions);
      stockByMaterial.set(
        product.canonicalKey,
        (stockByMaterial.get(product.canonicalKey) || 0) + amount,
      );
    });
    stockByMaterial.forEach((amount, material) => {
      const planningKeys = planningKeysByMaterial.get(material) || [];
      const totalPlanned = planningKeys.reduce(
        (total, key) => total + (planningDistribution.get(key)?.planned || 0),
        0,
      );
      if (!totalPlanned) return;
      planningKeys.forEach((key) => {
        const planned = planningDistribution.get(key)?.planned || 0;
        addCoverage(
          key,
          "stock",
          (amount * planned) / totalPlanned,
        );
      });
    });
    return coverage;
  }, [datasets.consumo, dimensions, planningDistribution, stockRows]);
  const registeredClosingMonths = useMemo(() => {
    const months = new Set<string>();
    for (const closing of commercialClosings.closings) {
      for (const [month, amount] of Object.entries(closing.distribution)) {
        if (amount && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) months.add(month);
      }
    }
    return [...months].sort();
  }, [commercialClosings.closings]);
  const closingMonths = useMemo(() => {
    const values = new Set<string>();
    planningDistribution.forEach((schedule) =>
      Object.keys(schedule.months).forEach((month) => values.add(month)),
    );
    Object.values(commercialClosings.closings).forEach((closing) =>
      Object.keys(closing.distribution).forEach((month) => values.add(month)),
    );
    return [...values].sort();
  }, [commercialClosings.closings, planningDistribution]);

  const resolvedCommercialClosings = useMemo(
    () =>
      resolveCommercialClosings(
        commercialClosings.closings,
        planningDistribution,
        dimensions,
        new Map(commercialOrders.map((order) => [order.key, order])),
      ),
    [
      commercialClosings.closings,
      commercialOrders,
      dimensions,
      planningDistribution,
    ],
  );
  const normalizedClosingQuery = normalizeMaterial(closingQuery);
  const filteredCommercialClosings = useMemo(
    () =>
      resolvedCommercialClosings
        .filter(
          (entry) =>
            (closingCycleFilter === "Todos" ||
              entry.closing.cycle === closingCycleFilter) &&
            matchesCommercialClosing(entry, normalizedClosingQuery),
        )
        .sort(
          (left, right) =>
            left.physicalProduct.localeCompare(right.physicalProduct) ||
            left.closing.supplier.localeCompare(right.closing.supplier),
        ),
    [closingCycleFilter, normalizedClosingQuery, resolvedCommercialClosings],
  );
  const commercialOverview = useMemo(
    () =>
      buildCommercialClosingOverview(
        planningDistribution,
        resolvedCommercialClosings,
        closingCycleFilter,
        normalizedClosingQuery,
        commercialCoverageByPlanningKey,
      ),
    [
      closingCycleFilter,
      commercialCoverageByPlanningKey,
      normalizedClosingQuery,
      planningDistribution,
      resolvedCommercialClosings,
    ],
  );
  const commercialOrderForClosing = useMemo(() => {
    const ordersByKey = new Map(commercialOrders.map((order) => [order.key, order]));
    const ordersByNumber = new Map<string, typeof commercialOrders>();
    const orderNumberKey = (value: unknown) =>
      String(value ?? "").replace(/[^0-9]/g, "");
    commercialOrders.forEach((order) => {
      const key = orderNumberKey(order.orderNumber);
      if (!key) return;
      const current = ordersByNumber.get(key) || [];
      current.push(order);
      ordersByNumber.set(key, current);
    });
    const orderForClosing = (
      entry: (typeof resolvedCommercialClosings)[number],
    ) => {
      const direct = ordersByKey.get(entry.closing.orderKey);
      if (direct) return direct;
      const candidates =
        ordersByNumber.get(orderNumberKey(entry.closing.orderNumber)) || [];
      // O item de um pedido pode mudar depois da distribuição comercial.
      // Por isso, o material é a chave determinante dentro do documento; o
      // item só desempata quando há mais de uma linha do mesmo material.
      const productCandidates = candidates.filter((order) => {
        const orderProducts = [order.product, order.standardProduct].map(
          normalizeMaterial,
        );
        return [
          entry.closing.product,
          entry.physicalProduct,
          entry.standardProduct,
        ].some((product) => orderProducts.includes(normalizeMaterial(product)));
      });
      if (productCandidates.length === 1) return productCandidates[0];
      if (!entry.closing.orderItem) return undefined;
      return productCandidates.find(
        (order) =>
          normalizeMaterial(order.item) ===
          normalizeMaterial(entry.closing.orderItem),
      );
    };
    return orderForClosing;
  }, [commercialOrders]);
  const commercialToInvoiceByMonitoringKey = useMemo(() => {
    const orderForClosing = commercialOrderForClosing;
    const linkedVolumeByOrder = new Map<string, number>();
    resolvedCommercialClosings.forEach((entry) => {
      const order = orderForClosing(entry);
      if (!order) return;
      linkedVolumeByOrder.set(
        order.key,
        (linkedVolumeByOrder.get(order.key) || 0) +
          entry.closing.totalVolume,
      );
    });
    const values = new Map<string, number>();
    resolvedCommercialClosings.forEach((entry) => {
      const order = orderForClosing(entry);
      const remainingToInvoice = order
        ? order.balance
        : typeof entry.closing.invoicedVolume === "number"
          ? Math.max(
              0,
              entry.closing.totalVolume - entry.closing.invoicedVolume,
            )
          : 0;
      if (!entry.plannedKey || remainingToInvoice <= 0) return;
      const destinationKey = normalizeMaterial(entry.closing.destination);
      const nucleus =
        destinationKey === "0714"
          ? "ARMAZÉM"
          : dimensions.centerToNucleus[destinationKey] ||
            farmToNucleus[destinationKey] ||
            entry.closing.destination;
      if (!nucleus) return;
      const totalLinked = order
        ? linkedVolumeByOrder.get(order.key) || 0
        : 0;
      // Saldo Forn é físico/comercial. Não aplicar conversão de dose: a
      // coluna A faturar deve espelhar o volume pendente no pedido de compra.
      const share = order && totalLinked
        ? (remainingToInvoice * entry.closing.totalVolume) /
          totalLinked
        : remainingToInvoice;
      const key = `${entry.plannedKey}|${normalizeMaterial(nucleus)}`;
      values.set(key, (values.get(key) || 0) + share);
    });
    return values;
  }, [commercialOrderForClosing, dimensions.centerToNucleus, farmToNucleus, resolvedCommercialClosings]);
  const commercialDeliveryTracking = useMemo(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const entries = filteredCommercialClosings.map((entry) => ({
      entry,
      order: commercialOrderForClosing(entry),
    }));
    const closingVolumeByOrder = new Map<string, number>();
    entries.forEach(({ entry, order }) => {
      if (!order) return;
      closingVolumeByOrder.set(
        order.key,
        (closingVolumeByOrder.get(order.key) || 0) + entry.closing.totalVolume,
      );
    });
    const rows: CommercialDeliveryTrackingRow[] = entries.map(({ entry, order }) => {
      const { closing } = entry;
      const linkedVolume = order
        ? closingVolumeByOrder.get(order.key) || 0
        : 0;
      const pending = order
        ? Math.min(
            closing.totalVolume,
            Math.max(0, order.balance) *
              (linkedVolume > 0 ? closing.totalVolume / linkedVolume : 1),
          )
        : null;
      const received = pending === null
        ? null
        : Math.max(0, closing.totalVolume - pending);
      const scheduledMonths = Object.entries(closing.distribution || {})
        .filter(([, volume]) => Number(volume) > 0)
        .sort(([left], [right]) => left.localeCompare(right));
      const expectedToDate = scheduledMonths.reduce(
        (total, [month, volume]) =>
          month <= currentMonth ? total + Number(volume) : total,
        0,
      );
      const calendarGap = received === null
        ? null
        : Math.max(0, expectedToDate - received);
      const status: CommercialDeliveryTrackingRow["status"] = !order
        ? "Sem pedido"
        : pending <= 0.0001
          ? "Entregue"
          : expectedToDate <= 0.0001
            ? "Previsto"
            : calendarGap <= 0.0001
              ? "No prazo"
              : "Atrasado";
      return {
        active: entry.active,
        calendarGap,
        closed: closing.totalVolume,
        cycle: closing.cycle,
        expectedToDate,
        group: entry.merchandiseGroup,
        id: closing.id,
        nextScheduledMonth:
          scheduledMonths.find(([month]) => month >= currentMonth)?.[0] ||
          scheduledMonths.at(-1)?.[0] ||
          "",
        orderNumber: order?.orderNumber || closing.orderNumber,
        pending,
        physicalProduct: entry.physicalProduct,
        product: entry.standardProduct,
        received,
        status,
        subgroup: entry.subgroup,
        supplier: closing.supplier,
        unit: closing.unit?.trim().toUpperCase() || "",
      };
    });
    return { currentMonth, rows };
  }, [commercialOrderForClosing, filteredCommercialClosings]);

  const materialResolution = useMemo(() => {
    const input: Array<[Row[], "stock" | "transit" | "consumption"]> = [
      [stockRows, "stock"],
      [datasets.transito, "transit"],
      [datasets.consumo, "consumption"],
    ];
    let described = 0;
    let resolved = 0;
    input.forEach(([rows, source]) =>
      rows.forEach((row) => {
        const product = productFor(row, source, dimensions);
        if (product.rawName === "Sem descrição") return;
        described += 1;
        if (product.resolvedByDimension) resolved += 1;
      }),
    );
    return { described, resolved };
  }, [stockRows, datasets.transito, datasets.consumo, dimensions]);

  const latestDataUpdate = useMemo(
    () =>
      Object.values(imports)
        .map((item) => item?.importedAt)
        .filter((value): value is string => Boolean(value))
        .sort(
          (left, right) => new Date(right).getTime() - new Date(left).getTime(),
        )[0],
    [imports],
  );

  const oldestSource = useMemo(
    () =>
      Object.entries(imports)
        // Planejamento e Dimensões são referências de premissa. A defasagem
        // operacional passa a refletir somente fontes que mudam no dia a dia.
        .filter(([key]) => key !== "planejamento" && key !== "dimensoes")
        .filter((entry): entry is [ImportKey, ImportSummary] =>
          Boolean(entry[1]?.fileModifiedAt),
        )
        .sort(
          ([, left], [, right]) =>
            new Date(left.fileModifiedAt).getTime() -
            new Date(right.fileModifiedAt).getTime(),
        )[0],
    [imports],
  );
  const dataFreshness = freshnessStatus(
    oldestSource?.[1].fileModifiedAt,
    clock,
  );

  const reconciliationIssues = useMemo<ReconciliationIssue[]>(() => {
    const issues = new Map<string, ReconciliationIssue>();
    const sources: Array<{
      productSource:
        | "planning"
        | "stock"
        | "transit"
        | "consumption"
        | "pending";
      rows: Row[];
      title: string;
    }> = [
      { productSource: "planning", rows: plans, title: "Planejamento" },
      { productSource: "consumption", rows: datasets.consumo, title: "CN52" },
      { productSource: "stock", rows: datasets.estoque, title: "ZMM_BATCH" },
      { productSource: "stock", rows: datasets.estoqueMb52, title: "MB52" },
      { productSource: "transit", rows: datasets.transito, title: "MB5T" },
      {
        productSource: "pending",
        rows: pendingOrders,
        title: "Pedidos pendentes",
      },
    ];
    const add = (issue: Omit<ReconciliationIssue, "count">) => {
      const key = [issue.source, issue.detail, issue.material, issue.code].join(
        "\u0000",
      );
      const current = issues.get(key);
      issues.set(
        key,
        current
          ? { ...current, count: current.count + 1 }
          : { ...issue, count: 1 },
      );
    };
    sources.forEach(({ productSource, rows, title }) =>
      rows.forEach((row) => {
        const product = productFor(row, productSource, dimensions);
        if (product.rawName === "Sem descrição") {
          add({
            source: title,
            material: "Sem descrição",
            code: product.code || "—",
            detail: "Descrição de material ausente",
            action: "Corrigir a descrição do material no arquivo de origem.",
          });
          return;
        }
        if (!product.resolvedByDimension) {
          add({
            source: title,
            material: product.rawName,
            code: product.code || "—",
            detail: "Sem vínculo nas dimensões",
            action:
              "Provável novo cadastro ou grafia divergente: incluir ou corrigir o material nas Dimensões.",
          });
        }
        const nucleus =
          productSource === "planning"
            ? planningNucleusFor(row, dimensions, farmToNucleus)
            : productSource === "consumption"
              ? consumptionNucleusFor(row, dimensions, farmToNucleus)
              : productSource === "stock"
                ? stockNucleusFor(row, dimensions, farmToNucleus)
                : nucleusFor(row, dimensions, farmToNucleus);
        if (nucleus === "Sem núcleo") {
          add({
            source: title,
            material: product.rawName,
            code: product.code || "—",
            detail: "Núcleo não conciliado",
            action:
              "Cadastrar ou corrigir o vínculo Centro/Fazenda → Núcleo nas Dimensões.",
          });
        }
      }),
    );
    return [...issues.values()].sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.material.localeCompare(right.material),
    );
  }, [
    datasets.consumo,
    datasets.estoque,
    datasets.estoqueMb52,
    datasets.transito,
    dimensions,
    farmToNucleus,
    pendingOrders,
    plans,
  ]);

  const premiseSections = useMemo<PremiseSection[]>(() => {
    const materials = new Map<string, DimensionBundle["materials"][string]>();
    Object.values(dimensions.materials).forEach((material) =>
      materials.set(normalizeMaterial(material.material), material),
    );
    return [
      {
        id: "operacionais",
        title: "Regras operacionais",
        description: "Parâmetros que guiam as análises e conciliações.",
        headers: ["Premissa", "Valor"],
        rows: [
          ["Tolerância de desvio", premises.tolerance + "%"],
          ["Amostra mínima", premises.sample],
          ["Janelas de demanda", premises.horizon],
          ["Status excluído", premises.excludedStatus],
          ["Ciclo exibido na visão DAE", dashboardSettings.daeCycle],
        ],
      },
      {
        id: "materiais",
        title: "Materiais e princípios ativos",
        description:
          "Material físico, material agregado e classificação utilizada nas visões.",
        headers: [
          "Material físico",
          "Material agregado",
          "Princípio ativo",
          "Grupo",
          "Subgrupo",
          "Dose padrão",
        ],
        rows: [...materials.values()]
          .sort((left, right) => left.material.localeCompare(right.material))
          .map((material) => [
            material.material,
            material.aggregateMaterial,
            material.principleActive,
            material.merchandiseGroup,
            material.subgroup,
            material.standardDose,
          ]),
      },
      {
        id: "nucleos",
        title: "Centros, fazendas e núcleos",
        description:
          "Vínculos que definem onde cada saldo e demanda são consolidados.",
        headers: ["Centro ou fazenda", "Núcleo aplicado"],
        rows: Object.entries(dimensions.centerToNucleus)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([center, nucleus]) => [center, nucleus]),
      },
      {
        id: "culturas",
        title: "Culturas e ciclos",
        description: "Classificação de cultura entre Safra e Safrinha.",
        headers: ["Cultura", "Ciclo aplicado"],
        rows: Object.entries(dimensions.cultureToCycle)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([culture, cycle]) => [culture, cycle]),
      },
      {
        id: "conversoes",
        title: "Conversões de dose",
        description:
          "Fatores que convertem o saldo físico para o material agregado.",
        headers: [
          "Material padrão",
          "Apresentação física",
          "Fator de conversão",
        ],
        rows: Object.entries(dimensions.conversions)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([pair, factor]) => {
            const [standard, physical] = pair.split("|");
            return [standard, physical, factor];
          }),
      },
    ];
  }, [dashboardSettings.daeCycle, dimensions, premises]);
  const selectedPremiseSection =
    premiseSections.find((section) => section.id === premiseSection) ||
    premiseSections[0];

  const groupedProgress = useMemo(() => {
    type ProgressRow = {
      group: string;
      subgroup: string;
      planned: number;
      applied: number;
    };
    const values = new Map<string, ProgressRow>();
    const ensure = (cycle: string, group: string, subgroup: string) => {
      const key = [cycle, group, subgroup].join("|");
      const value = values.get(key) || {
        group,
        subgroup,
        planned: 0,
        applied: 0,
      };
      values.set(key, value);
      return value;
    };
    plans.forEach((row) => {
      if (
        isOperator &&
        planningNucleusFor(row, dimensions, farmToNucleus) !== operatorNucleus
      )
        return;
      const product = productFor(row, "planning", dimensions);
      ensure(
        cycleFor(row, dimensions),
        product.merchandiseGroup,
        product.subgroup,
      ).planned += standardQuantity(row, "planning", product, dimensions);
    });
    datasets.consumo.forEach((row) => {
      if (
        isOperator &&
        consumptionNucleusFor(row, dimensions, farmToNucleus) !==
          operatorNucleus
      )
        return;
      const product = productFor(row, "consumption", dimensions);
      ensure(
        cycleFor(row, dimensions),
        product.merchandiseGroup,
        product.subgroup,
      ).applied += standardQuantity(row, "consumption", product, dimensions);
    });
    return ["Safra", "Safrinha"].map((cycle) => ({
      cycle,
      rows: [...values.entries()]
        .filter(([key]) => key.startsWith(cycle + "|"))
        .map(([, value]) => value)
        .sort((left, right) => right.planned - left.planned),
    }));
  }, [
    plans,
    datasets.consumo,
    dimensions,
    farmToNucleus,
    isOperator,
    operatorNucleus,
  ]);

  const macroCrop = useMemo(
    () =>
      crops.map((crop) => ({
        ...crop,
        applied: datasets.execucao
          .filter(
            (row) =>
              headerKey(
                readText(row, "Cultura", "WBS element", "WBS"),
              ).includes(crop.code) &&
              (!isOperator ||
                nucleusFor(row, dimensions, farmToNucleus) === operatorNucleus),
          )
          .reduce(
            (sum, row) =>
              sum +
              readNumber(
                row,
                "Área Executada",
                "Area Executada",
                "Qtde. executada",
              ),
            0,
          ),
      })),
    [datasets.execucao, dimensions, farmToNucleus, isOperator, operatorNucleus],
  );

  const daeByNucleus = useMemo(() => {
    type DaeGroup = {
      nucleus: string;
      culture: string;
      cycle: string;
      totalArea: number;
      dates: Map<string, { area: number; date: Date }>;
    };
    const groups = new Map<string, DaeGroup>();
    plantingAreaRows.forEach((row) => {
      const cycle = cycleFor(row, dimensions);
      if (
        dashboardSettings.daeCycle !== "Ambos" &&
        cycle !== dashboardSettings.daeCycle
      )
        return;
      const culture = cultureFor(row);
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const area = planningArea(row);
      const key = [nucleus, culture, cycle].join("|");
      const group = groups.get(key) || {
        nucleus,
        culture,
        cycle,
        totalArea: 0,
        dates: new Map(),
      };
      group.totalArea += area;
      const plantingDate = dateFromPlan(
        readText(
          row,
          "Data de plantio",
          "Data Plantio",
          "Dt. Plantio",
          "Dt Plantio",
          "DT_Plantio",
          "DATA_PLANTIO",
          "Plantio",
        ),
      );
      if (plantingDate) {
        const dateKeyValue = dateKey(plantingDate);
        const dateGroup = group.dates.get(dateKeyValue) || {
          area: 0,
          date: plantingDate,
        };
        dateGroup.area += area;
        group.dates.set(dateKeyValue, dateGroup);
      }
      groups.set(key, group);
    });
    const nucleusGroups = new Map<
      string,
      Array<{
        area: number;
        culture: string;
        cycle: string;
        days: number;
        plantedAt: Date;
        share: number;
      }>
    >();
    groups.forEach((group) =>
      group.dates.forEach((dateGroup) => {
        const entries = nucleusGroups.get(group.nucleus) || [];
        entries.push({
          area: dateGroup.area,
          culture: group.culture,
          cycle: group.cycle,
          days: Math.max(0, -daysFromToday(dateGroup.date, new Date(clock))),
          plantedAt: dateGroup.date,
          share: group.totalArea ? (dateGroup.area * 100) / group.totalArea : 0,
        });
        nucleusGroups.set(group.nucleus, entries);
      }),
    );
    const result = [...nucleusGroups.entries()]
      .map(([nucleus, entries]) => ({
        nucleus,
        entries: entries.sort(
          (left, right) => right.days - left.days || right.area - left.area,
        ),
      }))
      .sort((left, right) => left.nucleus.localeCompare(right.nucleus));
    return isOperator
      ? result.filter((group) => group.nucleus === operatorNucleus)
      : result;
  }, [
    clock,
    dashboardSettings.daeCycle,
    dimensions,
    farmToNucleus,
    isOperator,
    operatorNucleus,
    plantingAreaRows,
  ]);

  const filters = useMemo(
    () => ({
      cycles: ["Todos", ...new Set(ledger.flatMap((row) => row.cycles))],
      groups: ["Todos", ...new Set(ledger.map((row) => row.merchandiseGroup))],
      subgroups: ["Todos", ...new Set(ledger.map((row) => row.subgroup))],
      cultures: ["Todos", ...new Set(ledger.flatMap((row) => row.cultures))],
    }),
    [ledger],
  );
  const monitoringLedger = useMemo(() => {
    const matchesScope = (row: Row, source: "planning" | "consumption") => {
      const product = productFor(row, source, dimensions);
      return (
        (cycleFilter === "Todos" ||
          cycleFor(row, dimensions) === cycleFilter) &&
        (groupFilter === "Todos" || product.merchandiseGroup === groupFilter) &&
        (subgroupFilter === "Todos" || product.subgroup === subgroupFilter) &&
        (cultureFilter === "Todos" || cultureFor(row) === cultureFilter)
      );
    };
    return buildReconciliation({
      bundle: dimensions,
      planningRows: plans.filter((row) => matchesScope(row, "planning")),
      stockRows,
      transitRows: datasets.transito,
      consumptionRows: datasets.consumo.filter((row) =>
        matchesScope(row, "consumption"),
      ),
      pendingRows: pendingOrders,
      farmToNucleus,
    });
  }, [
    cycleFilter,
    cultureFilter,
    datasets.consumo,
    stockRows,
    datasets.transito,
    dimensions,
    farmToNucleus,
    groupFilter,
    pendingOrders,
    plans,
    subgroupFilter,
  ]);

  const warehouseMonitoringRows = useMemo(() => {
    const context = new Map<
      string,
      { cultures: Set<string>; cycles: Set<string> }
    >();
    monitoringLedger.forEach((row) => {
      const current = context.get(row.canonicalKey) || {
        cultures: new Set<string>(),
        cycles: new Set<string>(),
      };
      row.cultures.forEach((culture) => current.cultures.add(culture));
      row.cycles.forEach((cycle) => current.cycles.add(cycle));
      context.set(row.canonicalKey, current);
    });
    const values = new Map<string, MonitoringRow>();
    const ensureWarehouseRow = (
      row: ReconciliationRow,
      cycles: string[],
      cultures: string[],
    ) => {
      const id = row.canonicalKey + "|ARMAZEM";
      const current = values.get(id) || {
        active: row.active,
        applied: 0,
        available: 0,
        canonicalKey: row.canonicalKey,
        codes: [],
        cultures: [...cultures].sort(),
        cycles: [...cycles].sort(),
        farmBalance: 0,
        id,
        isWarehouseView: true,
        locations: [],
        merchandiseGroup: row.merchandiseGroup,
        nucleus: "ARMAZÉM",
        pendingOrder: 0,
        planned: 0,
        plannedMaterials: [],
        shortage: 0,
        standardMaterial: row.standardMaterial,
        stockMaterials: [],
        subgroup: row.subgroup,
        transit: 0,
        warehouseBalance: 0,
      };
      cycles.forEach((cycle) => {
        if (!current.cycles.includes(cycle)) current.cycles.push(cycle);
      });
      cultures.forEach((culture) => {
        if (!current.cultures.includes(culture)) current.cultures.push(culture);
      });
      current.cycles.sort();
      current.cultures.sort();
      values.set(id, current);
      return current;
    };
    monitoringLedger.forEach((row) =>
      row.locations
        .filter(
          (location) => location.type === "Armazém" && location.amount !== 0,
        )
        .forEach((location) => {
          const sourceContext = context.get(row.canonicalKey);
          const current = ensureWarehouseRow(
            row,
            [...(sourceContext?.cycles || [])],
            [...(sourceContext?.cultures || [])],
          );
          current.warehouseBalance += location.amount;
          current.locations.push({ ...location });
          if (!current.stockMaterials.includes(location.material))
            current.stockMaterials.push(location.material);
        }),
    );
    // O saldo a faturar pertence ao centro/armazém e precisa continuar
    // visível antes da chegada física do material.
    monitoringLedger.forEach((row) =>
      row.cycles.forEach((cycle) =>
        row.cultures.forEach((culture) => {
          const toInvoice = commercialToInvoiceByMonitoringKey.get(
            `${row.canonicalKey}|${normalizeMaterial(cycle)}|${normalizeMaterial(culture)}|ARMAZEM`,
          ) || 0;
          if (toInvoice > 0) ensureWarehouseRow(row, [cycle], [culture]);
        }),
      ),
    );
    return [...values.values()].map((row) => ({
      ...row,
      available: row.warehouseBalance,
      stockMaterials: row.stockMaterials.sort(),
    }));
  }, [commercialToInvoiceByMonitoringKey, monitoringLedger]);

  const monitoringNuclei = useMemo(
    () => [
      "Todos",
      ...[
        ...new Set([
          ...monitoringLedger.map((row) => row.nucleus),
          ...warehouseMonitoringRows.map((row) => row.nucleus),
        ]),
      ].sort(),
    ],
    [monitoringLedger, warehouseMonitoringRows],
  );

  const executionRows = useMemo(() => {
    const search = normalizeMaterial(query);
    const farmRows: MonitoringRow[] = monitoringLedger
      .map((row) => {
        const locations = row.locations.filter(
          (location) => location.type !== "Armazém",
        );
        const stockMaterials = [
          ...new Set(locations.map((location) => location.material)),
        ].sort();
        return {
          ...row,
          available: row.farmBalance + row.transit,
          locations,
          shortage: Math.max(
            0,
            row.planned - row.applied - row.farmBalance - row.transit,
          ),
          stockMaterials,
          warehouseBalance: 0,
        };
      })
      .filter(
        (row) =>
          row.planned ||
          row.applied ||
          row.pendingOrder ||
          row.transit ||
          row.farmBalance,
      );
    return [...farmRows, ...warehouseMonitoringRows]
      .filter((row) => {
        const line = normalizeMaterial(
          [
            row.active,
            row.standardMaterial,
            row.stockMaterials.join(" "),
            row.plannedMaterials.join(" "),
            row.nucleus,
            ...row.locations.map((location) => location.location),
          ].join(" "),
        );
        return (
          (cycleFilter === "Todos" || row.cycles.includes(cycleFilter)) &&
          (groupFilter === "Todos" || row.merchandiseGroup === groupFilter) &&
          (subgroupFilter === "Todos" || row.subgroup === subgroupFilter) &&
          (cultureFilter === "Todos" || row.cultures.includes(cultureFilter)) &&
          (nucleusFilter === "Todos" || row.nucleus === nucleusFilter) &&
          (!search || line.includes(search))
        );
      })
      .sort(
        (left, right) =>
          left.active.localeCompare(right.active) ||
          left.standardMaterial.localeCompare(right.standardMaterial) ||
          left.nucleus.localeCompare(right.nucleus),
      );
  }, [
    cycleFilter,
    cultureFilter,
    groupFilter,
    monitoringLedger,
    nucleusFilter,
    query,
    subgroupFilter,
    warehouseMonitoringRows,
  ]);

  const toInvoiceForMonitoringRow = (row: MonitoringRow) => {
    const cycles =
      cycleFilter === "Todos"
        ? row.cycles
        : row.cycles.includes(cycleFilter)
          ? [cycleFilter]
          : [];
    const cultures =
      cultureFilter === "Todos"
        ? row.cultures
        : row.cultures.includes(cultureFilter)
          ? [cultureFilter]
          : [];
    return cycles.reduce(
      (total, cycle) =>
        total +
        cultures.reduce(
          (byCulture, culture) =>
            byCulture +
            (commercialToInvoiceByMonitoringKey.get(
              `${row.canonicalKey}|${normalizeMaterial(cycle)}|${normalizeMaterial(culture)}|${normalizeMaterial(row.nucleus)}`,
            ) || 0),
          0,
        ),
      0,
    );
  };

  const monitoringGroups = useMemo<MonitoringGroup[]>(() => {
    const groups = new Map<string, MonitoringRow[]>();
    executionRows.forEach((row) => {
      const active = row.active || "Princípio ativo não informado";
      const rows = groups.get(active) || [];
      rows.push(row);
      groups.set(active, rows);
    });
    return [...groups.entries()].map(([active, rows]) => ({
      active,
      rows,
      totals: rows.reduce(
        (totals, row) => ({
          applied: totals.applied + row.applied,
          balance: totals.balance + row.farmBalance + row.warehouseBalance,
          toInvoice: totals.toInvoice + toInvoiceForMonitoringRow(row),
          pendingOrder: totals.pendingOrder + row.pendingOrder,
          planned: totals.planned + row.planned,
          toDeliver: totals.toDeliver + amountToDeliver(row),
          transit: totals.transit + row.transit,
        }),
        {
          applied: 0,
          balance: 0,
          toInvoice: 0,
          pendingOrder: 0,
          planned: 0,
          toDeliver: 0,
          transit: 0,
        },
      ),
    }));
  }, [commercialToInvoiceByMonitoringKey, cycleFilter, executionRows]);

  const executedAreaByTask = useMemo(() => {
    const values = new Map<string, number>();
    datasets.execucao.forEach((row) => {
      if (statusExcluded(row, premises.excludedStatus)) return;
      const key = taskKey(row);
      const area = readNumber(row, "Área Executada", "Area Executada");
      if (!key || area <= 0) return;
      values.set(key, (values.get(key) || 0) + area);
    });
    return values;
  }, [datasets.execucao, premises.excludedStatus]);

  const executionPerformance = useMemo(() => {
    const values = new Map<string, PerformanceAccumulator>();
    const ensure = (
      product: ReturnType<typeof productFor>,
      nucleus: string,
      cycle: string,
      culture: string,
    ) => {
      const id = product.canonicalKey + "|" + normalizeMaterial(nucleus);
      const current = values.get(id) || {
        active: product.active,
        appliedArea: 0,
        appliedVolume: 0,
        canonicalKey: product.canonicalKey,
        cultures: new Set<string>(),
        cycles: new Set<string>(),
        merchandiseGroup: product.merchandiseGroup,
        neededVolume: 0,
        nucleus,
        plannedArea: 0,
        plannedVolume: 0,
        standardMaterial: product.canonicalName,
        subgroup: product.subgroup,
      };
      if (product.active !== "Não conciliado") current.active = product.active;
      if (product.merchandiseGroup !== "Sem grupo")
        current.merchandiseGroup = product.merchandiseGroup;
      if (product.subgroup !== "Sem subgrupo")
        current.subgroup = product.subgroup;
      if (cycle !== "Sem ciclo") current.cycles.add(cycle);
      if (culture !== "Sem cultura") current.cultures.add(culture);
      values.set(id, current);
      return { current, id };
    };

    plans.forEach((row) => {
      const product = productFor(row, "planning", dimensions);
      if (product.rawName === "Sem descrição") return;
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const item = ensure(
        product,
        nucleus,
        cycleFor(row, dimensions),
        cultureFor(row),
      );
      item.current.plannedVolume += standardQuantity(
        row,
        "planning",
        product,
        dimensions,
      );
      item.current.plannedArea += planningArea(row);
    });

    const seenArea = new Set<string>();
    datasets.consumo.forEach((row) => {
      const product = productFor(row, "consumption", dimensions);
      if (product.rawName === "Sem descrição") return;
      const nucleus = consumptionNucleusFor(row, dimensions, farmToNucleus);
      const item = ensure(
        product,
        nucleus,
        cycleFor(row, dimensions),
        cultureFor(row),
      );
      item.current.appliedVolume += standardQuantity(
        row,
        "consumption",
        product,
        dimensions,
      );
      item.current.neededVolume += standardAmount(
        readNumber(
          row,
          "Qtd.necess.",
          "Qtd necess.",
          "Quantidade necessária",
          "Quantidade necessaria",
        ),
        product,
        dimensions,
      );
      const areaKey = item.id + "|" + taskKey(row);
      const area = executedAreaByTask.get(taskKey(row)) || 0;
      if (taskKey(row) && area > 0 && !seenArea.has(areaKey)) {
        item.current.appliedArea += area;
        seenArea.add(areaKey);
      }
    });

    return [...values.entries()]
      .map(([id, value]) => {
        const plannedVolume = value.plannedVolume || value.neededVolume;
        const plannedDose =
          value.plannedArea > 0 ? plannedVolume / value.plannedArea : null;
        const appliedDose =
          value.appliedArea > 0
            ? value.appliedVolume / value.appliedArea
            : null;
        const volumeImpact =
          plannedDose !== null && value.appliedArea > 0
            ? value.appliedVolume - plannedDose * value.appliedArea
            : null;
        return {
          ...value,
          id,
          cultures: [...value.cultures].sort(),
          cycles: [...value.cycles].sort(),
          plannedDose,
          plannedVolume,
          appliedDose,
          volumeImpact,
        };
      })
      .filter((row) => row.plannedVolume || row.appliedVolume)
      .sort((left, right) => right.plannedVolume - left.plannedVolume);
  }, [plans, datasets.consumo, dimensions, farmToNucleus, executedAreaByTask]);

  const performanceRows = useMemo(() => {
    const search = normalizeMaterial(query);
    return executionPerformance.filter((row) => {
      const line = normalizeMaterial(
        [
          row.active,
          row.standardMaterial,
          row.nucleus,
          row.subgroup,
          row.merchandiseGroup,
        ].join(" "),
      );
      return (
        (cycleFilter === "Todos" || row.cycles.includes(cycleFilter)) &&
        (groupFilter === "Todos" || row.merchandiseGroup === groupFilter) &&
        (subgroupFilter === "Todos" || row.subgroup === subgroupFilter) &&
        (cultureFilter === "Todos" || row.cultures.includes(cultureFilter)) &&
        (!isOperator || row.nucleus === operatorNucleus) &&
        (!search || line.includes(search))
      );
    });
  }, [
    executionPerformance,
    cycleFilter,
    groupFilter,
    subgroupFilter,
    cultureFilter,
    isOperator,
    operatorNucleus,
    query,
  ]);

  const performanceSummary = useMemo(() => {
    const planned = performanceRows.reduce(
      (sum, row) => sum + row.plannedVolume,
      0,
    );
    const applied = performanceRows.reduce(
      (sum, row) => sum + row.appliedVolume,
      0,
    );
    const doseRows = performanceRows.filter(
      (row) => row.plannedDose !== null && row.appliedArea > 0,
    );
    const executedArea = doseRows.reduce(
      (sum, row) => sum + row.appliedArea,
      0,
    );
    const plannedDose =
      executedArea > 0
        ? doseRows.reduce(
            (sum, row) => sum + (row.plannedDose || 0) * row.appliedArea,
            0,
          ) / executedArea
        : null;
    const appliedDose =
      executedArea > 0
        ? doseRows.reduce((sum, row) => sum + row.appliedVolume, 0) /
          executedArea
        : null;
    const impact = doseRows.reduce(
      (sum, row) => sum + (row.volumeImpact || 0),
      0,
    );
    return { applied, appliedDose, executedArea, impact, planned, plannedDose };
  }, [performanceRows]);

  const provision = useMemo(() => {
    const start = new Date(evaluationDate + "T00:00:00");
    const finish = new Date(provisionUntil + "T23:59:59");
    const matchesScope = (row: Row) =>
      (provisionCycle === "Todos" || cycleFor(row, dimensions) === provisionCycle) &&
      (provisionCulture === "Todas" || applicationCulture(row) === provisionCulture);
    const scopedPlans = plans.filter(matchesScope);
    const dated = scopedPlans.map((row) => ({ row, date: plannedApplicationDate(row) }));
    const scheduled = dated.filter((item) => item.date);
    const windowPlans = scheduled.length
      ? scheduled
          .filter((item) => item.date! >= start && item.date! <= finish)
          .map((item) => item.row)
      : scopedPlans;
    // Keep stock and warehouse pooled per material / nucleus. The culture
    // breakdown identifies planned demand without duplicating availability.
    type CultureDemand = { cycle: string; culture: string; planned: number };
    const breakdown = new Map<string, Map<string, CultureDemand>>();
    windowPlans.forEach((row) => {
      const product = productFor(row, "planning", dimensions);
      if (product.rawName === "Sem descrição") return;
      const id = product.canonicalKey + "|" + normalizeMaterial(planningNucleusFor(row, dimensions, farmToNucleus));
      const cycle = cycleFor(row, dimensions);
      const culture = applicationCulture(row);
      const values = breakdown.get(id) || new Map<string, CultureDemand>();
      const key = JSON.stringify([cycle, culture]);
      const entry = values.get(key) || { cycle, culture, planned: 0 };
      entry.planned += standardQuantity(row, "planning", product, dimensions);
      values.set(key, entry);
      breakdown.set(id, values);
    });
    const windowLedger = buildReconciliation({
      bundle: dimensions,
      planningRows: windowPlans,
      stockRows,
      transitRows: datasets.transito,
      consumptionRows: datasets.consumo.filter(matchesScope),
      pendingRows: pendingOrders,
      farmToNucleus,
    });
    const demands: DemandRow[] = windowLedger
      .filter((row) => row.planned > 0)
      .map((row) => ({
        ...row,
        demand: Math.max(0, row.planned - row.applied),
        local: row.farmBalance + row.transit,
      }));
    const allocation = allocateCentralWarehouse(demands, windowLedger);
    const rows = demands
      .map((row) => {
        const warehouse = allocation.allocations.get(row.id) || {
          allocated: 0,
          locations: [],
        };
        const nucleusSupportLocations = supportFromOtherNuclei(row, demands);
        const nucleusSupport = nucleusSupportLocations.reduce(
          (sum, location) => sum + location.amount,
          0,
        );
        const balance = row.local + warehouse.allocated - row.demand;
        const status =
          row.demand <= row.local
            ? "Atende no núcleo"
            : balance >= 0
              ? "Atende com armazém"
              : "Falta";
        // A BATCH possui uma linha por lote. A calendarização é operacional,
        // então exibe uma única linha por material, tipo de saldo e localização.
        return {
          ...row,
          cultureBreakdown: [...(breakdown.get(row.id)?.values() || [])].sort((a,b) => a.cycle.localeCompare(b.cycle) || a.culture.localeCompare(b.culture)),
          balance,
          locations: consolidateLocations([
            ...row.locations,
            ...nucleusSupportLocations,
          ]),
          status,
          warehouseLocations: consolidateLocations(warehouse.locations),
          warehouseSupport: warehouse.allocated,
          nucleusSupport,
          nucleusSupportLocations,
        };
      })
      .sort(
        (left, right) =>
          left.balance - right.balance || right.demand - left.demand,
      );
    const scopedRows = isOperator
      ? rows.filter((row) => row.nucleus === operatorNucleus)
      : rows;
    return {
      dated: scheduled.length > 0,
      rows: scopedRows,
      demand: scopedRows.reduce((sum, row) => sum + row.demand, 0),
      farm: scopedRows.reduce((sum, row) => sum + row.farmBalance, 0),
      pendingOrder: scopedRows.reduce((sum, row) => sum + row.pendingOrder, 0),
      transit: scopedRows.reduce((sum, row) => sum + row.transit, 0),
      warehouse: allocation.totalAvailable,
      nucleusSupport: scopedRows.reduce(
        (sum, row) => sum + row.nucleusSupport,
        0,
      ),
    };
  }, [
    evaluationDate,
    provisionUntil,
    provisionCycle,
    provisionCulture,
    plans,
    dimensions,
    stockRows,
    datasets.transito,
    datasets.consumo,
    pendingOrders,
    farmToNucleus,
    isOperator,
    operatorNucleus,
  ]);

  const consolidatedSupply = useMemo(() => {
    const demands: DemandRow[] = ledger
      .filter((row) => row.planned > 0)
      .map((row) => ({
        ...row,
        demand: Math.max(0, row.planned - row.applied),
        local: row.farmBalance + row.transit,
      }));
    const allocation = allocateCentralWarehouse(demands, ledger);
    const failures = demands.filter((row) => {
      const assigned = allocation.allocations.get(row.id)?.allocated || 0;
      return row.local + assigned < row.demand;
    });
    return {
      failures,
      shortage: failures.reduce(
        (sum, row) =>
          sum +
          Math.max(
            0,
            row.demand -
              row.local -
              (allocation.allocations.get(row.id)?.allocated || 0),
          ),
        0,
      ),
    };
  }, [ledger]);

  const pendingSignals = useMemo<PendingSignal[]>(
    () =>
      pendingOrders
        .map((row, index) => {
          const product = productFor(row, "pending", dimensions);
          const nucleus = nucleusFor(row, dimensions, farmToNucleus);
          const dueDateValue = readText(
            row,
            "DtRemPed",
            "Dt. Rem. Ped",
            "Data remessa",
            "Data prevista",
            "Previsão de utilização",
            "Previsao de utilizacao",
          );
          const previousDueDate = dateFromPlan(dueDateValue);
          const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateValue)
            ? dateFromPlan(`${dueDateValue}T00:00:00`)
            : previousDueDate;
          const daysUntil = dueDate
            ? daysFromToday(dueDate, new Date(clock))
            : null;
          const reference =
            readText(
              row,
              ...sapOrderHeaders,
              "Documento",
              "Doc. compra",
              "Solicitação",
              "Solicitacao",
            ) || "Pedido pendente";
          const signal = pendingSignalStatus(daysUntil);
          return {
            // Mantém o vínculo das tarefas já registradas para datas ISO antes interpretadas em UTC.
            id:
              normalizeMaterial(
                [
                  reference,
                  product.rawName,
                  nucleus,
                  previousDueDate ? dateKey(previousDueDate) : String(index),
                ].join("|"),
              ) || `pedido-${index}`,
            dueDate,
            daysUntil,
            material: product.canonicalName,
            physicalMaterial: product.rawName,
            nucleus,
            quantity: standardQuantity(row, "pending", product, dimensions),
            reference,
            row,
            ...signal,
          };
        })
        .sort(
          (left, right) =>
            (left.daysUntil ?? Number.MAX_SAFE_INTEGER) -
            (right.daysUntil ?? Number.MAX_SAFE_INTEGER),
        ),
    [clock, dimensions, farmToNucleus, pendingOrders],
  );

  const webAgilRequests = useMemo<LogisticsRequest[]>(() => {
    const values = new Map<string, LogisticsRequest>();
    const occurrences = new Map<string, number>();
    datasets.solicitacoesWeb.forEach((row, index) => {
      const id = readText(
        row,
        "Nº Solicitação",
        "N° Solicitação",
        "Numero Solicitação",
        "Numero Solicitacao",
        "Solicitação",
        "Solicitacao",
      );
      const product = readText(
        row,
        "Insumo Web",
        "Produto Web",
        "Descrição Produto",
        "Descricao Produto",
        "Produto",
        "Material Web",
        "Insumo SAP",
      );
      const status = readText(row, "St. do Atendimento");
      const shippingStatus = readText(
        row,
        "Situação de Envio ao Rodopar",
        "Situacao de Envio ao Rodopar",
      );
      if (
        !id ||
        !product ||
        headerKey(status).includes("CANCEL") ||
        headerKey(shippingStatus).includes("CANCEL")
      )
        return;
      const dimension = dimensions.materials[normalizeMaterial(product)];
      const current = values.get(id) || {
        date: readText(row, "Data Atendimento", "Data"),
        destination: readText(
          row,
          "Local destino",
          "Fazenda",
          "Nome do Tomador",
          "Nome do Responsável",
          "Nome do Responsavel",
        ),
        destinationCode: readText(
          row,
          "Cód. Cliente Ind.",
          "Cod. Cliente Ind.",
          "Cód. Cliente Destino",
          "Cod. Cliente Destino",
          "Destino",
        ),
        id,
        requestNumber: id,
        sourceWarehouse: readText(
          row,
          "Apelido Op. Logístico",
          "Apelido Op. Logistico",
          "Nome Op. Logístico",
          "Nome Op. Logistico",
        ),
        status: status || "Sem status",
        lines: [],
      };
      const lot = readText(row, "Lote Bravo", "Lote Web", "Lote");
      const sapLot = readText(row, "Lote SAP", "Lote indústria");
      const sapCode = readText(row, "CD MAT", "Código material SAP", "Material SAP");
      const baseId = [id, normalizeMaterial(product), normalizeMaterial(lot), normalizeMaterial(sapLot), sapCode].join("|");
      const occurrence = (occurrences.get(baseId) || 0) + 1;
      occurrences.set(baseId, occurrence);
      current.lines.push({
        id: `web|${baseId}|${occurrence}`,
        legacyId: `${id}|${index}|${normalizeMaterial(product)}|${normalizeMaterial(readText(row, "Lote", "Lote Web", "Lote SAP"))}`,
        active: dimension?.principleActive || "Não conciliado",
        lot,
        sapLot,
        sapCode,
        sapProduct: readText(row, "Insumo SAP", "Descrição material SAP"),
        center: readText(row, "CEN", "Centro"),
        invoiceNumber: readText(row, "Nota fiscal", "NF", "Nº nota fiscal"),
        product,
        productCode: readText(
          row,
          "Cód. Prod. Indústria",
          "Cod. Prod. Industria",
          "Cód. Prod. Operador",
          "Cod. Prod. Operador",
          "CD MAT",
          "Material",
        ),
        quantity: readNumber(
          row,
          "Qt. Solicitada",
          "Qt Solicitada",
          "Quantidade solicitada",
          "Quantidade",
          "QTD",
        ),
        standardProduct: dimension?.aggregateMaterial || product,
        unit: readText(row, ...sapUnitHeaders),
      });
      values.set(id, current);
    });
    return [...values.values()].sort((left, right) =>
      right.id.localeCompare(left.id, "pt-BR", { numeric: true }),
    );
  }, [datasets.solicitacoesWeb, dimensions]);
  const resolveFiscalLot = useMemo(
    () => indexLogisticsLots(datasets.estoqueWeb, datasets.estoque),
    [datasets.estoque, datasets.estoqueWeb],
  );
  const logisticsPlanningContext = useMemo(() => {
    type PlannedDemand = { cycle: string; date: Date; quantity: number };
    type PlanningContext = {
      cycleWarning: string;
      daysBeforePlanning: number | null;
      planningDate: Date | null;
      planningCycle: string;
      plannedUntilRequest: number;
      planningStatus: string;
      priority: number;
      requestedAt: Date | null;
    };
    const schedules = new Map<string, PlannedDemand[]>();
    const availableCycles = new Map<string, Set<string>>();
    plans.forEach((row) => {
      const product = productFor(row, "planning", dimensions);
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const cycle = cycleFor(row, dimensions);
      const date = dateFromPlan(
        readText(
          row,
          "DT_Aplicacao",
          "Data prevista",
          "Data planejada",
          "Data aplicação",
          "Data",
        ),
      );
      if (!date || !product.canonicalKey || !nucleus) return;
      const key = `${product.canonicalKey}|${normalizeMaterial(nucleus)}`;
      const cycles = availableCycles.get(key) || new Set<string>();
      cycles.add(cycle);
      availableCycles.set(key, cycles);
      if (
        dashboardSettings.daeCycle !== "Ambos" &&
        cycle !== dashboardSettings.daeCycle
      )
        return;
      const values = schedules.get(key) || [];
      values.push({
        cycle,
        date,
        quantity: standardQuantity(row, "planning", product, dimensions),
      });
      schedules.set(key, values);
    });
    schedules.forEach((rows) =>
      rows.sort((left, right) => left.date.getTime() - right.date.getTime()),
    );
    const values = new Map<string, PlanningContext>();
    pendingSignals.forEach((signal) => {
      const product = productFor(signal.row, "pending", dimensions);
      const key = `${product.canonicalKey}|${normalizeMaterial(signal.nucleus)}`;
      const schedule = schedules.get(key) || [];
      const otherCycles = [...(availableCycles.get(key) || [])].sort();
      const hasConfiguredCycle =
        dashboardSettings.daeCycle === "Ambos" ||
        otherCycles.includes(dashboardSettings.daeCycle);
      const requestedAt = dateFromPlan(
        readText(
          signal.row,
          "Data pedido",
          "Dt. pedido",
          "Dt pedido",
          "Data solicitação",
          "Data solicitacao",
          "Criado em",
          "Data criação",
          "Data criacao",
        ),
      );
      const next = signal.dueDate
        ? schedule.find((item) => item.date >= signal.dueDate!) || null
        : schedule[0] || null;
      const previous = signal.dueDate
        ? [...schedule].reverse().find((item) => item.date < signal.dueDate!) ||
          null
        : null;
      const planningDate = next?.date || previous?.date || null;
      const daysBeforePlanning =
        signal.dueDate && planningDate
          ? daysFromToday(planningDate, signal.dueDate)
          : null;
      const plannedUntilRequest = signal.dueDate
        ? schedule
            .filter((item) => item.date <= signal.dueDate!)
            .reduce((sum, item) => sum + item.quantity, 0)
        : 0;
      const planningStatus = !planningDate
        ? "Sem data planejada"
        : daysBeforePlanning! < 0
          ? "Planejamento já iniciado"
          : daysBeforePlanning! < 5
            ? "Antecedência curta"
            : daysBeforePlanning! <= 15
              ? "Janela adequada"
              : "Antecedência longa";
      const priority = !planningDate
        ? 4
        : daysBeforePlanning! < 0
          ? 0
          : daysBeforePlanning! < 5
            ? 1
            : daysBeforePlanning! <= 15
              ? 2
              : 3;
      values.set(signal.id, {
        cycleWarning:
          dashboardSettings.daeCycle !== "Ambos" &&
          otherCycles.length &&
          !hasConfiguredCycle
            ? `Material planejado apenas em ${otherCycles.join(" / ")}; a logística está configurada para ${dashboardSettings.daeCycle}.`
            : "",
        daysBeforePlanning,
        planningDate,
        planningCycle:
          dashboardSettings.daeCycle === "Ambos"
            ? [...new Set(schedule.map((item) => item.cycle))].join(" / ")
            : dashboardSettings.daeCycle,
        plannedUntilRequest,
        planningStatus,
        priority,
        requestedAt,
      });
    });
    return values;
  }, [dashboardSettings.daeCycle, dimensions, farmToNucleus, pendingSignals, plans]);
  const transitByPendingRow = useMemo(
    () => matchPendingTransit(pendingSignals, datasets.transito),
    [datasets.transito, pendingSignals],
  );
  const logisticsRequests = useMemo<LogisticsRequest[]>(() => {
    const values = new Map<
      string,
      LogisticsRequest & { priority: number; requestedAt: Date | null }
    >();
    pendingSignals.forEach((signal, index) => {
      const baseKey = `sap|${signal.id}`;
      const itemKey = `${baseKey}|${readPendingOrderDetails(signal.row).item}`;
      const key = values.has(baseKey)
        ? values.has(itemKey) ? `${itemKey}|${index}` : itemKey
        : baseKey;
      const planning = logisticsPlanningContext.get(signal.id);
      const current = values.get(key) || {
        date: signal.dueDate ? dateKey(signal.dueDate) : "",
        destination: signal.nucleus || "Destino não informado",
        destinationCode: signal.nucleus || "",
        id: key,
        requestNumber: signal.reference,
        sourceWarehouse: "",
        status: "Pendente SAP",
        lines: [],
        priority: planning?.priority || 4,
        requestedAt: planning?.requestedAt || signal.dueDate,
      };
      const dimension =
        logisticsDimensionFor(signal.physicalMaterial, dimensions) ||
        logisticsDimensionFor(signal.material, dimensions);
      current.lines.push({
        id: key,
        active: dimension?.principleActive || "Não conciliado",
        culture: cultureFor(signal.row),
        lot: "",
        product: signal.physicalMaterial || signal.material,
        productCode: readText(
          signal.row,
          "Material",
          "CD MAT",
          "Cod. material",
          "Código material",
          "Codigo material",
        ),
        quantity: pendingSapQuantity(signal.row),
        inTransit: transitByPendingRow.get(signal.row) || 0,
        standardProduct: signal.material,
        unit: readText(signal.row, ...sapUnitHeaders) || "UN",
        planningDate: planning?.planningDate
          ? dateKey(planning.planningDate)
          : "",
        planningCycle: planning?.planningCycle || dashboardSettings.daeCycle,
        cycleWarning: planning?.cycleWarning || "",
        daysBeforePlanning: planning?.daysBeforePlanning ?? null,
        plannedUntilRequest: planning?.plannedUntilRequest || 0,
        planningStatus: planning?.planningStatus || "Sem data planejada",
      });
      values.set(key, current);
    });
    return [...values.values()].sort(
      (left, right) =>
        left.priority - right.priority ||
        (left.requestedAt?.getTime() || Number.MAX_SAFE_INTEGER) -
          (right.requestedAt?.getTime() || Number.MAX_SAFE_INTEGER) ||
        left.requestNumber.localeCompare(right.requestNumber, "pt-BR", {
          numeric: true,
        }),
    );
  }, [dashboardSettings.daeCycle, dimensions, logisticsPlanningContext, pendingSignals, transitByPendingRow]);
  const logisticsProductOptions = useMemo(
    () =>
      [
        ...new Set(
          logisticsRequests
            .flatMap((request) => request.lines.map((line) => line.product))
            .filter(Boolean),
        ),
      ].sort((left, right) => left.localeCompare(right, "pt-BR")),
    [logisticsRequests],
  );
  const logisticsUnitOptions = useMemo(
    () =>
      [
        ...new Set(
          logisticsRequests
            .map((request) => request.destination)
            .filter(Boolean),
        ),
      ].sort((left, right) => left.localeCompare(right, "pt-BR")),
    [logisticsRequests],
  );
  const filteredLogisticsRequests = useMemo(() => {
    const productQuery = normalizeMaterial(logisticsProductFilter);
    const orderQuery = normalizeMaterial(logisticsOrderFilter);
    return logisticsRequests.filter((request) => {
      const line = request.lines[0];
      const urgent =
        line?.planningStatus === "Planejamento já iniciado" ||
        line?.planningStatus === "Antecedência curta";
      const priorityMatches =
        logisticsPriorityFilter === "Todas" ||
        (logisticsPriorityFilter === "Urgente" && urgent) ||
        (logisticsPriorityFilter === "Janela adequada" &&
          line?.planningStatus === "Janela adequada") ||
        (logisticsPriorityFilter === "Antecedência longa" &&
          line?.planningStatus === "Antecedência longa") ||
        (logisticsPriorityFilter === "Sem data planejada" &&
          line?.planningStatus === "Sem data planejada");
      return (
        (!productQuery ||
          normalizeMaterial(line?.product).includes(productQuery)) &&
        (!orderQuery ||
          normalizeMaterial(request.requestNumber).includes(orderQuery)) &&
        (logisticsUnitFilter === "Todos" ||
          request.destination === logisticsUnitFilter) &&
        priorityMatches
      );
    });
  }, [
    logisticsOrderFilter,
    logisticsPriorityFilter,
    logisticsProductFilter,
    logisticsRequests,
    logisticsUnitFilter,
  ]);
  const dispatchedByRequestLine = useMemo(() => {
    const values = new Map<string, number>();
    logistics.trips.flatMap(logisticsTripItems).forEach((item) => {
      if (!item.requestLineId || item.sourceMode === "manual") return;
      values.set(
        item.requestLineId,
        (values.get(item.requestLineId) || 0) + item.quantity,
      );
    });
    return values;
  }, [logistics.trips]);
  const legacyDispatchedByRequestProduct = useMemo(() => {
    const values = new Map<string, number>();
    logistics.trips.flatMap(logisticsTripItems).forEach((item) => {
      if (
        item.requestLineId ||
        item.sourceMode === "manual" ||
        item.requestId === "SEM-PEDIDO"
      )
        return;
      const key = [
        normalizeMaterial(item.requestId),
        normalizeMaterial(item.requestProduct || item.product),
      ].join("|");
      values.set(key, (values.get(key) || 0) + item.quantity);
    });
    return values;
  }, [logistics.trips]);
  const logisticsLineBalances = useMemo(() => {
    const legacyRemaining = new Map(legacyDispatchedByRequestProduct);
    const balances = new Map<string, number>();
    for (const request of logisticsRequests) {
      for (const line of request.lines) {
        const legacyKey = [normalizeMaterial(request.requestNumber), normalizeMaterial(line.product)].join("|");
        const balance = Math.max(0, line.quantity - (line.inTransit || 0) - (dispatchedByRequestLine.get(line.id) || 0));
        const legacyVolume = legacyRemaining.get(legacyKey) || 0;
        legacyRemaining.set(legacyKey, Math.max(0, legacyVolume - balance));
        balances.set(line.id, Math.max(0, balance - legacyVolume));
      }
    }
    return balances;
  }, [dispatchedByRequestLine, legacyDispatchedByRequestProduct, logisticsRequests]);
  const remainingForLogisticsLine = (line: LogisticsRequestLine) => logisticsLineBalances.get(line.id) || 0;
  const availableLogisticsRequests = logisticsRequests.filter((request) =>
    request.lines.some(
      (line) => remainingForLogisticsLine(line) > 0,
    ),
  );
  const availableFilteredLogisticsRequests = filteredLogisticsRequests.filter(
    (request) =>
      request.lines.some(
        (line) => remainingForLogisticsLine(line) > 0,
      ),
  );
  if (requestedDateSort) {
    availableFilteredLogisticsRequests.sort((left, right) => {
      if (!left.date || !right.date) return Number(!left.date) - Number(!right.date);
      return requestedDateSort === "ascending"
        ? left.date.localeCompare(right.date)
        : right.date.localeCompare(left.date);
    });
  }
  const linkedWebRequestIds = useMemo(
    () =>
      new Set(
        logistics.trips.flatMap((trip) => trip.webRequestIds || []),
      ),
    [logistics.trips],
  );
  const selectedLogisticsRequest =
    logisticsRequests.find((request) => request.id === tripRequestId) || null;
  const selectedLogisticsLine =
    selectedLogisticsRequest?.lines.find(
      (line) => line.id === tripMaterialKey,
    ) || null;
  const selectedLineRemaining = selectedLogisticsLine
    ? remainingForLogisticsLine(selectedLogisticsLine)
    : 0;
  const webStockOptions = useMemo(
    () =>
      datasets.estoqueWeb
        .map((row, index) => {
          const product = readText(
            row,
            "Descrição Produto",
            "Descricao Produto",
            "Produto",
            "INSUMO WEB",
            "Insumo Web",
            "INSUMO SAP",
            "Insumo SAP",
            "Produto Web",
            "Material Web",
            "Descrição material",
            "Descricao material",
          );
          const dimension = logisticsDimensionFor(product, dimensions);
          const balance = readNumber(
            row,
            "Saldo",
            "QTD",
            "Qtd",
            "Quantidade",
            "Qt. Disponível",
            "Qt Disponivel",
          );
          const warehouse =
            readText(
              row,
              "Nome Op. Logístico",
              "Nome Op. Logistico",
              "Armazém",
              "Armazem",
              "Centro",
              "CEN",
            ) || "Armazém não identificado";
          const responsibleName =
            readText(
              row,
              "Nome do Responsável",
              "Nome do Responsavel",
              "Responsável",
              "Responsavel",
              "AG",
            ) || "BOA ESPERANCA AGROPECUARIA LTDA";
          return {
            id: `${index}|${normalizeMaterial(product)}|${normalizeMaterial(readText(row, "Lote", "LOTE WEB", "Lote Web"))}`,
            active: dimension?.principleActive || "Não conciliado",
            balance,
            code: readText(
              row,
              "Cód. Prod. Indústria",
              "Cod. Prod. Industria",
              "CD MAT",
              "Material",
            ),
            lot: readText(row, "Lote", "LOTE WEB", "Lote Web"),
            pallets: readNumber(
              row,
              "Qt Paletes",
              "Qtd Paletes",
              "Paletes",
              "Pallets",
            ),
            product,
            responsibleName,
            standardProduct: dimension?.aggregateMaterial || product,
            unit: readText(row, "UMB", "Und", "Unidade", "UM") || "UN",
            warehouse,
            weightKg: readNumber(
              row,
              "Peso KG",
              "Peso (kg)",
              "Peso total KG",
              "Peso total (kg)",
            ),
          };
        })
        .filter((item) => item.product && item.balance > 0),
    [datasets.estoqueWeb, dimensions],
  );
  const webWarehouseProductOptions = useMemo(() => {
    const values = new Map<
      string,
      {
        active: string;
        balance: number;
        code: string;
        id: string;
        pallets: number;
        product: string;
        responsibleName: string;
        standardProduct: string;
        stockReferences: string[];
        unit: string;
        warehouse: string;
        weightKg: number;
      }
    >();
    webStockOptions.forEach((stock) => {
      const key = [
        normalizeMaterial(stock.product),
        normalizeMaterial(stock.warehouse),
        normalizeMaterial(stock.responsibleName),
        normalizeMaterial(stock.unit),
      ].join("|");
      const current = values.get(key) || {
        active: stock.active,
        balance: 0,
        code: stock.code,
        id: `saldo|${key}`,
        pallets: 0,
        product: stock.product,
        responsibleName: stock.responsibleName,
        standardProduct: stock.standardProduct,
        stockReferences: [],
        unit: stock.unit,
        warehouse: stock.warehouse,
        weightKg: 0,
      };
      current.balance += stock.balance;
      current.pallets += stock.pallets || 0;
      current.weightKg += stock.weightKg || 0;
      current.stockReferences.push(stock.id);
      values.set(key, current);
    });
    return [...values.values()].sort(
      (left, right) =>
        left.product.localeCompare(right.product, "pt-BR") ||
        left.warehouse.localeCompare(right.warehouse, "pt-BR"),
    );
  }, [webStockOptions]);
  const generalStockOptions = useMemo(() => {
    const values = new Map<
      string,
      {
        balance: number;
        code: string;
        id: string;
        product: string;
        unit: string;
        warehouse: string;
      }
    >();
    stockRows.forEach((row, index) => {
      const product = productFor(row, "stock", dimensions);
      const balance = quantityFor(row, "stock");
      if (
        !product.rawName ||
        product.rawName === "Sem descrição" ||
        balance <= 0
      )
        return;
      const nucleus = stockNucleusFor(row, dimensions, farmToNucleus);
      const location = stockLocationFor(row, nucleus);
      const unit = readText(row, "UMB", "UM", "Unidade", "Und", "U") || "UN";
      const key = [
        normalizeMaterial(product.rawName),
        normalizeMaterial(location.place),
        normalizeMaterial(unit),
      ].join("|");
      const current = values.get(key) || {
        balance: 0,
        code: product.code,
        id: `geral|${key}|${index}`,
        product: product.rawName,
        unit,
        warehouse: location.place,
      };
      current.balance += balance;
      values.set(key, current);
    });
    return [...values.values()].sort(
      (left, right) =>
        left.product.localeCompare(right.product, "pt-BR") ||
        left.warehouse.localeCompare(right.warehouse, "pt-BR"),
    );
  }, [dimensions, farmToNucleus, stockRows]);
  const stockUnitValues = useMemo(() => {
    const values = new Map<string, { quantity: number; total: number }>();
    stockRows.forEach((row) => {
      const product = productFor(row, "stock", dimensions);
      const quantity = quantityFor(row, "stock");
      const total = readNumber(
        row,
        "Val.utiliz.livre",
        "Val. utiliz. livre",
        "Valor utilizável livre",
        "Valor utilizavel livre",
        "Valor total",
        "Valor Total",
        "Valor total estoque",
        "Valor Estoque",
        "Valor em moeda interna",
        "Valor",
      );
      if (!product.rawName || quantity <= 0 || total <= 0) return;
      [product.rawName, product.canonicalName]
        .filter(Boolean)
        .forEach((name) => {
          const key = normalizeMaterial(name);
          const current = values.get(key) || { quantity: 0, total: 0 };
          current.quantity += quantity;
          current.total += total;
          values.set(key, current);
        });
    });
    return new Map(
      [...values.entries()].map(([key, value]) => [
        key,
        value.total / value.quantity,
      ]),
    );
  }, [dimensions, stockRows]);
  const unitValueForProduct = (product: string, standardProduct = "") =>
    stockUnitValues.get(normalizeMaterial(product)) ||
    stockUnitValues.get(normalizeMaterial(standardProduct)) ||
    0;
  const routeLocationOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...ledger.map((entry) => entry.nucleus),
            ...generalStockOptions.map((stock) => stock.warehouse),
            ...webWarehouseProductOptions.map((stock) => stock.warehouse),
            ...Object.keys(dimensions.centerToNucleus),
            ...Object.values(dimensions.centerToNucleus),
            ...Object.keys(logistics.municipalityByLocation || {}),
          ].filter(Boolean),
        ),
      ].sort((left, right) => left.localeCompare(right, "pt-BR")),
    [
      dimensions.centerToNucleus,
      generalStockOptions,
      ledger,
      logistics.municipalityByLocation,
      webWarehouseProductOptions,
    ],
  );
  const compatibleWarehouseStocks = useMemo(() => {
    if (!selectedLogisticsLine) return [];
    const requestedProduct = normalizeMaterial(selectedLogisticsLine.product);
    const requestedStandard = normalizeMaterial(
      selectedLogisticsLine.standardProduct,
    );
    const requestedActive = normalizeMaterial(selectedLogisticsLine.active);
    const linkedWebProduct = normalizeMaterial(
      logistics.webMaterialLinks?.[requestedProduct],
    );
    return webWarehouseProductOptions.filter(
      (stock) =>
        normalizeMaterial(stock.product) === requestedProduct ||
        normalizeMaterial(stock.standardProduct) === requestedStandard ||
        (requestedProduct.length >= 5 &&
          normalizeMaterial(stock.product).includes(requestedProduct)) ||
        (requestedStandard.length >= 5 &&
          normalizeMaterial(stock.product).includes(requestedStandard)) ||
        (linkedWebProduct &&
          normalizeMaterial(stock.product) === linkedWebProduct) ||
        (requestedActive &&
          requestedActive !== "NAOCONCILIADO" &&
          normalizeMaterial(stock.active) === requestedActive),
    );
  }, [
    logistics.webMaterialLinks,
    selectedLogisticsLine,
    webWarehouseProductOptions,
  ]);
  const selectedWarehouseStock =
    compatibleWarehouseStocks.find(
      (stock) => stock.id === tripFulfillmentStockId,
    ) ||
    compatibleWarehouseStocks.find(
      (stock) =>
        normalizeMaterial(stock.product) ===
        normalizeMaterial(selectedLogisticsLine?.product),
    ) ||
    compatibleWarehouseStocks[0];
  const selectedDestinationNucleus = selectedLogisticsRequest
    ? dimensions.centerToNucleus[
        normalizeMaterial(selectedLogisticsRequest.destinationCode)
      ] ||
      farmToNucleus[
        normalizeMaterial(selectedLogisticsRequest.destinationCode)
      ] ||
      dimensions.centerToNucleus[
        normalizeMaterial(selectedLogisticsRequest.destination)
      ] ||
      farmToNucleus[normalizeMaterial(selectedLogisticsRequest.destination)] ||
      (selectedLogisticsRequest.destinationCode.startsWith("NC-")
        ? selectedLogisticsRequest.destinationCode
        : "Sem núcleo")
    : "Sem núcleo";
  const collectionOptions = useMemo(() => {
    if (!selectedLogisticsLine)
      return [] as Array<{
        balance: number;
        id: string;
        material: string;
        nucleus: string;
      }>;
    const requestedActive = normalizeMaterial(selectedLogisticsLine.active);
    const requestedStandard = normalizeMaterial(
      selectedLogisticsLine.standardProduct,
    );
    const values = new Map<
      string,
      { balance: number; id: string; material: string; nucleus: string }
    >();
    ledger.forEach((entry) => {
      const match =
        normalizeMaterial(entry.standardMaterial) === requestedStandard ||
        (requestedActive &&
          requestedActive !== "NAOCONCILIADO" &&
          normalizeMaterial(entry.active) === requestedActive);
      if (!match) return;
      entry.locations
        .filter(
          (location) => location.type === "Fazenda" && location.amount > 0,
        )
        .forEach((location) => {
          const id = `${entry.nucleus}|${location.material}`;
          const current = values.get(id) || {
            balance: 0,
            id,
            material: location.material,
            nucleus: entry.nucleus,
          };
          current.balance += location.amount;
          values.set(id, current);
        });
    });
    return [...values.values()]
      .filter((item) => item.nucleus !== selectedDestinationNucleus)
      .sort(
        (left, right) =>
          left.nucleus.localeCompare(right.nucleus) ||
          left.material.localeCompare(right.material),
      );
  }, [ledger, selectedDestinationNucleus, selectedLogisticsLine]);
  const selectedCollection =
    collectionOptions.find((item) => item.id === tripCollectionId) ||
    collectionOptions[0];
  const selectedSourceBalance =
    tripSourceMode === "coleta"
      ? selectedCollection?.balance || 0
      : selectedWarehouseStock?.balance || 0;
  const selectedQuantity = tripQuantity.trim()
    ? numberFrom(tripQuantity)
    : selectedLineRemaining;
  const selectedFarmPlan = selectedLogisticsLine
    ? logisticsCycleLedger
        .filter(
          (entry) =>
            entry.nucleus === selectedDestinationNucleus &&
            (normalizeMaterial(entry.standardMaterial) ===
              normalizeMaterial(selectedLogisticsLine.standardProduct) ||
              (normalizeMaterial(selectedLogisticsLine.active) !==
                "NAOCONCILIADO" &&
                normalizeMaterial(entry.active) ===
                  normalizeMaterial(selectedLogisticsLine.active))),
        )
        .reduce((sum, entry) => sum + entry.shortage, 0)
    : 0;
  const selectedOverPlan = Math.max(0, selectedQuantity - selectedFarmPlan);
  const selectedRouteItem = useMemo<LogisticsTripItem | null>(() => {
    if (!selectedLogisticsRequest || !selectedLogisticsLine) return null;
    const source =
      tripSourceMode === "coleta" ? selectedCollection : selectedWarehouseStock;
    if (!source || selectedQuantity <= 0) return null;
    const sourceProduct =
      tripSourceMode === "coleta"
        ? selectedCollection?.material || selectedLogisticsLine.product
        : selectedWarehouseStock?.product || selectedLogisticsLine.product;
    const sourceBalance = selectedSourceBalance || 1;
    const sourcePallets =
      tripSourceMode === "coleta" ? 0 : selectedWarehouseStock?.pallets || 0;
    const isVolumetricProduct = /\b\d+(?:[,.]\d+)?\s*(?:L|ML)\b/i.test(
      sourceProduct,
    );
    const sourceWeight =
      tripSourceMode === "coleta" || isVolumetricProduct
        ? 0
        : selectedWarehouseStock?.weightKg || 0;
    const inferredWeight = inferredPackageWeightKg(
      sourceProduct,
      selectedLogisticsLine.unit,
    );
    const unitValue = unitValueForProduct(
      sourceProduct,
      selectedLogisticsLine.standardProduct,
    );
    return {
      id: taskId("rota"),
      active: selectedLogisticsLine.active,
      requestId: selectedLogisticsRequest.requestNumber,
      requestDate: selectedLogisticsRequest.date,
      product: sourceProduct,
      productCode:
        tripSourceMode === "coleta"
          ? ""
          : selectedWarehouseStock?.code || selectedLogisticsLine.productCode,
      // O planejamento reserva somente o saldo do produto. O lote real é
      // definido depois, no processo operacional de carregamento.
      lot: "",
      quantity: selectedQuantity,
      unit: selectedLogisticsLine.unit,
      adjustmentRequired:
        normalizeMaterial(sourceProduct) !==
        normalizeMaterial(selectedLogisticsLine.product),
      pallets: sourcePallets
        ? (selectedQuantity / sourceBalance) * sourcePallets
        : 0,
      requestLineId: selectedLogisticsLine.id,
      requestProduct: selectedLogisticsLine.product,
      standardProduct: selectedLogisticsLine.standardProduct,
      culture: selectedLogisticsLine.culture || "",
      sourceMode: tripSourceMode,
      sourceNucleus:
        tripSourceMode === "coleta" ? selectedCollection?.nucleus : "",
      sourceWarehouse:
        tripSourceMode === "coleta"
          ? `Coletar na ${selectedCollection?.nucleus || "fazenda"}`
          : selectedWarehouseStock?.warehouse ||
            selectedLogisticsRequest.sourceWarehouse ||
            "Armazém não identificado",
      stockReference:
        tripSourceMode === "coleta"
          ? selectedCollection?.material
          : selectedWarehouseStock?.id,
      responsibleName:
        tripSourceMode === "coleta"
          ? "BOA ESPERANCA AGROPECUARIA LTDA"
          : selectedWarehouseStock?.responsibleName ||
            "BOA ESPERANCA AGROPECUARIA LTDA",
      destination:
        selectedLogisticsRequest.destination || "Destino não identificado",
      destinationCode: selectedLogisticsRequest.destinationCode,
      weightKg: sourceWeight
        ? (selectedQuantity / sourceBalance) * sourceWeight
        : inferredWeight
          ? selectedQuantity * inferredWeight
          : selectedLogisticsLine.unit.toUpperCase().includes("KG")
            ? selectedQuantity
            : 0,
      estimatedValue: selectedQuantity * unitValue,
    };
  }, [
    selectedCollection,
    selectedLogisticsLine,
    selectedLogisticsRequest,
    selectedQuantity,
    selectedSourceBalance,
    selectedWarehouseStock,
    stockUnitValues,
    tripSourceMode,
  ]);
  const selectedLogisticsVehicle = logistics.vehicles.find(
    (vehicle) => vehicle.id === tripVehicleId,
  );
  const samePlateTripsOnDate = useMemo(
    () =>
      tripVehicleId && tripDate
        ? logistics.trips.filter(
            (trip) =>
              trip.vehicleId === tripVehicleId &&
              logisticsTripDate(trip) === tripDate,
          )
        : [],
    [logistics.trips, tripDate, tripVehicleId],
  );
  const routeLoad = useMemo(
    () => ({
      pallets: routeItems.reduce((sum, item) => sum + (item.pallets || 0), 0),
      weightKg: routeItems.reduce((sum, item) => sum + (item.weightKg || 0), 0),
      itemsWithoutWeight: routeItems.filter(
        (item) =>
          !item.weightKg && !String(item.unit || "").toUpperCase().includes("KG"),
      ).length,
      value: routeItems.reduce(
        (sum, item) => sum + (item.estimatedValue || 0),
        0,
      ),
    }),
    [routeItems],
  );
  const routeCapacity = selectedLogisticsVehicle
    ? {
        palletExceeded: Boolean(
          selectedLogisticsVehicle.palletCapacity &&
            routeLoad.pallets > selectedLogisticsVehicle.palletCapacity,
        ),
        weightExceeded: routeLoad.weightKg > selectedLogisticsVehicle.capacity,
      }
    : null;
  const routeMap = useMemo(() => {
    const origins = [
      ...new Set(
        routeItems
          .map((item) =>
            logisticsMunicipalityFor(
              item.sourceWarehouse,
              logistics.municipalityByLocation,
            ),
          )
          .filter(Boolean),
      ),
    ];
    const destinations = [
      ...new Set(
        routeItems
          .map((item) =>
            logisticsMunicipalityFor(
              item.destinationCode || item.destination,
              logistics.municipalityByLocation,
            ),
          )
          .filter(Boolean),
      ),
    ];
    const origin = origins[0] || "";
    const destination = destinations[0] || "";
    const originAddress = logisticsAddressFor(
      routeItems[0]?.sourceWarehouse || "",
      logistics.addressByLocation,
    );
    const destinationAddress = logisticsAddressFor(
      routeItems[0]?.destinationCode || routeItems[0]?.destination || "",
      logistics.addressByLocation,
    );
    const routeOrigin = originAddress || origin;
    const routeDestination = destinationAddress || destination;
    return {
      destination,
      destinationAddress,
      destinations,
      embedUrl:
        routeOrigin && routeDestination
          ? `https://www.google.com/maps?q=${encodeURIComponent(`${routeOrigin} até ${routeDestination}`)}&output=embed`
          : "",
      mapUrl:
        routeOrigin && routeDestination
          ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(routeOrigin)}&destination=${encodeURIComponent(routeDestination)}`
          : "",
      origin,
      originAddress,
      origins,
    };
  }, [
    logistics.addressByLocation,
    logistics.municipalityByLocation,
    routeItems,
  ]);

  const scopedPendingSignals = useMemo(
    () =>
      isOperator
        ? pendingSignals.filter((signal) => signal.nucleus === operatorNucleus)
        : pendingSignals,
    [isOperator, operatorNucleus, pendingSignals],
  );
  const farol = useMemo(
    () => ({
      demand: scopedPendingSignals.filter(
        (signal) => signal.status === "Demanda próxima",
      ).length,
      delay: scopedPendingSignals.filter(
        (signal) => signal.status === "Possível atraso",
      ).length,
      attention: scopedPendingSignals.filter(
        (signal) => signal.status === "Ponto de atenção",
      ).length,
      alert: scopedPendingSignals.filter((signal) => signal.status === "Alerta")
        .length,
    }),
    [scopedPendingSignals],
  );

  const taskNuclei = useMemo(
    () => [
      "Todos",
      ...[
        ...new Set(
          scopedPendingSignals.map((signal) => signal.nucleus).filter(Boolean),
        ),
      ].sort(),
    ],
    [scopedPendingSignals],
  );
  const taskOrders = useMemo(
    () => [
      "Todos",
      ...[
        ...new Set(
          scopedPendingSignals
            .map((signal) => signal.reference)
            .filter(Boolean),
        ),
      ].sort(),
    ],
    [scopedPendingSignals],
  );
  const taskMaterialOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...ledger.map((row) => row.standardMaterial),
            ...ledger.flatMap((row) => row.stockMaterials),
            ...scopedPendingSignals.map((signal) => signal.material),
          ].filter(Boolean),
        ),
      ].sort(),
    [ledger, scopedPendingSignals],
  );
  const filteredPendingSignals = useMemo(() => {
    const materialSearch = normalizeMaterial(taskMaterialFilter);
    return scopedPendingSignals.filter(
      (signal) =>
        (taskSignalFilter === "Todos" || signal.status === taskSignalFilter) &&
        (taskOrderFilter === "Todos" || signal.reference === taskOrderFilter) &&
        (taskNucleusFilter === "Todos" ||
          signal.nucleus === taskNucleusFilter) &&
        (!materialSearch ||
          normalizeMaterial(signal.material).includes(materialSearch)),
    );
  }, [
    scopedPendingSignals,
    taskMaterialFilter,
    taskNucleusFilter,
    taskOrderFilter,
    taskSignalFilter,
  ]);
  const transitOrders = useMemo(() => {
    const orders = listTransitNotificationOrders(datasets.transito);
    if (!isOperator) return orders;
    return orders.filter(({ center }) =>
      operatorHasNucleus && (farmToNucleus[normalizeMaterial(center)] || center) === operatorNucleus,
    );
  }, [datasets.transito, farmToNucleus, isOperator, operatorHasNucleus, operatorNucleus]);
  const transitCenters = useMemo(() => [...new Set(transitOrders.map(({ center }) => center))], [transitOrders]);
  const taskTransitDestination = transitCenters.includes(taskTransitCenter) ? taskTransitCenter : "";
  const isTransitNotification = notificationKind === "transito";
  const notificationDraft = useMemo(() => {
    if (!notificationKind) return null;
    if (notificationKind === "transito") {
      const rows = transitOrders.filter(({ center }) => !notificationCenter || center === notificationCenter);
      return rows.length ? buildTransitNotification(notificationCenter, rows) : null;
    }
    const minimumDays = Number(notificationDays);
    const candidates = scopedPendingSignals.filter(
      (signal) =>
        signal.daysUntil !== null &&
        signal.daysUntil <= -minimumDays &&
        (notificationNucleus === "Todos" ||
          signal.nucleus === notificationNucleus),
    );
    if (!candidates.length) return null;

    const rows = resolveTaskNotificationOrders(
      candidates,
      pendingSignals,
      datasets.pedidosCompra,
      notificationSource?.rows,
    );
    return rows.length
      ? {
          ...buildTaskNotification(notificationNucleus, minimumDays, rows),
          count: rows.length,
        }
      : null;
  }, [
    datasets.pedidosCompra,
    notificationCenter,
    notificationDays,
    notificationKind,
    notificationNucleus,
    notificationSource,
    pendingSignals,
    scopedPendingSignals,
    transitOrders,
  ]);
  const notificationRecipients = parseNotificationRecipients(notificationTo);
  const notificationCopy = parseNotificationRecipients(notificationCc);
  const outlookDraftUrl =
    !notificationSourceLoading &&
    notificationDraft &&
    notificationRecipients?.length &&
    notificationCopy
      ? buildNotificationMailto(
          notificationDraft.subject,
          notificationRecipients,
          notificationCopy,
        )
      : null;

  const supplyAlerts = useMemo<OperationalAlert[]>(() => {
    const start = startOfDay(new Date(clock));
    const finish = new Date(start);
    finish.setDate(finish.getDate() + 30);
    const datedPlans = plans.map((row) => ({
      row,
      dueDate: dateFromPlan(
        readText(
          row,
          "DT_Aplicacao",
          "Data prevista",
          "Data planejada",
          "Data aplicação",
          "Data",
        ),
      ),
    }));
    const plannedSoon = datedPlans.filter(
      (item) => item.dueDate && item.dueDate >= start && item.dueDate <= finish,
    );
    if (!plannedSoon.length) return [];
    const dueDates = new Map<string, Date>();
    plannedSoon.forEach(({ row, dueDate }) => {
      const product = productFor(row, "planning", dimensions);
      const nucleus = planningNucleusFor(row, dimensions, farmToNucleus);
      const id = `${product.canonicalKey}|${normalizeMaterial(nucleus)}`;
      const current = dueDates.get(id);
      if (!current || dueDate! < current) dueDates.set(id, dueDate!);
    });
    const windowLedger = buildReconciliation({
      bundle: dimensions,
      planningRows: plannedSoon.map((item) => item.row),
      stockRows,
      transitRows: datasets.transito,
      consumptionRows: datasets.consumo,
      pendingRows: pendingOrders,
      farmToNucleus,
    });
    const demands: DemandRow[] = windowLedger
      .filter((row) => row.planned > row.applied)
      .map((row) => ({
        ...row,
        demand: Math.max(0, row.planned - row.applied),
        local: row.farmBalance + row.transit,
      }));
    const allocation = allocateCentralWarehouse(demands, windowLedger);
    return demands
      .filter((row) => row.demand > 0 && row.farmBalance <= 0)
      .map((row) => {
        const support = allocation.allocations.get(row.id) || {
          allocated: 0,
          locations: [],
        };
        const locations = consolidateLocations(support.locations);
        // O rateio indica o apoio possível; o aviso também expõe o saldo físico
        // completo por armazém para o gestor avaliar a origem do repasse.
        const warehouseBalances = consolidateWarehouseBalances(
          windowLedger
            .filter((candidate) => candidate.canonicalKey === row.canonicalKey)
            .flatMap((candidate) => candidate.locations),
        );
        const place = locations.map((location) => location.location).join(", ");
        const fromCuiaba = locations.some((location) =>
          normalizeMaterial(location.location).includes("CUIABA"),
        );
        const dueDate = dueDates.get(row.id);
        const warehouseDetail =
          support.allocated > 0
            ? ` Há ${formatNumber(support.allocated)} no armazém${place ? `: ${place}` : ""}.${fromCuiaba ? " Origem Cuiabá: priorize o envio pelo maior tempo logístico." : " Priorize o repasse ao núcleo."}`
            : " Não há apoio disponível no armazém para esta demanda.";
        return {
          id: `repasse-${row.id}`,
          category: "Repasse em até 30 dias",
          severity: support.allocated > 0 ? "attention" : "critical",
          title: `${row.standardMaterial} — ${row.nucleus}`,
          detail: `Uso previsto ${dueDate ? new Intl.DateTimeFormat("pt-BR").format(dueDate) : "nos próximos 30 dias"}; a fazenda não possui saldo. Demanda restante: ${formatNumber(row.demand)}.${warehouseDetail}`,
          metric: `${formatNumber(row.demand)} necessários`,
          warehouseBalances,
        };
      });
  }, [
    clock,
    datasets.consumo,
    datasets.transito,
    dimensions,
    farmToNucleus,
    pendingOrders,
    plans,
    stockRows,
  ]);

  const doseIncreaseAlerts = useMemo<OperationalAlert[]>(
    () =>
      executionPerformance
        .filter(
          (row) =>
            row.plannedDose !== null &&
            row.plannedDose > 0 &&
            row.appliedDose !== null &&
            row.appliedDose > row.plannedDose * 1.05,
        )
        .map((row) => {
          const increase = (row.appliedDose! / row.plannedDose! - 1) * 100;
          return {
            id: `dose-${row.id}`,
            category: "Aumento de dose na execução",
            severity: increase >= 15 ? "critical" : "attention",
            title: `${row.standardMaterial} — ${row.nucleus}`,
            detail: `Dose executada ${formatDose(row.appliedDose)} frente a ${formatDose(row.plannedDose)} planejada. O acréscimo gera ${signedNumber(row.volumeImpact)} de impacto na área já executada.`,
            metric: `+${increase.toFixed(1)}%`,
          };
        })
        .sort(
          (left, right) =>
            Number(right.metric.replace(/[^0-9,.]/g, "").replace(",", ".")) -
            Number(left.metric.replace(/[^0-9,.]/g, "").replace(",", ".")),
        ),
    [executionPerformance],
  );

  const expiredStockAlerts = useMemo<OperationalAlert[]>(() => {
    const values = new Map<
      string,
      {
        amount: number;
        days: number;
        location: string;
        material: string;
        type: string;
        value: number;
      }
    >();
    stockRows.forEach((row) => {
      const expiry = dateFromPlan(
        readText(
          row,
          "Dt. Validade",
          "Dt Validade",
          "Data de validade",
          "Data Validade",
          "Validade",
        ),
      );
      if (!expiry || expiry >= startOfDay(new Date(clock))) return;
      const product = productFor(row, "stock", dimensions);
      if (product.rawName === "Sem descrição") return;
      const nucleus = stockNucleusFor(row, dimensions, farmToNucleus);
      const location = stockLocationFor(row, nucleus);
      const key = [product.canonicalKey, location.type, location.place].join(
        "|",
      );
      const current = values.get(key) || {
        amount: 0,
        days: 0,
        location: location.place,
        material: product.canonicalName,
        type: location.type,
        value: 0,
      };
      current.amount += standardQuantity(row, "stock", product, dimensions);
      current.days = Math.max(
        current.days,
        Math.max(1, -daysFromToday(expiry, new Date(clock))),
      );
      current.value += readNumber(
        row,
        "Valor total",
        "Valor Total",
        "Valor",
        "Val. total",
        "Valor estoque",
      );
      values.set(key, current);
    });
    return [...values.entries()]
      .map(([id, item]) => ({
        id: `vencido-${id}`,
        category: "Estoque vencido",
        severity: "critical" as const,
        title: `${item.material} — ${item.type}`,
        detail: `${item.location}. Produto vencido há ${item.days} dia${item.days === 1 ? "" : "s"}; saldo convertido de ${formatNumber(item.amount)} e valor agregado de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.value)}.`,
        metric: `${item.days} dia${item.days === 1 ? "" : "s"}`,
      }))
      .sort(
        (left, right) =>
          Number(right.metric.split(" ")[0]) -
          Number(left.metric.split(" ")[0]),
      );
  }, [clock, dimensions, farmToNucleus, stockRows]);

  const operationalAlerts = useMemo(
    () => [...supplyAlerts, ...doseIncreaseAlerts, ...expiredStockAlerts],
    [doseIncreaseAlerts, expiredStockAlerts, supplyAlerts],
  );
  const scopedOperationalAlerts = useMemo(() => {
    if (!isOperator) return operationalAlerts;
    const normalizedNucleus = normalizeMaterial(operatorNucleus);
    return operationalAlerts.filter((alert) =>
      normalizeMaterial(`${alert.title} ${alert.detail}`).includes(
        normalizedNucleus,
      ),
    );
  }, [isOperator, operationalAlerts, operatorNucleus]);
  const scopedAlertCounts = useMemo(
    () => ({
      dose: scopedOperationalAlerts.filter(
        (alert) => alert.category === "Aumento de dose na execução",
      ).length,
      expired: scopedOperationalAlerts.filter(
        (alert) => alert.category === "Estoque vencido",
      ).length,
      supply: scopedOperationalAlerts.filter(
        (alert) => alert.category === "Repasse em até 30 dias",
      ).length,
    }),
    [scopedOperationalAlerts],
  );
  const alertNuclei = useMemo(() => {
    if (isOperator) return operatorHasNucleus ? [operatorNucleus] : [];
    return [
      "Todos",
      ...[...new Set(ledger.map((row) => row.nucleus).filter(Boolean))].sort(),
    ];
  }, [isOperator, ledger, operatorHasNucleus, operatorNucleus]);
  const alertGroups = useMemo(
    () => [
      "Todos",
      ...[
        ...new Set(ledger.map((row) => row.merchandiseGroup).filter(Boolean)),
      ].sort(),
    ],
    [ledger],
  );
  const alertSubgroups = useMemo(
    () => [
      "Todos",
      ...[...new Set(ledger.map((row) => row.subgroup).filter(Boolean))].sort(),
    ],
    [ledger],
  );
  const filteredOperationalAlerts = useMemo(() => {
    const material = normalizeMaterial(alertMaterialFilter);
    const enforcedNucleus = isOperator ? operatorNucleus : alertNucleusFilter;
    const baseAlerts = isOperator ? scopedOperationalAlerts : operationalAlerts;
    const hasFilter =
      enforcedNucleus !== "Todos" ||
      Boolean(material) ||
      alertGroupFilter !== "Todos" ||
      alertSubgroupFilter !== "Todos";
    if (!hasFilter) return baseAlerts;
    const rowsInScope = ledger.filter(
      (row) =>
        (enforcedNucleus === "Todos" || row.nucleus === enforcedNucleus) &&
        (alertGroupFilter === "Todos" ||
          row.merchandiseGroup === alertGroupFilter) &&
        (alertSubgroupFilter === "Todos" ||
          row.subgroup === alertSubgroupFilter) &&
        (!material ||
          normalizeMaterial(
            [row.standardMaterial, ...row.stockMaterials].join(" "),
          ).includes(material)),
    );
    return baseAlerts.filter((alert) => {
      const searchable = normalizeMaterial(`${alert.title} ${alert.detail}`);
      return rowsInScope.some((row) =>
        [row.nucleus, row.active, row.standardMaterial, ...row.stockMaterials]
          .filter(Boolean)
          .some((value) => searchable.includes(normalizeMaterial(value))),
      );
    });
  }, [
    alertGroupFilter,
    alertMaterialFilter,
    alertNucleusFilter,
    alertSubgroupFilter,
    isOperator,
    ledger,
    operatorNucleus,
    operationalAlerts,
    scopedOperationalAlerts,
  ]);
  const warehouseStockRelations = useMemo(() => {
    const values = new Map<
      string,
      {
        active: string;
        group: string;
        subgroup: string;
        material: string;
        standardMaterial: string;
        warehouse: string;
        balance: number;
      }
    >();
    ledger.forEach((row) =>
      row.locations
        .filter(
          (location) => location.type === "Armazém" && location.amount > 0,
        )
        .forEach((location) => {
          const key = [
            row.canonicalKey,
            location.material,
            location.location,
          ].join("\u0000");
          const current = values.get(key);
          values.set(
            key,
            current
              ? { ...current, balance: current.balance + location.amount }
              : {
                  active: row.active,
                  group: row.merchandiseGroup,
                  subgroup: row.subgroup,
                  material: location.material,
                  standardMaterial: row.standardMaterial,
                  warehouse: location.location,
                  balance: location.amount,
                },
          );
        }),
    );
    const material = normalizeMaterial(alertMaterialFilter);
    return [...values.values()]
      .filter(
        (row) =>
          (alertGroupFilter === "Todos" || row.group === alertGroupFilter) &&
          (alertSubgroupFilter === "Todos" ||
            row.subgroup === alertSubgroupFilter) &&
          (!material ||
            normalizeMaterial(
              [row.active, row.standardMaterial, row.material].join(" "),
            ).includes(material)),
      )
      .sort(
        (left, right) =>
          left.warehouse.localeCompare(right.warehouse) ||
          left.material.localeCompare(right.material),
      );
  }, [alertGroupFilter, alertMaterialFilter, alertSubgroupFilter, ledger]);

  async function importFiles() {
    if (currentUser?.role !== "admin") {
      setMessage(
        "Somente administradores podem importar ou substituir arquivos operacionais.",
      );
      return;
    }
    const selected = sourceConfig.filter((source) => uploads[source.key]);
    if (!selected.length) {
      setMessage("Selecione ao menos uma fonte antes de importar.");
      return;
    }
    setImporting(true);
    setMessage("");
    try {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const loaded: Array<{
        key: SourceKey;
        rows: Row[];
        summary: ImportSummary;
        warnings: number;
      }> = [];
      for (const source of selected) {
        const file = uploads[source.key]!;
        setImportProgress(
          `Lendo ${source.title} em segundo plano (${loaded.length + 1} de ${selected.length})...`,
        );
        const parsed = await parseImportFile(file, source);
        loaded.push({
          key: source.key,
          rows: parsed.rows,
          summary: {
            fileName: file.name,
            fileModifiedAt: new Date(
              file.lastModified || Date.now(),
            ).toISOString(),
            importedAt: new Date().toISOString(),
            rows: parsed.rowCount,
            sheets: parsed.sheets,
          },
          warnings: importWarnings(parsed.rows, source.key).total,
        });
      }
      setImportProgress("Aplicando a carga conciliada aos visuais...");
      startTransition(() => {
        setDatasets((current) => ({
          ...current,
          ...Object.fromEntries(loaded.map((item) => [item.key, item.rows])),
        }));
        setImports((current) => ({
          ...current,
          ...Object.fromEntries(loaded.map((item) => [item.key, item.summary])),
        }));
        setImportHistory((current) => {
          const entries = loaded.map((item) => ({
            ...item.summary,
            id: taskId("import"),
            source: item.key,
            version:
              current.filter((entry) => entry.source === item.key).length + 1,
            previousRows: imports[item.key]?.rows || 0,
            warnings: item.warnings,
          }));
          return [...entries, ...current].slice(0, 80);
        });
      });
      loaded.forEach((item) =>
        recordAudit(
          "import",
          `${sourceConfig.find((source) => source.key === item.key)?.title || item.key}: ${item.summary.rows} linhas importadas${item.warnings ? `; ${item.warnings} validações pendentes` : ""}.`,
        ),
      );
      setUploads({});
      const warnings = loaded.reduce((sum, item) => sum + item.warnings, 0);
      setMessage(
        `Carga validada e salva na base central. ${warnings ? `${warnings} validação(ões) precisa(m) de revisão no histórico.` : "Os visuais já usam as fontes importadas."}`,
      );
      setActive("Visão geral");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ler um dos arquivos.",
      );
    } finally {
      setImporting(false);
      setImportProgress("");
    }
  }
  function addRoadDriver() {
    if (currentUser?.role !== "admin") return;
    const fullName = driverDraft.fullName.trim();
    const cpf = driverDraft.cpf.replace(/\D/g, "");
    if (!fullName || cpf.length !== 11) {
      setLogisticsMessage("Informe o nome completo e um CPF com 11 dígitos.");
      return;
    }
    if (
      logistics.drivers.some(
        (driver) => driver.cpf === cpf && driver.id !== editingDriverId,
      )
    ) {
      setLogisticsMessage("Já existe um motorista cadastrado com este CPF.");
      return;
    }
    const existing = logistics.drivers.find(
      (driver) => driver.id === editingDriverId,
    );
    const nextDriver: RoadDriver = {
      id: existing?.id || taskId("motorista"),
      fullName,
      cpf,
      phone: driverDraft.phone.trim(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    setLogistics((current) => ({
      ...current,
      drivers: existing
        ? current.drivers.map((driver) =>
            driver.id === existing.id ? nextDriver : driver,
          )
        : [...current.drivers, nextDriver],
    }));
    setDriverDraft({ cpf: "", fullName: "", phone: "" });
    setEditingDriverId("");
    setLogisticsMessage(
      existing
        ? "Motorista atualizado na configuração rodoviária."
        : "Motorista cadastrado para a configuração rodoviária.",
    );
    recordAudit(
      "workspace",
      `Motorista ${existing ? "atualizado" : "cadastrado"}: ${fullName}.`,
    );
  }
  function addRoadVehicle() {
    if (currentUser?.role !== "admin") return;
    const plate = vehicleDraft.plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const capacity = Number(vehicleDraft.capacity.replace(",", "."));
    const palletCapacity = Number(
      vehicleDraft.palletCapacity.replace(",", "."),
    );
    const model = vehicleDraft.model.trim();
    if (
      plate.length < 7 ||
      !Number.isFinite(capacity) ||
      capacity <= 0 ||
      !model
    ) {
      setLogisticsMessage(
        "Informe placa, modelo e capacidade válida do veículo.",
      );
      return;
    }
    if (
      logistics.vehicles.some(
        (vehicle) => vehicle.plate === plate && vehicle.id !== editingVehicleId,
      )
    ) {
      setLogisticsMessage("Já existe um veículo cadastrado com esta placa.");
      return;
    }
    const existing = logistics.vehicles.find(
      (vehicle) => vehicle.id === editingVehicleId,
    );
    const nextVehicle: RoadVehicle = {
      id: existing?.id || taskId("veiculo"),
      plate,
      capacity,
      model,
      createdAt: existing?.createdAt || new Date().toISOString(),
      defaultDriverId: vehicleDraft.defaultDriverId || undefined,
      ownership: vehicleDraft.ownership,
      palletCapacity:
        Number.isFinite(palletCapacity) && palletCapacity > 0
          ? palletCapacity
          : undefined,
      trackerNumber: vehicleDraft.trackerNumber.trim() || undefined,
    };
    setLogistics((current) => ({
      ...current,
      vehicles: existing
        ? current.vehicles.map((vehicle) =>
            vehicle.id === existing.id ? nextVehicle : vehicle,
          )
        : [...current.vehicles, nextVehicle],
    }));
    setVehicleDraft({
      capacity: "",
      defaultDriverId: "",
      model: "",
      ownership: "interno",
      palletCapacity: "",
      plate: "",
      trackerNumber: "",
    });
    setEditingVehicleId("");
    setLogisticsMessage(
      existing
        ? "Veículo atualizado na configuração rodoviária."
        : "Veículo cadastrado para a configuração rodoviária.",
    );
    recordAudit(
      "workspace",
      `Veículo ${existing ? "atualizado" : "cadastrado"}: ${plate}.`,
    );
  }
  function editRoadDriver(driver: RoadDriver) {
    setEditingDriverId(driver.id);
    setDriverDraft({
      cpf: driver.cpf,
      fullName: driver.fullName,
      phone: driver.phone || "",
    });
  }
  function editRoadVehicle(vehicle: RoadVehicle) {
    setEditingVehicleId(vehicle.id);
    setVehicleDraft({
      capacity: String(vehicle.capacity),
      defaultDriverId: vehicle.defaultDriverId || "",
      model: vehicle.model,
      ownership: vehicle.ownership || "interno",
      palletCapacity: vehicle.palletCapacity
        ? String(vehicle.palletCapacity)
        : "",
      plate: vehicle.plate,
      trackerNumber: vehicle.trackerNumber || "",
    });
  }
  function removeRoadDriver(driver: RoadDriver) {
    if (currentUser?.role !== "admin") return;
    if (logistics.trips.some((trip) => trip.driverId === driver.id)) {
      setLogisticsMessage(
        "Este motorista já está vinculado a uma viagem e não pode ser excluído.",
      );
      return;
    }
    setLogistics((current) => ({
      ...current,
      drivers: current.drivers.filter((item) => item.id !== driver.id),
    }));
    recordAudit("workspace", `Motorista removido: ${driver.fullName}.`);
  }
  function removeRoadVehicle(vehicle: RoadVehicle) {
    if (currentUser?.role !== "admin") return;
    if (logistics.trips.some((trip) => trip.vehicleId === vehicle.id)) {
      setLogisticsMessage(
        "Este veículo já está vinculado a uma viagem e não pode ser excluído.",
      );
      return;
    }
    setLogistics((current) => ({
      ...current,
      vehicles: current.vehicles.filter((item) => item.id !== vehicle.id),
    }));
    recordAudit("workspace", `Veículo removido: ${vehicle.plate}.`);
  }
  function selectLogisticsRequest(id: string) {
    const request = logisticsRequests.find((item) => item.id === id);
    const line = request?.lines[0];
    const remaining = line ? remainingForLogisticsLine(line) : 0;
    if (!request || !line || remaining <= 0) {
      setLogisticsMessage(
        "Este pedido já não tem saldo disponível após o trânsito e as reservas.",
      );
      return;
    }
    setTripRequestId(id);
    setTripMaterialKey(line?.id || "");
    setTripFulfillmentStockId("");
    setTripCollectionId("");
    setTripQuantity(remaining ? String(remaining) : "");
    setShowOrderPicker(false);
  }
  function addRouteItem() {
    if (!selectedRouteItem) {
      setLogisticsMessage(
        "Selecione um pedido SAP e um material para adicionar à rota.",
      );
      return;
    }
    if (tripSourceMode === "armazem" && !tripFulfillmentStockId) {
      setLogisticsMessage(
        "Selecione o material físico no Estoque webAgil para atender ao pedido SAP.",
      );
      return;
    }
    if (tripSourceMode === "coleta" && !tripCollectionId) {
      setLogisticsMessage(
        "Selecione a fazenda e o material que será coletado.",
      );
      return;
    }
    if (selectedQuantity > selectedLineRemaining) {
      setLogisticsMessage(
        "A quantidade informada ultrapassa o saldo pendente do pedido SAP.",
      );
      return;
    }
    if (selectedQuantity > selectedSourceBalance) {
      setLogisticsMessage(
        "A quantidade informada ultrapassa o saldo disponível na origem selecionada.",
      );
      return;
    }
    if (
      routeItems.some(
        (item) => item.requestLineId === selectedRouteItem.requestLineId,
      )
    ) {
      setLogisticsMessage(
        "Este pedido já possui um material reservado nesta rota. Ajuste a quantidade antes de adicionar.",
      );
      return;
    }
    setRouteItems((current) => [...current, selectedRouteItem]);
    if (
      tripSourceMode === "armazem" &&
      selectedLogisticsLine &&
      selectedWarehouseStock
    ) {
      setLogistics((current) => ({
        ...current,
        webMaterialLinks: {
          ...(current.webMaterialLinks || {}),
          [normalizeMaterial(selectedLogisticsLine.product)]:
            selectedWarehouseStock.product,
        },
      }));
    }
    setTripMaterialKey("");
    setTripFulfillmentStockId("");
    setTripCollectionId("");
    setTripQuantity("");
    setLogisticsMessage(
      `${selectedRouteItem.product} adicionado à rota a partir do pedido SAP.${selectedRouteItem.adjustmentRequired ? " Solicite à fazenda o ajuste do produto no sistema." : ""}`,
    );
  }
  function addManualRouteItem() {
    const stock = generalStockOptions.find((item) => item.id === manualStockId);
    const quantity = numberFrom(manualQuantity);
    if (!stock || !manualDestination || quantity <= 0) {
      setLogisticsMessage(
        "Selecione o material no estoque geral, o destino e a quantidade para incluir um material sem pedido.",
      );
      return;
    }
    if (quantity > stock.balance) {
      setLogisticsMessage(
        "A quantidade manual ultrapassa o saldo disponível no estoque geral.",
      );
      return;
    }
    const item: LogisticsTripItem = {
      id: taskId("rota"),
      requestId: "SEM-PEDIDO",
      requestDate: dateKey(new Date()),
      product: stock.product,
      productCode: stock.code,
      lot: "",
      quantity,
      unit: manualUnit || stock.unit,
      sourceWarehouse: stock.warehouse,
      destination: manualDestination,
      destinationCode: manualDestination,
      responsibleName: "BOA ESPERANCA AGROPECUARIA LTDA",
      sourceMode: "manual",
      stockReference: stock.id,
      pallets: 0,
      weightKg: inferredPackageWeightKg(stock.product, manualUnit || stock.unit)
        ? quantity *
          inferredPackageWeightKg(stock.product, manualUnit || stock.unit)
        : (manualUnit || stock.unit).toUpperCase().includes("KG")
          ? quantity
          : 0,
      estimatedValue: quantity * unitValueForProduct(stock.product),
    };
    setRouteItems((current) => [...current, item]);
    setManualStockId("");
    setManualDestination("");
    setManualQuantity("");
    setManualUnit("UN");
    setLogisticsMessage(
      `${item.product} incluído na rota sem pedido vinculado.`,
    );
  }
  async function resolveGoogleMapsAddress(addressUrl: string) {
    const response = await fetch("/api/resolve-map", {
      body: JSON.stringify({ url: addressUrl }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      coordinates?: { latitude: number; longitude: number } | null;
      error?: string;
      query?: string;
      resolvedUrl?: string;
    };
    if (!response.ok || !result.query) {
      throw new Error(result.error || "Não foi possível resolver este link do Google Maps.");
    }
    return result;
  }
  async function addLogisticsLocation() {
    const location = locationDraft.location;
    const municipality = locationDraft.municipality.trim();
    const addressUrl = locationDraft.addressUrl.trim();
    if (!location || (!municipality && !addressUrl)) {
      setLogisticsMessage(
        "Selecione um centro, armazém ou núcleo e informe o município ou endereço específico.",
      );
      return;
    }
    const key = editingLocationKey || normalizeMaterial(location);
    let routeAddress = "";
    let coordinates = "";
    if (addressUrl) {
      if (!isGoogleMapsUrl(addressUrl)) {
        setLocationResolution("");
        setLogisticsMessage(
          "Use um link do Google Maps (maps.app.goo.gl ou google.com/maps) para converter o endereço da rota.",
        );
        return;
      }
      setIsResolvingLocation(true);
      setLocationResolution("Resolvendo o link do Google Maps…");
      try {
        const result = await resolveGoogleMapsAddress(addressUrl);
        routeAddress = result.query;
        coordinates = result.coordinates
          ? `${result.coordinates.latitude.toFixed(6)}, ${result.coordinates.longitude.toFixed(6)}`
          : "endereço pesquisável";
      } catch (error) {
        setLocationResolution("");
        setLogisticsMessage(
          error instanceof Error
            ? error.message
            : "Não foi possível resolver o link do Google Maps.",
        );
        return;
      } finally {
        setIsResolvingLocation(false);
      }
    }
    setLogistics((current) => {
      const addresses = { ...(current.addressByLocation || {}) };
      const sourceUrls = { ...(current.addressSourceUrlByLocation || {}) };
      const municipalities = { ...(current.municipalityByLocation || {}) };
      if (routeAddress) {
        addresses[key] = routeAddress;
        sourceUrls[key] = addressUrl;
      } else {
        delete addresses[key];
        delete sourceUrls[key];
      }
      if (municipality) municipalities[key] = municipality;
      else delete municipalities[key];
      return {
        ...current,
        addressByLocation: addresses,
        addressSourceUrlByLocation: sourceUrls,
        municipalityByLocation: municipalities,
      };
    });
    setLocationDraft({ addressUrl: "", location: "", municipality: "" });
    setEditingLocationKey("");
    setLocationResolution(
      routeAddress ? `Mapa salvo com ${coordinates}.` : "",
    );
    setLogisticsMessage(
      `Premissa de rota ${editingLocationKey ? "atualizada" : "vinculada"}: ${location}${routeAddress ? ` → ${coordinates}` : municipality ? ` → ${municipality}` : ""}.`,
    );
  }
  async function resolveStoredRouteLinks() {
    const entries = Object.entries(logistics.addressByLocation || {}).filter(
      ([, address]) => isGoogleMapsUrl(address),
    );
    if (!entries.length) {
      setLogisticsMessage("Não há links antigos do Google Maps pendentes de conversão.");
      return;
    }
    setIsResolvingLocation(true);
    setLocationResolution(`Convertendo ${entries.length} link(s) cadastrado(s)…`);
    const converted: Array<[string, string, string]> = [];
    let failures = 0;
    for (const [location, address] of entries) {
      try {
        const result = await resolveGoogleMapsAddress(address);
        converted.push([location, address, result.query]);
      } catch {
        failures += 1;
      }
    }
    if (converted.length) {
      setLogistics((current) => {
        const addresses = { ...(current.addressByLocation || {}) };
        const sourceUrls = { ...(current.addressSourceUrlByLocation || {}) };
        converted.forEach(([location, sourceUrl, query]) => {
          addresses[location] = query;
          sourceUrls[location] ||= sourceUrl;
        });
        return {
          ...current,
          addressByLocation: addresses,
          addressSourceUrlByLocation: sourceUrls,
        };
      });
    }
    setIsResolvingLocation(false);
    setLocationResolution(
      converted.length
        ? `${converted.length} link(s) convertido(s)${failures ? `; ${failures} não puderam ser resolvido(s)` : ""}.`
        : "Nenhum link pôde ser convertido.",
    );
    setLogisticsMessage(
      converted.length
        ? `${converted.length} endereço(s) convertido(s) para uso no mapa.${failures ? ` ${failures} link(s) precisam ser revisados.` : ""}`
        : "Não foi possível converter os links cadastrados. Abra o link no Google Maps e salve um novo compartilhamento.",
    );
  }
  function editLogisticsLocation(location: string) {
    setEditingLocationKey(location);
    setLocationResolution("");
    setLocationDraft({
      addressUrl:
        logistics.addressSourceUrlByLocation?.[location] ||
        logistics.addressByLocation?.[location] ||
        "",
      location:
        routeLocationOptions.find(
          (item) => normalizeMaterial(item) === location,
        ) || location,
      municipality: logistics.municipalityByLocation?.[location] || "",
    });
  }
  function removeLogisticsLocation(location: string) {
    setLogistics((current) => {
      const municipalities = { ...(current.municipalityByLocation || {}) };
      const addresses = { ...(current.addressByLocation || {}) };
      const sourceUrls = { ...(current.addressSourceUrlByLocation || {}) };
      delete municipalities[location];
      delete addresses[location];
      delete sourceUrls[location];
      return {
        ...current,
        addressByLocation: addresses,
        addressSourceUrlByLocation: sourceUrls,
        municipalityByLocation: municipalities,
      };
    });
    if (editingLocationKey === location) {
      setEditingLocationKey("");
      setLocationDraft({ addressUrl: "", location: "", municipality: "" });
    }
  }
  function removeRouteItem(id: string) {
    setRouteItems((current) => current.filter((item) => item.id !== id));
  }
  function createLogisticsTrip() {
    if (currentUser?.role !== "admin") return;
    const driver = logistics.drivers.find((item) => item.id === tripDriverId);
    const vehicle = logistics.vehicles.find(
      (item) => item.id === tripVehicleId,
    );
    const primary = routeItems[0];
    if (!primary || !driver || !vehicle || !tripDate) {
      setLogisticsMessage(
        "Adicione ao menos um material à rota e informe data, motorista e veículo.",
      );
      return;
    }
    if (routeItems.some((item) => item.requestLineId && item.quantity > (logisticsLineBalances.get(item.requestLineId) || 0) + 0.000001)) {
      setLogisticsMessage("O saldo disponível de um pedido mudou. Revise os volumes da rota antes de emitir.");
      return;
    }
    if (routeCapacity?.weightExceeded || routeCapacity?.palletExceeded) {
      setLogisticsMessage(
        "A carga excede a capacidade configurada para o veículo. Revise o peso e os paletes antes de emitir.",
      );
      return;
    }
    const sourceWarehouses = [
      ...new Set(
        routeItems.map((item) => item.sourceWarehouse).filter(Boolean),
      ),
    ];
    const destinations = [
      ...new Set(routeItems.map((item) => item.destination).filter(Boolean)),
    ];
    const trip: LogisticsTrip = {
      id: taskId("viagem"),
      requestId: primary.requestId,
      requestDate: primary.requestDate,
      product: primary.product,
      productCode: primary.productCode,
      lot: primary.lot,
      quantity: primary.quantity,
      unit: primary.unit,
      sourceWarehouse: sourceWarehouses.join(" · "),
      destination: destinations.join(" · "),
      destinationCode: primary.destinationCode,
      driverId: driver.id,
      vehicleId: vehicle.id,
      invoiceNumber: "",
      invoiceNumbers: [],
      status: "Em progresso",
      tripDate,
      departureTime: tripDepartureTime,
      createdAt: new Date().toISOString(),
      items: routeItems,
    };
    setLogistics((current) => ({
      ...current,
      trips: [trip, ...current.trips],
    }));
    setTripRequestId("");
    setTripMaterialKey("");
    setTripFulfillmentStockId("");
    setTripCollectionId("");
    setTripQuantity("");
    setRouteItems([]);
    setTripDate(dateKey(new Date()));
    setTripDepartureTime("09:00");
    setLogisticsTab("viagens");
    setLogisticsMessage(
      `Viagem ${trip.id.replace("viagem-", "")} emitida para ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${tripDate}T00:00:00`))} com ${routeItems.length} material(is) de ${new Set(routeItems.map((item) => item.requestId)).size} pedido(s) SAP.${samePlateTripsOnDate.length ? " Atenção: já existe outra rota para esta placa na mesma data." : ""} Vincule notas fiscais, solicitações WebAgil e receitas posteriormente.`,
    );
    recordAudit(
      "workspace",
      `Viagem emitida com ${routeItems.length} material(is) para ${new Set(routeItems.map((item) => item.requestId)).size} pedido(s) SAP.`,
    );
  }
  function updateLogisticsTripStatus(
    tripId: string,
    status: NonNullable<LogisticsTrip["status"]>,
  ) {
    if (currentUser?.role !== "admin") return;
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((trip) =>
        trip.id === tripId ? { ...trip, status } : trip,
      ),
    }));
    setLogisticsMessage(`Status da viagem atualizado para “${status}”.`);
    recordAudit(
      "workspace",
      `Status da viagem ${tripId.replace("viagem-", "")} atualizado para ${status}.`,
    );
  }
  function openTripEditor(trip: LogisticsTrip) {
    if (currentUser?.role !== "admin") return;
    setEditingTripId(trip.id);
    setTripEditDraft({
      departureTime: trip.departureTime || "09:00",
      driverId: trip.driverId,
      status: trip.status || "Em progresso",
      tripDate: logisticsTripDate(trip),
      vehicleId: trip.vehicleId,
    });
    setTripEditItems(
      logisticsTripItems(trip).map((item) => ({ ...item })),
    );
  }
  function updateTripEditItem(
    itemId: string,
    patch: Partial<LogisticsTripItem>,
  ) {
    setTripEditItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    );
  }
  function addTripEditItem() {
    setTripEditItems((current) => [
      ...current,
      {
        destination: "",
        destinationCode: "",
        id: taskId("rota"),
        lot: "",
        product: "",
        productCode: "",
        quantity: 0,
        requestDate: dateKey(new Date()),
        requestId: "SEM-PEDIDO",
        sourceMode: "manual",
        sourceWarehouse: "",
        unit: "UN",
      },
    ]);
  }
  function removeTripEditItem(itemId: string) {
    setTripEditItems((current) => current.filter((item) => item.id !== itemId));
  }
  function saveTripEdits() {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === editingTripId);
    const driver = logistics.drivers.find(
      (item) => item.id === tripEditDraft.driverId,
    );
    const vehicle = logistics.vehicles.find(
      (item) => item.id === tripEditDraft.vehicleId,
    );
    if (!trip || !driver || !vehicle || !tripEditDraft.tripDate) {
      setLogisticsMessage(
        "Informe data, horário, motorista e veículo para salvar a viagem.",
      );
      return;
    }
    const nextItems = tripEditItems.map((item) => {
      const product = item.product.trim();
      const requestId = item.requestId.trim() || "SEM-PEDIDO";
      const sourceWarehouse = item.sourceWarehouse.trim();
      const destination = item.destination.trim();
      const unit = item.unit.trim() || "UN";
      const quantity = numberFrom(String(item.quantity));
      const dimension = logisticsDimensionFor(product, dimensions);
      const standardProduct =
        dimension?.aggregateMaterial || item.standardProduct || product;
      const inferredWeight = inferredPackageWeightKg(product, unit);
      return {
        ...item,
        active: dimension?.principleActive || item.active,
        adjustmentRequired:
          requestId !== "SEM-PEDIDO" &&
          Boolean(item.requestProduct) &&
          normalizeMaterial(product) !== normalizeMaterial(item.requestProduct),
        destination,
        destinationCode: item.destinationCode?.trim() || destination,
        estimatedValue: quantity * unitValueForProduct(product, standardProduct),
        lot: item.lot.trim(),
        pallets: item.pallets || 0,
        product,
        productCode: item.productCode.trim(),
        quantity,
        requestId,
        requestProduct:
          requestId === "SEM-PEDIDO"
            ? undefined
            : item.requestProduct?.trim() || product,
        sourceWarehouse,
        standardProduct,
        unit,
        weightKg: inferredWeight
          ? quantity * inferredWeight
          : unit.toUpperCase().includes("KG")
            ? quantity
            : 0,
      };
    });
    if (
      !nextItems.length ||
      nextItems.some(
        (item) =>
          !item.product ||
          !item.sourceWarehouse ||
          !item.destination ||
          item.quantity <= 0,
      )
    ) {
      setLogisticsMessage(
        "Inclua ao menos um material e preencha produto, quantidade, origem e destino em cada linha da carga.",
      );
      return;
    }
    const itemSignature = (items: LogisticsTripItem[]) =>
      items
        .map((item) =>
          [
            normalizeMaterial(item.product),
            normalizeMaterial(item.requestId),
            normalizeMaterial(item.sourceWarehouse),
            normalizeMaterial(item.destination),
            String(item.quantity),
            normalizeMaterial(item.unit),
            normalizeMaterial(item.lot),
          ].join("|"),
        )
        .join("\n");
    const cargoChanged =
      itemSignature(logisticsTripItems(trip)) !== itemSignature(nextItems);
    const hasDownstreamLinks = Boolean(
      (trip.fiscalAllocations || []).length ||
        logisticsTripInvoices(trip).length ||
        (trip.webRequestIds || []).length ||
        logisticsTripRecipes(trip).length ||
        (trip.recipeExemptions || []).length ||
        trip.appointmentNumber,
    );
    if (
      cargoChanged &&
      hasDownstreamLinks &&
      !window.confirm(
        "A carga foi alterada. Para manter a rastreabilidade, a aplicação removerá vínculos fiscais, solicitações WebAgil, agendamento e receitas desta viagem. Deseja continuar?",
      )
    ) {
      return;
    }
    const plateConflict = logistics.trips.some(
      (item) =>
        item.id !== trip.id &&
        item.vehicleId === vehicle.id &&
        logisticsTripDate(item) === tripEditDraft.tripDate,
    );
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((item) => {
        if (item.id !== trip.id) return item;
        const primary = nextItems[0];
        const sourceWarehouse = [
          ...new Set(nextItems.map((entry) => entry.sourceWarehouse)),
        ].join(" · ");
        const destination = [
          ...new Set(nextItems.map((entry) => entry.destination)),
        ].join(" · ");
        const updated: LogisticsTrip = {
          ...item,
          departureTime: tripEditDraft.departureTime,
          destination,
          destinationCode: primary.destinationCode,
          driverId: driver.id,
          items: nextItems,
          lot: primary.lot,
          product: primary.product,
          productCode: primary.productCode,
          quantity: primary.quantity,
          requestDate: primary.requestDate,
          requestId: primary.requestId,
          sourceWarehouse,
          status: tripEditDraft.status,
          tripDate: tripEditDraft.tripDate,
          unit: primary.unit,
          vehicleId: vehicle.id,
        };
        return cargoChanged
          ? {
              ...updated,
              appointmentNumber: undefined,
              appointmentRegisteredAt: undefined,
              fiscalAllocations: [],
              fiscalEmailSentAtByBatch: {},
              invoiceBatchByNumber: {},
              invoiceNumber: "",
              invoiceNumbers: [],
              recipe: undefined,
              recipeExemptions: [],
              recipeRequestSentAt: undefined,
              recipes: [],
              routeGroupSentAt: undefined,
              webAgilLinkedAt: undefined,
              webRequestIds: [],
            }
          : updated;
      }),
    }));
    setEditingTripId("");
    setTripEditItems([]);
    setLogisticsMessage(
      `Viagem atualizada.${cargoChanged ? " Os vínculos fiscais, WebAgil, agendamento e receitas foram reiniciados para reconciliação." : ""}${plateConflict ? " Atenção: a placa também possui outra rota nesta data." : ""}`,
    );
    recordAudit(
      "workspace",
      `Viagem ${trip.id.replace("viagem-", "")} atualizada: ${nextItems.length} material(is), ${tripEditDraft.tripDate} ${tripEditDraft.departureTime}, ${driver.fullName}, ${vehicle.plate}, ${tripEditDraft.status}.`,
    );
  }
  async function copyLogisticsText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setLogisticsMessage(successMessage);
    } catch {
      setLogisticsMessage(
        "O navegador não permitiu copiar o conteúdo. Selecione a prévia e copie manualmente.",
      );
    }
  }
  function moveTripRouteStop(
    trip: LogisticsTrip,
    stopId: string,
    direction: -1 | 1,
  ) {
    if (currentUser?.role !== "admin") return;
    const order = logisticsRouteStops(trip).map((stop) => stop.id);
    const currentIndex = order.indexOf(stopId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[currentIndex], order[nextIndex]] = [order[nextIndex], order[currentIndex]];
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((item) =>
        item.id === trip.id
          ? { ...item, routeGroupSentAt: undefined, routeStopOrder: order }
          : item,
      ),
    }));
    setLogisticsMessage("Sequência da rota atualizada. Revise e copie a nova mensagem para o grupo.");
    recordAudit(
      "workspace",
      `Sequência de destinos atualizada na viagem ${trip.id.replace("viagem-", "")}.`,
    );
  }
  function markTripCommunication(
    tripId: string,
    type: "fiscal" | "route" | "recipe",
    batchId = "",
  ) {
    if (currentUser?.role !== "admin") return;
    const sentAt = new Date().toISOString();
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((trip) => {
        if (trip.id !== tripId) return trip;
        if (type === "fiscal") {
          return {
            ...trip,
            fiscalEmailSentAtByBatch: {
              ...(trip.fiscalEmailSentAtByBatch || {}),
              [batchId]: sentAt,
            },
          };
        }
        return type === "route"
          ? { ...trip, routeGroupSentAt: sentAt }
          : { ...trip, recipeRequestSentAt: sentAt };
      }),
    }));
    const labels = {
      fiscal: "E-mail fiscal externo preparado",
      recipe: "Solicitação de receita preparada",
      route: "Mensagem do grupo de rota preparada",
    };
    recordAudit(
      "workspace",
      `${labels[type]} para a viagem ${tripId.replace("viagem-", "")}.`,
    );
  }
  function fiscalEmailBlocks(trip: LogisticsTrip) {
    const requests = fiscalRequestsForTrip(trip, webAgilRequests);
    return logisticsTripFiscalBatches(trip).map((batch) => {
      const rows: LogisticsEmailRow[] = [];
      const volumes = new Map<string, number>();
      for (const allocation of trip.fiscalAllocations || []) {
        if (allocation.batchId !== batch.id) continue;
        const line = fiscalRequestLineFor(allocation, requests);
        if (!line) continue;
        const items = batch.items.filter((item) => allocation.tripItemId
          ? item.id === allocation.tripItemId
          : fiscalLineMatchesRouteItem(line, item),
        );
        if (items.length !== 1) continue;
        const item = items[0];
        const request = requests.find((entry) => entry.id === allocation.requestId);
        const lots = resolveFiscalLot(line, item);
        volumes.set(item.id, (volumes.get(item.id) || 0) + allocation.quantity);
        rows.push({
          center: allocation.center || lots.center,
          sapCode: allocation.sapCode || lots.sapCode,
          sapProduct: allocation.sapProduct || lots.sapProduct,
          sapLot: allocation.sapLot || lots.sapLot,
          webProduct: line.product,
          webLot: line.lot,
          unit: line.unit || item.unit,
          quantity: allocation.quantity,
          destination: allocation.webDestination || request?.destination || item.destination,
          destinationCode: allocation.webDestinationCode || request?.destinationCode || item.destinationCode,
          request: request?.requestNumber || allocation.requestId,
          invoice: allocation.invoiceNumber,
          responsible: batch.responsibleName,
          warehouse: item.sourceWarehouse,
        });
      }
      const complete = rows.length > 0 && batch.items.every((item) =>
        Math.abs((volumes.get(item.id) || 0) - item.quantity) <= 0.000001,
      );
      return {
        batch,
        rows,
        faturamento: complete && rows.every((row) => row.sapLot),
        bravo: complete && rows.every((row) => row.webLot && row.invoice),
      };
    });
  }
  function openFiscalEmailGenerator(trip: LogisticsTrip, kind: LogisticsEmailKind) {
    setFiscalEmailTripId(trip.id);
    setFiscalEmailKind(kind);
    setFiscalEmailBatchIds(fiscalEmailBlocks(trip).filter((block) => block[kind]).map(({ batch }) => batch.id));
  }
  function toggleFiscalEmailBatch(batchId: string) {
    setFiscalEmailBatchIds((current) =>
      current.includes(batchId)
        ? current.filter((id) => id !== batchId)
        : [...current, batchId],
    );
  }
  function downloadFiscalEmailPackage() {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === fiscalEmailTripId);
    if (!trip) return;
    const blocks = fiscalEmailBlocks(trip).filter(({ batch, ...block }) =>
      fiscalEmailBatchIds.includes(batch.id) && block[fiscalEmailKind],
    );
    if (!blocks.length) return;

    const reference = trip.id.replace("viagem-", "");
    const email = buildLogisticsEmail(fiscalEmailKind, blocks.flatMap((block) => block.rows), {
      driver: logistics.drivers.find((driver) => driver.id === trip.driverId)?.fullName || "",
      plate: logistics.vehicles.find((vehicle) => vehicle.id === trip.vehicleId)?.plate || "",
      date: logisticsTripDate(trip),
      reference,
      appointment: trip.appointmentNumber || "",
    });
    const content = buildOutlookEml(email, [], []);
    const href = URL.createObjectURL(new Blob([content], { type: "message/rfc822" }));
    const link = document.createElement("a");
    const filenameReference = (trip.appointmentNumber || reference).replace(/[^a-z0-9]+/gi, "-");
    link.href = href;
    link.download = `${fiscalEmailKind}-${filenameReference}.eml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);

    if (fiscalEmailKind === "bravo") {
      const generatedAt = new Date().toISOString();
      setLogistics((current) => ({
        ...current,
        trips: current.trips.map((item) => item.id === trip.id ? {
          ...item,
          fiscalEmailSentAtByBatch: {
            ...item.fiscalEmailSentAtByBatch,
            ...Object.fromEntries(blocks.map(({ batch }) => [batch.id, generatedAt])),
          },
        } : item),
      }));
    }
    setFiscalEmailTripId("");
    setFiscalEmailBatchIds([]);
    setLogisticsMessage(`Rascunho .eml “${email.subject}” gerado para ${blocks.length} bloco(s).`);
    recordAudit("workspace", `Rascunho de ${fiscalEmailKind} gerado para a viagem ${reference}.`);
  }
  function attachTripRecipe() {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === recipeTripId);
    if (
      !trip ||
      !recipeDraft.destination.trim() ||
      !recipeDraft.product.trim() ||
      !recipeDraft.culture.trim() ||
      !recipeDraft.target.trim() ||
      !recipeDraft.dose.trim() ||
      recipeDraft.volume <= 0
    ) {
      setLogisticsMessage(
        "Informe fazenda destino, produto, volume, cultura, alvo e dose para vincular a receita.",
      );
      return;
    }
    const recipeOption = logisticsTripRecipeOptions(trip).find(
      (option) =>
        normalizeMaterial(option.destination) ===
          normalizeMaterial(recipeDraft.destination) &&
        normalizeMaterial(option.product) ===
          normalizeMaterial(recipeDraft.product),
    );
    if (!recipeOption) {
      setLogisticsMessage(
        "Selecione um destino + produto que esteja efetivamente carregado nesta viagem.",
      );
      return;
    }
    if (recipeDraft.volume > recipeOption.available + 0.000001) {
      setLogisticsMessage(
        `O volume informado ultrapassa o saldo disponível para receita: ${formatNumber(recipeOption.available)} ${recipeOption.unit}.`,
      );
      return;
    }
    const recipe: TripRecipe = {
      ...recipeDraft,
      id: taskId("receita"),
      culture: recipeDraft.culture.trim(),
      destination: recipeDraft.destination.trim(),
      dose: recipeDraft.dose.trim(),
      product: recipeDraft.product.trim(),
      target: recipeDraft.target.trim(),
      unit: recipeOption.unit,
    };
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((item) =>
        item.id === trip.id
          ? {
              ...item,
              recipes: [...logisticsTripRecipes(item), recipe],
              recipe: undefined,
            }
          : item,
      ),
    }));
    setRecipeDraft({
      culture: "",
      destination: "",
      dose: "",
      product: "",
      target: "",
      volume: 0,
    });
    setLogisticsMessage(
      "Receita vinculada à viagem emitida. Você pode adicionar outras receitas a esta mesma viagem.",
    );
    recordAudit(
      "workspace",
      `Receita vinculada à viagem ${trip.id.replace("viagem-", "")}.`,
    );
  }
  function removeTripRecipe(tripId: string, recipeId: string) {
    if (currentUser?.role !== "admin") return;
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              recipes: logisticsTripRecipes(trip).filter(
                (recipe) => recipe.id !== recipeId,
              ),
              recipe: undefined,
            }
          : trip,
      ),
    }));
  }
  function exemptTripRecipeOption() {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === recipeTripId);
    const option = trip
      ? logisticsTripRecipeOptions(trip).find(
          (item) =>
            normalizeMaterial(item.destination) ===
              normalizeMaterial(recipeDraft.destination) &&
            normalizeMaterial(item.product) ===
              normalizeMaterial(recipeDraft.product),
        )
      : null;
    if (!trip || !option) {
      setLogisticsMessage(
        "Selecione o destino + produto carregado que não exige receita.",
      );
      return;
    }
    if (option.allocated > 0.000001) {
      setLogisticsMessage(
        "Este produto já possui receita registrada. Remova as receitas antes de marcá-lo como dispensado.",
      );
      return;
    }
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((item) =>
        item.id === trip.id
          ? {
              ...item,
              recipeExemptions: [
                ...(item.recipeExemptions || []),
                {
                  destination: option.destination,
                  id: taskId("sem-receita"),
                  product: option.product,
                  unit: option.unit,
                },
              ],
            }
          : item,
      ),
    }));
    setRecipeDraft({
      culture: "",
      destination: "",
      dose: "",
      product: "",
      target: "",
      volume: 0,
    });
    setLogisticsMessage(
      `${option.product} — ${option.destination} marcado como sem necessidade de receita.`,
    );
  }
  function removeTripRecipeExemption(tripId: string, exemptionId: string) {
    if (currentUser?.role !== "admin") return;
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              recipeExemptions: (trip.recipeExemptions || []).filter(
                (item) => item.id !== exemptionId,
              ),
            }
          : trip,
      ),
    }));
  }
  function downloadRecipeEmail(trip: LogisticsTrip) {
    const pending = logisticsPendingRecipeOptions(trip);
    if (pending.length) {
      setLogisticsMessage(
        `Ainda há ${pending.length} produto(s) da carga sem receita ou dispensa registrada.`,
      );
      return;
    }
    const driverName =
      logistics.drivers.find((driver) => driver.id === trip.driverId)?.fullName ||
      "Motorista não informado";
    const subject = logisticsRecipeEmailSubject(trip, driverName);
    const boundary = `agronexus-receitas-${trip.id.replace(/[^a-z0-9]/gi, "")}`;
    const content = [
      "To:",
      `Subject: ${encodeEmailHeader(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      logisticsRecipeRequestText(trip),
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      logisticsRecipeRequestHtml(trip),
      "",
      `--${boundary}--`,
    ].join("\r\n");
    const blob = new Blob([content], { type: "message/rfc822;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `receitas-${(trip.appointmentNumber || trip.id).replace(/[^a-z0-9]+/gi, "-")}.eml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    markTripCommunication(trip.id, "recipe");
    setLogisticsMessage(
      `Arquivo .eml \"${subject}\" gerado para revisão e envio ao agrônomo.`,
    );
  }
  function openTripInvoices(trip: LogisticsTrip, fiscalBatchId = "") {
    const batches = logisticsTripFiscalBatches(trip);
    setInvoiceTripId(trip.id);
    setTripInvoiceDraft("");
    setInvoiceBatchKey(fiscalBatchId || batches[0]?.id || "");
    setFiscalLinkDraft({ lineKey: "", quantity: "", sapLot: "" });
    setEditingFiscalAllocationId("");
  }
  function openTripAppointment(trip: LogisticsTrip) {
    setAppointmentTripId(trip.id);
    setAppointmentDraft(trip.appointmentNumber || "");
  }
  function saveTripAppointment() {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === appointmentTripId);
    const appointmentNumber = appointmentDraft.trim();
    if (!trip || !appointmentNumber) {
      setLogisticsMessage(
        "Informe o número do agendamento criado no WebAgil.",
      );
      return;
    }
    if (!/^\d{7}$/.test(appointmentNumber)) {
      setLogisticsMessage(
        "O agendamento WebAgil deve conter exatamente 7 dígitos numéricos.",
      );
      return;
    }
    if (!(trip.webRequestIds || []).length) {
      setLogisticsMessage(
        "Vincule ao menos uma solicitação WebAgil antes de registrar o agendamento.",
      );
      return;
    }
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((item) =>
        item.id === trip.id
          ? {
              ...item,
              appointmentNumber,
              appointmentRegisteredAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
    setAppointmentDraft("");
    setAppointmentTripId("");
    setLogisticsMessage(
      `Agendamento ${appointmentNumber} registrado para a viagem. As solicitações WebAgil vinculadas permanecem reunidas neste único agendamento.`,
    );
    recordAudit(
      "workspace",
      `Agendamento WebAgil ${appointmentNumber} registrado na viagem ${trip.id.replace("viagem-", "")}.`,
    );
  }
  function attachTripInvoices() {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === invoiceTripId);
    const invoiceNumber = tripInvoiceDraft.trim();
    const isInvoice = invoiceNumber && !isPhysicalReturn(invoiceNumber);
    if (!trip) return;
    const fiscalBatches = logisticsTripFiscalBatches(trip);
    const fiscalBatch = fiscalBatches.find(
      (batch) => batch.id === invoiceBatchKey,
    );
    if (!fiscalBatch) {
      setLogisticsMessage(
        "Selecione o destino e responsável (AG) que receberá estas notas fiscais.",
      );
      return;
    }
    const candidates = logisticsFiscalCandidates(
      trip,
      fiscalBatch,
      webAgilRequests,
      editingFiscalAllocationId,
    );
    const candidate = candidates.find(
      (item) => item.key === fiscalLinkDraft.lineKey,
    );
    const quantity = numberFrom(fiscalLinkDraft.quantity);
    if (!candidate || quantity <= 0) {
      setLogisticsMessage(
        "Selecione a linha da solicitação WebAgil e informe o volume da viagem.",
      );
      return;
    }
    if (quantity > candidate.available + 0.000001) {
      setLogisticsMessage(
        `O volume informado ultrapassa o saldo disponível da solicitação ou do bloco fiscal: ${formatNumber(candidate.available)} ${candidate.line.unit}.`,
      );
      return;
    }
    const assignedBatch = isInvoice ? trip.invoiceBatchByNumber?.[invoiceNumber] : undefined;
    if (assignedBatch && assignedBatch !== fiscalBatch.id) {
      setLogisticsMessage(
        "Esta nota fiscal já está vinculada a outro destino ou responsável (AG) da viagem.",
      );
      return;
    }
    const editingAllocation = editingFiscalAllocationId
      ? (trip.fiscalAllocations || []).find(
          (allocation) => allocation.id === editingFiscalAllocationId,
        )
      : null;
    if (editingFiscalAllocationId && !editingAllocation) {
      setLogisticsMessage(
        "O vínculo fiscal que você tentou editar não foi encontrado. Atualize a tela e tente novamente.",
      );
      setEditingFiscalAllocationId("");
      return;
    }
    if (editingAllocation && editingAllocation.batchId !== fiscalBatch.id) {
      setLogisticsMessage(
        "A edição deve permanecer no mesmo bloco fiscal de destino e responsável.",
      );
      return;
    }
    const sapLot = fiscalLinkDraft.sapLot.trim();
    const lots = resolveFiscalLot({ ...candidate.line, sapLot: sapLot || candidate.line.sapLot }, candidate.item);
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((item) => {
        if (item.id !== trip.id) return item;
        const existing = editingFiscalAllocationId
          ? (item.fiscalAllocations || []).find(
              (allocation) => allocation.id === editingFiscalAllocationId,
            )
          : null;
        const nextAllocation: LogisticsFiscalAllocation = {
          batchId: fiscalBatch.id,
          createdAt: existing?.createdAt || new Date().toISOString(),
          id: existing?.id || taskId("fiscal"),
          invoiceNumber,
          quantity,
          requestId: candidate.request.id,
          requestLineId: candidate.line.id,
          tripItemId: candidate.item.id,
          webLine: candidate.line,
          webDestination: candidate.request.destination,
          webDestinationCode: candidate.request.destinationCode,
          sapLot: sapLot || lots.sapLot,
          sapProduct: editingAllocation?.tripItemId === candidate.item.id ? editingAllocation.sapProduct || lots.sapProduct : lots.sapProduct,
          sapCode: editingAllocation?.tripItemId === candidate.item.id ? editingAllocation.sapCode || lots.sapCode : lots.sapCode,
          center: editingAllocation?.tripItemId === candidate.item.id ? editingAllocation.center || lots.center : lots.center,
        };
        const nextAllocations = existing
          ? (item.fiscalAllocations || []).map((allocation) =>
              allocation.id === existing.id ? nextAllocation : allocation,
            )
          : [...(item.fiscalAllocations || []), nextAllocation];
        const previousInvoice = existing?.invoiceNumber || "";
        const shouldKeepPreviousInvoice = nextAllocations.some(
          (allocation) => allocation.invoiceNumber === previousInvoice,
        );
        const invoiceNumbers = [
          ...new Set([
            ...logisticsTripInvoices(item).filter(
              (number) =>
                !previousInvoice ||
                number !== previousInvoice ||
                shouldKeepPreviousInvoice,
            ),
            isInvoice ? invoiceNumber : "",
          ]),
        ].filter(Boolean);
        const invoiceBatchByNumber = { ...(item.invoiceBatchByNumber || {}) };
        if (
          previousInvoice &&
          previousInvoice !== invoiceNumber &&
          !shouldKeepPreviousInvoice
        ) {
          delete invoiceBatchByNumber[previousInvoice];
        }
        if (isInvoice) invoiceBatchByNumber[invoiceNumber] = fiscalBatch.id;
        return {
          ...item,
          fiscalAllocations: nextAllocations,
          fiscalEmailSentAtByBatch: Object.fromEntries(
            Object.entries(item.fiscalEmailSentAtByBatch || {}).filter(
              ([batchId]) => batchId !== fiscalBatch.id,
            ),
          ),
          invoiceBatchByNumber,
          invoiceNumber: invoiceNumbers.join(" · "),
          invoiceNumbers,
        };
      }),
    }));
    setTripInvoiceDraft("");
    setFiscalLinkDraft({ lineKey: "", quantity: "", sapLot: "" });
    setEditingFiscalAllocationId("");
    setLogisticsMessage(
      `${editingAllocation ? "Vínculo fiscal atualizado" : "Volume vinculado"} · solicitação ${candidate.request.requestNumber} · ${candidate.line.product} · ${formatNumber(quantity)} ${candidate.line.unit}.`,
    );
  }
  function editTripFiscalAllocation(
    trip: LogisticsTrip,
    allocation: LogisticsFiscalAllocation,
  ) {
    const batch = logisticsTripFiscalBatches(trip).find((item) => item.id === allocation.batchId);
    const candidates = batch ? logisticsFiscalCandidates(trip, batch, webAgilRequests, allocation.id) : [];
    const matches = candidates.filter((candidate) => fiscalAllocationMatchesLine(allocation, candidate.request, candidate.line) &&
      (!allocation.tripItemId || candidate.item.id === allocation.tripItemId));
    if (!candidates.length) {
      setLogisticsMessage(
        "A solicitação WebAgil deste vínculo não está mais disponível na base importada.",
      );
      return;
    }
    setInvoiceTripId(trip.id);
    setInvoiceBatchKey(allocation.batchId);
    setEditingFiscalAllocationId(allocation.id);
    const candidate = matches.length === 1 ? matches[0] : null;
    setFiscalLinkDraft({
      lineKey: candidate?.key || "",
      quantity: String(allocation.quantity),
      sapLot: allocation.sapLot || (candidate ? resolveFiscalLot(candidate.line, candidate.item).sapLot : ""),
    });
    setTripInvoiceDraft(allocation.invoiceNumber);
  }
  function removeTripFiscalAllocation(tripId: string, allocationId: string) {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === tripId);
    const allocation = trip?.fiscalAllocations?.find(
      (item) => item.id === allocationId,
    );
    if (!trip || !allocation) return;
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((item) => {
        if (item.id !== tripId) return item;
        const fiscalAllocations = (item.fiscalAllocations || []).filter(
          (entry) => entry.id !== allocationId,
        );
        const keepInvoice = fiscalAllocations.some(
          (entry) => entry.invoiceNumber === allocation.invoiceNumber,
        );
        const invoiceNumbers = keepInvoice
          ? logisticsTripInvoices(item)
          : logisticsTripInvoices(item).filter(
              (number) => number !== allocation.invoiceNumber,
            );
        const invoiceBatchByNumber = { ...(item.invoiceBatchByNumber || {}) };
        if (!keepInvoice) delete invoiceBatchByNumber[allocation.invoiceNumber];
        return {
          ...item,
          fiscalAllocations,
          fiscalEmailSentAtByBatch: Object.fromEntries(
            Object.entries(item.fiscalEmailSentAtByBatch || {}).filter(
              ([batchId]) => batchId !== allocation.batchId,
            ),
          ),
          invoiceBatchByNumber,
          invoiceNumber: invoiceNumbers.join(" · "),
          invoiceNumbers,
        };
      }),
    }));
    if (editingFiscalAllocationId === allocationId) {
      setEditingFiscalAllocationId("");
      setFiscalLinkDraft({ lineKey: "", quantity: "", sapLot: "" });
      setTripInvoiceDraft("");
    }
    setLogisticsMessage(
      `Vínculo da NF ${allocation.invoiceNumber} com a solicitação WebAgil removido. O bloco voltou a ficar disponível para correção.`,
    );
  }
  function removeTripInvoice(tripId: string, invoice: string) {
    if (currentUser?.role !== "admin") return;
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              invoiceNumbers: logisticsTripInvoices(trip).filter(
                (value) => value !== invoice,
              ),
              invoiceNumber: logisticsTripInvoices(trip)
                .filter((value) => value !== invoice)
                .join(" · "),
              invoiceBatchByNumber: Object.fromEntries(
                Object.entries(trip.invoiceBatchByNumber || {}).filter(
                  ([number]) => number !== invoice,
                ),
              ),
              fiscalAllocations: (trip.fiscalAllocations || []).filter(
                (allocation) => allocation.invoiceNumber !== invoice,
              ),
            }
          : trip,
      ),
    }));
  }
  function linkWebAgilRequest(tripId: string) {
    if (currentUser?.role !== "admin") return;
    const requestId = webLinkDrafts[tripId];
    const request = webAgilRequests.find((item) => item.id === requestId);
    if (!request) {
      setLogisticsMessage(
        "Selecione a solicitação WebAgil que será vinculada à viagem.",
      );
      return;
    }
    const linkedTrip = logistics.trips.find(
      (trip) =>
        trip.id !== tripId && (trip.webRequestIds || []).includes(request.id),
    );
    if (linkedTrip) {
      setLogisticsMessage(
        `A solicitação WebAgil ${request.requestNumber} já está vinculada à viagem ${linkedTrip.id.replace("viagem-", "")} e não pode ser usada em outra rota.`,
      );
      return;
    }
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              webRequestIds: [
                ...new Set([...(trip.webRequestIds || []), request.id]),
              ],
              webAgilLinkedAt: new Date().toISOString(),
            }
          : trip,
      ),
    }));
    setWebLinkDrafts((current) => ({ ...current, [tripId]: "" }));
    setLogisticsMessage(
      `Solicitação WebAgil ${request.requestNumber} vinculada à viagem.`,
    );
    recordAudit(
      "workspace",
      `Solicitação WebAgil ${request.requestNumber} vinculada à viagem ${tripId.replace("viagem-", "")}.`,
    );
  }
  function unlinkWebAgilRequest(tripId: string, requestId: string) {
    if (currentUser?.role !== "admin") return;
    const trip = logistics.trips.find((item) => item.id === tripId);
    if (
      trip?.fiscalAllocations?.some(
        (allocation) => allocation.requestId === requestId,
      )
    ) {
      setLogisticsMessage(
        "Esta solicitação possui volume e NF vinculados. Remova primeiro a nota fiscal para liberar o vínculo WebAgil.",
      );
      return;
    }
    setLogistics((current) => ({
      ...current,
      trips: current.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              webRequestIds: (trip.webRequestIds || []).filter(
                (id) => id !== requestId,
              ),
            }
          : trip,
      ),
    }));
  }
  function removeLogisticsTrip(trip: LogisticsTrip) {
    if (currentUser?.role !== "admin") return;
    const items = logisticsTripItems(trip);
    if (
      !window.confirm(
        `Excluir a viagem com ${items.length} material(is) de ${new Set(items.map((item) => item.requestId)).size} pedido(s) SAP?`,
      )
    )
      return;
    setLogistics((current) => ({
      ...current,
      trips: current.trips.filter((item) => item.id !== trip.id),
    }));
    if (recipeTripId === trip.id) setRecipeTripId("");
    recordAudit(
      "workspace",
      `Viagem excluída: ${items.length} material(is) e ${new Set(items.map((item) => item.requestId)).size} pedido(s) SAP.`,
    );
  }
  async function exportLogisticsDocument(trip: LogisticsTrip) {
    const XLSX = await loadXlsx();
    const driver = logistics.drivers.find((item) => item.id === trip.driverId);
    const vehicle = logistics.vehicles.find(
      (item) => item.id === trip.vehicleId,
    );
    const rows = [
      [
        "Viagem",
        "Data da viagem",
        "Horário de saída",
        "Status da viagem",
        "Pedido SAP",
        "Solicitação WebAgil",
        "Agendamento WebAgil",
        "Data do pedido",
        "Origem",
        "Modo",
        "Produto solicitado",
        "Cód. material",
        "Material físico",
        "Lote",
        "Unidade",
        "Quantidade",
        "Peso estimado (kg)",
        "Paletes",
        "Ajuste da fazenda",
        "Destino",
        "Cód. destino",
        "Responsável fiscal (AG)",
        "Motorista",
        "CPF",
        "Placa",
        "Modelo",
        "Capacidade",
        "Notas fiscais",
        "Cultura",
        "Alvo",
        "Dose",
      ],
      ...logisticsTripItems(trip).map((item) => [
        trip.id.replace("viagem-", ""),
        logisticsTripDate(trip),
        trip.departureTime || "",
        trip.status || "Em progresso",
        item.requestId,
        (trip.webRequestIds || [])
          .map(
            (id) =>
              webAgilRequests.find((request) => request.id === id)
                ?.requestNumber || id,
          )
          .join(", ") || "Pendente pós-rota",
        trip.appointmentNumber || "Pendente",
        item.requestDate,
        item.sourceWarehouse,
        item.sourceMode || "armazem",
        item.requestProduct || item.product,
        item.productCode,
        item.product,
        item.lot,
        item.unit,
        item.quantity,
        item.weightKg || "",
        item.pallets || "",
        item.adjustmentRequired ? "Solicitar ajuste no sistema" : "",
        item.destination,
        item.destinationCode,
        item.responsibleName || "BOA ESPERANCA AGROPECUARIA LTDA",
        driver?.fullName || "Motorista removido",
        driver?.cpf || "",
        vehicle?.plate || "Veículo removido",
        vehicle?.model || "",
        vehicle?.capacity || "",
        logisticsTripInvoices(trip).join(" | "),
        logisticsTripRecipes(trip)
          .map((recipe) => recipe.culture)
          .join(" | "),
        logisticsTripRecipes(trip)
          .map((recipe) => recipe.target)
          .join(" | "),
        logisticsTripRecipes(trip)
          .map((recipe) => recipe.dose)
          .join(" | "),
      ]),
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      "Emissão de doc",
    );
    XLSX.writeFile(
      workbook,
      `emissao_logistica_${trip.id.replace("viagem-", "")}.xlsx`,
      { bookType: "xlsx" },
    );
  }
  function resetClosingDraft() {
    setEditingClosingId("");
    setClosingDraft({
      supplier: "",
      paymentDue: "",
      paymentMethod: "",
      destination: "",
      deliveryLocation: "",
      cycle: "Safra",
      culture: "",
      active: "",
      product: "",
      unit: "",
      currency: "BRL",
      unitPrice: "",
      packaging: "",
      totalVolume: "",
      orderKey: "",
    });
    setClosingDistributionDraft({});
  }
  function applyClosingOrder(orderKey: string) {
    const order = commercialOrders.find((item) => item.key === orderKey);
    setClosingDraft((current) => ({
      ...current,
      orderKey,
      supplier: order?.supplier || current.supplier,
      paymentDue: order?.dueDate
        ? dateFromPlan(order.dueDate)
          ? dateKey(dateFromPlan(order.dueDate)!)
          : current.paymentDue
        : current.paymentDue,
      active:
        order && order.active !== "Não conciliado"
          ? order.active
          : current.active,
      product: order?.product || current.product,
      unit: order?.unit || current.unit,
      currency: order?.currency || current.currency,
      unitPrice: order?.unitPrice ? String(order.unitPrice) : current.unitPrice,
    }));
  }
  function applyPlanningDistribution() {
    const volume = numberFrom(closingDraft.totalVolume);
    if (!selectedClosingSchedule?.planned || !volume) {
      setClosingMessage(
        "Informe o produto e o volume para usar a sugestão baseada no planejamento.",
      );
      return;
    }
    const distribution = Object.fromEntries(
      Object.entries(selectedClosingSchedule.months).map(([month, amount]) => [
        month,
        Number(
          ((volume * amount) / selectedClosingSchedule.planned).toFixed(4),
        ),
      ]),
    );
    setClosingDistributionDraft(distribution);
    setClosingMessage(
      "Distribuição sugerida pelo volume planejado em cada mês de aplicação.",
    );
  }
  function saveCommercialClosing() {
    if (currentUser?.role !== "admin") return;
    const supplier = closingDraft.supplier.trim();
    const product = closingDraft.product.trim();
    const paymentMethod = closingDraft.paymentMethod.trim();
    const totalVolume = numberFrom(closingDraft.totalVolume);
    const unitPrice = numberFrom(closingDraft.unitPrice);
    const totalDistributed = Object.values(closingDistributionDraft).reduce(
      (sum, amount) => sum + numberFrom(amount),
      0,
    );
    if (!supplier || !product || !paymentMethod || totalVolume <= 0 || unitPrice < 0) {
      setClosingMessage(
        "Informe fornecedor, produto, forma de pagamento, volume e valor unitário para salvar o fechamento.",
      );
      return;
    }
    if (Math.abs(totalDistributed - totalVolume) > 0.01) {
      setClosingMessage(
        `A distribuição mensal soma ${formatNumber(totalDistributed)} e precisa totalizar ${formatNumber(totalVolume)}.`,
      );
      return;
    }
    const selectedOrder = commercialOrders.find(
      (order) => order.key === closingDraft.orderKey,
    );
    const now = new Date().toISOString();
    const item: CommercialClosing = {
      id: editingClosingId || taskId("fechamento"),
      supplier,
      paymentDue: closingDraft.paymentDue,
      paymentMethod,
      destination: closingDraft.destination.trim(),
      deliveryLocation: closingDraft.deliveryLocation.trim(),
      cycle: closingDraft.cycle,
      culture: closingDraft.culture.trim(),
      active:
        closingDraft.active.trim() ||
        dimensions.materials[normalizeMaterial(product)]?.principleActive ||
        "Não informado",
      product,
      unit: closingDraft.unit.trim() || selectedOrder?.unit || "UN",
      currency: closingDraft.currency,
      unitPrice,
      packaging: closingDraft.packaging.trim(),
      totalVolume,
      distribution: Object.fromEntries(
        Object.entries(closingDistributionDraft)
          .filter(([, amount]) => numberFrom(amount) !== 0)
          .map(([month, amount]) => [month, numberFrom(amount)]),
      ),
      orderKey: selectedOrder?.key || "",
      orderNumber: selectedOrder?.orderNumber || "",
      createdAt:
        commercialClosings.closings.find(
          (closing) => closing.id === editingClosingId,
        )?.createdAt || now,
      updatedAt: now,
    };
    setCommercialClosings((current) => ({
      ...current,
      closings: editingClosingId
        ? current.closings.map((closing) =>
            closing.id === editingClosingId ? item : closing,
          )
        : [item, ...current.closings],
    }));
    recordAudit(
      "workspace",
      `${editingClosingId ? "Fechamento atualizado" : "Fechamento comercial criado"}: ${item.product}.`,
    );
    setClosingMessage(
      editingClosingId
        ? "Fechamento atualizado e conciliado com a distribuição."
        : "Fechamento comercial salvo com a distribuição mensal.",
    );
    resetClosingDraft();
    setClosingTab("distribuicoes");
  }
  function editCommercialClosing(closing: CommercialClosing) {
    setEditingClosingId(closing.id);
    setClosingDraft({
      supplier: closing.supplier,
      paymentDue: closing.paymentDue,
      paymentMethod: closing.paymentMethod || "",
      destination: closing.destination,
      deliveryLocation: closing.deliveryLocation,
      cycle: closing.cycle,
      culture: closing.culture,
      active: closing.active,
      product: closing.product,
      unit: closing.unit,
      currency: closing.currency,
      unitPrice: String(closing.unitPrice),
      packaging: closing.packaging,
      totalVolume: String(closing.totalVolume),
      orderKey: closing.orderKey,
    });
    setClosingDistributionDraft(closing.distribution);
    setClosingMessage("");
    setClosingTab("distribuicoes");
  }
  function removeCommercialClosing(closing: CommercialClosing) {
    if (currentUser?.role !== "admin") return;
    if (
      !window.confirm(
        `Excluir o fechamento de ${closing.product} com ${closing.supplier}?`,
      )
    )
      return;
    setCommercialClosings((current) => ({
      ...current,
      closings: current.closings.filter((item) => item.id !== closing.id),
      annotations: current.annotations.filter(
        (note) => note.closingId !== closing.id,
      ),
    }));
    if (editingClosingId === closing.id) resetClosingDraft();
    recordAudit(
      "workspace",
      `Fechamento comercial excluído: ${closing.product}.`,
    );
  }
  function saveClosingAnnotation() {
    if (currentUser?.role !== "admin") return;
    if (
      !closingAnnotationDraft.closingId ||
      !closingAnnotationDraft.note.trim()
    ) {
      setClosingMessage(
        "Vincule a anotação a um fechamento e descreva o detalhe de faturamento ou observação.",
      );
      return;
    }
    const annotation: ClosingAnnotation = {
      id: taskId("anotacao-fechamento"),
      closingId: closingAnnotationDraft.closingId,
      materialSent: closingAnnotationDraft.materialSent.trim(),
      purchaseVolume: closingAnnotationDraft.purchaseVolume.trim()
        ? numberFrom(closingAnnotationDraft.purchaseVolume)
        : null,
      invoicedVolume: closingAnnotationDraft.invoicedVolume.trim()
        ? numberFrom(closingAnnotationDraft.invoicedVolume)
        : null,
      note: closingAnnotationDraft.note.trim(),
      resolved: closingAnnotationDraft.resolved,
      createdAt: new Date().toISOString(),
    };
    setCommercialClosings((current) => ({
      ...current,
      annotations: [annotation, ...current.annotations],
    }));
    setClosingAnnotationDraft({
      closingId: "",
      materialSent: "",
      purchaseVolume: "",
      invoicedVolume: "",
      note: "",
      resolved: false,
    });
    setClosingMessage("Anotação vinculada ao fechamento comercial.");
    recordAudit(
      "workspace",
      "Anotação de faturamento incluída em um fechamento comercial.",
    );
  }
  function removeClosingAnnotation(annotation: ClosingAnnotation) {
    if (currentUser?.role !== "admin") return;
    setCommercialClosings((current) => ({
      ...current,
      annotations: current.annotations.filter(
        (item) => item.id !== annotation.id,
      ),
    }));
  }
  function addPremise() {
    if (!draft.key.trim() || !draft.value.trim()) return;
    setDimensionPremises((current) => [
      ...current,
      { ...draft, key: draft.key.trim(), value: draft.value.trim() },
    ]);
    recordAudit(
      "premise",
      `Premissa incluída: ${draft.domain} — ${draft.key.trim()}.`,
    );
    setDraft((current) => ({ ...current, key: "", value: "" }));
  }
  async function exportPremiseSection() {
    const XLSX = await loadXlsx();
    const section = selectedPremiseSection;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([section.headers, ...section.rows]),
      section.title.slice(0, 31),
    );
    XLSX.writeFile(
      workbook,
      `premissas_${section.id}_${dateKey(new Date())}.xlsx`,
      { bookType: "xlsx" },
    );
  }
  function addLinkedTask() {
    if (!taskNote.trim()) return;
    const linked = pendingSignals.find((signal) => signal.id === taskPendingId);
    const material =
      taskLinkMode === "pedido" ? linked?.material || "" : taskMaterialLink;
    const nucleus = taskLinkMode === "pedido" ? linked?.nucleus || "" : "";
    const now = new Date().toISOString();
    setTasks((current) => [
      ...current,
      {
        id: taskId("tarefa"),
        pendingId: taskLinkMode === "pedido" ? taskPendingId : "",
        material,
        nucleus,
        title:
          taskTitle.trim() ||
          (material
            ? `Ação para ${material}${nucleus ? ` — ${nucleus}` : ""}`
            : "Ação operacional"),
        createdAt: now,
        owner: currentUser?.name || "Não atribuído",
        dueDate: dateKey(new Date(Date.now() + 3 * 86_400_000)),
        evidence: "",
        status: "Aberta",
        updatedAt: now,
        actions: [
          { id: taskId("acao"), note: taskNote.trim(), createdAt: now },
        ],
      },
    ]);
    recordAudit(
      "task",
      `Tarefa registrada: ${taskTitle.trim() || material || "Ação operacional"}.`,
    );
    setTaskTitle("");
    setTaskNote("");
    setTaskPendingId("");
    setTaskMaterialLink("");
  }
  function appendTaskAction(taskIdValue: string) {
    const note = taskActionDrafts[taskIdValue]?.trim();
    if (!note) return;
    setTasks((current) =>
      current.map((task) =>
        task.id === taskIdValue
          ? {
              ...task,
              actions: [
                ...task.actions,
                {
                  id: taskId("acao"),
                  note,
                  createdAt: new Date().toISOString(),
                },
              ],
              updatedAt: new Date().toISOString(),
            }
          : task,
      ),
    );
    setTaskActionDrafts((current) => ({ ...current, [taskIdValue]: "" }));
  }
  function updateTask(
    taskIdValue: string,
    patch: Partial<Pick<TaskItem, "owner" | "dueDate" | "evidence" | "status">>,
  ) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskIdValue
          ? { ...task, ...patch, updatedAt: new Date().toISOString() }
          : task,
      ),
    );
    if (patch.status)
      recordAudit("task", `Tarefa atualizada para ${patch.status}.`);
  }
  function deleteTask(task: TaskItem) {
    if (currentUser?.role !== "admin") return;
    if (
      !window.confirm(
        `Excluir a tarefa “${task.title}” e todo o seu histórico?`,
      )
    )
      return;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    recordAudit("task", `Tarefa excluída: ${task.title}.`);
  }
  function openNotification() {
    const nucleus =
      taskNucleusFilter !== "Todos" && taskNuclei.includes(taskNucleusFilter)
        ? taskNucleusFilter
        : (taskNuclei[1] ?? "Todos");
    setNotificationNucleus(nucleus);
    setNotificationTo(emailSettings.nucleusRecipients[nucleus] || "");
    setNotificationCc(emailSettings.defaultCopy || "");
    setNotificationMessage(null);
    setNotificationKind("pendentes");
  }
  function selectTransitNotificationCenter(center: string) {
    const nucleus = farmToNucleus[normalizeMaterial(center)] || center;
    setNotificationCenter(center);
    setNotificationTo(center ? emailSettings.nucleusRecipients[nucleus] || "" : "");
    setNotificationMessage(null);
  }
  function openTransitNotification() {
    selectTransitNotificationCenter(taskTransitDestination || (transitCenters.length === 1 ? transitCenters[0] : ""));
    setNotificationCc(emailSettings.defaultCopy || "");
    setNotificationKind("transito");
  }
  function closeNotification() {
    notificationSourceRequest.current += 1;
    setNotificationSource(null);
    setNotificationSourceLoading(false);
    setNotificationKind(null);
  }
  async function loadNotificationSource(file: File) {
    const request = ++notificationSourceRequest.current;
    setNotificationSourceLoading(true);
    setNotificationMessage(null);
    try {
      const { rows } = await parseImportFile(file, {
        key: "pedidos",
        header: 0,
      });
      if (!rows.length)
        throw new Error("A planilha não contém linhas de pedidos pendentes.");
      if (request === notificationSourceRequest.current)
        setNotificationSource({ name: file.name, rows });
    } catch (error) {
      if (request === notificationSourceRequest.current) {
        setNotificationMessage({
          text:
            error instanceof Error
              ? error.message
              : "Não foi possível ler a planilha.",
        });
      }
    } finally {
      if (request === notificationSourceRequest.current)
        setNotificationSourceLoading(false);
    }
  }
  async function copyNotificationBody() {
    if (!notificationDraft) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([notificationDraft.html], {
            type: "text/html",
          }),
          "text/plain": new Blob([notificationDraft.text], {
            type: "text/plain",
          }),
        }),
      ]);
      setNotificationMessage({
        text: "Corpo copiado. Na nova mensagem do Outlook, cole no início do corpo, acima da assinatura.",
        success: true,
      });
    } catch {
      setNotificationMessage({
        text: "O navegador não permitiu copiar com formatação. Abra a prévia para copiar a mensagem ou baixe o arquivo .eml.",
      });
    }
  }
  function downloadNotificationDraft() {
    if (!notificationRecipients || !notificationCopy || (!isTransitNotification && !notificationRecipients.length)) {
      setNotificationMessage({
        text: isTransitNotification
          ? "Confira os endereços de destinatário e cópia."
          : "Informe um destinatário válido e confira os endereços em cópia.",
      });
      return;
    }
    if (!notificationDraft) return;

    const url = URL.createObjectURL(
      new Blob(
        [
          buildOutlookEml(
            notificationDraft,
            notificationRecipients,
            notificationCopy,
          ),
        ],
        { type: "message/rfc822" },
      ),
    );
    const launcher = document.createElement("a");
    launcher.href = url;
    launcher.download = isTransitNotification ? "pedidos-em-transito.eml" : "controle-de-pedidos.eml";
    launcher.hidden = true;
    document.body.appendChild(launcher);
    launcher.click();
    launcher.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotificationMessage({
      text: "Abra o arquivo .eml no Outlook. Para adicionar a sua assinatura, use Mensagem → Assinatura.",
      success: true,
    });
  }
  async function exportTasks() {
    const XLSX = await loadXlsx();
    const farolRows = filteredPendingSignals.map((signal) => ({
      Farol: signal.status,
      Previsão: signal.dueDate
        ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate)
        : "Sem data",
      "Dias para uso": signal.daysUntil ?? "Sem cálculo",
      Pedido: signal.reference,
      Material: signal.material,
      Núcleo: signal.nucleus,
      "Volume solicitado": signal.quantity,
    }));
    const history = tasks.flatMap((task) =>
      task.actions.map((action) => {
        const linked = pendingSignals.find(
          (signal) => signal.id === task.pendingId,
        );
        return {
          Tarefa: task.title,
          Status: task.status || "Aberta",
          Responsável: task.owner || "Não atribuído",
          Prazo: task.dueDate || "",
          Evidência: task.evidence || "",
          Pedido: linked?.reference || "",
          Material: linked?.material || task.material || "",
          Núcleo: linked?.nucleus || task.nucleus || "",
          Ação: action.note,
          "Registrada em": formatDateTime(action.createdAt),
        };
      }),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(farolRows),
      "Farol de pedidos",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(history),
      "Histórico de ações",
    );
    XLSX.writeFile(workbook, `tarefas_e_farol_${dateKey(new Date())}.xlsx`, {
      bookType: "xlsx",
    });
  }
  async function exportAlerts() {
    const XLSX = await loadXlsx();
    const alerts = filteredOperationalAlerts.map((alert) => ({
      Categoria: alert.category,
      Prioridade:
        alert.severity === "critical"
          ? "Crítico"
          : alert.severity === "attention"
            ? "Atenção"
            : "Informativo",
      Título: alert.title,
      Detalhe: alert.detail,
      "Saldo armazém":
        alert.warehouseBalances
          ?.map(
            (location) =>
              `${location.location}: ${formatNumber(location.amount)}`,
          )
          .join(" | ") || "—",
      Indicador: alert.metric,
    }));
    const farolRows = pendingSignals
      .filter(
        (signal) =>
          signal.status !== "Programado" && signal.status !== "Sem data",
      )
      .map((signal) => ({
        Farol: signal.status,
        Pedido: signal.reference,
        Material: signal.material,
        Núcleo: signal.nucleus,
        Previsão: signal.dueDate
          ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate)
          : "Sem data",
        "Volume solicitado": signal.quantity,
      }));
    const warehouseRows = warehouseStockRelations.map((row) => ({
      "Princípio ativo": row.active,
      Grupo: row.group,
      Subgrupo: row.subgroup,
      "Material padrão": row.standardMaterial,
      Material: row.material,
      Armazém: row.warehouse,
      Saldo: row.balance,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(alerts),
      "Alertas operacionais",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(farolRows),
      "Farol de pedidos",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(warehouseRows),
      "Saldo em armazém",
    );
    XLSX.writeFile(
      workbook,
      `alertas_operacionais_${dateKey(new Date())}.xlsx`,
      { bookType: "xlsx" },
    );
  }
  async function exportProvision() {
    const XLSX = await loadXlsx();
    const summary = provision.rows.map((row) => ({
      Núcleo: row.nucleus,
      Ciclo: [...new Set(row.cultureBreakdown.map((item) => item.cycle))].join(" / "),
      Cultura: [...new Set(row.cultureBreakdown.map((item) => item.culture))].join(" / "),
      "Planejado por cultura": row.cultureBreakdown.map((item) => item.cycle + " · " + item.culture + ": " + formatNumber(item.planned)).join("; "),
      "Qtd. planejada": row.planned,
      "Princípio ativo": row.active,
      Grupo: row.merchandiseGroup,
      Subgrupo: row.subgroup,
      "Material padrão": row.standardMaterial,
      "Demanda da janela": row.demand,
      "Saldo do núcleo": row.farmBalance,
      Trânsito: row.transit,
      "Apoio do armazém": row.warehouseSupport,
      "Apoio de outros núcleos": row.nucleusSupport,
      "Saldo após atendimento": row.balance,
      "Volume solicitado": row.pendingOrder,
      Situação: row.status,
    }));
    const details = provision.rows.flatMap((row) => [
      ...row.locations
        .filter((location) => location.type !== "Armazém")
        .map((location) => ({
          Núcleo: row.nucleus,
          Ciclo: [...new Set(row.cultureBreakdown.map((item) => item.cycle))].join(" / "),
          Cultura: [...new Set(row.cultureBreakdown.map((item) => item.culture))].join(" / "),
          "Material padrão": row.standardMaterial,
          Material: location.material,
          Tipo: location.type,
          Local: location.location,
          "Saldo / trânsito": location.amount,
        })),
      ...row.warehouseLocations.map((location) => ({
        Núcleo: row.nucleus,
        Ciclo: [...new Set(row.cultureBreakdown.map((item) => item.cycle))].join(" / "),
        Cultura: [...new Set(row.cultureBreakdown.map((item) => item.culture))].join(" / "),
        "Material padrão": row.standardMaterial,
        Material: location.material,
        Tipo: "Armazém",
        Local: location.location,
        "Saldo / trânsito": location.amount,
      })),
      ...row.nucleusSupportLocations.map((location) => ({
        Núcleo: row.nucleus,
        Ciclo: [...new Set(row.cultureBreakdown.map((item) => item.cycle))].join(" / "),
        Cultura: [...new Set(row.cultureBreakdown.map((item) => item.culture))].join(" / "),
        "Material padrão": row.standardMaterial,
        Material: location.material,
        Tipo: "Apoio de outro núcleo",
        Local: location.location,
        "Saldo / trânsito": location.amount,
      })),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(summary),
      "Resumo",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(details),
      "Detalhes",
    );
    const cultureRows = provision.rows.flatMap((row) => row.cultureBreakdown.map((item) => ({
      Núcleo: row.nucleus,
      Ciclo: item.cycle,
      Cultura: item.culture,
      "Princípio ativo": row.active,
      "Material padrão": row.standardMaterial,
      "Qtd. planejada": item.planned,
    })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cultureRows), "Planejado por cultura");
    XLSX.writeFile(
      workbook,
      "provisionamento_" + provisionCycle.toLowerCase() + "_" + provisionCulture.toLowerCase() + "_" + evaluationDate + "_" + provisionUntil + ".xlsx",
      { bookType: "xlsx" },
    );
  }
  async function exportMonitoring() {
    const XLSX = await loadXlsx();
    const totalsByActive = monitoringGroups.map((group) => ({
      "Princípio ativo": group.active,
      "Qtd. planejada": group.totals.planned,
      Saldo: group.totals.balance,
      Trânsito: group.totals.transit,
      Aplicado: group.totals.applied,
      "A faturar": group.totals.toInvoice,
      "A entregar": group.totals.toDeliver,
      "Volume solicitado": group.totals.pendingOrder,
    }));
    const summary = executionRows.map((row) => {
      const conversion = stockConversionBalances.get(row.id);
      return {
        "Princípio ativo": row.active,
        Ciclo: row.cycles.join(", "),
        Cultura: row.cultures.join(", "),
        Núcleo: row.nucleus,
        Grupo: row.merchandiseGroup,
        Subgrupo: row.subgroup,
        "Material padrão": row.standardMaterial,
        "Material em estoque": row.stockMaterials.join(", "),
        "Qtd. planejada": row.planned,
        Estoque: row.farmBalance + row.warehouseBalance,
        "Saldo físico sem conversão": conversion?.hasConversion
          ? conversion.physical
          : "",
        Trânsito: row.transit,
        Aplicado: row.applied,
        "A faturar": toInvoiceForMonitoringRow(row),
        "A entregar": amountToDeliver(row),
        "Volume solicitado": row.pendingOrder,
      };
    });
    const details = executionRows.flatMap((row) =>
      consolidateLocations(row.locations).map((location) => ({
        "Princípio ativo": row.active,
        Núcleo: row.nucleus,
        "Material padrão": row.standardMaterial,
        Material: location.material,
        Tipo: location.type,
        Localização: location.location,
        "Saldo / trânsito": location.amount,
      })),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(summary),
      "Acompanhamento",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(totalsByActive),
      "Totais por ativo",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(details),
      "Detalhes",
    );
    XLSX.writeFile(
      workbook,
      "acompanhamento_" + dateKey(new Date()) + ".xlsx",
      { bookType: "xlsx" },
    );
  }
  async function exportReconciliationReport() {
    const XLSX = await loadXlsx();
    const rows = reconciliationIssues.map((issue) => ({
      Fonte: issue.source,
      Material: issue.material,
      "Código SAP": issue.code,
      Ocorrências: issue.count,
      Diagnóstico: issue.detail,
      "Ação sugerida": issue.action,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      "Não conciliados",
    );
    XLSX.writeFile(
      workbook,
      "relatorio_conciliacao_" + dateKey(new Date()) + ".xlsx",
      { bookType: "xlsx" },
    );
  }

  const dashboardLedger = operatorNucleus
    ? ledger.filter((row) => row.nucleus === operatorNucleus)
    : ledger;
  const totalPlanned = dashboardLedger.reduce(
    (sum, row) => sum + row.planned,
    0,
  );
  const totalApplied = dashboardLedger.reduce(
    (sum, row) => sum + row.applied,
    0,
  );
  const shortage = isOperator
    ? dashboardLedger.reduce((sum, row) => sum + row.shortage, 0)
    : consolidatedSupply.shortage;
  const hasData = sourceConfig.some((source) => Boolean(imports[source.key]));
  const scopedTasks = isOperator
    ? tasks.filter(
        (task) =>
          task.nucleus === operatorNucleus ||
          scopedPendingSignals.some((signal) => signal.id === task.pendingId),
      )
    : tasks;
  const openTasks = scopedTasks.filter((task) => task.status !== "Concluída");
  const overdueTasks = openTasks.filter(
    (task) => task.dueDate && task.dueDate < dateKey(new Date(clock)),
  ).length;
  const taskHistory = scopedTasks
    .flatMap((task) => task.actions.map((action) => ({ ...action, task })))
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  const taskHistoryPages = Math.max(
    1,
    Math.ceil(taskHistory.length / taskHistorySize),
  );
  const safeTaskHistoryPage = Math.min(taskHistoryPage, taskHistoryPages - 1);
  const paginatedTaskHistory = taskHistory.slice(
    safeTaskHistoryPage * taskHistorySize,
    (safeTaskHistoryPage + 1) * taskHistorySize,
  );
  const qualityWarnings = importHistory.reduce(
    (sum, item) => sum + item.warnings,
    0,
  );
  const qualityPending = reconciliationIssues.length + qualityWarnings;
  const dashboardQualityPending = isOperator ? 0 : qualityPending;
  const dailyPriorities = [
    ...scopedOperationalAlerts
      .filter((alert) => alert.severity === "critical")
      .slice(0, 4)
      .map((alert) => ({
        id: alert.id,
        level: "Crítico",
        title: alert.title,
        detail: alert.detail,
        tone: "rose",
      })),
    ...scopedPendingSignals
      .filter(
        (signal) =>
          signal.status === "Alerta" || signal.status === "Ponto de atenção",
      )
      .slice(0, 4)
      .map((signal) => ({
        id: signal.id,
        level: signal.status,
        title: `${signal.material} — ${signal.nucleus}`,
        detail: `${signal.reference} · ${signal.dueDate ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate) : "sem data"}`,
        tone: signal.tone === "rose" ? "rose" : "amber",
      })),
    ...openTasks
      .filter(
        (task) => task.dueDate && task.dueDate <= dateKey(new Date(clock)),
      )
      .slice(0, 3)
      .map((task) => ({
        id: task.id,
        level: "Tarefa",
        title: task.title,
        detail: `${task.owner || "Não atribuído"} · prazo ${task.dueDate ? new Intl.DateTimeFormat("pt-BR").format(new Date(task.dueDate + "T00:00:00")) : "não definido"}`,
        tone: "amber",
      })),
  ].slice(0, 8);

  async function exportExecutiveReport() {
    const XLSX = await loadXlsx();
    const workbook = XLSX.utils.book_new();
    const overview = [
      {
        Indicador: "Execução de materiais",
        Valor: `${percent(totalApplied, totalPlanned).toFixed(1)}%`,
        Detalhe: `${formatNumber(totalApplied)} de ${formatNumber(totalPlanned)} planejados`,
      },
      {
        Indicador: "Saldo com atenção",
        Valor: shortage,
        Detalhe: "Necessidade após rateio e apoios",
      },
      {
        Indicador: "Pendências de qualidade",
        Valor: qualityPending,
        Detalhe: `${reconciliationIssues.length} de conciliação e ${qualityWarnings} de importação`,
      },
      {
        Indicador: "Tarefas abertas",
        Valor: openTasks.length,
        Detalhe: `${overdueTasks} em atraso`,
      },
    ];
    const supply = provision.rows.map((row) => ({
      Núcleo: row.nucleus,
      Material: row.standardMaterial,
      Demanda: row.demand,
      Fazenda: row.farmBalance,
      Trânsito: row.transit,
      Armazém: row.warehouseSupport,
      "Outros núcleos": row.nucleusSupport,
      Situação: row.status,
    }));
    const taskRows = scopedTasks.map((task) => ({
      Tarefa: task.title,
      Status: task.status || "Aberta",
      Responsável: task.owner || "Não atribuído",
      Prazo: task.dueDate || "",
      Material: task.material || "",
      Núcleo: task.nucleus || "",
      Atualizada: formatDateTime(task.updatedAt || task.createdAt),
    }));
    const daeRows = daeByNucleus.flatMap(({ nucleus, entries }) =>
      entries.map((entry) => ({
        Núcleo: nucleus,
        Cultura: entry.culture,
        Ciclo: entry.cycle,
        DAE: entry.days,
        "Data de plantio": new Intl.DateTimeFormat("pt-BR").format(
          entry.plantedAt,
        ),
        Área: entry.area,
        "% da área": entry.share,
      })),
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(overview),
      "Resumo executivo",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(dailyPriorities),
      "Prioridades do dia",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(supply),
      "Simulação logística",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(taskRows),
      "Tarefas",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(daeRows),
      "DAE por núcleo",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(reconciliationIssues),
      "Qualidade da base",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(importHistory),
      "Histórico de importação",
    );
    XLSX.writeFile(
      workbook,
      `relatorio_executivo_${dateKey(new Date())}.xlsx`,
      { bookType: "xlsx" },
    );
  }

  let content: ReactNode;
  if (active === "Visão geral") {
    content = hasData ? (
      <section className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Card
            label="Execução de materiais"
            value={percent(totalApplied, totalPlanned).toFixed(1) + "%"}
            note={
              formatNumber(totalApplied) +
              " de " +
              formatNumber(totalPlanned) +
              " planejados"
            }
            tone="emerald"
          />
          <Card
            label="Saldo com atenção"
            value={formatNumber(shortage)}
            note="Necessidade após rateio do armazém"
            tone={shortage ? "amber" : "slate"}
          />
          <Card
            label="Pedidos pendentes"
            value={formatNumber(
              pendingOrders.reduce(
                (sum, row) =>
                  sum +
                  standardQuantity(
                    row,
                    "pending",
                    productFor(row, "pending", dimensions),
                    dimensions,
                  ),
                0,
              ),
            )}
            note={
              pendingOrders.length
                ? String(pendingOrders.length) + " linhas de pedido"
                : "Importe na guia Importações"
            }
          />
        </div>
        <p
          className={cn(
            "-mt-2 text-xs",
            materialResolution.described > materialResolution.resolved
              ? "text-amber-800"
              : "text-slate-500",
          )}
        >
          Conciliação de materiais:{" "}
          {materialResolution.described
            ? `${materialResolution.resolved}/${materialResolution.described} descrições vinculadas pelas dimensões.`
            : "aguardando descrições importadas."}
        </p>
        <div className="grid gap-5 xl:grid-cols-2">
          {groupedProgress.map((group) => (
            <div
              className="rounded-2xl border border-slate-200 bg-white p-5"
              key={group.cycle}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">
                    Execução por subgrupo — {group.cycle}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Planejado x aplicado, separado por grupo e subgrupo.
                  </p>
                </div>
                <BarChart3 className="h-5 w-5 text-emerald-700" />
              </div>
              <div className="space-y-4">
                {group.rows.length ? (
                  group.rows.map((row) => (
                    <div key={row.group + "|" + row.subgroup}>
                      <div className="mb-1.5 flex items-end justify-between gap-3">
                        <p className="text-sm font-medium">
                          {row.subgroup}{" "}
                          <span className="text-xs font-normal text-slate-500">
                            {row.group}
                          </span>
                        </p>
                        <p className="text-xs font-semibold text-slate-700">
                          {percent(row.applied, row.planned).toFixed(1)}%
                        </p>
                      </div>
                      <Progress value={percent(row.applied, row.planned)} />
                      <p className="mt-1 text-xs text-slate-500">
                        {formatNumber(row.applied)} aplicado de{" "}
                        {formatNumber(row.planned)} planejado
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Sem linhas conciliadas para este ciclo.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        <section className="border-t border-slate-200 pt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                Execução por cultura
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Área registrada no ZPS007, por safra e safrinha.
              </p>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              Leitura macro
            </p>
          </div>
          <div className="grid divide-y divide-slate-200 border-y border-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {macroCrop.map((crop) => (
              <div
                className="px-0 py-4 sm:px-4 sm:first:pl-0 xl:first:pl-0"
                key={crop.code}
              >
                <p className="text-xs font-semibold text-emerald-800">
                  {crop.cycle}
                </p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="font-bold text-slate-800">{crop.name}</p>
                  <p className="text-lg font-bold tabular-nums text-emerald-950">
                    {formatNumber(crop.applied)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  área executada registrada
                </p>
              </div>
            ))}
          </div>
        </section>
        {daeByNucleus.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">DAE por núcleo</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Idade desde o plantio. A área considera somente Planejamento:
                  Classificação Atividade e Atividade Plantio sem adubo.
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                Ciclo: {dashboardSettings.daeCycle}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {daeByNucleus.map(({ nucleus, entries }) => (
                <article
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  key={nucleus}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                        Núcleo
                      </p>
                      <h3 className="mt-1 font-semibold">{nucleus}</h3>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2 text-right shadow-sm">
                      <p className="text-xl font-bold text-emerald-800">
                        {entries[0]?.days} DAE
                      </p>
                      <p className="text-[10px] text-slate-500">mais antigo</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {entries.slice(0, 4).map((entry) => (
                      <div
                        className="border-t border-slate-200 pt-3"
                        key={[
                          entry.culture,
                          entry.cycle,
                          dateKey(entry.plantedAt),
                        ].join("|")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">
                              {entry.culture}
                            </p>
                            <p className="text-xs text-slate-500">
                              {entry.cycle} · plantio em{" "}
                              {new Intl.DateTimeFormat("pt-BR").format(
                                entry.plantedAt,
                              )}
                            </p>
                          </div>
                          <p className="text-right text-sm font-bold text-slate-800">
                            {entry.days} DAE
                            <br />
                            <span className="text-xs font-normal text-slate-500">
                              {formatNumber(entry.area)} ha ·{" "}
                              {entry.share.toFixed(1)}%
                            </span>
                          </p>
                        </div>
                      </div>
                    ))}
                    {entries.length > 4 ? (
                      <p className="text-xs text-slate-500">
                        + {entries.length - 4} datas de plantio neste núcleo
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
            A visão DAE será ativada quando o Planejamento contiver a data de
            plantio reconhecida para o ciclo selecionado.
          </div>
        )}
        {materialResolution.described > materialResolution.resolved ? (
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              <strong>Conciliação incompleta:</strong>{" "}
              {materialResolution.described - materialResolution.resolved}{" "}
              descrições não estão nas dimensões. Elas são identificadas, mas
              nunca viram uma chave pelo código SAP.
            </p>
          </div>
        ) : null}
      </section>
    ) : (
      <Empty
        actionLabel="Abrir central de importações"
        description="Carregue Planejamento, CN52, ZMM_BATCH, MB52 e MB5T. Depois envie Dimensões para conciliar materiais pelo nome."
        onAction={() => setActive("Importações")}
        title="Prepare a base para a conciliação"
      />
    );
  } else if (active === "Calendarização") {
    content = (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold">Calendarização e provisionamento</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              A janela compara demanda planejada, saldo por núcleo, trânsito e
              apoio do armazém para o mesmo material.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            disabled={!plans.length}
            onClick={() => setShowProvision(true)}
            type="button"
          >
            <CalendarDays className="h-4 w-4" />
            Provisionamento por data
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Card
            label="Data de avaliação"
            value={new Intl.DateTimeFormat("pt-BR").format(
              new Date(evaluationDate + "T00:00:00"),
            )}
            note="Valor inicial editável"
          />
          <Card
            label="Horizonte padrão"
            value={premises.horizon}
            note="dias definidos nas premissas"
          />
          <Card
            label="Materiais com falta"
            value={consolidatedSupply.failures.length}
            note="após rateio do armazém"
            tone="amber"
          />
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          <button type="button" onClick={() => setCalendarMode("calendar")} className={cn("rounded-lg px-4 py-2 text-sm font-semibold", calendarMode === "calendar" ? "bg-emerald-700 text-white" : "border border-slate-200")}>Calendário de aplicações</button>
          <button type="button" onClick={() => setShowProvision(true)} disabled={!plans.length} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold disabled:opacity-50">Provisionamento por data</button>
          <button type="button" onClick={() => setCalendarMode("dap")} className={cn("rounded-lg px-4 py-2 text-sm font-semibold", calendarMode === "dap" ? "bg-emerald-700 text-white" : "border border-slate-200")}>Provisionamento por DAP</button>
        </div>
        {calendarMode === "calendar" ? <PlanningApplicationCalendar rows={plans} dimensions={dimensions} farmToNucleus={farmToNucleus} operatorNucleus={operatorNucleus} /> : <DapProvision plans={plans} consumption={datasets.consumo} ledger={ledger} transitRows={datasets.transito} orders={commercialOrders} dimensions={dimensions} farmToNucleus={farmToNucleus} operatorNucleus={operatorNucleus} purchasesLoaded={!!imports.pedidosCompra} stockLoaded={!!imports.estoque || !!imports.estoqueMb52} transitLoaded={!!imports.transito} consumptionLoaded={!!imports.consumo} />}
      </section>
    );
  } else if (active === "Acompanhamento") {
    content = monitoringLedger.length ? (
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Acompanhamento de materiais</h2>
          <p className="mt-1 text-sm text-slate-500">
            A visão inicia em Safra. O planejamento é recalculado para o ciclo
            selecionado; armazéns ficam separados do saldo de fazenda e podem
            ser detalhados por material e localização.
          </p>
        </div>
        <AnalysisFilters
          cultures={filters.cultures}
          cultureFilter={cultureFilter}
          cycleFilter={cycleFilter}
          cycles={filters.cycles}
          groupFilter={groupFilter}
          groups={filters.groups}
          onCultureChange={setCultureFilter}
          onCycleChange={setCycleFilter}
          onGroupChange={setGroupFilter}
          onNucleusChange={setNucleusFilter}
          onQueryChange={setQuery}
          onSubgroupChange={setSubgroupFilter}
          nuclei={monitoringNuclei}
          nucleusFilter={nucleusFilter}
          query={query}
          subgroupFilter={subgroupFilter}
          subgroups={filters.subgroups}
        />
        <div className="flex justify-end">
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700"
            onClick={exportMonitoring}
            type="button"
          >
            <Download className="h-4 w-4" />
            Exportar Excel
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[1300px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {[
                  "",
                  "Princípio ativo",
                  "Ciclo / cultura",
                  "Núcleo",
                  "Material padrão",
                  "Material em estoque",
                  "Qtd. planejada",
                  "Estoque",
                  "Trânsito",
                  "Aplicado",
                  "A faturar",
                  "A entregar",
                  "V. solicitado",
                ].map((head) => (
                  <th className="px-3 py-3 font-semibold" key={head}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monitoringGroups.map((group) => (
                <Fragment key={group.active}>
                  <tr className="bg-emerald-50/70 text-emerald-950">
                    <td className="px-3 py-2.5 font-semibold" colSpan={13}>
                      Princípio ativo: {group.active}
                    </td>
                  </tr>
                  {group.rows.map((row) => {
                    const conversion = stockConversionBalances.get(row.id);
                    const convertedBalance =
                      row.farmBalance + row.warehouseBalance;
                    return (
                      <Fragment key={row.id}>
                        <tr>
                          <td className="px-3 py-3">
                            <button
                              aria-label="Expandir materiais"
                              className="rounded border border-slate-200 p-1 text-slate-600"
                              onClick={() =>
                                setExpanded(expanded === row.id ? null : row.id)
                              }
                              type="button"
                            >
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5",
                                  expanded === row.id && "rotate-180",
                                )}
                              />
                            </button>
                          </td>
                          <td className="px-3 py-3 text-slate-400">—</td>
                          <td className="px-3 py-3">
                            {row.cycles.join(", ") || "—"}
                            <br />
                            <span className="text-xs text-slate-500">
                              {row.cultures.join(", ") || "Sem cultura"}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "px-3 py-3",
                              row.isWarehouseView &&
                                "font-semibold text-emerald-800",
                            )}
                          >
                            {row.nucleus}
                          </td>
                          <td className="px-3 py-3 font-medium">
                            {row.standardMaterial}
                          </td>
                          <td className="px-3 py-3">
                            {row.stockMaterials.join(", ") || "—"}
                          </td>
                          <td className="px-3 py-3">
                            {formatNumber(row.planned)}
                          </td>
                          <td className="px-3 py-3">
                            {conversion?.hasConversion ? (
                              <>
                                <span className="inline-flex rounded-md bg-emerald-100 px-2 py-1 font-bold text-emerald-900">
                                  {formatNumber(convertedBalance)}
                                </span>
                                <span className="mt-1 block text-[11px] text-slate-500">
                                  saldo físico:{" "}
                                  {formatNumber(conversion.physical)}
                                </span>
                              </>
                            ) : (
                              formatNumber(convertedBalance)
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {formatNumber(row.transit)}
                          </td>
                          <td className="px-3 py-3">
                            {formatNumber(row.applied)}
                          </td>
                          <td className="px-3 py-3 font-semibold text-violet-700">
                            {formatNumber(toInvoiceForMonitoringRow(row))}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-3 font-semibold",
                              amountToDeliverColor(amountToDeliver(row)),
                            )}
                          >
                            {formatNumber(amountToDeliver(row))}
                          </td>
                          <td className="px-3 py-3 font-semibold text-emerald-700">
                            {formatNumber(row.pendingOrder)}
                          </td>
                        </tr>
                        {expanded === row.id ? (
                          <tr>
                            <td
                              className="bg-emerald-50 px-5 py-4 text-xs text-emerald-950"
                              colSpan={13}
                            >
                              <StockDetails
                                physicalBalances={
                                  stockLocationConversionBalances
                                }
                                row={row}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  <tr className="border-y border-emerald-200 bg-emerald-50/50 font-semibold text-slate-800">
                    <td className="px-3 py-3" colSpan={6}>
                      Total — {group.active}
                    </td>
                    <td className="px-3 py-3">
                      {formatNumber(group.totals.planned)}
                    </td>
                    <td className="px-3 py-3">
                      {formatNumber(group.totals.balance)}
                    </td>
                    <td className="px-3 py-3">
                      {formatNumber(group.totals.transit)}
                    </td>
                    <td className="px-3 py-3">
                      {formatNumber(group.totals.applied)}
                    </td>
                    <td className="px-3 py-3 font-semibold text-violet-700">
                      {formatNumber(group.totals.toInvoice)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3",
                        amountToDeliverColor(group.totals.toDeliver),
                      )}
                    >
                      {formatNumber(group.totals.toDeliver)}
                    </td>
                    <td className="px-3 py-3 text-emerald-700">
                      {formatNumber(group.totals.pendingOrder)}
                    </td>
                  </tr>
                </Fragment>
              ))}
              {!executionRows.length ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-slate-500"
                    colSpan={13}
                  >
                    Nenhum material atende aos filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    ) : (
      <Empty
        title="Sem acompanhamento conciliado"
        description="Importe planejamento, consumo, estoque por lote, MB52 complementar e trânsito para ativar esta visão."
      />
    );
  } else if (active === "Execução") {
    content = executionPerformance.length ? (
      <section className="space-y-5">
        <div>
          <h2 className="font-semibold">Execução de volumes e doses</h2>
          <p className="mt-1 text-sm text-slate-500">
            A leitura vincula CN52 à área executada do ZPS007 pelo Diagrama e
            Operação, sem usar o código SAP como chave de material.
          </p>
        </div>
        <AnalysisFilters
          cultures={filters.cultures}
          cultureFilter={cultureFilter}
          cycleFilter={cycleFilter}
          cycles={filters.cycles}
          groupFilter={groupFilter}
          groups={filters.groups}
          onCultureChange={setCultureFilter}
          onCycleChange={setCycleFilter}
          onGroupChange={setGroupFilter}
          onQueryChange={setQuery}
          onSubgroupChange={setSubgroupFilter}
          query={query}
          subgroupFilter={subgroupFilter}
          subgroups={filters.subgroups}
        />
        <div className="grid gap-3 md:grid-cols-3">
          <Card
            label="% do planejamento executado"
            value={percentageText(
              performanceSummary.applied,
              performanceSummary.planned,
            )}
            note={
              formatNumber(performanceSummary.applied) +
              " executado de " +
              formatNumber(performanceSummary.planned) +
              " planejado"
            }
            tone="emerald"
          />
          <Card
            label="Dose utilizada"
            value={formatDose(performanceSummary.appliedDose)}
            note={
              performanceSummary.plannedDose === null
                ? "Área ainda não conciliada"
                : "Planejado: " + formatDose(performanceSummary.plannedDose)
            }
            tone="emerald"
          />
          <Card
            label="Impacto da mudança de dose"
            value={signedNumber(performanceSummary.impact)}
            note={
              performanceSummary.impact > 0
                ? "volume adicional na área executada"
                : performanceSummary.impact < 0
                  ? "volume abaixo do planejado"
                  : "sem variação nas áreas conciliadas"
            }
            tone={performanceSummary.impact > 0 ? "amber" : "slate"}
          />
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[1380px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                {[
                  "Princípio ativo",
                  "Ciclo / cultura",
                  "Grupo / subgrupo",
                  "Núcleo",
                  "Material padrão",
                  "% executado",
                  "Planejado",
                  "Executado",
                  "Área executada",
                  "Dose: executado | planejado",
                  "Impacto de volume",
                ].map((head) => (
                  <th className="px-3 py-3 font-semibold" key={head}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {performanceRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-3 font-medium">{row.active}</td>
                  <td className="px-3 py-3">
                    {row.cycles.join(", ") || "—"}
                    <br />
                    <span className="text-xs text-slate-500">
                      {row.cultures.join(", ") || "Sem cultura"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {row.merchandiseGroup}
                    <br />
                    <span className="text-xs text-slate-500">
                      {row.subgroup}
                    </span>
                  </td>
                  <td className="px-3 py-3">{row.nucleus}</td>
                  <td className="px-3 py-3 font-medium">
                    {row.standardMaterial}
                  </td>
                  <td className="px-3 py-3 font-semibold text-emerald-700">
                    {percentageText(row.appliedVolume, row.plannedVolume)}
                  </td>
                  <td className="px-3 py-3">
                    {formatNumber(row.plannedVolume)}
                  </td>
                  <td className="px-3 py-3">
                    {formatNumber(row.appliedVolume)}
                  </td>
                  <td className="px-3 py-3">
                    {row.appliedArea > 0
                      ? formatNumber(row.appliedArea)
                      : "Área não conciliada"}
                  </td>
                  <td className="px-3 py-3">
                    {row.appliedDose === null || row.plannedDose === null
                      ? "Área não conciliada"
                      : "Executado (" +
                        formatDose(row.appliedDose) +
                        ") | Planejado (" +
                        formatDose(row.plannedDose) +
                        ")"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 font-semibold",
                      (row.volumeImpact || 0) > 0
                        ? "text-amber-700"
                        : (row.volumeImpact || 0) < 0
                          ? "text-emerald-700"
                          : "text-slate-600",
                    )}
                  >
                    {signedNumber(row.volumeImpact)}
                  </td>
                </tr>
              ))}
              {!performanceRows.length ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-slate-500"
                    colSpan={11}
                  >
                    Nenhum material atende aos filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Impacto de volume = volume executado − (dose planejada × área
          executada). Quando não houver correspondência de área, a dose fica
          indisponível em vez de assumir zero.
        </p>
      </section>
    ) : (
      <Empty
        title="Sem dados de execução"
        description="Importe Planejamento, CN52 e ZPS007 para calcular volumes, área e dose."
      />
    );
  } else if (active === "Importações") {
    if (importing) {
      content = (
        <ContentLoading
          detail={importProgress || "Preparando a importação em segundo plano."}
        />
      );
    } else {
      content = (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="font-semibold">Central de importações</h2>
            <p className="mt-1 text-xs text-slate-500">
              As fontes são conciliadas e salvas na base central vinculada à sua
              conta. Este navegador mantém somente as preferências locais; os
              dados operacionais vêm da base central.
            </p>
          </div>
          <div className="p-6">
            <div
              className={cn(
                "rounded-2xl border p-5",
                dataFreshness.tone === "emerald"
                  ? "border-emerald-200 bg-emerald-50/60"
                  : dataFreshness.tone === "amber"
                    ? "border-amber-200 bg-amber-50/60"
                    : dataFreshness.tone === "rose"
                      ? "border-rose-200 bg-rose-50/60"
                      : "border-slate-200 bg-slate-50",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Atualização dos dados</p>
                  <p className="mt-1 text-2xl font-bold">
                    {oldestSource
                      ? `Este visual está ${elapsedLabel(oldestSource[1].fileModifiedAt, clock)} sem atualização.`
                      : "Aguardando a primeira fonte operacional."}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Considera o arquivo operacional mais antigo:{" "}
                    {oldestSource
                      ? `${sourceConfig.find((source) => source.key === oldestSource[0])?.title} — ${formatDateTime(oldestSource[1].fileModifiedAt)}`
                      : "importe as fontes operacionais para iniciar a avaliação"}
                    . Planejamento e dimensões não entram no critério de atraso.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-bold",
                    dataFreshness.tone === "emerald"
                      ? "bg-emerald-700 text-white"
                      : dataFreshness.tone === "amber"
                        ? "bg-amber-500 text-amber-950"
                        : dataFreshness.tone === "rose"
                          ? "bg-rose-700 text-white"
                          : "bg-slate-200 text-slate-700",
                  )}
                >
                  {dataFreshness.label}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-600">
                Até 12 horas: OK · de 12 horas a 2 dias: Em atenção · acima de 2
                dias: Necessita atualizar.
              </p>
            </div>
          </div>
          <div className="grid gap-3 px-6 pb-6 md:grid-cols-2">
            {sourceConfig.map((source) => (
              <label
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 hover:border-emerald-300"
                key={source.key}
              >
                <input
                  accept=".xlsx,.xls"
                  className="sr-only"
                  onChange={(event) =>
                    setUploads((current) => ({
                      ...current,
                      [source.key]: event.target.files?.[0],
                    }))
                  }
                  type="file"
                />
                <div className="flex items-center gap-3">
                  <FileUp className="h-5 w-5 text-emerald-700" />
                  <div>
                    <p className="text-sm font-semibold">{source.title}</p>
                    <p className="text-xs text-slate-500">
                      {imports[source.key]?.fileName ||
                        uploads[source.key]?.name ||
                        source.hint}
                    </p>
                    {imports[source.key] ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Modificado:{" "}
                        {formatDateTime(imports[source.key]?.fileModifiedAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <span className="text-xs font-semibold text-emerald-700">
                  {imports[source.key]
                    ? "Importado"
                    : uploads[source.key]
                      ? "Selecionado"
                      : "Selecionar"}
                </span>
              </label>
            ))}
            <DimensionUpload
              count={Object.keys(bundle.materials).length}
              label={imports.dimensoes?.fileName || "Dimensões.xlsx (opcional)"}
              onLoaded={(loaded, summary) => {
                setBundle(loaded);
                setImports((current) => ({ ...current, dimensoes: summary }));
                setMessage("Dimensões aplicadas e salvas na base central.");
              }}
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-600">
              {persistenceError ||
                message ||
                (storageReady
                  ? "Cada fonte importada alimenta os visuais e fica salva na base central."
                  : "Recuperando dados salvos na base central...")}
            </p>
            <button
              className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              disabled={importing}
              onClick={importFiles}
              type="button"
            >
              <Upload className="mr-2 inline h-4 w-4" />
              {importing ? "Importando..." : "Validar e importar"}
            </button>
          </div>
          {Object.keys(imports).length ? (
            <div className="border-t border-slate-100 p-6">
              <Table
                headers={[
                  "Fonte",
                  "Arquivo",
                  "Modificado em",
                  "Importado em",
                  "Linhas",
                  "Abas",
                ]}
                rows={[
                  ...sourceConfig.map((source) => [
                    source.title,
                    imports[source.key]?.fileName || "—",
                    formatDateTime(imports[source.key]?.fileModifiedAt),
                    formatDateTime(imports[source.key]?.importedAt),
                    String(imports[source.key]?.rows ?? "—"),
                    imports[source.key]?.sheets.join(", ") || "—",
                  ]),
                  [
                    "Dimensões / Princípio ativo",
                    imports.dimensoes?.fileName || "—",
                    formatDateTime(imports.dimensoes?.fileModifiedAt),
                    formatDateTime(imports.dimensoes?.importedAt),
                    String(imports.dimensoes?.rows ?? "—"),
                    imports.dimensoes?.sheets.join(", ") || "—",
                  ],
                ]}
              />
            </div>
          ) : null}
          {Object.keys(imports).length ? (
            <div className="border-t border-slate-100 p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    Relatório de conciliação
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Materiais, descrições e núcleos que precisam de ajuste nas
                    dimensões.
                  </p>
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                  disabled={!reconciliationIssues.length}
                  onClick={exportReconciliationReport}
                  type="button"
                >
                  <Download className="h-4 w-4" />
                  Exportar relatório
                </button>
              </div>
              <Table
                empty="Nenhuma pendência de conciliação nas fontes importadas."
                headers={[
                  "Fonte",
                  "Material",
                  "Código SAP",
                  "Ocorrências",
                  "Diagnóstico",
                  "Ação sugerida",
                ]}
                rows={reconciliationIssues.map((issue) => [
                  issue.source,
                  issue.material,
                  issue.code,
                  String(issue.count),
                  issue.detail,
                  issue.action,
                ])}
              />
            </div>
          ) : null}
        </section>
      );
    }
  } else if (active === "Alertas") {
    const alertStyle = {
      attention: "border-amber-200 bg-amber-50 text-amber-950",
      critical: "border-rose-200 bg-rose-50 text-rose-950",
      info: "border-sky-200 bg-sky-50 text-sky-950",
    };
    const alertLabel = {
      attention: "Atenção",
      critical: "Crítico",
      info: "Informativo",
    };
    content = (
      <section className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Alertas operacionais</h2>
            <p className="mt-1 text-sm text-slate-500">
              Prioridades calculadas a partir do planejamento, saldo por
              localização, execução e validade dos lotes.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700"
            onClick={exportAlerts}
            type="button"
          >
            <Download className="h-4 w-4" />
            Exportar Excel
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card
            label="Repasse em até 30 dias"
            value={scopedAlertCounts.supply}
            note="sem saldo na fazenda"
            tone={scopedAlertCounts.supply ? "amber" : "slate"}
          />
          <Card
            label="Aumento de dose > 5%"
            value={scopedAlertCounts.dose}
            note="comparado ao planejado"
            tone={scopedAlertCounts.dose ? "amber" : "slate"}
          />
          <Card
            label="Estoque vencido"
            value={scopedAlertCounts.expired}
            note="fazenda e armazém"
            tone={scopedAlertCounts.expired ? "rose" : "slate"}
          />
          <Card
            label="Farol crítico"
            value={farol.alert}
            note="pedidos pendentes há mais de 5 dias"
            tone={farol.alert ? "rose" : "slate"}
          />
        </div>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Núcleo
            <select
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setAlertNucleusFilter(event.target.value)}
              value={alertNucleusFilter}
            >
              {alertNuclei.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Material
            <input
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setAlertMaterialFilter(event.target.value)}
              placeholder="Digite para filtrar"
              value={alertMaterialFilter}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Grupo
            <select
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setAlertGroupFilter(event.target.value)}
              value={alertGroupFilter}
            >
              {alertGroups.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Subgrupo
            <select
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setAlertSubgroupFilter(event.target.value)}
              value={alertSubgroupFilter}
            >
              {alertSubgroups.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        {filteredOperationalAlerts.length ? (
          <div className="grid gap-3">
            {filteredOperationalAlerts.map((alert) => (
              <article
                className={cn(
                  "rounded-2xl border p-4",
                  alertStyle[alert.severity],
                )}
                key={alert.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide opacity-70">
                      {alert.category}
                    </p>
                    <h3 className="mt-1 font-semibold">{alert.title}</h3>
                    <p className="mt-2 max-w-4xl text-sm leading-relaxed">
                      {alert.detail}
                    </p>
                    {alert.warehouseBalances?.length ? (
                      <div className="mt-4 max-w-4xl border-t border-current/15 pt-3">
                        <p className="text-xs font-bold uppercase tracking-wide opacity-75">
                          Saldo armazém
                        </p>
                        <div className="mt-2 grid gap-1 text-sm font-semibold sm:grid-cols-2">
                          {alert.warehouseBalances.map((location) => (
                            <p key={`${alert.id}|${location.location}`}>
                              {location.location}{" "}
                              <span className="tabular-nums">
                                — {formatNumber(location.amount)}
                              </span>
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold">
                    {alertLabel[alert.severity]} · {alert.metric}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Nenhum alerta atende aos filtros"
            description="Ajuste núcleo, material, grupo ou subgrupo para consultar outro recorte."
          />
        )}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-800">
            Sinalização na plataforma
          </p>
          <p className="mt-1">
            Os riscos acima ficam destacados neste painel e no menu lateral.
            Para notificar pedidos por núcleo, use a ação de e-mail na guia
            Tarefas.
          </p>
        </div>
      </section>
    );
  } else if (active === "Tarefas") {
    const signalStyle = {
      emerald: "bg-emerald-100 text-emerald-800",
      sky: "bg-sky-100 text-sky-800",
      amber: "bg-amber-100 text-amber-900",
      rose: "bg-rose-100 text-rose-800",
      slate: "bg-slate-100 text-slate-700",
    };
    content = (
      <section className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Farol de pedidos pendentes</h2>
            <p className="mt-1 text-sm text-slate-500">
              A data DtRemPed indica a previsão de utilização na fazenda e
              orienta a prioridade da equipe responsável.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700"
              onClick={exportTasks}
              type="button"
            >
              <Download className="h-4 w-4" />
              Exportar Excel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
              onClick={openNotification}
              type="button"
            >
              <Bell className="h-4 w-4" />
              Notificar por e-mail
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card
            label="Demanda em até 3 dias"
            value={farol.demand}
            note="sinalização antecipada"
            tone={farol.demand ? "emerald" : "slate"}
          />
          <Card
            label="Possível atraso"
            value={farol.delay}
            note="vence hoje ou amanhã"
            tone={farol.delay ? "amber" : "slate"}
          />
          <Card
            label="Ponto de atenção"
            value={farol.attention}
            note="1 a 3 dias em atraso"
            tone={farol.attention ? "amber" : "slate"}
          />
          <Card
            label="Alerta"
            value={farol.alert}
            note="mais de 5 dias em atraso"
            tone={farol.alert ? "rose" : "slate"}
          />
        </div>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Farol
            <select
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setTaskSignalFilter(event.target.value)}
              value={taskSignalFilter}
            >
              {[
                "Todos",
                "Demanda próxima",
                "Possível atraso",
                "Ponto de atenção",
                "Alerta",
                "Programado",
                "Sem data",
              ].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Pedido
            <select
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setTaskOrderFilter(event.target.value)}
              value={taskOrderFilter}
            >
              {taskOrders.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Núcleo
            <select
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setTaskNucleusFilter(event.target.value)}
              value={taskNucleusFilter}
            >
              {taskNuclei.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Material
            <input
              className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal"
              onChange={(event) => setTaskMaterialFilter(event.target.value)}
              placeholder="Digite para filtrar"
              value={taskMaterialFilter}
            />
          </label>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold">Registrar ação do setor</h3>
          <p className="mt-1 text-xs text-slate-500">
            Vincule a ação a um pedido específico ou agrupe o acompanhamento por
            qualquer material conciliado.
          </p>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Vincular por
              <select
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                onChange={(event) =>
                  setTaskLinkMode(event.target.value as "pedido" | "material")
                }
                value={taskLinkMode}
              >
                <option value="pedido">Pedido pendente</option>
                <option value="material">Material</option>
              </select>
            </label>
            {taskLinkMode === "pedido" ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Pedido
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  onChange={(event) => setTaskPendingId(event.target.value)}
                  value={taskPendingId}
                >
                  <option value="">Sem pedido vinculado</option>
                  {pendingSignals.map((signal) => (
                    <option key={signal.id} value={signal.id}>
                      {signal.reference} · {signal.material} · {signal.nucleus}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Material
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  onChange={(event) => setTaskMaterialLink(event.target.value)}
                  value={taskMaterialLink}
                >
                  <option value="">Selecione o material</option>
                  {taskMaterialOptions.map((material) => (
                    <option key={material}>{material}</option>
                  ))}
                </select>
              </label>
            )}
            <input
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Título da ação (opcional)"
              value={taskTitle}
            />
            <textarea
              className="min-h-28 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              onChange={(event) => setTaskNote(event.target.value)}
              placeholder="Descreva a ação, causa da falta e próximo passo."
              value={taskNote}
            />
            <button
              className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white"
              onClick={addLinkedTask}
              type="button"
            >
              Registrar no histórico
            </button>
          </div>
        </div>
        <Table
          empty="Nenhum pedido atende aos filtros selecionados."
          headers={[
            "Farol",
            "Previsão",
            "Pedido",
            "Material",
            "Núcleo",
            "Volume solicitado",
          ]}
          rows={filteredPendingSignals.map((signal) => [
            <span
              className={cn(
                "inline-flex rounded-full px-2.5 py-1 text-xs font-bold",
                signalStyle[signal.tone],
              )}
              key={signal.id}
            >
              {signal.status}
            </span>,
            signal.dueDate
              ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate)
              : "Sem data",
            signal.reference,
            signal.material,
            signal.nucleus,
            formatNumber(signal.quantity),
          ])}
        />
        <div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold">Histórico de ações</h3>
            <div className="mt-4 space-y-3">
              {tasks.length ? (
                tasks
                  .slice()
                  .reverse()
                  .map((item) => {
                    const linked = pendingSignals.find(
                      (signal) => signal.id === item.pendingId,
                    );
                    const reference = linked
                      ? `${linked.reference} · ${linked.material} · ${linked.nucleus}`
                      : item.material
                        ? `${item.material}${item.nucleus ? ` · ${item.nucleus}` : ""}`
                        : "Ação geral";
                    return (
                      <article
                        className="rounded-xl bg-slate-50 p-4"
                        key={item.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-800">
                              {item.title}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {reference} · criado em{" "}
                              {formatDateTime(item.createdAt)}
                            </p>
                          </div>
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                        </div>
                        <div className="mt-3 space-y-2 border-l-2 border-emerald-200 pl-3">
                          {item.actions.map((action) => (
                            <div key={action.id}>
                              <p className="text-sm text-slate-700">
                                {action.note}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatDateTime(action.createdAt)}
                              </p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <input
                            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                            onChange={(event) =>
                              setTaskActionDrafts((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            placeholder="Adicionar atualização"
                            value={taskActionDrafts[item.id] || ""}
                          />
                          <button
                            className="rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-700"
                            onClick={() => appendTaskAction(item.id)}
                            type="button"
                          >
                            Salvar
                          </button>
                        </div>
                      </article>
                    );
                  })
              ) : (
                <p className="py-10 text-center text-sm text-slate-500">
                  Nenhuma ação registrada ainda.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  } else if (active === "Fechamentos") {
    const suppliers = new Map<string, string>();
    for (const closing of commercialClosings.closings) {
      const key = closingSupplierKey(closing.supplier);
      if (!suppliers.has(key))
        suppliers.set(
          key,
          closing.supplier.trim() || "Fornecedor não informado",
        );
    }
    const supplierOptions = [...suppliers].sort(([, left], [, right]) =>
      left.localeCompare(right, "pt-BR"),
    );
    const supplierFilter =
      closingSupplierFilter !== null && suppliers.has(closingSupplierFilter)
        ? closingSupplierFilter
        : null;
    const filteredSupplierGroups = new Map<
      string,
      typeof filteredCommercialClosings
    >();
    for (const entry of filteredCommercialClosings) {
      const key = closingSupplierKey(entry.closing.supplier);
      if (supplierFilter !== null && key !== supplierFilter) continue;
      const group = filteredSupplierGroups.get(key);
      if (group) group.push(entry);
      else filteredSupplierGroups.set(key, [entry]);
    }
    const showSupplierFilter =
      closingTab === "calendario" || closingTab === "distribuicoes";
    const filteredOrderKeys = new Set(
      commercialOverview.closings
        .map((closing) => closing.orderKey)
        .filter(Boolean),
    );
    const suppliedByLinkedOrders = commercialOrders
      .filter((order) => filteredOrderKeys.has(order.key))
      .reduce((sum, order) => sum + order.supplied, 0);
    const physicalVolumes = new Map<string, number>();
    for (const closing of commercialOverview.closings) {
      const unit = closing.unit?.trim().toUpperCase() || "";
      physicalVolumes.set(
        unit,
        (physicalVolumes.get(unit) ?? 0) + closing.totalVolume,
      );
    }
    const commercialFinancial = (currency: CommercialClosing["currency"]) =>
      commercialOverview.closings
        .filter((closing) => closing.currency === currency)
        .reduce(
          (sum, closing) => sum + closing.totalVolume * closing.unitPrice,
          0,
        );
    const selectedOrderForDraft = commercialOrders.find(
      (order) => order.key === closingDraft.orderKey,
    );
    const commercialDestinationOptions = [
      ...new Set([
        ...Object.keys(dimensions.centerToNucleus),
        ...Object.keys(logistics.municipalityByLocation || {}),
        ...Object.keys(logistics.addressByLocation || {}),
      ]),
    ].sort((left, right) => left.localeCompare(right, "pt-BR"));
    const commercialActiveOptions = [
      ...new Set(
        Object.values(dimensions.materials)
          .map((material) => material.principleActive)
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right, "pt-BR"));
    const matchingCommercialOrdersForDraft = commercialOrders.filter((order) => {
      if (order.key === closingDraft.orderKey) return true;
      if (!closingDraft.product.trim()) return false;
      const draftProduct = productFor(
        { Produto: closingDraft.product },
        "planning",
        dimensions,
      );
      const orderProduct = productFor(
        { Produto: order.product },
        "planning",
        dimensions,
      );
      return (
        normalizeMaterial(order.product) === draftProduct.canonicalKey ||
        normalizeMaterial(order.standardProduct) === draftProduct.canonicalKey ||
        orderProduct.canonicalKey === draftProduct.canonicalKey
      );
    });
    const draftDistributed = Object.values(closingDistributionDraft).reduce(
      (sum, amount) => sum + numberFrom(amount),
      0,
    );
    content =
      currentUser?.role === "admin" ? (
        <section className="space-y-6">
          {closingTab !== "calendario" && !datasets.pedidosCompra.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <strong>Pedido de compra pendente.</strong> Importe{" "}
              <em>PEDIDOS COMPRA.xlsx</em> na Central de importações para
              vincular as distribuições e conciliar a quantidade fornecida.
            </div>
          ) : null}
          {closingMessage ? (
            <p
              className={cn(
                "rounded-xl px-4 py-3 text-sm",
                /salvo|atualizado|sugerida|vinculada/i.test(closingMessage)
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-50 text-amber-900",
              )}
            >
              {closingMessage}
            </p>
          ) : null}
          <div
            aria-label="Visões de fechamentos"
            className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
            role="group"
          >
            {(
              [
                ["calendario", "Calendário"],
                ["painel", "Visão comercial"],
                ["entregas", "Entregas"],
                ["distribuicoes", "Distribuições"],
                ["anotacoes", "Anotações"],
              ] as const
            ).map(([tab, label]) => (
              <button
                aria-pressed={closingTab === tab}
                className={cn(
                  "rounded-xl px-4 py-2 text-sm font-bold",
                  closingTab === tab
                    ? "bg-emerald-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100",
                )}
                key={tab}
                onClick={() => setClosingTab(tab)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className={cn(
              "grid gap-3 rounded-2xl border border-slate-200 bg-white p-4",
              showSupplierFilter
                ? "md:grid-cols-[minmax(120px,.5fr)_minmax(180px,1fr)_minmax(220px,1.5fr)]"
                : "md:grid-cols-[minmax(160px,.5fr)_minmax(260px,1fr)]",
            )}
          >
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Ciclo
              <select
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                onChange={(event) => setClosingCycleFilter(event.target.value)}
                value={closingCycleFilter}
              >
                <option>Todos</option>
                <option>Safra</option>
                <option>Safrinha</option>
              </select>
            </label>
            {showSupplierFilter ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Fornecedor
                <select
                  className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                  onChange={(event) =>
                    setClosingSupplierFilter(
                      event.target.value === "todos"
                        ? null
                        : event.target.value,
                    )
                  }
                  value={supplierFilter ?? "todos"}
                >
                  <option value="todos">Todos os fornecedores</option>
                  {supplierOptions.map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Buscar produto, princípio ativo, fornecedor ou pedido
              <input
                className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                onChange={(event) => setClosingQuery(event.target.value)}
                placeholder="Digite para filtrar"
                value={closingQuery}
              />
            </label>
          </div>
          {closingTab === "calendario" ? (
            <CommercialClosingCalendar
              groups={supplierOptions.flatMap(([key, name]) => {
                const closings = filteredSupplierGroups.get(key);
                return closings
                  ? [
                      {
                        key,
                        name,
                        closings: closings.map(
                          ({ closing, active, physicalProduct }) => ({
                            ...closing,
                            active,
                            product: physicalProduct,
                          }),
                        ),
                      },
                    ]
                  : [];
              })}
              onPeriodChange={setClosingCalendarPeriod}
              period={closingCalendarPeriod}
              registeredMonths={registeredClosingMonths}
              supplier={
                supplierFilter === null
                  ? undefined
                  : suppliers.get(supplierFilter)
              }
            />
          ) : null}
          {closingTab === "painel" ? (
            <section className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Card
                  label="Volume físico fechado"
                  note={`${commercialOverview.closings.length} distribuição(ões)`}
                  tone="emerald"
                  value={
                    physicalVolumes.size
                      ? [...physicalVolumes]
                          .sort(([left], [right]) => left.localeCompare(right))
                          .map(([unit, value]) => (
                            <span className="block text-xl" key={unit}>
                              {formatNumber(value)}
                              {unit ? ` ${unit}` : ""}
                            </span>
                          ))
                      : "0"
                  }
                />
                <Card
                  label="Quantidade fornecida"
                  value={formatNumber(suppliedByLinkedOrders)}
                  note="pedidos vinculados"
                  tone={suppliedByLinkedOrders ? "emerald" : "slate"}
                />
                <Card
                  label="Fechado em BRL"
                  value={formatCurrency(commercialFinancial("BRL"), "BRL")}
                  note="volume físico × valor unitário"
                  tone="slate"
                />
                <Card
                  label="Fechado em USD"
                  value={formatCurrency(commercialFinancial("USD"), "USD")}
                  note="volume físico × valor unitário"
                  tone="slate"
                />
              </div>
              <CommercialClosingBalances
                empty={
                  normalizedClosingQuery || planningDistribution.size
                    ? "Nenhum produto encontrado para os filtros atuais."
                    : "Importe o Planejamento para calcular o volume restante do ciclo."
                }
                expandMatches={Boolean(normalizedClosingQuery)}
                groups={commercialOverview.groups}
              />
            </section>
          ) : null}
          {closingTab === "entregas" ? (
            <CommercialDeliveryTracker
              currentMonth={commercialDeliveryTracking.currentMonth}
              rows={commercialDeliveryTracking.rows}
            />
          ) : null}
          {closingTab === "distribuicoes" ? (
            <section className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">
                      {editingClosingId
                        ? "Editar distribuição"
                        : "Nova distribuição comercial"}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      O calendário pode ser sugerido pelo planejamento, usando
                      as datas previstas de aplicação derivadas do DAE.
                    </p>
                  </div>
                  {editingClosingId ? (
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600"
                      onClick={resetClosingDraft}
                      type="button"
                    >
                      Cancelar edição
                    </button>
                  ) : null}
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Fornecedor
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      list="commercial-destinations"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          supplier: event.target.value,
                        }))
                      }
                      value={closingDraft.supplier}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Vencimento para pagamento
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          paymentDue: event.target.value,
                        }))
                      }
                      type="date"
                      value={closingDraft.paymentDue}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Origem do recurso <span className="text-rose-700">*</span>
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          paymentMethod: event.target.value,
                        }))
                      }
                      placeholder="Ex.: Caixa, barter ou bonificação"
                      value={closingDraft.paymentMethod}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Centro / filial
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      list="commercial-destinations"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          destination: event.target.value,
                        }))
                      }
                      placeholder="Ex.: 0714 ou núcleo"
                      value={closingDraft.destination}
                    />
                    <datalist id="commercial-destinations">
                      {commercialDestinationOptions.map((destination) => (
                        <option key={destination} value={destination} />
                      ))}
                    </datalist>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Local de entrega
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          deliveryLocation: event.target.value,
                        }))
                      }
                      placeholder="Fazenda ou armazém"
                      value={closingDraft.deliveryLocation}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Ciclo
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          cycle: event.target
                            .value as CommercialClosing["cycle"],
                        }))
                      }
                      value={closingDraft.cycle}
                    >
                      <option>Safra</option>
                      <option>Safrinha</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Cultura
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          culture: event.target.value,
                        }))
                      }
                      placeholder="Ex.: Soja"
                      value={closingDraft.culture}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Princípio ativo
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      list="commercial-actives"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          active: event.target.value,
                        }))
                      }
                      value={closingDraft.active}
                    />
                    <datalist id="commercial-actives">
                      {commercialActiveOptions.map((activeOption) => (
                        <option key={activeOption} value={activeOption} />
                      ))}
                    </datalist>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Produto
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      list="commercial-materials"
                      onChange={(event) => {
                        const product = event.target.value;
                        const option = commercialMaterialOptions.find(
                          (item) =>
                            normalizeMaterial(item.product) ===
                            normalizeMaterial(product),
                        );
                        setClosingDraft((current) => ({
                          ...current,
                          product,
                          active: option?.active || current.active,
                        }));
                      }}
                      value={closingDraft.product}
                    />
                    <datalist id="commercial-materials">
                      {commercialMaterialOptions.map((item) => (
                        <option key={item.product} value={item.product}>
                          {item.active}
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Moeda
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          currency: event.target
                            .value as CommercialClosing["currency"],
                        }))
                      }
                      value={closingDraft.currency}
                    >
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Valor unitário
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      inputMode="decimal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          unitPrice: event.target.value,
                        }))
                      }
                      value={closingDraft.unitPrice}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Embalagem
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          packaging: event.target.value,
                        }))
                      }
                      placeholder="Ex.: galão 20 L"
                      value={closingDraft.packaging}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Volume total
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      inputMode="decimal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          totalVolume: event.target.value,
                        }))
                      }
                      value={closingDraft.totalVolume}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Unidade
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingDraft((current) => ({
                          ...current,
                          unit: event.target.value,
                        }))
                      }
                      placeholder="L, KG, UN"
                      value={closingDraft.unit}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600 xl:col-span-2">
                    Pedido de compra vinculado
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      disabled={!matchingCommercialOrdersForDraft.length}
                      onChange={(event) =>
                        applyClosingOrder(event.target.value)
                      }
                      value={closingDraft.orderKey}
                    >
                      <option value="">Vincular depois</option>
                      {matchingCommercialOrdersForDraft.map((order) => (
                        <option key={order.key} value={order.key}>
                          {order.orderNumber} · item {order.item} ·{" "}
                          {order.product} · fornecido{" "}
                          {formatNumber(order.supplied)} {order.unit}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] font-normal text-slate-500">
                      {closingDraft.product.trim()
                        ? `${matchingCommercialOrdersForDraft.length} pedido(s) conciliado(s) com este produto.`
                        : "Informe o produto para listar somente pedidos compatíveis."}
                    </span>
                  </label>
                </div>
                {selectedOrderForDraft ? (
                  <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    Pedido {selectedOrderForDraft.orderNumber}:{" "}
                    {formatNumber(selectedOrderForDraft.ordered)} pedido,{" "}
                    {formatNumber(selectedOrderForDraft.supplied)} fornecido e{" "}
                    {formatNumber(selectedOrderForDraft.balance)} a fornecer.
                  </p>
                ) : null}
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h4 className="font-semibold">Distribuição mensal</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Preencha os volumes por mês. Total distribuído:{" "}
                        <strong>{formatNumber(draftDistributed)}</strong> de{" "}
                        {formatNumber(numberFrom(closingDraft.totalVolume))}.
                      </p>
                    </div>
                    <button
                      className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-700"
                      onClick={applyPlanningDistribution}
                      type="button"
                    >
                      Sugerir pelo planejamento
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                    {closingMonths.map((month) => (
                      <label
                        className="grid gap-1 text-xs font-semibold text-slate-600"
                        key={month}
                      >
                        {formatMonth(month)}
                        <input
                          className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                          inputMode="decimal"
                          onChange={(event) =>
                            setClosingDistributionDraft((current) => ({
                              ...current,
                              [month]: numberFrom(event.target.value),
                            }))
                          }
                          value={closingDistributionDraft[month] || ""}
                        />
                      </label>
                    ))}
                    {!closingMonths.length ? (
                      <p className="text-sm text-amber-800">
                        Ainda não há meses previstos no Planejamento para criar
                        a distribuição.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white"
                    onClick={saveCommercialClosing}
                    type="button"
                  >
                    {editingClosingId
                      ? "Salvar alterações"
                      : "Salvar fechamento"}
                  </button>
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold">Distribuições registradas</h3>
                {filteredSupplierGroups.size ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[1060px] text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          {[
                            "Ativo / produto",
                            "Ciclo",
                            "Preço",
                            "Recurso / vencimento",
                            "Centro / entrega",
                            "Programado",
                            "Pedido",
                            "Fornecido",
                            "Ações",
                          ].map((head) => (
                            <th
                              className="px-3 py-2.5 font-semibold"
                              key={head}
                              scope="col"
                            >
                              {head}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      {supplierOptions.map(([key, name]) => {
                        const closings = filteredSupplierGroups.get(key);
                        if (!closings) return null;
                        return (
                          <tbody
                            className="divide-y divide-slate-100"
                            key={key}
                          >
                            <tr className="border-t border-slate-200 bg-emerald-50">
                              <th
                                className="px-3 py-3"
                                colSpan={9}
                                scope="rowgroup"
                              >
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                  <span className="font-bold text-emerald-950">
                                    {name}
                                  </span>
                                  <span className="text-xs font-medium text-slate-500">
                                    {closings.length}{" "}
                                    {closings.length === 1
                                      ? "distribuição"
                                      : "distribuições"}
                                  </span>
                                  <button
                                    aria-label={`Ver calendário de ${name}`}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:border-emerald-600"
                                    onClick={() => {
                                      setClosingSupplierFilter(key);
                                      setClosingTab("calendario");
                                      window.scrollTo({ top: 0 });
                                    }}
                                    type="button"
                                  >
                                    <CalendarDays
                                      aria-hidden="true"
                                      className="size-4"
                                    />
                                    Ver calendário
                                  </button>
                                </div>
                              </th>
                            </tr>
                            {closings.map(({ closing }) => {
                              const order = commercialOrders.find(
                                (item) => item.key === closing.orderKey,
                              );
                              return (
                                <tr key={closing.id}>
                                  <td className="px-3 py-3">
                                    <strong>{closing.active}</strong>
                                    <br />
                                    <span className="text-xs text-slate-500">
                                      {closing.product}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    {closing.cycle}
                                    <br />
                                    <span className="text-xs text-slate-500">
                                      {closing.culture || "—"}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    {formatCurrency(
                                      closing.unitPrice,
                                      closing.currency,
                                    )}
                                    <br />
                                    <span className="text-xs text-slate-500">
                                      {closing.packaging || closing.unit}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    <strong>
                                      {closing.paymentMethod || "Não informado"}
                                    </strong>
                                    <br />
                                    {closing.paymentDue
                                      ? new Intl.DateTimeFormat("pt-BR").format(
                                          new Date(
                                            closing.paymentDue + "T00:00:00",
                                          ),
                                        )
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-3">
                                    {closing.destination || "—"}
                                    <br />
                                    <span className="text-xs text-slate-500">
                                      {closing.deliveryLocation || "—"}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 font-semibold text-emerald-700">
                                    {formatNumber(closing.totalVolume)}{" "}
                                    {closing.unit}
                                    <br />
                                    <span className="text-xs font-normal text-slate-500">
                                      {Object.keys(closing.distribution).length}{" "}
                                      mês(es)
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    {closing.orderNumber || "Não vinculado"}
                                  </td>
                                  <td className="px-3 py-3">
                                    {order
                                      ? `${formatNumber(order.supplied)} ${order.unit}`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex gap-2">
                                      <button
                                        className="text-xs font-bold text-emerald-700"
                                        onClick={() =>
                                          editCommercialClosing(closing)
                                        }
                                        type="button"
                                      >
                                        Editar
                                      </button>
                                      <button
                                        className="text-xs font-bold text-rose-700"
                                        onClick={() =>
                                          removeCommercialClosing(closing)
                                        }
                                        type="button"
                                      >
                                        Excluir
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        );
                      })}
                    </table>
                  </div>
                ) : (
                  <p className="py-10 text-center text-sm text-slate-500">
                    Nenhuma distribuição encontrada para os filtros atuais.
                  </p>
                )}
              </section>
            </section>
          ) : null}
          {closingTab === "anotacoes" ? (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold">Nova anotação</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Registre condição de faturamento, volume enviado e observações
                  do fornecedor.
                </p>
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Fechamento
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingAnnotationDraft((current) => ({
                          ...current,
                          closingId: event.target.value,
                        }))
                      }
                      value={closingAnnotationDraft.closingId}
                    >
                      <option value="">Selecione a distribuição</option>
                      {commercialClosings.closings.map((closing) => (
                        <option key={closing.id} value={closing.id}>
                          {closing.supplier} · {closing.product} ·{" "}
                          {formatNumber(closing.totalVolume)} {closing.unit}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Material enviado
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingAnnotationDraft((current) => ({
                          ...current,
                          materialSent: event.target.value,
                        }))
                      }
                      value={closingAnnotationDraft.materialSent}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-slate-600">
                      Compra
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                        inputMode="decimal"
                        onChange={(event) =>
                          setClosingAnnotationDraft((current) => ({
                            ...current,
                            purchaseVolume: event.target.value,
                          }))
                        }
                        value={closingAnnotationDraft.purchaseVolume}
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-slate-600">
                      Faturamento
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                        inputMode="decimal"
                        onChange={(event) =>
                          setClosingAnnotationDraft((current) => ({
                            ...current,
                            invoicedVolume: event.target.value,
                          }))
                        }
                        value={closingAnnotationDraft.invoicedVolume}
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-xs font-semibold text-slate-600">
                    Observação
                    <textarea
                      className="min-h-28 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) =>
                        setClosingAnnotationDraft((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      value={closingAnnotationDraft.note}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      checked={closingAnnotationDraft.resolved}
                      onChange={(event) =>
                        setClosingAnnotationDraft((current) => ({
                          ...current,
                          resolved: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    Resolvida
                  </label>
                  <button
                    className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white"
                    onClick={saveClosingAnnotation}
                    type="button"
                  >
                    Salvar anotação
                  </button>
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div>
                  <h3 className="font-semibold">Anotações de faturamento</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Histórico vinculado ao fechamento para concentrar tratativas
                    comerciais.
                  </p>
                </div>
                <div className="mt-4 space-y-3">
                  {commercialClosings.annotations.map((annotation) => {
                    const closing = commercialClosings.closings.find(
                      (item) => item.id === annotation.closingId,
                    );
                    return (
                      <article
                        className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                        key={annotation.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-800">
                              {closing
                                ? `${closing.supplier} · ${closing.product}`
                                : "Fechamento removido"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {annotation.materialSent ||
                                "Material não informado"}{" "}
                              · criado em {formatDateTime(annotation.createdAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] font-bold",
                                annotation.resolved
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-900",
                              )}
                            >
                              {annotation.resolved ? "Resolvida" : "Em aberto"}
                            </span>
                            <button
                              className="text-xs font-bold text-rose-700"
                              onClick={() =>
                                removeClosingAnnotation(annotation)
                              }
                              type="button"
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                        <p className="mt-3 text-sm text-slate-700">
                          {annotation.note}
                        </p>
                        <p className="mt-3 text-xs font-semibold text-slate-600">
                          Compra:{" "}
                          {annotation.purchaseVolume === null
                            ? "—"
                            : formatNumber(annotation.purchaseVolume)}{" "}
                          · Faturamento:{" "}
                          {annotation.invoicedVolume === null
                            ? "—"
                            : formatNumber(annotation.invoicedVolume)}
                        </p>
                      </article>
                    );
                  })}
                  {!commercialClosings.annotations.length ? (
                    <p className="py-10 text-center text-sm text-slate-500">
                      Nenhuma anotação cadastrada.
                    </p>
                  ) : null}
                </div>
              </section>
            </section>
          ) : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-950">Acesso restrito</h2>
          <p className="mt-2 text-sm text-amber-900">
            Fechamentos comerciais, distribuições e anotações são funções
            exclusivas de administradores.
          </p>
        </section>
      );
  } else if (active === "Logística") {
    const recipeTrip =
      logistics.trips.find((trip) => trip.id === recipeTripId) || null;
    const invoiceTrip =
      logistics.trips.find((trip) => trip.id === invoiceTripId) || null;
    const invoiceFiscalBatch = invoiceTrip
      ? logisticsTripFiscalBatches(invoiceTrip).find(
          (batch) => batch.id === invoiceBatchKey,
        ) || null
      : null;
    const invoiceFiscalCandidates =
      invoiceTrip && invoiceFiscalBatch
        ? logisticsFiscalCandidates(
            invoiceTrip,
            invoiceFiscalBatch,
            webAgilRequests,
            editingFiscalAllocationId,
          )
        : [];
    const selectedFiscalCandidate = invoiceFiscalCandidates.find(
      (candidate) => candidate.key === fiscalLinkDraft.lineKey,
    );
    const invoiceFiscalAllocations =
      invoiceTrip && invoiceFiscalBatch
        ? (invoiceTrip.fiscalAllocations || []).filter(
            (allocation) => allocation.batchId === invoiceFiscalBatch.id,
          )
        : [];
    const invoiceFiscalBatchTotal = invoiceFiscalBatch
      ? invoiceFiscalBatch.items.reduce(
          (total, item) => total + item.quantity,
          0,
        )
      : 0;
    const invoiceFiscalBatchAllocated = invoiceTrip && invoiceFiscalBatch
      ? logisticsFiscalBatchAllocated(invoiceTrip, invoiceFiscalBatch)
      : 0;
    const invoiceFiscalBatchComplete =
      invoiceFiscalBatchTotal > 0 &&
      invoiceFiscalBatchAllocated >= invoiceFiscalBatchTotal - 0.000001;
    const invoiceNumbersWithoutAllocation = invoiceTrip
      ? logisticsTripInvoices(invoiceTrip).filter(
          (invoice) =>
            !(invoiceTrip.fiscalAllocations || []).some(
              (allocation) => allocation.invoiceNumber === invoice,
            ),
        )
      : [];
    const appointmentTrip =
      logistics.trips.find((trip) => trip.id === appointmentTripId) || null;
    const editingTrip =
      logistics.trips.find((trip) => trip.id === editingTripId) || null;
    const recipeOptions = recipeTrip
      ? logisticsTripRecipeOptions(recipeTrip)
      : [];
    const selectableRecipeOptions = recipeTrip
      ? recipeOptions.filter(
          (option) =>
            !isRecipeExempt(
              recipeTrip,
              option.destination,
              option.product,
              option.unit,
            ),
        )
      : [];
    const selectedRecipeOption = recipeOptions.find(
      (option) =>
        normalizeMaterial(option.destination) ===
          normalizeMaterial(recipeDraft.destination) &&
        normalizeMaterial(option.product) ===
          normalizeMaterial(recipeDraft.product),
    );
    const pendingRecipeOptions = recipeTrip
      ? logisticsPendingRecipeOptions(recipeTrip)
      : [];
    const workflowTrip =
      logistics.trips.find((trip) => trip.id === workflowTripId) || null;
    const workflowDriver = workflowTrip
      ? logistics.drivers.find((driver) => driver.id === workflowTrip.driverId)
      : null;
    const workflowVehicle = workflowTrip
      ? logistics.vehicles.find(
          (vehicle) => vehicle.id === workflowTrip.vehicleId,
        )
      : null;
    const workflowRouteStops = workflowTrip
      ? logisticsRouteStops(workflowTrip)
      : [];
    const workflowFiscalBatches = workflowTrip
      ? logisticsTripFiscalBatches(workflowTrip)
      : [];
    const workflowEmailBlocks = workflowTrip ? fiscalEmailBlocks(workflowTrip) : [];
    const workflowReadyFiscalBatches = workflowEmailBlocks
      .filter((block) => block[fiscalEmailKind]).map((block) => block.batch);
    const workflowLinkedWeb = workflowTrip
      ? (workflowTrip.webRequestIds || [])
          .map((id) => webAgilRequests.find((request) => request.id === id))
          .filter((request): request is LogisticsRequest => Boolean(request))
      : [];
    const selectedDriver = logistics.drivers.find(
      (driver) => driver.id === tripDriverId,
    );
    const selectedVehicle = logistics.vehicles.find(
      (vehicle) => vehicle.id === tripVehicleId,
    );
    content =
      currentUser?.role === "admin" ? (
        <section className="space-y-6">
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[.12em] text-emerald-700">
              Logística de carregamento
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-emerald-950">
                  Emissão e organização de viagens
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-emerald-900">
                  Monte a rota pelos pedidos pendentes SAP, materiais, motorista
                  e veículo. Depois da emissão, vincule notas fiscais,
                  solicitações WebAgil e as receitas do carregamento.
                </p>
              </div>
              <span className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-emerald-800">
                Acesso administrativo
              </span>
            </div>
          </section>

          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
            <button
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-bold",
                logisticsTab === "emissao"
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => setLogisticsTab("emissao")}
              type="button"
            >
              Emissão de viagem
            </button>
            <button
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-bold",
                logisticsTab === "viagens"
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => setLogisticsTab("viagens")}
              type="button"
            >
              Viagens emitidas
            </button>
            <button
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-bold",
                logisticsTab === "rodoviaria"
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              )}
              onClick={() => setLogisticsTab("rodoviaria")}
              type="button"
            >
              Configuração rodoviária
            </button>
          </div>

          {!datasets.pedidos.length || !datasets.estoqueWeb.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <strong>Fontes pendentes.</strong> Importe{" "}
              <em>Pedidos pendentes SAP</em> e <em>Estoque webAgil</em> na
              Central de importações para planejar a rota com saldo consolidado
              por produto.
            </div>
          ) : null}
          {logisticsMessage ? (
            <p
              className={cn(
                "rounded-xl px-4 py-3 text-sm",
                /cadastrado|emitida|vinculada|adicionado/i.test(
                  logisticsMessage,
                )
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-50 text-amber-900",
              )}
            >
              {logisticsMessage}
            </p>
          ) : null}

          {logisticsTab === "emissao" ? (
            <section className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Card
                  label="Pedidos SAP disponíveis"
                  value={availableLogisticsRequests.length}
                  note="com saldo restante para expedição"
                />
                <Card
                  label="Saldo pendente"
                  value={
                    selectedLogisticsLine
                      ? formatNumber(selectedLineRemaining)
                      : "—"
                  }
                  note={
                    selectedLogisticsLine
                      ? `${selectedLogisticsLine.product} ainda a expedir`
                      : "selecione um pedido SAP"
                  }
                  tone={
                    selectedLogisticsLine && !selectedLineRemaining
                      ? "slate"
                      : "emerald"
                  }
                />
                <Card
                  label="Saldo na origem"
                  value={
                    selectedLogisticsLine
                      ? formatNumber(selectedSourceBalance)
                      : "—"
                  }
                  note={
                    tripSourceMode === "coleta"
                      ? "fazenda selecionada para coleta"
                      : "Estoque webAgil"
                  }
                  tone={
                    selectedLogisticsLine &&
                    selectedSourceBalance < selectedLineRemaining
                      ? "amber"
                      : "emerald"
                  }
                />
                <Card
                  label="Valor da viagem"
                  value={formatCurrency(routeLoad.value, "BRL")}
                  note={
                    routeLoad.value
                      ? "valor estimado pela base de estoque"
                      : "valor será calculado com a base de estoque"
                  }
                  tone={routeLoad.value > 1000000 ? "rose" : "emerald"}
                />
                <Card
                  label="Viagens emitidas"
                  value={logistics.trips.length}
                  note="salvas na base central"
                />
              </div>
              <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <h3 className="font-semibold">Pedidos pendentes SAP</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
                    Abra a fila para selecionar o pedido conforme produto,
                    pedido SAP, unidade e prioridade. A lista prioriza a
                    urgência da janela planejada e, no mesmo nível, os pedidos
                    mais antigos.
                  </p>
                </div>
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800"
                  onClick={() => setShowOrderPicker(true)}
                  type="button"
                >
                  Vincular pedidos
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
                    {availableLogisticsRequests.length}
                  </span>
                </button>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <h3 className="font-semibold">Planejamento da rota</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    A rota nasce do saldo restante do pedido pendente SAP.
                    Vincule o material físico do Estoque webAgil, faça coleta
                    entre fazendas quando necessário e valide a capacidade antes
                    da emissão. A solicitação WebAgil é vinculada somente após a
                    criação da rota.
                  </p>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    <span>Pedido pendente SAP</span>
                    <button
                      className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-normal text-slate-700 transition hover:border-emerald-500"
                      onClick={() => setShowOrderPicker(true)}
                      type="button"
                    >
                      <span className="truncate">
                        {selectedLogisticsRequest
                          ? `${selectedLogisticsRequest.requestNumber} · ${selectedLogisticsRequest.destination} · ${selectedLogisticsLine?.product || "Material"}`
                          : "Selecione em Vincular pedidos"}
                      </span>
                      <span className="shrink-0 text-xs font-bold text-emerald-700">
                        Alterar
                      </span>
                    </button>
                  </div>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Material solicitado no SAP
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      disabled={!selectedLogisticsRequest}
                      onChange={(event) => {
                        const line = selectedLogisticsRequest?.lines.find(
                          (item) => item.id === event.target.value,
                        );
                        const pending = line ? remainingForLogisticsLine(line) : 0;
                        setTripMaterialKey(event.target.value);
                        setTripFulfillmentStockId("");
                        setTripCollectionId("");
                        setTripQuantity(pending ? String(pending) : "");
                      }}
                      value={tripMaterialKey}
                    >
                      <option value="">Selecione o material</option>
                      {selectedLogisticsRequest?.lines.map((line) => {
                        const pending = remainingForLogisticsLine(line);
                        return (
                          <option
                            disabled={!pending}
                            key={line.id}
                            value={line.id}
                          >
                            {line.product} · saldo {formatNumber(pending)}{" "}
                            {line.unit}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {selectedLogisticsLine ? (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 lg:col-span-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-sky-800">
                            Necessidade da fazenda
                          </p>
                          <p className="mt-1 font-semibold text-slate-900">
                            {selectedDestinationNucleus} ·{" "}
                            {selectedLogisticsLine.standardProduct}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            Saldo pendente do pedido SAP:{" "}
                            <strong>
                              {formatNumber(selectedLineRemaining)}{" "}
                              {selectedLogisticsLine.unit}
                            </strong>{" "}
                            · Necessidade conciliada:{" "}
                            <strong>{formatNumber(selectedFarmPlan)}</strong>.
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-800">
                          Ativo: {selectedLogisticsLine.active}
                        </span>
                      </div>
                      {selectedLogisticsLine.cycleWarning ? (
                        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 lg:col-span-2">
                          {selectedLogisticsLine.cycleWarning}
                        </p>
                      ) : null}
                      <div className="mt-3 grid gap-2 border-t border-sky-200 pt-3 text-sm sm:grid-cols-3">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">
                            Janela de aplicação
                          </p>
                          <p
                            className={cn(
                              "mt-1 font-semibold",
                              selectedLogisticsLine.planningStatus ===
                                "Janela adequada"
                                ? "text-emerald-700"
                                : selectedLogisticsLine.planningStatus ===
                                      "Planejamento já iniciado" ||
                                    selectedLogisticsLine.planningStatus ===
                                      "Antecedência curta"
                                  ? "text-rose-700"
                                  : "text-amber-800",
                            )}
                          >
                            {selectedLogisticsLine.planningDate
                              ? `${selectedLogisticsLine.planningStatus} · ${selectedLogisticsLine.daysBeforePlanning !== null && selectedLogisticsLine.daysBeforePlanning !== undefined ? (selectedLogisticsLine.daysBeforePlanning >= 0 ? `${selectedLogisticsLine.daysBeforePlanning} dia(s) antes` : `${Math.abs(selectedLogisticsLine.daysBeforePlanning)} dia(s) após`) : "sem cálculo"}`
                              : "Sem data planejada"}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600">
                            {selectedLogisticsLine.planningDate
                              ? `Ciclo ${selectedLogisticsLine.planningCycle || dashboardSettings.daeCycle} · aplicação prevista: ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${selectedLogisticsLine.planningDate}T00:00:00`))}`
                              : "Inclua a data de aplicação no planejamento."}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">
                            Planejado até a data solicitada
                          </p>
                          <p className="mt-1 font-semibold text-slate-900">
                            {formatNumber(
                              selectedLogisticsLine.plannedUntilRequest || 0,
                            )}{" "}
                            {selectedLogisticsLine.unit}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600">
                            Simulação acumulada do planejamento até{" "}
                            {selectedLogisticsRequest?.date
                              ? new Intl.DateTimeFormat("pt-BR").format(
                                  new Date(
                                    `${selectedLogisticsRequest.date}T00:00:00`,
                                  ),
                                )
                              : "a data solicitada"}
                            .
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">
                            Leitura operacional
                          </p>
                          <p className="mt-1 font-semibold text-slate-900">
                            {selectedLogisticsLine.planningStatus ===
                            "Janela adequada"
                              ? "Prazo adequado"
                              : selectedLogisticsLine.planningStatus ===
                                  "Antecedência curta"
                                ? "Priorizar expedição"
                                : selectedLogisticsLine.planningStatus ===
                                    "Planejamento já iniciado"
                                  ? "Demanda em atraso"
                                  : "Avaliar programação"}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600">
                            Faixa recomendada: pedido entre 5 e 15 dias antes da
                            aplicação.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <fieldset className="grid gap-2 rounded-xl border border-slate-200 p-3 lg:col-span-2">
                    <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                      Origem da carga
                    </legend>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <input
                          checked={tripSourceMode === "armazem"}
                          onChange={() => setTripSourceMode("armazem")}
                          type="radio"
                        />
                        Armazém
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          checked={tripSourceMode === "coleta"}
                          onChange={() => setTripSourceMode("coleta")}
                          type="radio"
                        />
                        Coleta em fazenda
                      </label>
                    </div>
                    {tripSourceMode === "armazem" ? (
                      <label className="mt-3 grid gap-1.5 text-sm font-semibold text-slate-700">
                        Material físico e saldo consolidado no Estoque webAgil
                        <select
                          className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                          disabled={!compatibleWarehouseStocks.length}
                          onChange={(event) =>
                            setTripFulfillmentStockId(event.target.value)
                          }
                          value={tripFulfillmentStockId}
                        >
                          <option value="">
                            Selecione o produto do armazém
                          </option>
                          {compatibleWarehouseStocks.map((stock) => (
                            <option key={stock.id} value={stock.id}>
                              {stock.product} · saldo disponível{" "}
                              {formatNumber(stock.balance)} {stock.unit} ·{" "}
                              {stock.warehouse} · AG {stock.responsibleName}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs font-normal text-slate-500">
                          O saldo é consolidado por produto e armazém. O lote
                          será vinculado posteriormente no carregamento.
                        </span>
                      </label>
                    ) : (
                      <label className="mt-3 grid gap-1.5 text-sm font-semibold text-slate-700">
                        Fazenda para coleta
                        <select
                          className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                          disabled={!collectionOptions.length}
                          onChange={(event) =>
                            setTripCollectionId(event.target.value)
                          }
                          value={tripCollectionId}
                        >
                          <option value="">
                            Selecione a unidade com saldo
                          </option>
                          {collectionOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              Coletar na {item.nucleus} · {item.material} ·
                              saldo {formatNumber(item.balance)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </fieldset>
                  {selectedLogisticsLine &&
                  selectedWarehouseStock &&
                  tripSourceMode === "armazem" &&
                  normalizeMaterial(selectedWarehouseStock.product) !==
                    normalizeMaterial(selectedLogisticsLine.product) ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 lg:col-span-2">
                      <strong>Substituição pelo mesmo princípio ativo.</strong>{" "}
                      Pedido: {selectedLogisticsLine.product} · Estoque
                      escolhido: {selectedWarehouseStock.product}. A rota mantém
                      o pedido original e exige solicitação de ajuste à fazenda
                      no sistema.
                    </div>
                  ) : null}
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Quantidade a expedir
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      inputMode="decimal"
                      max={Math.min(
                        selectedLineRemaining,
                        selectedSourceBalance,
                      )}
                      onChange={(event) => setTripQuantity(event.target.value)}
                      placeholder={
                        selectedLineRemaining
                          ? String(selectedLineRemaining)
                          : "0"
                      }
                      value={tripQuantity}
                    />
                  </label>
                  <div
                    className={cn(
                      "rounded-xl border p-3 text-sm",
                      selectedOverPlan > 0
                        ? "border-amber-200 bg-amber-50 text-amber-950"
                        : "border-slate-200 bg-slate-50 text-slate-700",
                    )}
                  >
                    <p className="text-xs font-bold uppercase tracking-wide">
                      Comparativo de necessidade
                    </p>
                    <p className="mt-1">
                      Carga: <strong>{formatNumber(selectedQuantity)}</strong> ·
                      planejado a atender:{" "}
                      <strong>{formatNumber(selectedFarmPlan)}</strong>
                      {selectedOverPlan > 0
                        ? ` · ${formatNumber(selectedOverPlan)} acima da necessidade`
                        : " · dentro da necessidade"}
                    </p>
                  </div>
                  <div className="flex items-end lg:col-span-2">
                    <button
                      className="w-full rounded-xl border border-emerald-700 px-4 py-2.5 text-sm font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        !selectedRouteItem ||
                        !tripQuantity.trim() ||
                        (tripSourceMode === "armazem"
                          ? !tripFulfillmentStockId
                          : !tripCollectionId) ||
                        selectedQuantity > selectedLineRemaining ||
                        selectedQuantity > selectedSourceBalance
                      }
                      onClick={addRouteItem}
                      type="button"
                    >
                      Adicionar pedido à rota
                    </button>
                  </div>
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 lg:col-span-2">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-800">
                          Material sem pedido
                        </h4>
                        <p className="mt-1 text-xs text-slate-500">
                          Inclua uma carga avulsa a partir do estoque geral
                          conciliado (fazenda ou armazém); ela não depende do
                          Estoque webAgil. O lote será definido posteriormente.
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-500">
                        Opcional
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <label className="grid gap-1 text-xs font-semibold text-slate-600 md:col-span-2">
                        Material no estoque geral
                        <select
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                          onChange={(event) => {
                            const stock = generalStockOptions.find(
                              (item) => item.id === event.target.value,
                            );
                            setManualStockId(event.target.value);
                            if (stock) setManualUnit(stock.unit);
                          }}
                          value={manualStockId}
                        >
                          <option value="">Selecione o material</option>
                          {generalStockOptions.map((stock) => (
                            <option key={stock.id} value={stock.id}>
                              {stock.product} · saldo{" "}
                              {formatNumber(stock.balance)} {stock.unit} ·{" "}
                              {stock.warehouse}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-600">
                        Destino / núcleo
                        <select
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                          onChange={(event) =>
                            setManualDestination(event.target.value)
                          }
                          value={manualDestination}
                        >
                          <option value="">Selecione o destino</option>
                          {[
                            ...new Set(
                              ledger.map((row) => row.nucleus).filter(Boolean),
                            ),
                          ]
                            .sort()
                            .map((nucleus) => (
                              <option key={nucleus}>{nucleus}</option>
                            ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-600">
                        Quantidade
                        <input
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                          inputMode="decimal"
                          onChange={(event) =>
                            setManualQuantity(event.target.value)
                          }
                          value={manualQuantity}
                        />
                      </label>
                    </div>
                    <button
                      className="mt-3 rounded-lg border border-slate-700 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                      disabled={
                        !manualStockId ||
                        !manualDestination ||
                        !numberFrom(manualQuantity)
                      }
                      onClick={addManualRouteItem}
                      type="button"
                    >
                      Incluir material sem pedido
                    </button>
                  </div>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Veículo
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) => {
                        const vehicle = logistics.vehicles.find(
                          (item) => item.id === event.target.value,
                        );
                        setTripVehicleId(event.target.value);
                        if (vehicle?.defaultDriverId)
                          setTripDriverId(vehicle.defaultDriverId);
                      }}
                      value={tripVehicleId}
                    >
                      <option value="">Selecione a placa</option>
                      {logistics.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.plate} · {vehicle.model} ·{" "}
                          {formatNumber(vehicle.capacity)} kg
                          {vehicle.palletCapacity
                            ? ` · ${formatNumber(vehicle.palletCapacity)} paletes`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Data da viagem
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) => setTripDate(event.target.value)}
                      type="date"
                      value={tripDate}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Horário previsto de saída
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) => setTripDepartureTime(event.target.value)}
                      type="time"
                      value={tripDepartureTime}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Motorista
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                      onChange={(event) => setTripDriverId(event.target.value)}
                      value={tripDriverId}
                    >
                      <option value="">Selecione o motorista</option>
                      {logistics.drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.fullName} · CPF {driver.cpf}
                        </option>
                      ))}
                    </select>
                  </label>
                  {samePlateTripsOnDate.length ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 lg:col-span-2">
                      <strong>Placa já programada nesta data.</strong> Há{" "}
                      {samePlateTripsOnDate.length} rota(s) para esta placa em{" "}
                      {new Intl.DateTimeFormat("pt-BR").format(
                        new Date(`${tripDate}T00:00:00`),
                      )}
                      . Você pode seguir, mas confirme a disponibilidade do
                      veículo.
                    </div>
                  ) : null}
                </div>
                <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-emerald-950">
                        Carga da rota
                      </h4>
                      <p className="mt-1 text-xs text-emerald-900">
                        {routeItems.length} material(is) ·{" "}
                        {
                          new Set(
                            routeItems
                              .map((item) => item.requestId)
                              .filter((id) => id !== "SEM-PEDIDO"),
                          ).size
                        }{" "}
                        pedido(s) SAP · {formatNumber(routeLoad.weightKg)} kg
                        estimados · {formatNumber(routeLoad.pallets)} palete(s)
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800">
                        Valor: {formatCurrency(routeLoad.value, "BRL")}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800">
                        Uma viagem, vários pedidos SAP
                      </span>
                    </div>
                  </div>
                  {routeCapacity ? (
                    <p
                      className={cn(
                        "mt-3 rounded-lg px-3 py-2 text-xs font-semibold",
                        routeCapacity.weightExceeded ||
                          routeCapacity.palletExceeded
                          ? "bg-rose-100 text-rose-800"
                          : routeLoad.itemsWithoutWeight
                            ? "bg-amber-100 text-amber-900"
                          : "bg-white text-emerald-800",
                      )}
                    >
                      {routeCapacity.weightExceeded ||
                      routeCapacity.palletExceeded
                        ? "Capacidade excedida: revise a carga antes de emitir."
                        : routeLoad.itemsWithoutWeight
                          ? `Capacidade parcial: ${formatNumber(routeLoad.weightKg)} de ${formatNumber(selectedLogisticsVehicle?.capacity || 0)} kg. ${routeLoad.itemsWithoutWeight} material(is) sem peso em kg informado; informe o peso para validar a capacidade total.`
                        : `Capacidade validada: ${formatNumber(routeLoad.weightKg)} de ${formatNumber(selectedLogisticsVehicle?.capacity || 0)} kg${selectedLogisticsVehicle?.palletCapacity ? ` · ${formatNumber(routeLoad.pallets)} de ${formatNumber(selectedLogisticsVehicle.palletCapacity)} paletes` : ""}.`}
                    </p>
                  ) : (
                    <p className="mt-3 text-xs text-slate-600">
                      Selecione um veículo para validar peso e paletes.
                    </p>
                  )}
                  {routeLoad.value > 1000000 ? (
                    <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm font-bold text-rose-900">
                      Carga acima de {formatCurrency(1000000, "BRL")}:
                      necessária escolta armada e isca/rastreador antes da
                      emissão.
                    </p>
                  ) : null}
                  {routeItems.length ? (
                    <div className="mt-3 divide-y divide-emerald-100 rounded-lg bg-white">
                      {routeItems.map((item) => (
                        <div
                          className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm"
                          key={item.id}
                        >
                          <div>
                            <p className="font-semibold text-slate-800">
                              {item.product}
                              <span className="ml-2 font-normal text-slate-500">
                                · saldo reservado · lote a definir
                              </span>
                              {item.adjustmentRequired ? (
                                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                  AJUSTAR PRODUTO NA FAZENDA
                                </span>
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {item.requestId === "SEM-PEDIDO"
                                ? "Sem pedido"
                                : `Pedido SAP ${item.requestId}`}{" "}
                              · {formatNumber(item.quantity)} {item.unit} ·{" "}
                              {item.weightKg
                                ? `${formatNumber(item.weightKg)} kg`
                                : "peso não informado"}{" "}
                              ·{" "}
                              {formatCurrency(item.estimatedValue || 0, "BRL")}{" "}
                              · {item.sourceWarehouse} → {item.destination}
                            </p>
                            {item.requestProduct &&
                            item.requestProduct !== item.product ? (
                              <p className="mt-1 text-xs text-amber-800">
                                Pedido original: {item.requestProduct}
                              </p>
                            ) : null}
                          </div>
                          <button
                            className="text-xs font-bold text-rose-700"
                            onClick={() => removeRouteItem(item.id)}
                            type="button"
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">
                      Selecione um pedido SAP ou adicione um material avulso,
                      depois use “Adicionar pedido à rota”.
                    </p>
                  )}
                </div>
                {routeItems.length ? (
                  <section className="mt-5 overflow-hidden rounded-xl border border-sky-200 bg-sky-50">
                    <div className="flex flex-wrap items-end justify-between gap-3 p-4">
                      <div>
                        <h4 className="text-sm font-bold text-sky-950">
                          Mapa da rota
                        </h4>
                        <p className="mt-1 text-xs text-sky-900">
                          {routeMap.origin || "Configure a origem"} →{" "}
                          {routeMap.destination || "configure o destino"}.
                          Cadastre municípios em Configuração rodoviária para
                          melhorar a rota.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {routeMap.originAddress ||
                        routeMap.destinationAddress ? (
                          <a
                            className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800"
                            href={googleMapsSearchUrl(
                              routeMap.destinationAddress ||
                                routeMap.originAddress,
                            )}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Abrir endereço cadastrado
                          </a>
                        ) : null}
                        {routeMap.mapUrl ? (
                          <a
                            className="rounded-lg border border-sky-700 bg-white px-3 py-2 text-xs font-bold text-sky-800"
                            href={routeMap.mapUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Abrir no Google Maps
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {routeMap.embedUrl ? (
                      <iframe
                        className="h-64 w-full border-0 bg-white"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        src={routeMap.embedUrl}
                        title="Mapa da rota da viagem"
                      />
                    ) : (
                      <div className="m-4 rounded-lg border border-dashed border-sky-300 bg-white p-4 text-sm text-sky-900">
                        Vincule o armazém e o núcleo/destino aos seus municípios
                        para exibir o mapa.
                      </div>
                    )}
                  </section>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="text-xs text-slate-500">
                    {selectedDriver && selectedVehicle
                      ? `Rota pronta: ${selectedDriver.fullName} · ${selectedVehicle.plate}. Notas fiscais e receitas serão vinculadas após a emissão.`
                      : "Cadastre e selecione motorista e veículo para completar a rota."}
                  </p>
                  <button
                    className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                    disabled={
                      !routeItems.length ||
                      !tripDate ||
                      !tripDriverId ||
                      !tripVehicleId ||
                      Boolean(
                        routeCapacity?.weightExceeded ||
                          routeCapacity?.palletExceeded,
                      )
                    }
                    onClick={createLogisticsTrip}
                    type="button"
                  >
                    Emitir viagem
                  </button>
                </div>
              </section>
            </section>
          ) : null}

          {logisticsTab === "viagens" ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Viagens emitidas</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    A rota é criada pelos pedidos SAP. A solicitação WebAgil é
                    vinculada nesta etapa, depois da emissão.
                  </p>
                </div>
                <span className="text-sm font-bold text-emerald-800">
                  {logistics.trips.length} registro(s)
                </span>
              </div>
              <Table
                empty="Nenhuma viagem emitida."
                headers={[
                  "Pedidos SAP / WebAgil / agendamento",
                  "Carga da rota",
                  "Rota",
                  "Data / motorista / placa",
                  "Status",
                  "NF",
                  "Receita",
                  "Ações",
                ]}
                rows={logistics.trips.map((trip) => {
                  const driver = logistics.drivers.find(
                    (item) => item.id === trip.driverId,
                  );
                  const vehicle = logistics.vehicles.find(
                    (item) => item.id === trip.vehicleId,
                  );
                  const items = logisticsTripItems(trip);
                  const requests = [
                    ...new Set(items.map((item) => item.requestId)),
                  ];
                  const linkedWeb = (trip.webRequestIds || [])
                    .map((id) =>
                      webAgilRequests.find((request) => request.id === id),
                    )
                    .filter((request): request is LogisticsRequest =>
                      Boolean(request),
                    );
                  return [
                    <span key={`${trip.id}-requests`} className="font-semibold">
                      {requests.join(", ")}
                      <br />
                      <small className="font-normal text-slate-500">
                        {requests.length} pedido(s) SAP
                      </small>
                      <small className="mt-1 block font-normal text-sky-700">
                        {linkedWeb.length
                          ? `WebAgil: ${linkedWeb.map((request) => request.requestNumber).join(", ")}`
                          : "WebAgil pendente de vínculo"}
                      </small>
                      <small className="mt-1 block font-semibold text-violet-700">
                        {trip.appointmentNumber
                          ? `Agendamento: ${trip.appointmentNumber}`
                          : "Agendamento pendente"}
                      </small>
                    </span>,
                    <span key={`${trip.id}-material`}>
                      {items.slice(0, 2).map((item) => (
                        <span className="block" key={item.id}>
                          {item.product}{" "}
                          <small className="text-slate-500">
                            · {formatNumber(item.quantity)} {item.unit}
                          </small>
                        </span>
                      ))}
                      {items.length > 2 ? (
                        <small className="text-slate-500">
                          + {items.length - 2} material(is)
                        </small>
                      ) : null}
                      <small className="mt-1 block font-semibold text-emerald-700">
                        Valor estimado:{" "}
                        {formatCurrency(
                          items.reduce(
                            (total, item) => total + (item.estimatedValue || 0),
                            0,
                          ),
                          "BRL",
                        )}
                      </small>
                    </span>,
                    <span key={`${trip.id}-route`}>
                      {trip.sourceWarehouse}
                      <br />
                      <small className="text-slate-500">
                        → {trip.destination}
                      </small>
                    </span>,
                    <span key={`${trip.id}-driver`}>
                      <strong>
                        {new Intl.DateTimeFormat("pt-BR").format(
                          new Date(`${logisticsTripDate(trip)}T00:00:00`),
                        )}
                        {trip.departureTime ? ` · ${trip.departureTime}` : ""}
                      </strong>
                      <br />
                      {driver?.fullName || "Cadastro removido"}
                      <br />
                      <small className="text-slate-500">
                        {vehicle?.plate || "Placa removida"}
                      </small>
                    </span>,
                    <select
                      aria-label={`Status da viagem ${trip.id}`}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-xs font-bold",
                        (trip.status || "Em progresso") === "Concluído"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : (trip.status || "Em progresso") === "Rota ativa"
                            ? "border-sky-200 bg-sky-50 text-sky-800"
                            : "border-amber-200 bg-amber-50 text-amber-900",
                      )}
                      key={`${trip.id}-status`}
                      onChange={(event) =>
                        updateLogisticsTripStatus(
                          trip.id,
                          event.target
                            .value as NonNullable<LogisticsTrip["status"]>,
                        )
                      }
                      value={trip.status || "Em progresso"}
                    >
                      <option>Em progresso</option>
                      <option>Rota ativa</option>
                      <option>Concluído</option>
                    </select>,
                    <span key={`${trip.id}-invoices`}>
                      {logisticsTripInvoices(trip).join(", ") || "—"}
                    </span>,
                    logisticsTripRecipes(trip).length ? (
                      <span className="font-semibold text-emerald-700">
                        {logisticsTripRecipes(trip).length} receita(s)
                        <br />
                        <small>
                          {logisticsTripRecipes(trip)
                            .map((recipe) => recipe.culture)
                            .join(" · ")}
                        </small>
                      </span>
                    ) : (
                      <span className="text-slate-500">Pendente</span>
                    ),
                    <span
                      className="flex flex-wrap gap-2"
                      key={`${trip.id}-actions`}
                    >
                      <button
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700"
                        onClick={() => openTripEditor(trip)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="rounded-lg border border-sky-700 px-2.5 py-1.5 text-xs font-bold text-sky-800"
                        onClick={() => openTripInvoices(trip)}
                        type="button"
                      >
                        Notas fiscais
                      </button>
                      <button
                        className="rounded-lg border border-violet-700 px-2.5 py-1.5 text-xs font-bold text-violet-800"
                        onClick={() => openTripAppointment(trip)}
                        type="button"
                      >
                        {trip.appointmentNumber
                          ? "Agendamento"
                          : "Registrar agendamento"}
                      </button>
                      <button
                        className="rounded-lg border border-sky-700 px-2.5 py-1.5 text-xs font-bold text-sky-800"
                        onClick={() => {
                          const firstItem = logisticsTripItems(trip)[0];
                          setRecipeTripId(trip.id);
                          setRecipeDraft({
                            culture: firstItem?.culture || "",
                            destination: firstItem?.destination || trip.destination,
                            dose: "",
                            product: firstItem?.product || trip.product,
                            target: "",
                            volume: firstItem?.quantity || trip.quantity,
                          });
                        }}
                        type="button"
                      >
                        Receitas
                      </button>
                      <button
                        className="rounded-lg border border-violet-700 px-2.5 py-1.5 text-xs font-bold text-violet-800"
                        onClick={() => setWorkflowTripId(trip.id)}
                        type="button"
                      >
                        Fluxo
                      </button>
                      <button
                        className="rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-bold text-emerald-700"
                        onClick={() => void exportLogisticsDocument(trip)}
                        type="button"
                      >
                        Exportar doc.
                      </button>
                      <button
                        className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700"
                        onClick={() => removeLogisticsTrip(trip)}
                        type="button"
                      >
                        Excluir
                      </button>
                    </span>,
                  ];
                })}
              />
              {editingTrip ? (
                <section className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[.12em] text-slate-600">
                        Edição da viagem
                      </p>
                      <h4 className="mt-1 font-semibold text-slate-950">
                        Viagem {editingTrip.id.replace("viagem-", "")}
                      </h4>
                      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
                        Edite a viagem completa: materiais, pedido SAP,
                        quantidade, origem, destino, lote, data, horário,
                        motorista, veículo e status. Se a carga mudar após os
                        vínculos operacionais, a aplicação pedirá confirmação
                        para reiniciar essas etapas de forma segura.
                      </p>
                    </div>
                    <button
                      className="text-xs font-bold text-slate-600"
                      onClick={() => {
                        setEditingTripId("");
                        setTripEditItems([]);
                      }}
                      type="button"
                    >
                      Cancelar
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Data da viagem
                      <input
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setTripEditDraft((current) => ({
                            ...current,
                            tripDate: event.target.value,
                          }))
                        }
                        type="date"
                        value={tripEditDraft.tripDate}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Horário de saída
                      <input
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setTripEditDraft((current) => ({
                            ...current,
                            departureTime: event.target.value,
                          }))
                        }
                        type="time"
                        value={tripEditDraft.departureTime}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Motorista
                      <select
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setTripEditDraft((current) => ({
                            ...current,
                            driverId: event.target.value,
                          }))
                        }
                        value={tripEditDraft.driverId}
                      >
                        <option value="">Selecione o motorista</option>
                        {logistics.drivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.fullName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Veículo / placa
                      <select
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setTripEditDraft((current) => ({
                            ...current,
                            vehicleId: event.target.value,
                          }))
                        }
                        value={tripEditDraft.vehicleId}
                      >
                        <option value="">Selecione o veículo</option>
                        {logistics.vehicles.map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.plate} · {vehicle.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Status
                      <select
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setTripEditDraft((current) => ({
                            ...current,
                            status: event.target
                              .value as NonNullable<LogisticsTrip["status"]>,
                          }))
                        }
                        value={tripEditDraft.status}
                      >
                        <option>Em progresso</option>
                        <option>Rota ativa</option>
                        <option>Concluído</option>
                      </select>
                    </label>
                  </div>
                  <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h5 className="text-sm font-bold text-slate-950">
                          Carga e rota da viagem
                        </h5>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          Cada linha representa um material da carga. Use o
                          material físico efetivamente carregado; o pedido SAP
                          pode permanecer como referência ou ser corrigido.
                        </p>
                      </div>
                      <button
                        className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-700"
                        onClick={addTripEditItem}
                        type="button"
                      >
                        Adicionar material
                      </button>
                    </div>
                    <datalist id="trip-editor-products">
                      {[...new Set([
                        ...generalStockOptions.map((stock) => stock.product),
                        ...webWarehouseProductOptions.map(
                          (stock) => stock.product,
                        ),
                      ])]
                        .filter(Boolean)
                        .sort((left, right) =>
                          left.localeCompare(right, "pt-BR"),
                        )
                        .map((product) => (
                          <option key={product} value={product} />
                        ))}
                    </datalist>
                    <div className="mt-4 space-y-3">
                      {tripEditItems.map((item, index) => (
                        <article
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                          key={item.id}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                              Material {index + 1}
                            </p>
                            <button
                              className="text-xs font-bold text-rose-700"
                              disabled={tripEditItems.length === 1}
                              onClick={() => removeTripEditItem(item.id)}
                              type="button"
                            >
                              Excluir material
                            </button>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                            <label className="grid gap-1 text-xs font-bold text-slate-600 xl:col-span-2">
                              Material físico carregado
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                list="trip-editor-products"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    product: event.target.value,
                                  })
                                }
                                placeholder="Ex.: PRETORIAN 240 SC 4X5"
                                value={item.product}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Código do material
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    productCode: event.target.value,
                                  })
                                }
                                value={item.productCode}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Quantidade
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                inputMode="decimal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    quantity: numberFrom(event.target.value),
                                  })
                                }
                                value={item.quantity || ""}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Unidade
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    unit: event.target.value,
                                  })
                                }
                                value={item.unit}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Pedido SAP
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    requestId: event.target.value,
                                  })
                                }
                                placeholder="SEM-PEDIDO"
                                value={item.requestId}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600 xl:col-span-2">
                              Material solicitado no SAP
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    requestProduct: event.target.value,
                                  })
                                }
                                placeholder="Material originalmente solicitado"
                                value={item.requestProduct || ""}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Data do pedido
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    requestDate: event.target.value,
                                  })
                                }
                                type="date"
                                value={item.requestDate}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Origem / armazém
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    sourceWarehouse: event.target.value,
                                  })
                                }
                                placeholder="Ex.: BRAVO SORRISO"
                                value={item.sourceWarehouse}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Tipo de origem
                              <select
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    sourceMode: event.target.value as NonNullable<
                                      LogisticsTripItem["sourceMode"]
                                    >,
                                  })
                                }
                                value={item.sourceMode || "manual"}
                              >
                                <option value="armazem">Armazém</option>
                                <option value="coleta">Coleta em fazenda</option>
                                <option value="manual">Material avulso</option>
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600 xl:col-span-2">
                              Destino / fazenda
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    destination: event.target.value,
                                    destinationCode: event.target.value,
                                  })
                                }
                                placeholder="Ex.: NC-QUA"
                                value={item.destination}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Lote
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    lot: event.target.value,
                                  })
                                }
                                placeholder="A definir"
                                value={item.lot}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-600">
                              Paletes estimados
                              <input
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal"
                                inputMode="decimal"
                                onChange={(event) =>
                                  updateTripEditItem(item.id, {
                                    pallets: numberFrom(event.target.value),
                                  })
                                }
                                value={item.pallets || ""}
                              />
                            </label>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      Alterar somente data, horário, motorista, veículo ou
                      status preserva as etapas já concluídas. Alterar a carga
                      exige reconciliação operacional.
                    </p>
                    <button
                      className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white"
                      onClick={saveTripEdits}
                      type="button"
                    >
                      Salvar alterações
                    </button>
                  </div>
                </section>
              ) : null}
              {workflowTrip ? (
                <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[.12em] text-violet-700">
                        Fluxo operacional da viagem
                      </p>
                      <h4 className="mt-1 font-semibold text-violet-950">
                        Viagem {workflowTrip.id.replace("viagem-", "")} ·{" "}
                        {new Intl.DateTimeFormat("pt-BR").format(
                          new Date(`${logisticsTripDate(workflowTrip)}T00:00:00`),
                        )}
                        {workflowTrip.departureTime
                          ? ` · saída ${workflowTrip.departureTime}`
                          : ""}
                      </h4>
                      <p className="mt-1 text-sm text-violet-900">
                        {workflowDriver?.fullName || "Motorista não identificado"}
                        {workflowVehicle?.plate
                          ? ` · ${workflowVehicle.plate}`
                          : ""}
                      </p>
                    </div>
                    <button
                      className="text-xs font-bold text-slate-600"
                      onClick={() => setWorkflowTripId("")}
                      type="button"
                    >
                      Fechar fluxo
                    </button>
                  </div>

                  <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
                    {[
                      ["1", "Rota criada", true],
                      [
                        "2",
                        "WebAgil",
                        Boolean(workflowLinkedWeb.length),
                      ],
                      [
                        "3",
                        "Fiscal / NF",
                        workflowFiscalBatches.every((batch) =>
                          isFiscalBatchReady(workflowTrip, batch),
                        ),
                      ],
                      [
                        "4",
                        "E-mail Bravo",
                        workflowFiscalBatches.every((batch) =>
                            Boolean(
                              workflowTrip.fiscalEmailSentAtByBatch?.[batch.id],
                            ),
                          ),
                      ],
                      [
                        "5",
                        "Agendamento",
                        Boolean(workflowTrip.appointmentNumber),
                      ],
                      ["6", "Grupo de rota", Boolean(workflowTrip.routeGroupSentAt)],
                      [
                        "7",
                        "Pedido de receita",
                        Boolean(workflowTrip.recipeRequestSentAt),
                      ],
                    ].map(([step, label, ready]) => (
                      <div
                        className={cn(
                          "rounded-xl border px-3 py-2 text-sm",
                          ready
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-violet-200 bg-white text-slate-600",
                        )}
                        key={String(step)}
                      >
                        <span className="font-bold">{step}. </span>
                        {label}
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    <article className="order-1 rounded-xl border border-sky-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h5 className="font-semibold text-sky-950">
                            2. Solicitações WebAgil
                          </h5>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600">
                            Crie as solicitações no WebAgil com os volumes da
                            rota. O lote é definido naquele sistema; depois,
                            vincule cada solicitação uma única vez aqui.
                          </p>
                        </div>
                        <button
                          className="rounded-lg border border-sky-700 px-3 py-2 text-xs font-bold text-sky-800"
                          onClick={() =>
                            document
                              .getElementById("logistics-webagil-links")
                              ?.scrollIntoView({ behavior: "smooth", block: "center" })
                          }
                          type="button"
                        >
                          Vincular WebAgil
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {workflowLinkedWeb.length ? (
                          workflowLinkedWeb.map((request) => (
                            <span
                              className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800"
                              key={request.id}
                            >
                              Solicitação {request.requestNumber}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-500">
                            Nenhuma solicitação vinculada ainda.
                          </span>
                        )}
                      </div>
                    </article>

                    <article className="order-3 rounded-xl border border-violet-200 bg-white p-4">
                      <h5 className="font-semibold text-violet-950">
                        5. Agendamento da carga no WebAgil
                      </h5>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        Depois de vincular as solicitações, crie no WebAgil um
                        único agendamento para a carga do veículo e associe a
                        ele todas as solicitações desta viagem. O sistema não
                        escolhe lotes: essa distribuição continua no WebAgil.
                      </p>
                      <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-950">
                        {workflowTrip.appointmentNumber ? (
                          <>
                            <strong>Agendamento {workflowTrip.appointmentNumber}</strong>
                            <br />
                            {workflowLinkedWeb.length} solicitação(ões) WebAgil
                            vinculada(s) a esta viagem.
                          </>
                        ) : (
                          "Nenhum agendamento WebAgil registrado ainda."
                        )}
                      </div>
                      <button
                        className="mt-3 rounded-lg border border-violet-700 bg-white px-3 py-1.5 text-xs font-bold text-violet-800"
                        onClick={() => openTripAppointment(workflowTrip)}
                        type="button"
                      >
                        {workflowTrip.appointmentNumber
                          ? "Editar agendamento"
                          : "Registrar agendamento"}
                      </button>
                    </article>

                    <article className="order-2 rounded-xl border border-amber-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h5 className="font-semibold text-amber-950">
                            3–4. Fiscal e e-mail externo
                          </h5>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600">
                            Vincule o volume da viagem e confira os lotes. Gere o rascunho do faturamento com o lote SAP e, após registrar as NFs, o da Bravo com o lote WebAgil.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-lg border border-amber-700 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 disabled:opacity-45"
                            disabled={!workflowEmailBlocks.some((block) => block.faturamento)}
                            onClick={() => openFiscalEmailGenerator(workflowTrip, "faturamento")}
                            type="button"
                          >
                            E-mail para faturamento
                          </button>
                          <button
                            className="rounded-lg border border-amber-700 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 disabled:opacity-45"
                            disabled={!workflowEmailBlocks.some((block) => block.bravo)}
                            onClick={() => openFiscalEmailGenerator(workflowTrip, "bravo")}
                            type="button"
                          >
                            E-mail para Bravo
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {workflowFiscalBatches.map((batch) => (
                          <div
                            className="rounded-lg border border-amber-100 bg-amber-50/60 p-3"
                            key={batch.id}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <strong className="text-sm text-amber-950">
                                  {batch.destination}
                                </strong>
                                <p className="text-xs text-amber-900">
                                  AG: {batch.responsibleName}
                                </p>
                                <p className="mt-1 text-xs text-slate-600">
                                  {batch.items
                                    .map(
                                      (item) =>
                                        `${item.product} (${formatNumber(item.quantity)} ${item.unit})`,
                                    )
                                    .join(" · ")}
                                </p>
                                <p className="mt-1 text-xs font-semibold text-amber-900">
                                  Volume vinculado: {formatNumber(
                                    logisticsFiscalBatchAllocated(
                                      workflowTrip,
                                      batch,
                                    ),
                                  )} de {formatNumber(
                                    batch.items.reduce(
                                      (total, item) => total + item.quantity,
                                      0,
                                    ),
                                  )}
                                </p>
                                {(workflowTrip.fiscalAllocations || [])
                                  .filter(
                                    (allocation) =>
                                      allocation.batchId === batch.id,
                                  )
                                  .map((allocation) => {
                                    const request = webAgilRequests.find(
                                      (item) =>
                                        item.id === allocation.requestId,
                                    );
                                    const line = fiscalRequestLineFor(allocation, webAgilRequests);
                                    return (
                                      <p
                                        className="mt-1 text-xs text-amber-900"
                                        key={allocation.id}
                                      >
                                        <strong>{allocation.invoiceNumber ? `NF ${allocation.invoiceNumber}` : "NF pendente"}</strong>
                                        {" · Solicitação "}
                                        {request?.requestNumber || allocation.requestId}
                                        {" · "}
                                        {line?.product || "material não identificado"}
                                        {" · "}
                                        {formatNumber(allocation.quantity)} {line?.unit || "UN"}
                                        {" · Web "}{line?.lot || "a conferir"}
                                        {" · SAP "}{allocation.sapLot || "a conferir"}
                                      </p>
                                    );
                                  })}
                              </div>
                              <span
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-xs font-bold",
                                  batch.invoices.length
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-white text-amber-900",
                                )}
                              >
                                {batch.invoices.length
                                  ? `NF: ${batch.invoices.join(", ")}`
                                  : "NF pendente"}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                className="rounded-lg border border-amber-700 bg-white px-3 py-1.5 text-xs font-bold text-amber-900"
                                onClick={() => openTripInvoices(workflowTrip, batch.id)}
                                type="button"
                              >
                                {logisticsFiscalBatchAllocated(
                                  workflowTrip,
                                  batch,
                                ) >=
                                batch.items.reduce(
                                  (total, item) => total + item.quantity,
                                  0,
                                ) - 0.000001
                                  ? "Ver / editar vínculo"
                                  : "Vincular volume e lotes"}
                              </button>
                              {workflowTrip.fiscalEmailSentAtByBatch?.[batch.id] ? (
                                <span className="px-1 py-1.5 text-xs font-semibold text-emerald-800">Rascunho Bravo gerado</span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      {fiscalEmailTripId === workflowTrip.id ? (
                        <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h6 className="text-sm font-bold text-amber-950">
                                Blocos do e-mail para {fiscalEmailKind === "bravo" ? "Bravo" : "faturamento"}
                              </h6>
                              <p className="mt-1 text-xs text-amber-900">
                                {fiscalEmailKind === "bravo" ? "Selecione os blocos e anexe os PDFs das NFs no Outlook." : "Selecione os blocos para a conferência de estoque."}
                              </p>
                            </div>
                            <label className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                              <input
                                checked={
                                  workflowReadyFiscalBatches.length > 0 &&
                                  fiscalEmailBatchIds.length ===
                                    workflowReadyFiscalBatches.length
                                }
                                onChange={(event) =>
                                  setFiscalEmailBatchIds(
                                    event.target.checked
                                      ? workflowReadyFiscalBatches.map(
                                          (batch) => batch.id,
                                        )
                                      : [],
                                  )
                                }
                                type="checkbox"
                              />
                              Todos os blocos prontos
                            </label>
                          </div>
                          <div className="mt-3 space-y-2">
                            {workflowReadyFiscalBatches.map((batch) => (
                              <label
                                className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950"
                                key={batch.id}
                              >
                                <input
                                  checked={fiscalEmailBatchIds.includes(batch.id)}
                                  onChange={() => toggleFiscalEmailBatch(batch.id)}
                                  type="checkbox"
                                />
                                <span>
                                  <strong>{batch.destination}</strong>
                                  <span className="block text-xs text-amber-900">
                                    {batch.responsibleName}{batch.invoices.length ? ` · NF ${batch.invoices.join(", ")}` : ""}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button
                              className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600"
                              onClick={() => {
                                setFiscalEmailTripId("");
                                setFiscalEmailBatchIds([]);
                              }}
                              type="button"
                            >
                              Cancelar
                            </button>
                            <button
                              className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
                              disabled={!fiscalEmailBatchIds.length}
                              onClick={downloadFiscalEmailPackage}
                              type="button"
                            >
                              Baixar rascunho .eml
                            </button>
                          </div>
                        </section>
                      ) : null}
                    </article>

                    <article className="order-4 rounded-xl border border-emerald-200 bg-white p-4">
                      <h5 className="font-semibold text-emerald-950">
                        6. Grupo da rota
                      </h5>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        Mensagem preparada para informar armazém e unidades com
                        pelo menos um dia de antecedência. Revise e envie no
                        grupo oficial da rota.
                      </p>
                      <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                            Sequência das paradas
                          </p>
                          <span className="text-[11px] text-emerald-800">
                            Use as setas para definir a rota.
                          </span>
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {workflowRouteStops.map((stop, index) => (
                            <div
                              className="flex items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-white px-2.5 py-2"
                              key={stop.id}
                            >
                              <div className="min-w-0 text-xs text-emerald-950">
                                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-[10px] font-bold text-white">
                                  {index + 1}
                                </span>
                                <strong>{stop.type === "collect" ? "Coletar" : "Entregar"}</strong>
                                <span className="ml-1">· {stop.location}</span>
                              </div>
                              <div className="flex shrink-0 gap-1">
                                <button
                                  aria-label={`Subir ${stop.location}`}
                                  className="rounded border border-emerald-200 px-2 py-0.5 text-xs font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={index === 0}
                                  onClick={() => moveTripRouteStop(workflowTrip, stop.id, -1)}
                                  type="button"
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label={`Descer ${stop.location}`}
                                  className="rounded border border-emerald-200 px-2 py-0.5 text-xs font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={index === workflowRouteStops.length - 1}
                                  onClick={() => moveTripRouteStop(workflowTrip, stop.id, 1)}
                                  type="button"
                                >
                                  ↓
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-950">
                        {logisticsRouteBrief(
                          workflowTrip,
                          workflowDriver?.fullName || "",
                          workflowVehicle?.plate || "",
                        )}
                      </pre>
                      <button
                        className="mt-3 rounded-lg border border-emerald-700 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800"
                        onClick={() => {
                          void copyLogisticsText(
                            logisticsRouteBrief(
                              workflowTrip,
                              workflowDriver?.fullName || "",
                              workflowVehicle?.plate || "",
                            ),
                            "Mensagem de rota copiada para o grupo.",
                          );
                          markTripCommunication(workflowTrip.id, "route");
                        }}
                        type="button"
                      >
                        {workflowTrip.routeGroupSentAt
                          ? "Mensagem preparada"
                          : "Copiar mensagem da rota"}
                      </button>
                    </article>

                    <article className="order-5 rounded-xl border border-emerald-200 bg-white p-4">
                      <h5 className="font-semibold text-emerald-950">
                        7. Emissão de receitas
                      </h5>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        A prévia abaixo usa somente as receitas registradas.
                        Produtos dispensados não entram no e-mail. Complete cada
                        destino, produto, cultura, alvo e dose antes de gerar o
                        arquivo para o agrônomo.
                      </p>
                      <p className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                        Assunto: {logisticsRecipeEmailSubject(
                          workflowTrip,
                          workflowDriver?.fullName || "Motorista não informado",
                        )}
                      </p>
                      <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-emerald-100 bg-white">
                        <table className="min-w-full text-left text-xs text-slate-700">
                          <thead className="sticky top-0 bg-emerald-800 text-[10px] uppercase tracking-wide text-white">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Fazenda destino</th>
                              <th className="px-3 py-2 font-semibold">Produto</th>
                              <th className="px-3 py-2 text-right font-semibold">Volume</th>
                              <th className="px-3 py-2 font-semibold">Cultura</th>
                              <th className="px-3 py-2 font-semibold">Alvo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-50">
                            {logisticsRecipeRequestRows(workflowTrip).length ? (
                              logisticsRecipeRequestRows(workflowTrip).map((row) => (
                                <tr key={`${row.destination}-${row.product}-${row.culture}-${row.target}`}>
                                  <td className="px-3 py-2 font-medium text-slate-900">{row.destination}</td>
                                  <td className="px-3 py-2">{row.product}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.quantity)} {row.unit}</td>
                                  <td className="px-3 py-2">{row.culture}</td>
                                  <td className="px-3 py-2">{row.target}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td className="px-3 py-3 text-slate-500" colSpan={5}>
                                  Nenhuma receita registrada para esta viagem.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border border-emerald-700 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45"
                          disabled={Boolean(logisticsPendingRecipeOptions(workflowTrip).length)}
                          onClick={() => downloadRecipeEmail(workflowTrip)}
                          type="button"
                        >
                          {workflowTrip.recipeRequestSentAt
                            ? "E-mail .eml gerado"
                            : "Gerar e-mail .eml"}
                        </button>
                        <button
                          className="rounded-lg border border-emerald-700 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800"
                          onClick={() => {
                            const firstItem = logisticsPendingRecipeOptions(
                              workflowTrip,
                            )[0];
                            setRecipeTripId(workflowTrip.id);
                            setRecipeDraft({
                              culture: firstItem?.culture || "",
                              destination:
                                firstItem?.destination || workflowTrip.destination,
                              dose: "",
                              product: firstItem?.product || workflowTrip.product,
                              target: "",
                              volume: firstItem?.available || workflowTrip.quantity,
                            });
                          }}
                          type="button"
                        >
                          Registrar receita
                        </button>
                        {logisticsPendingRecipeOptions(workflowTrip).length ? (
                          <span className="self-center text-xs font-semibold text-amber-800">
                            {logisticsPendingRecipeOptions(workflowTrip).length} produto(s) ainda precisam de receita ou dispensa.
                          </span>
                        ) : null}
                      </div>
                    </article>
                  </div>
                </section>
              ) : null}
              {invoiceTrip ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-amber-950">
                        Vincular volume, lotes e NF
                      </h4>
                      <p className="mt-1 text-xs text-amber-900">
                        Viagem {invoiceTrip.id.replace("viagem-", "")} · inclua
                        os lotes e a nota fiscal de cada volume vinculado.
                      </p>
                    </div>
                    <button
                      className="text-xs font-bold text-slate-600"
                      onClick={() => setInvoiceTripId("")}
                      type="button"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1 text-sm font-semibold text-amber-950">
                      Bloco fiscal: destino + responsável (AG)
                      <select
                        className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) => {
                          setInvoiceBatchKey(event.target.value);
                          setFiscalLinkDraft({ lineKey: "", quantity: "", sapLot: "" });
                          setTripInvoiceDraft("");
                          setEditingFiscalAllocationId("");
                        }}
                        value={invoiceBatchKey}
                      >
                        {logisticsTripFiscalBatches(invoiceTrip).map((batch) => (
                          <option key={batch.id} value={batch.id}>
                            {batch.destination} · {batch.responsibleName} · {batch.items.length} item(ns)
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-amber-950">
                      {(() => {
                        const batch = logisticsTripFiscalBatches(invoiceTrip).find(
                          (item) => item.id === invoiceBatchKey,
                        );
                        return batch ? (
                          <>
                            <strong>
                              {formatNumber(invoiceFiscalBatchAllocated)} de {formatNumber(invoiceFiscalBatchTotal)}
                              {" "}consumido(s) neste bloco.
                            </strong>
                            <br />
                            {invoiceFiscalBatchComplete
                              ? "Volume completo. Use Editar para conferir lotes e informar a NF."
                              : "Selecione a linha WebAgil e o item da viagem que recebe o volume."}
                          </>
                        ) : (
                          "Selecione o bloco fiscal para registrar as notas."
                        );
                      })()}
                    </div>
                  </div>
                  {!invoiceFiscalBatchComplete || editingFiscalAllocationId ? (
                    <>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="grid gap-1 text-sm font-semibold text-amber-950 md:col-span-2">
                      Linha WebAgil e item da viagem
                      <select
                        className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 font-normal"
                        disabled={!invoiceFiscalCandidates.length}
                        onChange={(event) => {
                          const candidate = invoiceFiscalCandidates.find(
                            (item) => item.key === event.target.value,
                          );
                          setFiscalLinkDraft({
                            lineKey: event.target.value,
                            quantity: candidate
                              ? String(candidate.available)
                              : "",
                            sapLot: candidate ? resolveFiscalLot(candidate.line, candidate.item).sapLot : "",
                          });
                          setTripInvoiceDraft(candidate?.line.invoiceNumber || "");
                        }}
                        value={fiscalLinkDraft.lineKey}
                      >
                        <option value="">
                          {invoiceFiscalCandidates.length
                            ? "Selecione a solicitação e o material"
                            : "Nenhuma linha conciliada disponível"}
                        </option>
                        {invoiceFiscalCandidates.map((candidate) => (
                          <option
                            disabled={candidate.available <= 0}
                            key={candidate.key}
                            value={candidate.key}
                          >
                            {candidate.request.requestNumber} · {candidate.line.product} · lote {candidate.line.lot || "—"} · pedido {candidate.item.requestId} · {formatNumber(candidate.available)} {candidate.line.unit || candidate.item.unit} disponíveis
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-amber-950">
                      Volume vinculado
                      <input
                        className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 font-normal"
                        disabled={!selectedFiscalCandidate}
                        inputMode="decimal"
                        onChange={(event) =>
                          setFiscalLinkDraft((current) => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                        value={fiscalLinkDraft.quantity}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-amber-950">
                      Lote SAP
                      <input
                        className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 font-normal"
                        disabled={!selectedFiscalCandidate}
                        onChange={(event) => setFiscalLinkDraft((current) => ({ ...current, sapLot: event.target.value }))}
                        placeholder="Informe se não houver correspondência"
                        value={fiscalLinkDraft.sapLot}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-amber-950">
                      NF ou retorno físico
                    <input
                      className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm font-normal"
                      disabled={!selectedFiscalCandidate}
                      onChange={(event) =>
                        setTripInvoiceDraft(event.target.value)
                      }
                      placeholder="Pode preencher depois"
                      value={tripInvoiceDraft}
                    />
                    </label>
                    <button
                      className="self-end rounded-xl border border-amber-700 bg-white px-4 py-2.5 text-sm font-bold text-amber-900 disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={!selectedFiscalCandidate}
                      onClick={attachTripInvoices}
                      type="button"
                    >
                      {editingFiscalAllocationId
                        ? "Salvar edição"
                        : "Salvar vínculo"}
                    </button>
                  </div>
                  {selectedFiscalCandidate ? (
                    <p className="mt-3 text-xs text-amber-900">
                      Solicitação {selectedFiscalCandidate.request.requestNumber}
                      {" · "}{selectedFiscalCandidate.line.product}
                      {" · Lote Bravo "}{selectedFiscalCandidate.line.lot || "ausente na solicitação"}
                      {" · "}saldo conciliado {formatNumber(selectedFiscalCandidate.available)} {selectedFiscalCandidate.line.unit || selectedFiscalCandidate.item.unit}.
                    </p>
                  ) : null}
                  {editingFiscalAllocationId ? (
                    <button
                      className="mt-2 text-xs font-bold text-amber-900 underline"
                      onClick={() => {
                        setEditingFiscalAllocationId("");
                        setFiscalLinkDraft({ lineKey: "", quantity: "", sapLot: "" });
                        setTripInvoiceDraft("");
                      }}
                      type="button"
                    >
                      Cancelar edição do vínculo
                    </button>
                  ) : null}
                    </>
                  ) : (
                    <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-950">
                      <strong>Todo o volume do bloco está vinculado.</strong> Use <strong>Editar</strong> para preencher a NF ou revisar os lotes.
                    </p>
                  )}
                  <div className="mt-4 space-y-2">
                    {invoiceFiscalAllocations.map((allocation) => {
                      const request = webAgilRequests.find(
                        (item) => item.id === allocation.requestId,
                      );
                      const line = fiscalRequestLineFor(allocation, webAgilRequests);
                      return (
                        <article
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm"
                          key={allocation.id}
                        >
                          <div>
                            <p className="font-bold text-amber-950">
                              {allocation.invoiceNumber || "NF pendente"}
                            </p>
                            <p className="mt-0.5 text-xs text-amber-900">
                              Solicitação WebAgil{" "}
                              <strong>
                                {request?.requestNumber ||
                                  allocation.requestId}
                              </strong>
                              {" · "}
                              {line?.product || "Material não identificado"}
                              {" · "}
                              <strong>
                                {formatNumber(allocation.quantity)} {line?.unit || "UN"}
                              </strong>
                              {" · Lote Bravo "}{line?.lot || "a conferir"}
                              {" · Lote SAP "}{allocation.sapLot || "a conferir"}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="rounded-lg border border-amber-700 px-3 py-1.5 text-xs font-bold text-amber-900"
                              onClick={() =>
                                editTripFiscalAllocation(
                                  invoiceTrip,
                                  allocation,
                                )
                              }
                              type="button"
                            >
                              Editar
                            </button>
                            <button
                              className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700"
                              onClick={() =>
                                removeTripFiscalAllocation(
                                  invoiceTrip.id,
                                  allocation.id,
                                )
                              }
                              type="button"
                            >
                              Excluir
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {!invoiceFiscalAllocations.length &&
                    !invoiceNumbersWithoutAllocation.length ? (
                      <p className="text-sm text-amber-900">
                        Nenhum volume WebAgil vinculado neste bloco.
                      </p>
                    ) : null}
                    {invoiceNumbersWithoutAllocation.length ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {invoiceNumbersWithoutAllocation.map((invoice) => (
                          <span
                            className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-amber-900"
                            key={invoice}
                          >
                            NF {invoice} · sem volume vinculado
                            <button
                              aria-label={`Remover nota ${invoice}`}
                              onClick={() =>
                                removeTripInvoice(invoiceTrip.id, invoice)
                              }
                              type="button"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {appointmentTrip ? (
                <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-violet-950">
                        Registrar agendamento WebAgil
                      </h4>
                      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-violet-900">
                        No WebAgil, vincule as solicitações desta viagem ao mesmo
                        agendamento de carga. Depois, informe aqui o número gerado.
                        Um agendamento pode conter várias solicitações, mas pertence
                        a uma única viagem no AgroNexus.
                      </p>
                    </div>
                    <button
                      className="text-xs font-bold text-slate-600"
                      onClick={() => setAppointmentTripId("")}
                      type="button"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="grid gap-1 text-sm font-semibold text-violet-950">
                      Número do agendamento de carga
                      <input
                        className="rounded-xl border border-violet-200 bg-white px-3 py-2.5 font-normal"
                        inputMode="numeric"
                        maxLength={7}
                        onChange={(event) =>
                          setAppointmentDraft(
                            event.target.value.replace(/\D/g, "").slice(0, 7),
                          )
                        }
                        placeholder="7 dígitos · Ex.: 2969014"
                        value={appointmentDraft}
                      />
                    </label>
                    <button
                      className="self-end rounded-xl border border-violet-700 bg-white px-4 py-2.5 text-sm font-bold text-violet-800"
                      onClick={saveTripAppointment}
                      type="button"
                    >
                      Salvar agendamento
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-violet-900">
                    Solicitações WebAgil vinculadas: {appointmentTrip.webRequestIds?.length || 0}.
                    {!appointmentTrip.webRequestIds?.length
                      ? " Vincule pelo menos uma antes de salvar o agendamento."
                      : ""}
                  </p>
                </section>
              ) : null}
              {recipeTrip ? (
                <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-sky-950">
                        Vincular receitas após a emissão
                      </h4>
                      <p className="mt-1 text-xs text-sky-900">
                        Uma viagem pode atender várias receitas. Registre cada
                        destino, produto e recomendação separadamente.
                      </p>
                    </div>
                    <button
                      className="text-xs font-bold text-slate-600"
                      onClick={() => setRecipeTripId("")}
                      type="button"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <label className="grid gap-1 text-sm font-semibold text-slate-700 xl:col-span-2">
                      Fazenda destino + produto carregado
                      <select
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) => {
                          const selected = recipeOptions.find(
                            (option) => option.id === event.target.value,
                          );
                          setRecipeDraft((current) =>
                            selected
                              ? {
                                  ...current,
                                  culture: selected.culture || current.culture,
                                  destination: selected.destination,
                                  product: selected.product,
                                  volume: selected.available,
                                }
                              : {
                                  ...current,
                                  culture: "",
                                  destination: "",
                                  product: "",
                                  volume: 0,
                                },
                          );
                        }}
                        value={selectedRecipeOption?.id || ""}
                      >
                        <option value="">Selecione o destino e produto da carga</option>
                        {selectableRecipeOptions.map((option) => (
                          <option
                            disabled={option.available <= 0}
                            key={option.id}
                            value={option.id}
                          >
                            {option.product} — {option.destination} · disponível {formatNumber(option.available)} {option.unit}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Volume
                      <input
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        inputMode="decimal"
                        onChange={(event) =>
                          setRecipeDraft((current) => ({
                            ...current,
                            volume: numberFrom(event.target.value),
                          }))
                        }
                        value={recipeDraft.volume || ""}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Cultura
                      <input
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setRecipeDraft((current) => ({
                            ...current,
                            culture: event.target.value,
                          }))
                        }
                        placeholder="Ex.: Soja"
                        value={recipeDraft.culture}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Alvo
                      <input
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setRecipeDraft((current) => ({
                            ...current,
                            target: event.target.value,
                          }))
                        }
                        placeholder="Ex.: Mancha-alvo"
                        value={recipeDraft.target}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Dose
                      <input
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setRecipeDraft((current) => ({
                            ...current,
                            dose: event.target.value,
                          }))
                        }
                        placeholder="Ex.: 0,50 L/ha"
                        value={recipeDraft.dose}
                      />
                    </label>
                  </div>
                  {selectedRecipeOption ? (
                    <p className="mt-3 rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs text-sky-900">
                      Carga para receita: <strong>{formatNumber(selectedRecipeOption.total)} {selectedRecipeOption.unit}</strong>
                      {selectedRecipeOption.allocated
                        ? ` · já vinculado: ${formatNumber(selectedRecipeOption.allocated)} ${selectedRecipeOption.unit}`
                        : ""}
                      {` · saldo disponível: ${formatNumber(selectedRecipeOption.available)} ${selectedRecipeOption.unit}.`}
                      O volume sugerido pode ser alterado para uma receita parcial.
                    </p>
                  ) : null}
                  <div className="mt-4 flex justify-end">
                    <button
                      className="mr-3 rounded-xl border border-slate-400 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={!selectedRecipeOption}
                      onClick={exemptTripRecipeOption}
                      type="button"
                    >
                      Produto não possui necessidade de receita
                    </button>
                    <button
                      className="rounded-xl border border-sky-700 bg-white px-4 py-2.5 text-sm font-bold text-sky-800"
                      onClick={attachTripRecipe}
                      type="button"
                    >
                      Adicionar receita
                    </button>
                  </div>
                  <div className="mt-4 divide-y divide-sky-100 rounded-xl bg-white">
                    {logisticsTripRecipes(recipeTrip).map((recipe) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm"
                        key={recipe.id}
                      >
                        <span>
                          <strong>{recipe.destination}</strong> ·{" "}
                          {recipe.product} · {formatNumber(recipe.volume)} {recipe.unit || ""} ·{" "}
                          {recipe.culture} · {recipe.target} · {recipe.dose}
                        </span>
                        <button
                          className="text-xs font-bold text-rose-700"
                          onClick={() =>
                            removeTripRecipe(recipeTrip.id, recipe.id || "")
                          }
                          type="button"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                    {!logisticsTripRecipes(recipeTrip).length ? (
                      <p className="px-3 py-4 text-sm text-slate-500">
                        Nenhuma receita vinculada à viagem.
                      </p>
                    ) : null}
                    {(recipeTrip.recipeExemptions || []).map((exemption) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm text-slate-600"
                        key={exemption.id}
                      >
                        <span>
                          <strong>{exemption.destination}</strong> · {exemption.product}
                          {" · "}<em>sem necessidade de receita</em>
                        </span>
                        <button
                          className="text-xs font-bold text-sky-700"
                          onClick={() =>
                            removeTripRecipeExemption(
                              recipeTrip.id,
                              exemption.id,
                            )
                          }
                          type="button"
                        >
                          Reativar
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              <section
                className="rounded-2xl border border-sky-200 bg-sky-50 p-5"
                id="logistics-webagil-links"
              >
                <div>
                  <h4 className="font-semibold text-sky-950">
                    Vincular solicitação WebAgil após a rota
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-sky-900">
                    Após criar a rota pelos pedidos SAP, associe aqui uma ou
                    mais solicitações processadas no WebAgil. Cada solicitação
                    só pode ser vinculada a uma única viagem. Esse vínculo é
                    posterior e não altera o planejamento da viagem.
                  </p>
                </div>
                {!datasets.solicitacoesWeb.length ? (
                  <p className="mt-4 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-sky-900">
                    Importe a Relação de solicitação webAgil quando ela estiver
                    disponível para concluir os vínculos pós-rota.
                  </p>
                ) : logistics.trips.length ? (
                  <div className="mt-4 space-y-3">
                    {logistics.trips.map((trip) => {
                      const linkedWeb = (trip.webRequestIds || [])
                        .map((id) =>
                          webAgilRequests.find((request) => request.id === id),
                        )
                        .filter((request): request is LogisticsRequest =>
                          Boolean(request),
                        );
                      const sapOrders = [
                        ...new Set(
                          logisticsTripItems(trip).map(
                            (item) => item.requestId,
                          ),
                        ),
                      ];
                      return (
                        <article
                          className="rounded-xl border border-sky-200 bg-white p-4"
                          key={`${trip.id}-web-link`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">
                                Viagem {trip.id.replace("viagem-", "")}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                Pedidos SAP: {sapOrders.join(", ")} · NF{" "}
                                {logisticsTripInvoices(trip).join(", ") ||
                                  "pendente"}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {linkedWeb.length ? (
                                  linkedWeb.map((request) => (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800"
                                      key={request.id}
                                    >
                                      WebAgil {request.requestNumber}
                                      <button
                                        aria-label={`Remover solicitação ${request.requestNumber}`}
                                        className="ml-1 text-sky-700"
                                        onClick={() =>
                                          unlinkWebAgilRequest(
                                            trip.id,
                                            request.id,
                                          )
                                        }
                                        type="button"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    Nenhuma solicitação WebAgil vinculada.
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="grid min-w-[260px] gap-2 sm:grid-cols-[1fr_auto]">
                              <select
                                aria-label={`Solicitação WebAgil para viagem ${trip.id}`}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                onChange={(event) =>
                                  setWebLinkDrafts((current) => ({
                                    ...current,
                                    [trip.id]: event.target.value,
                                  }))
                                }
                                value={webLinkDrafts[trip.id] || ""}
                              >
                                <option value="">
                                  Selecione a solicitação WebAgil
                                </option>
                                {webAgilRequests
                                  .filter(
                                    (request) =>
                                      !linkedWebRequestIds.has(request.id),
                                  )
                                  .map((request) => (
                                  <option key={request.id} value={request.id}>
                                    {request.requestNumber} ·{" "}
                                    {request.destination ||
                                      "Destino não informado"}
                                  </option>
                                  ))}
                              </select>
                              <button
                                className="rounded-lg border border-sky-700 px-3 py-2 text-sm font-bold text-sky-800 disabled:opacity-50"
                                disabled={!webLinkDrafts[trip.id]}
                                onClick={() => linkWebAgilRequest(trip.id)}
                                type="button"
                              >
                                Vincular
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-sky-900">
                    Emita uma viagem para liberar o vínculo posterior com o
                    WebAgil.
                  </p>
                )}
              </section>
            </section>
          ) : null}

          {logisticsTab === "rodoviaria" ? (
            <section className="grid gap-5 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Motoristas</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Cadastre nome completo e CPF. A vinculação padrão é
                      definida no veículo.
                    </p>
                  </div>
                  {editingDriverId ? (
                    <button
                      className="text-xs font-bold text-slate-600"
                      onClick={() => {
                        setEditingDriverId("");
                        setDriverDraft({ cpf: "", fullName: "", phone: "" });
                      }}
                      type="button"
                    >
                      Cancelar edição
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Nome completo
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                      onChange={(event) =>
                        setDriverDraft((current) => ({
                          ...current,
                          fullName: event.target.value,
                        }))
                      }
                      value={driverDraft.fullName}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      CPF
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        inputMode="numeric"
                        onChange={(event) =>
                          setDriverDraft((current) => ({
                            ...current,
                            cpf: event.target.value,
                          }))
                        }
                        placeholder="Somente números"
                        value={driverDraft.cpf}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Telefone (opcional)
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setDriverDraft((current) => ({
                            ...current,
                            phone: event.target.value,
                          }))
                        }
                        value={driverDraft.phone}
                      />
                    </label>
                  </div>
                  <button
                    className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white"
                    onClick={addRoadDriver}
                    type="button"
                  >
                    {editingDriverId
                      ? "Salvar motorista"
                      : "Cadastrar motorista"}
                  </button>
                </div>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <Table
                    empty="Nenhum motorista cadastrado."
                    headers={["Motorista", "CPF", "Telefone", "Ações"]}
                    rows={logistics.drivers.map((driver) => [
                      driver.fullName,
                      driver.cpf,
                      driver.phone || "—",
                      <span className="flex gap-3" key={driver.id}>
                        <button
                          className="text-xs font-bold text-emerald-700"
                          onClick={() => editRoadDriver(driver)}
                          type="button"
                        >
                          Editar
                        </button>
                        <button
                          className="text-xs font-bold text-rose-700"
                          onClick={() => removeRoadDriver(driver)}
                          type="button"
                        >
                          Excluir
                        </button>
                      </span>,
                    ])}
                  />
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Veículos</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Informe limites de peso, paletes, rastreador e o motorista
                      geralmente vinculado à placa.
                    </p>
                  </div>
                  {editingVehicleId ? (
                    <button
                      className="text-xs font-bold text-slate-600"
                      onClick={() => {
                        setEditingVehicleId("");
                        setVehicleDraft({
                          capacity: "",
                          defaultDriverId: "",
                          model: "",
                          ownership: "interno",
                          palletCapacity: "",
                          plate: "",
                          trackerNumber: "",
                        });
                      }}
                      type="button"
                    >
                      Cancelar edição
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Placa
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal uppercase"
                      onChange={(event) =>
                        setVehicleDraft((current) => ({
                          ...current,
                          plate: event.target.value,
                        }))
                      }
                      placeholder="ABC1D23"
                      value={vehicleDraft.plate}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Modelo
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
                        }
                        placeholder="Ex.: Bitruck"
                        value={vehicleDraft.model}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Tipo
                      <select
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            ownership: event.target.value as
                              | "interno"
                              | "terceiro",
                          }))
                        }
                        value={vehicleDraft.ownership}
                      >
                        <option value="interno">Veículo interno</option>
                        <option value="terceiro">Terceiro</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Capacidade (kg)
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        inputMode="decimal"
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            capacity: event.target.value,
                          }))
                        }
                        placeholder="Ex.: 15000"
                        value={vehicleDraft.capacity}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Capacidade (paletes)
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        inputMode="decimal"
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            palletCapacity: event.target.value,
                          }))
                        }
                        placeholder="Ex.: 24"
                        value={vehicleDraft.palletCapacity}
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Isca / rastreador
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            trackerNumber: event.target.value,
                          }))
                        }
                        placeholder="Nº da isca"
                        value={vehicleDraft.trackerNumber}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Motorista vinculado
                      <select
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            defaultDriverId: event.target.value,
                          }))
                        }
                        value={vehicleDraft.defaultDriverId}
                      >
                        <option value="">Selecionar depois</option>
                        {logistics.drivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.fullName}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white"
                    onClick={addRoadVehicle}
                    type="button"
                  >
                    {editingVehicleId ? "Salvar veículo" : "Cadastrar veículo"}
                  </button>
                </div>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <Table
                    empty="Nenhum veículo cadastrado."
                    headers={[
                      "Placa / tipo",
                      "Modelo",
                      "Capacidade",
                      "Motorista / rastreador",
                      "Ações",
                    ]}
                    rows={logistics.vehicles.map((vehicle) => {
                      const driver = logistics.drivers.find(
                        (item) => item.id === vehicle.defaultDriverId,
                      );
                      return [
                        <span
                          key={`${vehicle.id}-plate`}
                          className="font-semibold"
                        >
                          {vehicle.plate}
                          <br />
                          <small className="font-normal text-slate-500">
                            {vehicle.ownership === "terceiro"
                              ? "Terceiro"
                              : "Interno"}
                          </small>
                        </span>,
                        vehicle.model,
                        `${formatNumber(vehicle.capacity)} kg${vehicle.palletCapacity ? ` · ${formatNumber(vehicle.palletCapacity)} paletes` : ""}`,
                        <span key={`${vehicle.id}-driver`}>
                          {driver?.fullName || "Sem motorista padrão"}
                          <br />
                          <small className="text-slate-500">
                            {vehicle.trackerNumber
                              ? `Isca ${vehicle.trackerNumber}`
                              : "Sem isca"}
                          </small>
                        </span>,
                        <span className="flex gap-3" key={vehicle.id}>
                          <button
                            className="text-xs font-bold text-emerald-700"
                            onClick={() => editRoadVehicle(vehicle)}
                            type="button"
                          >
                            Editar
                          </button>
                          <button
                            className="text-xs font-bold text-rose-700"
                            onClick={() => removeRoadVehicle(vehicle)}
                            type="button"
                          >
                            Excluir
                          </button>
                        </span>,
                      ];
                    })}
                  />
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Premissas de rota</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Selecione uma opção disponível de centro, armazém ou
                      núcleo. Links do Google Maps são convertidos em coordenadas
                      para a rota, sem usar a URL curta como endereço.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <button
                      className="text-xs font-bold text-sky-700 disabled:opacity-50"
                      disabled={isResolvingLocation}
                      onClick={() => void resolveStoredRouteLinks()}
                      type="button"
                    >
                      Converter links cadastrados
                    </button>
                    {editingLocationKey ? (
                      <button
                        className="text-xs font-bold text-slate-600"
                        onClick={() => {
                          setEditingLocationKey("");
                          setLocationResolution("");
                          setLocationDraft({
                            addressUrl: "",
                            location: "",
                            municipality: "",
                          });
                        }}
                        type="button"
                      >
                        Cancelar edição
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto]">
                  <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                    Centro, armazém ou núcleo
                    <select
                      className="min-w-0 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                      onChange={(event) =>
                        setLocationDraft((current) => ({
                          ...current,
                          location: event.target.value,
                        }))
                      }
                      value={locationDraft.location}
                    >
                      <option value="">Selecione uma opção</option>
                      {routeLocationOptions.map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                    Município
                    <input
                      className="min-w-0 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                      onChange={(event) =>
                        setLocationDraft((current) => ({
                          ...current,
                          municipality: event.target.value,
                        }))
                      }
                      placeholder="Ex.: Sorriso - MT"
                      value={locationDraft.municipality}
                    />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                    Link do Google Maps
                    <input
                      className="min-w-0 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                      onChange={(event) =>
                        setLocationDraft((current) => ({
                          ...current,
                          addressUrl: event.target.value,
                        }))
                      }
                      placeholder="https://maps.app.goo.gl/..."
                      type="url"
                      value={locationDraft.addressUrl}
                    />
                  </label>
                  <button
                    className="min-w-[190px] self-end whitespace-nowrap rounded-xl border border-emerald-700 px-4 py-2.5 text-sm font-bold text-emerald-700 disabled:opacity-50"
                    disabled={isResolvingLocation}
                    onClick={() => void addLogisticsLocation()}
                    type="button"
                  >
                    {isResolvingLocation
                      ? "Convertendo…"
                      : editingLocationKey
                      ? "Salvar premissa"
                      : "Vincular premissa"}
                  </button>
                </div>
                {locationResolution ? (
                  <p className="mt-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    {locationResolution}
                  </p>
                ) : null}
                <div className="mt-5">
                  <Table
                    empty="Nenhuma premissa de rota cadastrada."
                    headers={[
                      "Centro / armazém / núcleo",
                      "Município",
                      "Endereço",
                      "Ações",
                    ]}
                    rows={[
                      ...new Set([
                        ...Object.keys(logistics.municipalityByLocation || {}),
                        ...Object.keys(logistics.addressByLocation || {}),
                        ...Object.keys(logistics.addressSourceUrlByLocation || {}),
                      ]),
                    ]
                      .sort((left, right) => left.localeCompare(right))
                      .map((location) => [
                        location,
                        logistics.municipalityByLocation?.[location] || "—",
                        logistics.addressByLocation?.[location] ? (
                          <a
                            className="text-xs font-bold text-sky-700"
                            href={
                              logistics.addressSourceUrlByLocation?.[location] ||
                              googleMapsSearchUrl(
                                logistics.addressByLocation[location],
                              )
                            }
                            key={`${location}-map`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Abrir mapa
                          </a>
                        ) : (
                          "—"
                        ),
                        <span
                          className="flex gap-3"
                          key={`${location}-actions`}
                        >
                          <button
                            className="text-xs font-bold text-emerald-700"
                            onClick={() => editLogisticsLocation(location)}
                            type="button"
                          >
                            Editar
                          </button>
                          <button
                            className="text-xs font-bold text-rose-700"
                            onClick={() => removeLogisticsLocation(location)}
                            type="button"
                          >
                            Excluir
                          </button>
                        </span>,
                      ])}
                  />
                </div>
              </section>
            </section>
          ) : null}
        </section>
      ) : (
        <section className="space-y-5">
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[.12em] text-emerald-700">
              Logística operacional
            </p>
            <h2 className="mt-1 text-xl font-bold text-emerald-950">
              Rotas ativas em trânsito
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-emerald-900">
              Acompanhe as rotas ativas e os volumes destinados a cada fazenda.
              Esta visão é somente leitura e não expõe valores da carga.
            </p>
          </section>
          {logistics.trips
            .filter((trip) => trip.status === "Rota ativa")
            .sort((left, right) =>
              logisticsTripDate(left).localeCompare(logisticsTripDate(right)),
            )
            .map((trip) => {
              const driver = logistics.drivers.find(
                (item) => item.id === trip.driverId,
              );
              const vehicle = logistics.vehicles.find(
                (item) => item.id === trip.vehicleId,
              );
              const deliveries = logisticsTripDeliverySummary(trip);
              return (
                <article
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                  key={trip.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-950">
                        Rota de {new Intl.DateTimeFormat("pt-BR").format(
                          new Date(`${logisticsTripDate(trip)}T00:00:00`),
                        )}
                        {trip.departureTime ? ` · saída ${trip.departureTime}` : ""}
                      </h3>
                      <p className="mt-1 text-xs text-slate-600">
                        {driver?.fullName || "Motorista não informado"}
                        {vehicle?.plate ? ` · ${vehicle.plate}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                      Rota ativa
                    </span>
                  </div>
                  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold">Fazenda destino</th>
                          <th className="px-3 py-2.5 font-semibold">Produto</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Volume</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {deliveries.map((delivery) => (
                          <tr key={`${delivery.destination}-${delivery.product}-${delivery.unit}`}>
                            <td className="px-3 py-2.5 font-medium text-slate-900">{delivery.destination}</td>
                            <td className="px-3 py-2.5">{delivery.product}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(delivery.quantity)} {delivery.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          {!logistics.trips.some((trip) => trip.status === "Rota ativa") ? (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Não há rotas ativas em trânsito no momento.
            </section>
          ) : null}
        </section>
      );
  } else if (active === "Usuários") {
    content =
      currentUser?.role === "admin" ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                Administração de acesso
              </p>
              <h2 className="mt-1 text-xl font-bold text-emerald-950">
                Usuários da plataforma
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-emerald-900">
                Crie e mantenha as contas que acessam a base central. Apenas
                administradores podem gerenciar usuários.
              </p>
            </div>
            <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
              <p className="text-xs font-semibold text-slate-500">Sua sessão</p>
              <p className="mt-1 text-sm font-bold text-slate-800">
                {currentUser.name}
              </p>
              <p className="text-xs text-emerald-700">Administrador</p>
            </div>
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="font-semibold">Contas cadastradas</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {managedUsers.length} usuário(s) com acesso ao AgroNexus.
                  </p>
                </div>
                <button
                  className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50"
                  disabled={userManagerLoading}
                  onClick={() => void loadManagedUsers()}
                  type="button"
                >
                  Atualizar
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Usuário</th>
                      <th className="px-4 py-3 font-semibold">Login</th>
                      <th className="px-4 py-3 font-semibold">Perfil</th>
                      <th className="px-4 py-3 font-semibold">Criado em</th>
                      <th className="px-5 py-3 text-right font-semibold">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {managedUsers.map((user) => (
                      <tr key={user.id}>
                        <td className="px-5 py-4 font-semibold text-slate-800">
                          {user.name}
                          {user.id === currentUser.id ? (
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              VOCÊ
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-slate-600">
                          {user.username}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-bold",
                              user.role === "admin"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-700",
                            )}
                          >
                            {user.role === "admin"
                              ? "Administrador"
                              : "Operador"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500">
                          {formatDateTime(user.createdAt)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="inline-flex gap-2">
                            <button
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
                              onClick={() => editManagedUser(user)}
                              type="button"
                            >
                              Editar
                            </button>
                            <button
                              className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-40"
                              disabled={
                                user.id === currentUser.id || userManagerLoading
                              }
                              onClick={() => void removeManagedUser(user)}
                              type="button"
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!managedUsers.length && !userManagerLoading ? (
                      <tr>
                        <td
                          className="px-5 py-12 text-center text-sm text-slate-500"
                          colSpan={5}
                        >
                          Nenhum usuário encontrado.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
            <form
              className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              onSubmit={saveManagedUser}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {userDraft.id ? "Editar usuário" : "Nova conta"}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {userDraft.id
                      ? "Deixe a senha em branco para mantê-la."
                      : "Defina uma senha inicial para liberar o acesso."}
                  </p>
                </div>
                {userDraft.id ? (
                  <button
                    className="text-xs font-bold text-slate-500"
                    onClick={() => setUserDraft(emptyUserDraft)}
                    type="button"
                  >
                    Cancelar
                  </button>
                ) : null}
              </div>
              <div className="mt-5 grid gap-3">
                <label className="grid gap-1.5 text-xs font-bold text-slate-600">
                  Nome
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                    onChange={(event) =>
                      setUserDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Nome completo"
                    required
                    value={userDraft.name}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-bold text-slate-600">
                  Login
                  <input
                    autoCapitalize="none"
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                    onChange={(event) =>
                      setUserDraft((current) => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                    placeholder="nome.sobrenome"
                    required
                    value={userDraft.username}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-bold text-slate-600">
                  Perfil
                  <select
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                    onChange={(event) =>
                      setUserDraft((current) => ({
                        ...current,
                        role: event.target.value as UserDraft["role"],
                      }))
                    }
                    value={userDraft.role}
                  >
                    <option value="viewer">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-bold text-slate-600">
                  {userDraft.id ? "Nova senha (opcional)" : "Senha inicial"}
                  <input
                    autoComplete="new-password"
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                    minLength={6}
                    onChange={(event) =>
                      setUserDraft((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    placeholder={
                      userDraft.id
                        ? "Manter senha atual"
                        : "Mínimo de 6 caracteres"
                    }
                    required={!userDraft.id}
                    type="password"
                    value={userDraft.password}
                  />
                </label>
              </div>
              {userManagerMessage ? (
                <p
                  className={cn(
                    "mt-4 rounded-xl px-3 py-2 text-sm",
                    /atualizado|criado|excluído/i.test(userManagerMessage)
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-rose-50 text-rose-800",
                  )}
                >
                  {userManagerMessage}
                </p>
              ) : null}
              <button
                className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
                disabled={userManagerLoading}
                type="submit"
              >
                {userManagerLoading
                  ? "Salvando..."
                  : userDraft.id
                    ? "Salvar alterações"
                    : "Criar usuário"}
              </button>
            </form>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-950">Acesso restrito</h2>
          <p className="mt-2 text-sm text-amber-900">
            A administração de usuários está disponível apenas para o perfil
            administrador.
          </p>
        </section>
      );
  } else {
    content = (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="font-semibold">Configurações</h2>
          <p className="mt-2 text-sm text-slate-500">
            Padronize premissas e destinatários das notificações por núcleo.
          </p>
        </div>
        <div className="flex gap-2 border-b border-slate-100 px-6 pt-4">
          <button
            className={cn(
              "rounded-t-xl px-4 py-2 text-sm font-semibold",
              settingsTab === "premissas"
                ? "bg-emerald-50 text-emerald-800"
                : "text-slate-500",
            )}
            onClick={() => setSettingsTab("premissas")}
            type="button"
          >
            Premissas
          </button>
          <button
            className={cn(
              "rounded-t-xl px-4 py-2 text-sm font-semibold",
              settingsTab === "email"
                ? "bg-emerald-50 text-emerald-800"
                : "text-slate-500",
            )}
            onClick={() => setSettingsTab("email")}
            type="button"
          >
            E-mails por núcleo
          </button>
        </div>
        {settingsTab === "premissas" ? (
          <div className="p-6">
            <p className="text-sm text-slate-500">
              Ajuste dimensões, conversões e regras aplicadas às análises.
            </p>
            <button
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white"
              onClick={() => setShowPremises(true)}
              type="button"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Editar premissas
            </button>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
              <p className="font-semibold">Envio por domínio corporativo</p>
              <p className="mt-1 text-xs">
                Os destinatários abaixo são sugeridos no envio manual de
                alertas. Use endereços internos @agroboaesperanca.com.br,
                separados por vírgula.
              </p>
            </div>
            <label className="grid max-w-xl gap-1.5 text-sm font-medium">
              Cópia padrão (CC)
              <input
                className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                onChange={(event) =>
                  setEmailSettings((current) => ({
                    ...current,
                    defaultCopy: event.target.value,
                  }))
                }
                placeholder="planejamento@agroboaesperanca.com.br"
                value={emailSettings.defaultCopy}
              />
            </label>
            <div>
              <h3 className="text-sm font-semibold">
                Destinatário padrão por núcleo
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {taskNuclei
                  .filter((nucleus) => nucleus !== "Todos")
                  .map((nucleus) => (
                    <label
                      className="grid gap-1.5 text-sm font-medium"
                      key={nucleus}
                    >
                      {nucleus}
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setEmailSettings((current) => ({
                            ...current,
                            nucleusRecipients: {
                              ...current.nucleusRecipients,
                              [nucleus]: event.target.value,
                            },
                          }))
                        }
                        placeholder={`responsavel.${nucleus.toLowerCase()}@agroboaesperanca.com.br`}
                        value={emailSettings.nucleusRecipients[nucleus] || ""}
                      />
                    </label>
                  ))}
              </div>
              {taskNuclei.length === 1 ? (
                <p className="mt-3 text-sm text-slate-500">
                  Os núcleos aparecem após a importação de pedidos pendentes.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (active === "Tarefas") {
    const taskSignalStyle = {
      emerald: "bg-emerald-100 text-emerald-800",
      sky: "bg-sky-100 text-sky-800",
      amber: "bg-amber-100 text-amber-900",
      rose: "bg-rose-100 text-rose-800",
      slate: "bg-slate-100 text-slate-700",
    };
    content = (
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Farol e tarefas operacionais</h2>
            <p className="mt-1 text-sm text-slate-500">
              Registre responsáveis, decisões e próximos passos ligados a
              pedidos ou materiais.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700"
              onClick={() => void exportTasks()}
              type="button"
            >
              <Download className="h-4 w-4" />
              Exportar Excel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
              onClick={openNotification}
              type="button"
            >
              <Bell className="h-4 w-4" />
              Notificar por e-mail
            </button>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold">Histórico de ações</h3>
              <p className="mt-1 text-xs text-slate-500">
                As atualizações mais recentes aparecem primeiro.
              </p>
            </div>
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Exibir
              <select
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal"
                onChange={(event) => {
                  setTaskHistorySize(Number(event.target.value));
                  setTaskHistoryPage(0);
                }}
                value={taskHistorySize}
              >
                <option value={10}>10 registros</option>
                <option value={30}>30 registros</option>
                <option value={50}>50 registros</option>
              </select>
            </label>
          </div>
          <div className="mt-4 space-y-2">
            {paginatedTaskHistory.length ? (
              paginatedTaskHistory.map(({ task, ...action }) => (
                <article
                  className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                  key={action.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {task.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {action.note}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        {task.material || "Ação geral"}
                        {task.nucleus ? ` · ${task.nucleus}` : ""} ·{" "}
                        {task.owner || "Não atribuído"}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(action.createdAt)}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                Nenhuma ação registrada ainda.
              </p>
            )}
          </div>
          {taskHistory.length > taskHistorySize ? (
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600">
              <span>
                Página {safeTaskHistoryPage + 1} de {taskHistoryPages} ·{" "}
                {taskHistory.length} ações
              </span>
              <span className="flex gap-2">
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
                  disabled={safeTaskHistoryPage === 0}
                  onClick={() =>
                    setTaskHistoryPage((current) => Math.max(0, current - 1))
                  }
                  type="button"
                >
                  Anterior
                </button>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
                  disabled={safeTaskHistoryPage >= taskHistoryPages - 1}
                  onClick={() =>
                    setTaskHistoryPage((current) =>
                      Math.min(taskHistoryPages - 1, current + 1),
                    )
                  }
                  type="button"
                >
                  Próxima
                </button>
              </span>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold">Registrar ação do setor</h3>
          <p className="mt-1 text-xs text-slate-500">
            Vincule a ação a um pedido específico ou agrupe o acompanhamento por
            material.
          </p>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              Vincular por
              <select
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                onChange={(event) =>
                  setTaskLinkMode(event.target.value as "pedido" | "material")
                }
                value={taskLinkMode}
              >
                <option value="pedido">Pedido pendente</option>
                <option value="material">Material</option>
              </select>
            </label>
            {taskLinkMode === "pedido" ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Pedido
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  onChange={(event) => setTaskPendingId(event.target.value)}
                  value={taskPendingId}
                >
                  <option value="">Sem pedido vinculado</option>
                  {pendingSignals.map((signal) => (
                    <option key={signal.id} value={signal.id}>
                      {signal.reference} · {signal.material} · {signal.nucleus}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Material
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  onChange={(event) => setTaskMaterialLink(event.target.value)}
                  value={taskMaterialLink}
                >
                  <option value="">Selecione o material</option>
                  {taskMaterialOptions.map((material) => (
                    <option key={material}>{material}</option>
                  ))}
                </select>
              </label>
            )}
            <input
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Título da ação (opcional)"
              value={taskTitle}
            />
            <textarea
              className="min-h-28 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              onChange={(event) => setTaskNote(event.target.value)}
              placeholder="Descreva a ação, causa da falta e próximo passo."
              value={taskNote}
            />
            <button
              className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white"
              onClick={addLinkedTask}
              type="button"
            >
              Registrar no histórico
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold">Responsáveis e prazos</h3>
              <p className="mt-1 text-xs text-slate-500">
                Acompanhe a execução de cada tarefa aberta.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <span className="rounded-lg bg-sky-50 px-3 py-2 font-bold text-sky-800">
                {tasks.filter((task) => task.status === "Aberta").length}{" "}
                abertas
              </span>
              <span className="rounded-lg bg-amber-50 px-3 py-2 font-bold text-amber-800">
                {tasks.filter((task) => task.status === "Em andamento").length}{" "}
                em curso
              </span>
              <span className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-800">
                {tasks.filter((task) => task.status === "Concluída").length}{" "}
                concluídas
              </span>
            </div>
          </div>
          <div className="space-y-3">
            {tasks.length ? (
              tasks
                .slice()
                .reverse()
                .map((task) => (
                  <article
                    className="rounded-xl border border-slate-200 p-4"
                    key={task.id}
                  >
                    <div className="grid gap-3 lg:grid-cols-[minmax(200px,1.4fr)_minmax(130px,.7fr)_150px_160px]">
                      <div>
                        <p className="font-semibold text-slate-800">
                          {task.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {task.material || "Sem material"}
                          {task.nucleus ? ` · ${task.nucleus}` : ""}
                        </p>
                      </div>
                      <label className="grid gap-1 text-[11px] font-semibold text-slate-500">
                        Responsável
                        <input
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800"
                          onBlur={(event) =>
                            updateTask(task.id, { owner: event.target.value })
                          }
                          defaultValue={task.owner || ""}
                        />
                      </label>
                      <label className="grid gap-1 text-[11px] font-semibold text-slate-500">
                        Prazo
                        <input
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800"
                          onChange={(event) =>
                            updateTask(task.id, { dueDate: event.target.value })
                          }
                          type="date"
                          value={task.dueDate || ""}
                        />
                      </label>
                      <label className="grid gap-1 text-[11px] font-semibold text-slate-500">
                        Status
                        <select
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800"
                          onChange={(event) =>
                            updateTask(task.id, {
                              status: event.target.value as TaskStatus,
                            })
                          }
                          value={task.status || "Aberta"}
                        >
                          {[
                            "Aberta",
                            "Em andamento",
                            "Aguardando",
                            "Concluída",
                          ].map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        onChange={(event) =>
                          setTaskActionDrafts((current) => ({
                            ...current,
                            [task.id]: event.target.value,
                          }))
                        }
                        placeholder="Adicionar atualização ao histórico"
                        value={taskActionDrafts[task.id] || ""}
                      />
                      <button
                        className="rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-700"
                        onClick={() => appendTaskAction(task.id)}
                        type="button"
                      >
                        Salvar atualização
                      </button>
                    </div>
                  </article>
                ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                Registre uma ação para iniciar o acompanhamento.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold">Farol de pedidos pendentes</h3>
              <p className="mt-1 text-xs text-slate-500">
                Filtre a demanda que orienta as ações da equipe.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <select
                aria-label="Filtrar farol"
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                onChange={(event) => setTaskSignalFilter(event.target.value)}
                value={taskSignalFilter}
              >
                {[
                  "Todos",
                  "Demanda próxima",
                  "Possível atraso",
                  "Ponto de atenção",
                  "Alerta",
                  "Programado",
                  "Sem data",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <select
                aria-label="Filtrar pedido"
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                onChange={(event) => setTaskOrderFilter(event.target.value)}
                value={taskOrderFilter}
              >
                {taskOrders.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <select
                aria-label="Filtrar núcleo"
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                onChange={(event) => setTaskNucleusFilter(event.target.value)}
                value={taskNucleusFilter}
              >
                {taskNuclei.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <input
                aria-label="Filtrar material"
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                onChange={(event) => setTaskMaterialFilter(event.target.value)}
                placeholder="Material"
                value={taskMaterialFilter}
              />
            </div>
          </div>
          <Table
            empty="Nenhum pedido atende aos filtros selecionados."
            headers={[
              "Farol",
              "Previsão",
              "Pedido",
              "Material",
              "Núcleo",
              "Volume solicitado",
            ]}
            rows={filteredPendingSignals.map((signal) => [
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-1 text-xs font-bold",
                  taskSignalStyle[signal.tone],
                )}
                key={signal.id}
              >
                {signal.status}
              </span>,
              signal.dueDate
                ? new Intl.DateTimeFormat("pt-BR").format(signal.dueDate)
                : "Sem data",
              signal.reference,
              signal.material,
              signal.nucleus,
              formatNumber(signal.quantity),
            ])}
          />
        </section>
      </section>
    );
  }

  if (active === "Tarefas" && currentUser?.role === "admin") {
    const taskContentForAdmin = content;
    content = (
      <section className="space-y-6">
        {taskContentForAdmin}
        <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5">
          <h3 className="font-semibold text-rose-950">
            Administração de tarefas
          </h3>
          <p className="mt-1 text-xs text-rose-800">
            A exclusão remove a tarefa e todas as ações vinculadas. Esta
            operação não pode ser desfeita.
          </p>
          <div className="mt-4">
            <Table
              empty="Nenhuma tarefa para administrar."
              headers={["Tarefa", "Responsável", "Status", "Ação"]}
              rows={tasks
                .slice()
                .reverse()
                .map((task) => [
                  task.title,
                  task.owner || "Não atribuído",
                  task.status || "Aberta",
                  <button
                    className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700"
                    key={task.id}
                    onClick={() => deleteTask(task)}
                    type="button"
                  >
                    Excluir tarefa
                  </button>,
                ])}
            />
          </div>
        </section>
      </section>
    );
  }

  if (active === "Configurações") {
    content = (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="font-semibold">Configurações</h2>
          <p className="mt-2 text-sm text-slate-500">
            Padronize as visões operacionais e os destinatários das notificações
            por núcleo.
          </p>
        </div>
        <div className="flex gap-2 border-b border-slate-100 px-6 pt-4">
          <button
            className={cn(
              "rounded-t-xl px-4 py-2 text-sm font-semibold",
              settingsTab === "premissas"
                ? "bg-emerald-50 text-emerald-800"
                : "text-slate-500",
            )}
            onClick={() => setSettingsTab("premissas")}
            type="button"
          >
            Visões e premissas
          </button>
          <button
            className={cn(
              "rounded-t-xl px-4 py-2 text-sm font-semibold",
              settingsTab === "email"
                ? "bg-emerald-50 text-emerald-800"
                : "text-slate-500",
            )}
            onClick={() => setSettingsTab("email")}
            type="button"
          >
            E-mails por núcleo
          </button>
        </div>
        {settingsTab === "premissas" ? (
          <div className="space-y-5 p-6">
            <div className="max-w-xl rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <label className="grid gap-1.5 text-sm font-semibold text-emerald-950">
                Ciclo exibido na visão DAE
                <select
                  className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800"
                  onChange={(event) =>
                    setDashboardSettings({
                      daeCycle: event.target
                        .value as DashboardSettings["daeCycle"],
                    })
                  }
                  value={dashboardSettings.daeCycle}
                >
                  <option>Safra</option>
                  <option>Safrinha</option>
                  <option>Ambos</option>
                </select>
              </label>
              <p className="mt-2 text-xs text-emerald-900">
                A visão geral mostrará a idade desde o plantio por núcleo apenas
                para o ciclo escolhido.
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">
                Ajuste dimensões, conversões e regras que sustentam as análises.
              </p>
              <button
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white"
                onClick={() => setShowPremises(true)}
                type="button"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Editar premissas
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
              <p className="font-semibold">Envio por domínio corporativo</p>
              <p className="mt-1 text-xs">
                Os destinatários abaixo são sugeridos no envio manual de
                alertas. Use endereços internos @agroboaesperanca.com.br,
                separados por vírgula.
              </p>
            </div>
            <label className="grid max-w-xl gap-1.5 text-sm font-medium">
              Cópia padrão (CC)
              <input
                className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                onChange={(event) =>
                  setEmailSettings((current) => ({
                    ...current,
                    defaultCopy: event.target.value,
                  }))
                }
                placeholder="planejamento@agroboaesperanca.com.br"
                value={emailSettings.defaultCopy}
              />
            </label>
            <div>
              <h3 className="text-sm font-semibold">
                Destinatário padrão por núcleo
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {taskNuclei
                  .filter((nucleus) => nucleus !== "Todos")
                  .map((nucleus) => (
                    <label
                      className="grid gap-1.5 text-sm font-medium"
                      key={nucleus}
                    >
                      {nucleus}
                      <input
                        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                        onChange={(event) =>
                          setEmailSettings((current) => ({
                            ...current,
                            nucleusRecipients: {
                              ...current.nucleusRecipients,
                              [nucleus]: event.target.value,
                            },
                          }))
                        }
                        placeholder={`responsavel.${nucleus.toLowerCase()}@agroboaesperanca.com.br`}
                        value={emailSettings.nucleusRecipients[nucleus] || ""}
                      />
                    </label>
                  ))}
              </div>
              {taskNuclei.length === 1 ? (
                <p className="mt-3 text-sm text-slate-500">
                  Os núcleos aparecem após a importação de pedidos pendentes.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (active === "Visão geral" && hasData) {
    const overviewContent = content;
    content = (
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-emerald-700">
              Centro de decisão
            </p>
            <h2 className="mt-1 text-xl font-bold text-emerald-950">
              Prioridades de hoje
            </h2>
            <p className="mt-1 text-sm text-emerald-900">
              {isOperator
                ? `Leitura operacional do núcleo ${operatorHasNucleus ? operatorNucleus : "ainda não definido"}.`
                : "Leitura rápida de riscos, tarefas e abastecimento antes da análise detalhada."}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-xl border border-emerald-700 bg-white px-3 py-2 text-sm font-bold text-emerald-800"
              onClick={() => void exportExecutiveReport()}
              type="button"
            >
              <Download className="mr-2 inline h-4 w-4" />
              Relatório executivo
            </button>
            <button
              className="rounded-xl bg-emerald-800 px-3 py-2 text-sm font-bold text-white"
              onClick={() => window.print()}
              type="button"
            >
              Imprimir / PDF
            </button>
          </div>
        </div>
        {isOperator && !operatorHasNucleus ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <strong>Acesso aguardando configuração.</strong> Um administrador
            precisa definir o núcleo deste usuário antes de liberar os dados
            operacionais.
          </div>
        ) : null}
        {logistics.trips.filter((trip) => trip.status === "Rota ativa").length ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
            <div>
              <strong>
                Há {logistics.trips.filter((trip) => trip.status === "Rota ativa").length} rota(s) ativa(s) em trânsito.
              </strong>
              <p className="mt-1 text-xs text-sky-800">
                Confira destinos, produtos e volumes na aba Logística.
              </p>
            </div>
            <button
              className="rounded-lg border border-sky-700 bg-white px-3 py-2 text-xs font-bold text-sky-800"
              onClick={() => setActive("Logística")}
              type="button"
            >
              Conferir logística
            </button>
          </section>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card
            label="Riscos críticos"
            value={
              scopedOperationalAlerts.filter(
                (alert) => alert.severity === "critical",
              ).length
            }
            note="estoque vencido, dose ou cobertura"
            tone="rose"
          />
          <Card
            label="Pendências de qualidade"
            value={dashboardQualityPending}
            note={
              isOperator
                ? "sem pendências no escopo do núcleo"
                : "conciliação e validações de importação"
            }
            tone={dashboardQualityPending ? "amber" : "emerald"}
          />
          <Card
            label="Tarefas abertas"
            value={openTasks.length}
            note={
              overdueTasks
                ? `${overdueTasks} com prazo vencido`
                : "sem prazo vencido"
            }
            tone={overdueTasks ? "amber" : "slate"}
          />
          <Card
            label="Pedidos urgentes"
            value={farol.alert + farol.attention}
            note="ponto de atenção ou alerta"
            tone={farol.alert ? "rose" : "amber"}
          />
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Fila operacional</h3>
              <p className="mt-1 text-xs text-slate-500">
                Itens que merecem decisão ou acompanhamento imediato.
              </p>
            </div>
            <button
              className="text-xs font-bold text-emerald-800"
              onClick={() => setActive("Alertas")}
              type="button"
            >
              Ver alertas
            </button>
          </div>
          <div className="grid gap-2">
            {dailyPriorities.length ? (
              dailyPriorities.map((item) => (
                <article
                  className={cn(
                    "rounded-xl border px-4 py-3",
                    item.tone === "rose"
                      ? "border-rose-200 bg-rose-50"
                      : "border-amber-200 bg-amber-50/60",
                  )}
                  key={item.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                        {item.level}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <p className="py-4 text-sm text-slate-500">
                Não há prioridades críticas no recorte atual.
              </p>
            )}
          </div>
        </section>
        {overviewContent}
      </section>
    );
  }

  if (active === "Importações") {
    const importsContent = content;
    content = (
      <section className="space-y-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <Card
            label="Qualidade da base"
            value={
              qualityPending
                ? `${qualityPending} pendências`
                : "Base consistente"
            }
            note={`${reconciliationIssues.length} itens para conciliar`}
            tone={qualityPending ? "amber" : "emerald"}
          />
          <Card
            label="Últimas importações"
            value={importHistory.length}
            note="versões registradas"
          />
          <Card
            label="Validações do arquivo"
            value={qualityWarnings}
            note="campos essenciais sem leitura"
            tone={qualityWarnings ? "amber" : "emerald"}
          />
        </section>
        {importsContent}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="font-semibold">Histórico e versões de importação</h2>
            <p className="mt-1 text-xs text-slate-500">
              Cada importação preserva data, versão, comparação de linhas e
              validações encontradas.
            </p>
          </div>
          <Table
            empty="Nenhuma importação registrada nesta base."
            headers={[
              "Fonte",
              "Arquivo",
              "Versão",
              "Linhas",
              "Variação",
              "Validações",
              "Importada em",
            ]}
            rows={importHistory.slice(0, 20).map((entry) => [
              sourceConfig.find((source) => source.key === entry.source)
                ?.title || entry.source,
              entry.fileName,
              `v${entry.version}`,
              formatNumber(entry.rows),
              entry.previousRows
                ? `${entry.rows >= entry.previousRows ? "+" : ""}${formatNumber(entry.rows - entry.previousRows)}`
                : "Primeira carga",
              entry.warnings ? (
                <span className="font-bold text-amber-700" key={entry.id}>
                  {" "}
                  {entry.warnings}
                </span>
              ) : (
                "OK"
              ),
              formatDateTime(entry.importedAt),
            ])}
          />
        </section>
      </section>
    );
  }

  if (active === "Tarefas") {
    const tasksContent = content;
    content = (
      <section className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">Gestão de responsabilidade</h2>
              <p className="mt-1 text-xs text-slate-500">
                Defina responsável, prazo, status e a referência da evidência de
                cada ação.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <span className="rounded-lg bg-sky-50 px-3 py-2 font-bold text-sky-800">
                {tasks.filter((task) => task.status === "Aberta").length}{" "}
                abertas
              </span>
              <span className="rounded-lg bg-amber-50 px-3 py-2 font-bold text-amber-800">
                {tasks.filter((task) => task.status === "Em andamento").length}{" "}
                em curso
              </span>
              <span className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-800">
                {tasks.filter((task) => task.status === "Concluída").length}{" "}
                concluídas
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Tarefa",
                    "Responsável",
                    "Prazo",
                    "Status",
                    "Evidência / link",
                    "Atualizada",
                  ].map((head) => (
                    <th className="px-3 py-3 font-semibold" key={head}>
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.length ? (
                  tasks
                    .slice()
                    .reverse()
                    .map((task) => (
                      <tr key={task.id}>
                        <td className="px-3 py-3 font-semibold text-slate-800">
                          {task.title}
                          <p className="mt-1 text-xs font-normal text-slate-500">
                            {task.material || "Sem material"}
                            {task.nucleus ? ` · ${task.nucleus}` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            aria-label={`Responsável por ${task.title}`}
                            className="w-40 rounded-lg border border-slate-200 px-2 py-1.5"
                            onBlur={(event) =>
                              updateTask(task.id, { owner: event.target.value })
                            }
                            defaultValue={task.owner || ""}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            aria-label={`Prazo para ${task.title}`}
                            className="rounded-lg border border-slate-200 px-2 py-1.5"
                            onChange={(event) =>
                              updateTask(task.id, {
                                dueDate: event.target.value,
                              })
                            }
                            type="date"
                            value={task.dueDate || ""}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <select
                            aria-label={`Status de ${task.title}`}
                            className="rounded-lg border border-slate-200 px-2 py-1.5"
                            onChange={(event) =>
                              updateTask(task.id, {
                                status: event.target.value as TaskStatus,
                              })
                            }
                            value={task.status || "Aberta"}
                          >
                            {[
                              "Aberta",
                              "Em andamento",
                              "Aguardando",
                              "Concluída",
                            ].map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            aria-label={`Evidência de ${task.title}`}
                            className="w-48 rounded-lg border border-slate-200 px-2 py-1.5"
                            onBlur={(event) =>
                              updateTask(task.id, {
                                evidence: event.target.value,
                              })
                            }
                            placeholder="Link, chamado ou referência"
                            defaultValue={task.evidence || ""}
                          />
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500">
                          {formatDateTime(task.updatedAt || task.createdAt)}
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td
                      className="px-3 py-8 text-center text-slate-500"
                      colSpan={6}
                    >
                      Registre uma ação abaixo para começar o acompanhamento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {tasksContent}
      </section>
    );
  }

  if (active === "Configurações") {
    const settingsContent = content;
    content = (
      <section className="space-y-6">
        {settingsContent}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="font-semibold">Auditoria recente</h2>
            <p className="mt-1 text-xs text-slate-500">
              Registro de alterações relevantes feitas na base operacional.
            </p>
          </div>
          <Table
            empty="Ainda não há eventos registrados nesta sessão."
            headers={["Quando", "Responsável", "Tipo", "Detalhe"]}
            rows={auditEvents
              .slice(0, 15)
              .map((event) => [
                formatDateTime(event.createdAt),
                event.actor,
                event.kind,
                event.detail,
              ])}
          />
        </section>
      </section>
    );
  }

  if (active === "Usuários" && currentUser?.role === "admin") {
    content = (
      <section className="space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
            Administração de acesso
          </p>
          <h2 className="mt-1 text-xl font-bold text-emerald-950">
            Usuários e escopo operacional
          </h2>
          <p className="mt-2 text-sm text-emerald-900">
            Operadores são direcionados para o núcleo definido. O Acompanhamento
            permanece comparativo e geral.
          </p>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-semibold">Contas cadastradas</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Defina o núcleo dos operadores para priorizar suas análises.
                </p>
              </div>
              <button
                className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-700"
                onClick={() => void loadManagedUsers()}
                type="button"
              >
                Atualizar
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {["Usuário", "Login", "Perfil", "Núcleo", "Ações"].map(
                      (head) => (
                        <th className="px-4 py-3 font-semibold" key={head}>
                          {head}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {managedUsers.map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-4 font-semibold text-slate-800">
                        {user.name}
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {user.username}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-bold",
                            user.role === "admin"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-700",
                          )}
                        >
                          {user.role === "admin" ? "Administrador" : "Operador"}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-medium text-emerald-800">
                        {user.role === "admin"
                          ? "Todos"
                          : user.nucleus || "Definir núcleo"}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex gap-2">
                          <button
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
                            onClick={() => editManagedUser(user)}
                            type="button"
                          >
                            Editar
                          </button>
                          <button
                            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-40"
                            disabled={
                              user.id === currentUser.id || userManagerLoading
                            }
                            onClick={() => void removeManagedUser(user)}
                            type="button"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!managedUsers.length ? (
                    <tr>
                      <td
                        className="px-4 py-10 text-center text-slate-500"
                        colSpan={5}
                      >
                        Nenhum usuário encontrado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
          <form
            className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={saveManagedUser}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">
                  {userDraft.id ? "Editar usuário" : "Novo usuário"}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Operadores só acessam as análises priorizadas para seu núcleo.
                </p>
              </div>
              {userDraft.id ? (
                <button
                  className="text-xs font-bold text-slate-500"
                  onClick={() => setUserDraft(emptyUserDraft)}
                  type="button"
                >
                  Cancelar
                </button>
              ) : null}
            </div>
            <div className="mt-5 grid gap-3">
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Nome
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  onChange={(event) =>
                    setUserDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                  value={userDraft.name}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Login
                <input
                  autoCapitalize="none"
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  onChange={(event) =>
                    setUserDraft((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                  required
                  value={userDraft.username}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Perfil
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  onChange={(event) =>
                    setUserDraft((current) => ({
                      ...current,
                      role: event.target.value as UserDraft["role"],
                    }))
                  }
                  value={userDraft.role}
                >
                  <option value="viewer">Operador</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Núcleo do operador
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal disabled:bg-slate-50"
                  disabled={userDraft.role === "admin"}
                  onChange={(event) =>
                    setUserDraft((current) => ({
                      ...current,
                      nucleus: event.target.value,
                    }))
                  }
                  value={userDraft.role === "admin" ? "" : userDraft.nucleus}
                >
                  <option value="">Selecione o núcleo</option>
                  {[
                    ...new Set([
                      ...ledger.map((row) => row.nucleus),
                      ...taskNuclei.filter((nucleus) => nucleus !== "Todos"),
                    ]),
                  ]
                    .filter(Boolean)
                    .sort()
                    .map((nucleus) => (
                      <option key={nucleus}>{nucleus}</option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                {userDraft.id ? "Nova senha (opcional)" : "Senha inicial"}
                <input
                  autoComplete="new-password"
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
                  minLength={6}
                  onChange={(event) =>
                    setUserDraft((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  required={!userDraft.id}
                  type="password"
                  value={userDraft.password}
                />
              </label>
            </div>
            {userManagerMessage ? (
              <p
                className={cn(
                  "mt-4 rounded-xl px-3 py-2 text-sm",
                  /atualizado|criado|excluído/i.test(userManagerMessage)
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-800",
                )}
              >
                {userManagerMessage}
              </p>
            ) : null}
            <button
              className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={userManagerLoading}
              type="submit"
            >
              {userManagerLoading
                ? "Salvando..."
                : userDraft.id
                  ? "Salvar alterações"
                  : "Criar usuário"}
            </button>
          </form>
        </div>
      </section>
    );
  }

  if (active === "Transferências" && currentUser) {
    content = <FarmTransfers key={currentUser.id} user={currentUser} />;
  }

  if (active === "Importações" && currentUser?.role !== "admin") {
    content = (
      <section className="space-y-6">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <h2 className="font-semibold text-sky-950">
            Importações em modo consulta
          </h2>
          <p className="mt-1 text-sm text-sky-900">
            Seu perfil pode acompanhar arquivos, versões e validações, mas não
            pode importar ou substituir dados operacionais.
          </p>
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <Table
            empty="Nenhuma importação registrada."
            headers={[
              "Fonte",
              "Arquivo",
              "Versão",
              "Linhas",
              "Validações",
              "Importada em",
            ]}
            rows={importHistory
              .slice(0, 30)
              .map((entry) => [
                sourceConfig.find((source) => source.key === entry.source)
                  ?.title || entry.source,
                entry.fileName,
                `v${entry.version}`,
                formatNumber(entry.rows),
                entry.warnings || "OK",
                formatDateTime(entry.importedAt),
              ])}
          />
        </section>
      </section>
    );
  }

  if (active === "Tarefas") {
    const pendingTasks = content;
    const visibleTransitOrders = transitOrders.filter(({ center }) => !taskTransitDestination || center === taskTransitDestination);
    content = (
      <section className="space-y-5">
        <nav aria-label="Visões de Tarefas" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {([
            ["pendentes", "Pedidos pendentes"],
            ["transito", "Pedidos em trânsito"],
          ] as const).map(([view, label]) => (
            <button
              aria-pressed={taskView === view}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold",
                taskView === view ? "bg-emerald-700 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
              )}
              key={view}
              onClick={() => setTaskView(view)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        {taskView === "pendentes" ? pendingTasks : (
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">Pedidos em trânsito</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {visibleTransitOrders.length} {visibleTransitOrders.length === 1 ? "registro na" : "registros na"} MB5T
                  {imports.transito?.importedAt ? ` · importada em ${formatDateTime(imports.transito.importedAt)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Centro de destino
                  <select
                    aria-label="Centro de destino"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                    onChange={(event) => setTaskTransitCenter(event.target.value)}
                    value={taskTransitDestination}
                  >
                    <option value="">Todos os centros</option>
                    {transitCenters.map((center) => <option key={center}>{center}</option>)}
                  </select>
                </label>
                <button
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={!visibleTransitOrders.length}
                  onClick={openTransitNotification}
                  type="button"
                >
                  <Bell aria-hidden="true" className="h-4 w-4" />
                  Notificar pedidos em trânsito
                </button>
              </div>
            </div>
            <Table
              empty={datasets.transito.length ? "Nenhum pedido em trânsito no seu filtro." : "Aguardando a importação da MB5T."}
              headers={transitNotificationHeaders}
              rows={visibleTransitOrders.map(formatTransitNotificationCells)}
            />
          </section>
        )}
      </section>
    );
  }

  if (!authReady || (currentUser && !storageReady))
    return (
      <main className="login-screen grid min-h-screen place-items-center p-5">
        <ContentLoading detail="Conectando à base central e preparando seu ambiente." />
      </main>
    );
  if (!currentUser)
    return (
      <LoginScreen
        error={loginError || persistenceError}
        loading={loggingIn}
        onPasswordChange={setLoginPassword}
        onSubmit={signIn}
        onUsernameChange={setLoginUsername}
        password={loginPassword}
        username={loginUsername}
      />
    );

  return (
    <main
      className="app-shell min-h-screen bg-[#f2f5ef] text-slate-900"
      data-theme={dark ? "dark" : "light"}
    >
      <Navigation
        active={active}
        alertCount={operationalAlerts.length + farol.alert}
        lastUpdatedAt={latestDataUpdate}
        onSelect={setActive}
      />
      <div className="lg:pl-[264px]">
        <header className="command-header sticky top-0 z-10 flex min-h-[64px] items-center justify-between gap-3 border-b border-emerald-950/10 bg-[#f8faf6]/95 px-4 py-2.5 lg:min-h-[72px] lg:px-9">
          <div className="flex min-w-0 items-center gap-2">
            <button
              aria-label="Abrir menu"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 lg:hidden"
              onClick={() => setShowMobileNav(true)}
              type="button"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">
                {active}
              </p>
              <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
                Safra 2026/2027 ·{" "}
                {hasData
                  ? "base operacional ativa"
                  : "base ainda não carregada"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-label="Alternar modo de cor"
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-emerald-400 hover:text-emerald-800"
              onClick={toggleTheme}
              type="button"
            >
              {dark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <button
              aria-label="Abrir premissas"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-800"
              onClick={() => setShowPremises(true)}
              type="button"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">Premissas</span>
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[1540px] px-4 py-6 pb-24 sm:px-5 sm:py-7 lg:px-9 lg:py-9 lg:pb-9">
          <section className="page-intro mb-7 flex flex-wrap items-end justify-between gap-3 sm:mb-8 sm:gap-4">
            <div>
              <h1 className="text-[1.75rem] font-bold tracking-tight text-emerald-950 sm:text-4xl">
                {active}
              </h1>
              {active !== "Fechamentos" ? (
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                  {hasData
                    ? "Dados carregados, conciliados e prontos para leitura operacional."
                    : "Importe as fontes para ativar a leitura operacional e a conciliação de materiais."}
                </p>
              ) : null}
            </div>
            {active !== "Fechamentos" ? (
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs font-bold",
                  hasData
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-amber-200 bg-amber-50 text-amber-900",
                )}
              >
                {hasData ? "Base pronta para análise" : "Aguardando fontes"}
              </div>
            ) : null}
          </section>
          {content}
        </div>
      </div>
      <nav
        aria-label="Atalhos principais"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-emerald-950/10 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        {[nav[0], nav[1], nav[2], nav[4]].map(([label, Icon]) => (
          <button
            className={cn(
              "grid min-h-12 place-items-center gap-1 rounded-lg px-1 text-[10px] font-bold",
              active === label ? "bg-emerald-800 text-white" : "text-slate-600",
            )}
            key={label}
            onClick={() => setActive(label)}
            type="button"
          >
            <Icon className="h-4 w-4" />
            <span className="max-w-full truncate">{label}</span>
          </button>
        ))}
        <button
          className="grid min-h-12 place-items-center gap-1 rounded-lg px-1 text-[10px] font-bold text-slate-600"
          onClick={() => setShowMobileNav(true)}
          type="button"
        >
          <Menu className="h-4 w-4" />
          <span>Mais</span>
        </button>
      </nav>
      {showMobileNav ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end bg-emerald-950/40 p-3 lg:hidden"
          role="dialog"
        >
          <div className="w-full rounded-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Navegação</h2>
                <p className="text-xs text-slate-500">
                  Acesse todas as áreas operacionais.
                </p>
              </div>
              <button
                aria-label="Fechar menu"
                className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200"
                onClick={() => setShowMobileNav(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {nav.map(([label, Icon]) => (
                <button
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left text-sm font-bold",
                    active === label
                      ? "border-emerald-700 bg-emerald-50 text-emerald-950"
                      : "border-slate-200 text-slate-700",
                  )}
                  key={label}
                  onClick={() => {
                    setActive(label);
                    setShowMobileNav(false);
                  }}
                  type="button"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {notificationKind ? (
        <div
          aria-labelledby="task-notification-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h2 className="font-semibold" id="task-notification-title">
                {isTransitNotification ? "Notificar pedidos em trânsito" : "Notificar pedidos pendentes"}
              </h2>
              <button
                aria-label="Fechar notificação"
                className="p-2 text-slate-500"
                onClick={closeNotification}
                type="button"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              {isTransitNotification ? (
                <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                  Centro de destino
                  <select
                    aria-label="Centro de destino"
                    className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                    onChange={(event) => selectTransitNotificationCenter(event.target.value)}
                    value={notificationCenter}
                  >
                    <option value="">Todos os centros</option>
                    {transitCenters.map((center) => <option key={center}>{center}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Núcleo
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                      onChange={(event) => {
                        const nucleus = event.target.value;
                        setNotificationNucleus(nucleus);
                        setNotificationTo(
                          emailSettings.nucleusRecipients[nucleus] || "",
                        );
                        setNotificationMessage(null);
                      }}
                      value={notificationNucleus}
                    >
                      {taskNuclei.map((nucleus) => (
                        <option key={nucleus}>{nucleus}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Atraso a partir de
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                      onChange={(event) => {
                        setNotificationDays(event.target.value);
                        setNotificationMessage(null);
                      }}
                      value={notificationDays}
                    >
                      {[1, 3, 5, 7, 10].map((days) => (
                        <option key={days} value={days}>
                          {days} {days === 1 ? "dia" : "dias"}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                Para
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                  onChange={(event) => setNotificationTo(event.target.value)}
                  placeholder="responsavel@empresa.com"
                  value={notificationTo}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                Cópia (CC)
                <input
                  className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
                  onChange={(event) => setNotificationCc(event.target.value)}
                  placeholder="planejamento@empresa.com"
                  value={notificationCc}
                />
              </label>
              {!isTransitNotification &&
              (notificationDraft?.incompleteRows || notificationSource || notificationSourceLoading) ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 sm:col-span-2">
                  <p
                    className="min-w-0 break-words text-xs text-slate-600"
                    role="status"
                  >
                    {notificationSourceLoading
                      ? "Lendo a planilha…"
                      : notificationSource
                        ? `Planilha deste rascunho · ${notificationSource.name}`
                        : "Use PEDIDOS PENDENTES.xlsx para recuperar os campos ausentes neste rascunho."}
                  </p>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-800 focus-within:outline-2 focus-within:outline-emerald-700 has-disabled:cursor-wait has-disabled:opacity-50">
                    <FileUp aria-hidden="true" className="h-4 w-4" />
                    {notificationSource
                      ? "Trocar planilha"
                      : "Completar com Excel"}
                    <input
                      accept=".xlsx,.xls"
                      className="sr-only"
                      disabled={notificationSourceLoading}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void loadNotificationSource(file);
                      }}
                      type="file"
                    />
                  </label>
                </div>
              ) : null}
              {notificationDraft ? (
                <details className="rounded-xl border border-slate-200 p-3 sm:col-span-2">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Prévia do e-mail
                  </summary>
                  <p className="mt-2 text-sm">{notificationDraft.subject}</p>
                  <iframe
                    className="mt-2 h-72 w-full rounded-lg bg-white"
                    sandbox=""
                    srcDoc={notificationDraft.html}
                    title={isTransitNotification ? "Corpo do e-mail de pedidos em trânsito" : "Corpo do e-mail de pedidos pendentes"}
                  />
                </details>
              ) : null}
            </div>
            <div className="border-t border-slate-100 px-6 py-4">
              <p className="text-sm text-slate-600">
                {notificationDraft
                  ? `${notificationDraft.count} ${notificationDraft.count === 1 ? "linha de pedido no rascunho" : "linhas de pedido no rascunho"}.`
                  : isTransitNotification
                    ? "Nenhum pedido em trânsito para o centro selecionado."
                    : "Nenhum pedido pendente na faixa e no núcleo selecionados."}
              </p>
              {notificationDraft?.incompleteRows ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-900">
                  <p>
                    {isTransitNotification
                      ? "Há registros com campos ausentes. Reimporte a MB5T para atualizar esses campos."
                      : notificationDraft.incompleteRows === 1
                      ? "Uma linha tem campos ausentes na base."
                      : `${notificationDraft.incompleteRows} linhas têm campos ausentes na base.`}
                  </p>
                  {currentUser.role === "admin" ? (
                    <button
                      className="font-semibold underline"
                      onClick={() => {
                        closeNotification();
                        setActive("Importações");
                        window.scrollTo({ top: 0 });
                      }}
                      type="button"
                    >
                      Abrir Importações
                    </button>
                  ) : null}
                </div>
              ) : null}
              {notificationDraft ? (
                <p className="mt-2 text-xs text-slate-600">
                  Para usar a sua assinatura, copie o corpo, abra uma nova
                  mensagem no Outlook e cole no início do corpo. Se necessário,
                  selecione a assinatura em{" "}
                  <strong>Mensagem → Assinatura</strong>.
                </p>
              ) : null}
              {notificationMessage ? (
                <p
                  className={cn(
                    "mt-2 text-sm",
                    notificationMessage.success
                      ? "text-emerald-800"
                      : "text-rose-700",
                  )}
                  role="status"
                >
                  {notificationMessage.text}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600"
                  onClick={closeNotification}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  disabled={!notificationDraft || notificationSourceLoading}
                  onClick={downloadNotificationDraft}
                  type="button"
                >
                  Baixar .eml
                </button>
                <button
                  className="rounded-xl border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"
                  disabled={!notificationDraft || notificationSourceLoading}
                  onClick={() => void copyNotificationBody()}
                  type="button"
                >
                  Copiar corpo formatado
                </button>
                {outlookDraftUrl ? (
                  <a
                    className="inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                    href={outlookDraftUrl}
                    onClick={() =>
                      setNotificationMessage({
                        text: "No Outlook, confira a conta remetente e cole o corpo acima da assinatura. Se a janela não abrir, use Novo E-mail no Outlook clássico.",
                        success: true,
                      })
                    }
                  >
                    Nova mensagem no Outlook
                  </a>
                ) : (
                  <button
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={!notificationDraft || notificationSourceLoading}
                    onClick={() =>
                      setNotificationMessage({
                        text: "Informe um destinatário válido e confira os endereços em cópia.",
                      })
                    }
                    type="button"
                  >
                    Nova mensagem no Outlook
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showOrderPicker ? (
        <div
          aria-labelledby="logistics-order-picker-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
        >
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6 sm:py-5">
              <div>
                <h2 className="font-semibold" id="logistics-order-picker-title">
                  Vincular pedidos SAP
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  O saldo disponível desconta o trânsito da MB5T e as reservas em viagens.
                  Clique em Data solicitada para alternar a ordem.
                </p>
              </div>
              <button
                aria-label="Fechar seleção de pedidos"
                className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                onClick={() => setShowOrderPicker(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Produto
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                  onChange={(event) =>
                    setLogisticsProductFilter(event.target.value)
                  }
                  value={logisticsProductFilter}
                >
                  <option value="">Todos os produtos</option>
                  {logisticsProductOptions.map((product) => (
                    <option key={product}>{product}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Pedido SAP
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                  onChange={(event) =>
                    setLogisticsOrderFilter(event.target.value)
                  }
                  placeholder="Número do pedido"
                  value={logisticsOrderFilter}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Unidade / núcleo
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                  onChange={(event) =>
                    setLogisticsUnitFilter(event.target.value)
                  }
                  value={logisticsUnitFilter}
                >
                  <option>Todos</option>
                  {logisticsUnitOptions.map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                Prioridade
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                  onChange={(event) =>
                    setLogisticsPriorityFilter(event.target.value)
                  }
                  value={logisticsPriorityFilter}
                >
                  {[
                    "Todas",
                    "Urgente",
                    "Janela adequada",
                    "Antecedência longa",
                    "Sem data planejada",
                  ].map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 text-xs text-slate-600 sm:px-6">
              <span>
                <strong className="text-slate-900">
                  {availableFilteredLogisticsRequests.length}
                </strong>{" "}
                pedido(s) encontrado(s)
              </span>
              <button
                className="font-bold text-emerald-700"
                onClick={() => {
                  setLogisticsProductFilter("");
                  setLogisticsOrderFilter("");
                  setLogisticsUnitFilter("Todos");
                  setLogisticsPriorityFilter("Todas");
                }}
                type="button"
              >
                Limpar filtros
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {[
                      "Pedido / material",
                      "Unidade",
                      "Data solicitada",
                      "Janela planejada",
                      "Planejado até a data",
                      "Saldo restante",
                      "",
                    ].map((head) => head === "Data solicitada" ? (
                      <th aria-sort={requestedDateSort || "none"} className="px-4 py-3 font-semibold" key={head}>
                        <button
                          className="inline-flex items-center gap-1.5 font-semibold uppercase hover:text-emerald-800"
                          onClick={() => setRequestedDateSort((current) => current === "ascending" ? "descending" : "ascending")}
                          title={requestedDateSort === "ascending" ? "Classificar da data mais recente à mais antiga" : "Classificar da data mais antiga à mais recente"}
                          type="button"
                        >
                          {head}
                          {requestedDateSort === "ascending" ? <ArrowUp className="h-3.5 w-3.5" /> : requestedDateSort === "descending" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5" />}
                        </button>
                      </th>
                    ) : (
                      <th className="px-4 py-3 font-semibold" key={head}>
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {availableFilteredLogisticsRequests.map((request) => {
                    const line = request.lines[0];
                    const remaining = line
                      ? remainingForLogisticsLine(line)
                      : 0;
                    const timing = line?.daysBeforePlanning;
                    const timingLabel = line?.planningDate
                      ? `${line.planningStatus} · ${timing !== null && timing !== undefined ? (timing >= 0 ? `${timing} dia(s) antes` : `${Math.abs(timing)} dia(s) após`) : "sem cálculo"}`
                      : "Sem data planejada";
                    const tone =
                      line?.planningStatus === "Janela adequada"
                        ? "text-emerald-700"
                        : line?.planningStatus === "Planejamento já iniciado" ||
                            line?.planningStatus === "Antecedência curta"
                          ? "text-rose-700"
                          : "text-amber-800";
                    return (
                      <tr key={request.id}>
                        <td className="px-4 py-3">
                          <strong>{request.requestNumber}</strong>
                          <span className="mt-1 block text-xs text-slate-600">
                            {line?.product || "Material não identificado"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {request.destination || "Sem núcleo"}
                        </td>
                        <td className="px-4 py-3">
                          {request.date
                            ? new Intl.DateTimeFormat("pt-BR").format(
                                new Date(`${request.date}T00:00:00`),
                              )
                            : "Sem data"}
                        </td>
                        <td className={cn("px-4 py-3 font-semibold", tone)}>
                          {timingLabel}
                          <span className="mt-1 block text-xs font-normal text-slate-500">
                            {line?.planningDate
                              ? `Aplicação ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${line.planningDate}T00:00:00`))}`
                              : "Cadastre a data no planejamento"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {formatNumber(line?.plannedUntilRequest || 0)}{" "}
                          {line?.unit || ""}
                        </td>
                        <td className="px-4 py-3">
                          <strong>{formatNumber(remaining)}</strong>{" "}
                          {line?.unit || ""}
                          <span className="mt-1 block text-xs text-slate-500">
                            Saldo SAP {formatNumber(line?.quantity || 0)}
                          </span>
                          {line?.inTransit ? <span className="mt-1 block text-xs text-sky-800">−{formatNumber(line.inTransit)} em trânsito (MB5T)</span> : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                            onClick={() => selectLogisticsRequest(request.id)}
                            type="button"
                          >
                            Vincular
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!availableFilteredLogisticsRequests.length ? (
                    <tr>
                      <td
                        className="px-4 py-12 text-center text-sm text-slate-500"
                        colSpan={7}
                      >
                        Nenhum pedido atende aos filtros selecionados.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {showProvision ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
        >
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="font-semibold">Provisionamento micro</h2>
                <p className="mt-1 text-xs text-slate-500">
                  As linhas abaixo detalham fazenda, armazém, trânsito e pedidos
                  pendentes do mesmo material.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-700"
                  onClick={exportProvision}
                  type="button"
                >
                  <Download className="h-4 w-4" />
                  Exportar Excel
                </button>
                <button
                  aria-label="Fechar provisionamento"
                  className="p-2 text-slate-500"
                  onClick={() => setShowProvision(false)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid gap-4 border-b border-slate-100 p-6 sm:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1.5 text-sm font-medium">
                Início
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2"
                  onChange={(event) => setEvaluationDate(event.target.value)}
                  type="date"
                  value={evaluationDate}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Fim
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2"
                  onChange={(event) => setProvisionUntil(event.target.value)}
                  type="date"
                  value={provisionUntil}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Ciclo
                <select className="rounded-lg border border-slate-200 px-3 py-2" value={provisionCycle} onChange={(event) => setProvisionCycle(event.target.value)}>
                  {["Todos", "Safra", "Safrinha"].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Cultura
                <select className="rounded-lg border border-slate-200 px-3 py-2" value={provisionCulture} onChange={(event) => setProvisionCulture(event.target.value)}>
                  {["Todas", "Soja", "Algodão", "Milho", ...filters.cultures.filter((value) => !["Todos", "Soja", "Algodão", "Milho"].includes(value) && !/^(SOJA|ALGODAO|MILHO)/.test(headerKey(value)))].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 border-b border-slate-100 p-6 sm:grid-cols-5">
              <Card label="Demanda" value={formatNumber(provision.demand)} />
              <Card
                label="Saldo em fazenda"
                value={formatNumber(provision.farm)}
              />
              <Card label="Trânsito" value={formatNumber(provision.transit)} />
              <Card
                label="Volume solicitado"
                value={formatNumber(provision.pendingOrder)}
                note="pedidos pendentes"
              />
              <Card
                label="Apoio do armazém"
                value={formatNumber(provision.warehouse)}
                note="saldo central compartilhado"
              />
            </div>
            <p className="px-6 py-3 text-xs text-slate-500">
              {provision.dated
                ? "A demanda foi filtrada por DT_Aplicacao do planejamento."
                : "Não foi encontrada data prevista reconhecida: a janela usa todas as linhas do filtro."}
              {" "}O saldo físico, trânsito e pedidos são compartilhados por material e núcleo; o planejamento por cultura é exibido separadamente, sem duplicar disponibilidade.
            </p>
            <div className="min-h-0 flex-1 overflow-auto border-t border-slate-100">
              <table className="w-full min-w-[1380px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {[
                      "Núcleo",
                      "Ciclo / cultura",
                      "Princípio ativo",
                      "Material padrão",
                      "Demanda",
                      "Saldo",
                      "Trânsito",
                      "V. solicitado",
                      "Situação",
                    ].map((head) => (
                      <th className="px-4 py-3 font-semibold" key={head}>
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {provision.rows.map((row) => (
                    <Fragment key={row.id}>
                      <tr>
                        <td className="px-4 py-3 font-medium">{row.nucleus}</td>
                        <td className="px-4 py-3">
                          {row.cultureBreakdown.map((item) => (
                            <div key={item.cycle + "|" + item.culture} className={cn("mb-1 rounded border-l-2 px-2 py-1 text-xs", calendarCycleTone(item.cycle))}>
                              <strong>{item.culture}</strong> · {item.cycle}<br />
                              Planejado: {formatNumber(item.planned)}
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-3">{row.active}</td>
                        <td className="px-4 py-3 font-medium">
                          {row.standardMaterial}
                        </td>
                        <td className="px-4 py-3">
                          {formatNumber(row.demand)}
                        </td>
                        <td className="px-4 py-3">
                          {formatNumber(row.farmBalance)}
                        </td>
                        <td className="px-4 py-3">
                          {formatNumber(row.transit)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-emerald-700">
                          {formatNumber(row.pendingOrder)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 font-semibold",
                            row.status === "Falta"
                              ? "text-rose-700"
                              : "text-emerald-700",
                          )}
                        >
                          {row.status}
                        </td>
                      </tr>
                      {[
                        ...row.locations.filter(
                          (location) => location.type !== "Armazém",
                        ),
                        ...row.warehouseLocations,
                      ].map((location, index) => (
                        <tr
                          className="bg-slate-50/70 text-xs"
                          key={
                            row.id +
                            "|" +
                            location.type +
                            "|" +
                            location.location +
                            "|" +
                            String(index)
                          }
                        >
                          <td className="py-2 pl-8 pr-4 text-slate-500">
                            {location.type}
                          </td>
                          <td className="px-4 py-2 text-slate-500" colSpan={3}>
                            {location.location}
                          </td>
                          <td className="px-4 py-2 text-slate-500" colSpan={2}>
                            {location.material}
                          </td>
                          <td className="px-4 py-2 font-medium">
                            {formatNumber(location.amount)}
                          </td>
                          <td className="px-4 py-2 text-slate-400">—</td>
                          <td className="px-4 py-2 text-slate-500">
                            {location.type === "Armazém"
                              ? "Apoio possível"
                              : "Saldo localizado"}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {!provision.rows.length ? (
                    <tr>
                      <td
                        className="px-4 py-10 text-center text-slate-500"
                        colSpan={9}
                      >
                        Não há demanda planejada para esta janela.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {showPremises ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="font-semibold">Premissas e dimensões</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Regras operacionais e mapeamentos aplicados à conciliação.
                </p>
              </div>
              <button
                aria-label="Fechar premissas"
                className="p-2 text-slate-500"
                onClick={() => setShowPremises(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              {[
                ["Tolerância de desvio (%)", "tolerance"],
                ["Amostra mínima", "sample"],
                ["Janelas de demanda", "horizon"],
                ["Status excluído", "excludedStatus"],
              ].map(([label, key]) => (
                <label className="grid gap-1.5 text-sm font-medium" key={key}>
                  {label}
                  <input
                    className="rounded-lg border border-slate-200 px-3 py-2"
                    onChange={(event) =>
                      setPremises({ ...premises, [key]: event.target.value })
                    }
                    value={premises[key as keyof Premises]}
                  />
                </label>
              ))}
            </div>
            <div className="border-t border-slate-100 px-6 py-5">
              <h3 className="text-sm font-semibold">
                Nova premissa de dimensão
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Material: nome → material agregado. Centro/Fazenda: chave →
                núcleo. Conversão: material padrão|apresentação física → fator.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <select
                  className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, domain: event.target.value })
                  }
                  value={draft.domain}
                >
                  <option>Material</option>
                  <option>Princípio ativo</option>
                  <option>Centro</option>
                  <option>Fazenda</option>
                  <option>Cultura</option>
                  <option>Conversão</option>
                </select>
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, key: event.target.value })
                  }
                  placeholder="Chave"
                  value={draft.key}
                />
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, value: event.target.value })
                  }
                  placeholder="Valor"
                  value={draft.value}
                />
                <button
                  className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700"
                  onClick={addPremise}
                  type="button"
                >
                  Incluir
                </button>
              </div>
              {dimensionPremises.length ? (
                <div className="mt-4 space-y-2">
                  {dimensionPremises.map((item, index) => (
                    <div
                      className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                      key={item.domain + "|" + item.key + "|" + String(index)}
                    >
                      <span>
                        {item.domain}: <strong>{item.key}</strong> →{" "}
                        {item.value}
                      </span>
                      <button
                        className="text-rose-600"
                        onClick={() =>
                          setDimensionPremises((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                        type="button"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="border-t border-slate-100 px-6 py-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold">Catálogo de premissas</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Escolha um tipo para consultar os dados em tabela e
                  exportá-los para edição.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {premiseSections.map((section) => (
                  <button
                    className={cn(
                      "rounded-xl border p-4 text-left",
                      premiseSection === section.id
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-slate-200 bg-white hover:border-emerald-300",
                    )}
                    key={section.id}
                    onClick={() => setPremiseSection(section.id)}
                    type="button"
                  >
                    <p className="text-sm font-semibold">{section.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {section.rows.length} registros
                    </p>
                  </button>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">
                      {selectedPremiseSection.title}
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedPremiseSection.description}
                    </p>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 bg-white px-3 py-2 text-xs font-semibold text-emerald-700"
                    onClick={exportPremiseSection}
                    type="button"
                  >
                    <Download className="h-4 w-4" />
                    Exportar para edição
                  </button>
                </div>
                <Table
                  empty="Nenhum registro nesta premissa."
                  headers={selectedPremiseSection.headers}
                  rows={selectedPremiseSection.rows}
                />
              </div>
            </div>
            <div className="border-t border-slate-100 px-6 py-5">
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                <p className="text-sm font-semibold text-sky-950">
                  Alertas por e-mail
                </p>
                <p className="mt-1 text-xs leading-relaxed text-sky-900">
                  A programação de destinatários e frequência será habilitada
                  assim que o serviço de envio for autorizado. A plataforma já
                  sinaliza os alertas operacionais no painel.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600"
                onClick={() => setShowPremises(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  setShowPremises(false);
                  setMessage("Premissas aplicadas e salvas na base central.");
                }}
                type="button"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
