"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Suspense,
} from "react";
import { useSearchParams } from "next/navigation";
import MinimalHeader from "@/components/tools/MinimalHeader";
import {
  type AdjustmentPill,
  type SFRAnalysisResult,
  analyzeSFR,
} from "./analyze";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlaceSelection {
  formattedAddress: string;
  lat: number;
  lng: number;
}

interface CrmContact {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

interface PropertyInfo {
  beds: number | "";
  baths: number | "";
  sqft: number | "";
  parking: "garage" | "carport" | "both" | "none";
  garageSpaces: number;
  features: string[];
  condition: "light" | "full" | "heavy";
}

interface RawComp {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt: number;
  salePrice: number;
  saleDate: string;
  daysAgo: number;
  pricePerSqft: number | null;
  distanceMiles: number;
  latitude: number;
  longitude: number;
  garage: boolean;
  garageSpaces: number;
  pool: boolean;
  priceSource: "sale" | "history" | "assessment" | "none";
}

interface ProcessedComp extends RawComp {
  adjustedPrice: number;
  adjustments: AdjustmentPill[];
}

interface CalcResults {
  pctAmount: number;
  endBuyerMax: number;
  mao: number;
  anchorOffer: number;
}

interface Filters {
  radius: 0.25 | 0.5 | 1 | 2;
  days: 30 | 60 | 90 | 180 | 365 | 730 | 1095 | null;
  sqftRange: 100 | 250 | 500 | 750 | null;
  yearRange: 5 | 10 | 20 | null;
  bedsRange: 0 | 1 | 2 | null;
}

interface MelissaResult {
  found: boolean;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  garage?: boolean | null;
  garageSpaces?: number | null;
  carport?: boolean | null;
  pool?: boolean | null;
  ownerName?: string | null;
  ownerOccupied?: boolean | null;
  ownerType?: string | null;
  mortgageAmount?: number | null;
  assessedValue?: number | null;
  taxDelinquentYear?: string | null;
  estimatedValue?: number | null;
  estimatedValueMin?: number | null;
  estimatedValueMax?: number | null;
  lastSaleDate?: string | null;
  lastSalePrice?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalizeName(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function computeAdjustments(
  comp: RawComp,
  info: PropertyInfo,
): { adjustments: AdjustmentPill[]; adjustedPrice: number } {
  const pills: AdjustmentPill[] = [];
  let delta = 0;

  const subBeds = typeof info.beds === "number" ? info.beds : 0;
  const subBaths = typeof info.baths === "number" ? info.baths : 0;

  if (comp.beds != null && subBeds !== 0 && comp.beds !== subBeds) {
    const amt = (subBeds - comp.beds) * 10000;
    delta += amt;
    pills.push({
      label: `${amt > 0 ? "+" : ""}${subBeds - comp.beds} bed`,
      amount: amt,
    });
  }

  if (comp.baths != null && subBaths !== 0 && comp.baths !== subBaths) {
    const amt = (subBaths - comp.baths) * 5000;
    delta += amt;
    pills.push({
      label: `${amt > 0 ? "+" : ""}${(subBaths - comp.baths).toFixed(1)} bath`,
      amount: amt,
    });
  }

  const subHasGarage = info.parking === "garage" || info.parking === "both";
  const subHasCarport = info.parking === "carport" || info.parking === "both";

  if (subHasGarage) {
    delta += 10000;
    pills.push({ label: "+garage", amount: 10000 });
    if (info.garageSpaces > 0) {
      const spAmt = info.garageSpaces * 5000;
      delta += spAmt;
      pills.push({
        label: `+${info.garageSpaces} bay${info.garageSpaces > 1 ? "s" : ""}`,
        amount: spAmt,
      });
    }
  }

  if (subHasCarport) {
    delta += 5000;
    pills.push({ label: "+carport", amount: 5000 });
  }

  if (info.features.includes("Pool")) {
    delta += 10000;
    pills.push({ label: "+pool", amount: 10000 });
  }

  return {
    adjustments: pills,
    adjustedPrice: Math.max(0, comp.salePrice + delta),
  };
}

function calcDaysSinceSold(saleDate: string | null | undefined): number {
  if (!saleDate) return 0;
  return Math.floor((Date.now() - new Date(saleDate).getTime()) / 86400000);
}

function relativeDate(daysAgo: number | null): string {
  if (daysAgo == null) return "Unknown";
  if (daysAgo <= 90) return `${daysAgo} days ago`;
  if (daysAgo <= 365) return `${Math.round(daysAgo / 30)} mo ago`;
  return `${Math.round(daysAgo / 365)} yr ago`;
}

function SortIndicator({
  col,
  sortCol,
  sortDir,
}: {
  col: string;
  sortCol: string | null;
  sortDir: "asc" | "desc" | null;
}) {
  if (sortCol !== col) {
    return (
      <svg
        className="w-3 h-3 text-white/20 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          d="M8 9l4-4 4 4M8 15l4 4 4-4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (sortDir === "asc") {
    return (
      <svg
        className="w-3 h-3 text-[#DABD59] shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          d="M12 19V5M5 12l7-7 7 7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg
      className="w-3 h-3 text-[#DABD59] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        d="M12 5v14M5 12l7 7 7-7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SESSION_KEY = (addr: string) => `reiblast_comps_${addr}`;

const REPAIR_RATES: Record<"light" | "full" | "heavy", number> = {
  light: 6,
  full: 17,
  heavy: 40,
};

const REPAIR_LABELS: Record<"light" | "full" | "heavy", string> = {
  light: "Light cosmetic",
  full: "Full cosmetic + systems",
  heavy: "Heavy rehab",
};

// ─── Google Maps window types ─────────────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google: any;
    initSFRGoogleMaps?: () => void;
  }
}

// ─── Step progress ────────────────────────────────────────────────────────────

function StepProgress({ step }: { step: number }) {
  const labels = ["Address", "Property", "Comps", "Results"];
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? "bg-gold text-black"
                    : active
                      ? "bg-gold text-black"
                      : "bg-surface-2 text-white/30 border border-border-default"
                }`}
              >
                {done ? (
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  n
                )}
              </div>
              <span
                className={`text-[10px] font-medium ${active ? "text-gold" : done ? "text-white/50" : "text-white/20"}`}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className={`flex-1 h-px mb-4 ${done ? "bg-gold/40" : "bg-border-default"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`bg-surface-2 rounded-lg animate-pulse ${className ?? ""}`}
      style={{ animation: "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite" }}
    />
  );
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="bg-surface border border-border-default rounded-xl p-5 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((k) => (
          <div
            key={k}
            className="bg-surface border border-border-default rounded-xl p-4 flex gap-4"
          >
            <Skeleton className="w-16 h-12 shrink-0 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? "w-5 h-5"}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function SFRContent() {
  const searchParams = useSearchParams();
  const locationId =
    searchParams.get("locationId") ?? searchParams.get("token") ?? "";

  // ── Connection gate ─────────────────────────────────────────────────────────

  const [connectionStatus, setConnectionStatus] = useState<
    "checking" | "connected" | "disconnected"
  >("checking");
  const [connectedBanner, setConnectedBanner] = useState(false);
  const [loadingDeal, setLoadingDeal] = useState(false);

  // ── Step state ──────────────────────────────────────────────────────────────

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1
  const [place, setPlace] = useState<PlaceSelection | null>(null);
  const [addressInput, setAddressInput] = useState("");

  // Step 2
  const [propInfo, setPropInfo] = useState<PropertyInfo>({
    beds: "",
    baths: "",
    sqft: "",
    parking: "none",
    garageSpaces: 1,
    features: [],
    condition: "light",
  });
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  // Melissa
  const [melissaData, setMelissaData] = useState<MelissaResult | null>(null);
  const [melissaLoading, setMelissaLoading] = useState(false);

  // Step 3
  const [rawComps, setRawComps] = useState<RawComp[]>([]);
  const [allComps, setAllComps] = useState<RawComp[]>([]);
  const [fetchingComps, setFetchingComps] = useState(false);
  const [compsError, setCompsError] = useState("");
  const [filters, setFilters] = useState<Filters>({
    radius: 1,
    days: null,
    sqftRange: null,
    yearRange: null,
    bedsRange: null,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [manuallySelected, setManuallySelected] = useState<Set<string>>(
    new Set(),
  );
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [showAdjModal, setShowAdjModal] = useState(false);

  // Step 4
  const [analysis, setAnalysis] = useState<SFRAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [conditionUsedForAnalysis, setConditionUsedForAnalysis] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1);
  const [tab2Unlocked, setTab2Unlocked] = useState(false);
  const [tab3Unlocked, setTab3Unlocked] = useState(false);

  // Tab 2 inputs
  const [investorPct, setInvestorPct] = useState(70);
  const [repairLevel, setRepairLevel] = useState<"light" | "full" | "heavy">(
    "full",
  );
  const [wholesaleFee, setWholesaleFee] = useState(10000);

  // Tab 3
  const [calcResults, setCalcResults] = useState<CalcResults | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    text: string;
    variant: "success" | "warning" | "error";
  } | null>(null);

  // Save modal
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalSearching, setSaveModalSearching] = useState(false);
  const [saveModalContacts, setSaveModalContacts] = useState<CrmContact[]>([]);
  const [saveModalSelection, setSaveModalSelection] = useState<
    string | "new" | "skip" | null
  >(null);
  const [saveModalSellerName, setSaveModalSellerName] = useState("");
  const [saveModalSaving, setSaveModalSaving] = useState(false);

  // Refs
  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<unknown>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const gMapRef = useRef<unknown>(null);
  const markersRef = useRef<Map<string, unknown>>(new Map());
  const circleRef = useRef<unknown>(null);
  const subjectMarkerRef = useRef<unknown>(null);

  // ── Computed ────────────────────────────────────────────────────────────────

  const processedComps = useMemo<ProcessedComp[]>(() => {
    return allComps.map((c) => ({ ...c, ...computeAdjustments(c, propInfo) }));
  }, [allComps, propInfo]);

  const filteredComps = useMemo<ProcessedComp[]>(() => {
    const sqft = typeof propInfo.sqft === "number" ? propInfo.sqft : null;
    const subBeds = typeof propInfo.beds === "number" ? propInfo.beds : null;
    const result = processedComps.filter((c) => {
      if (c.distanceMiles > filters.radius) return false;
      if (filters.days !== null && c.daysAgo > filters.days) return false;
      if (
        filters.sqftRange !== null &&
        sqft &&
        c.sqft &&
        Math.abs(c.sqft - sqft) > filters.sqftRange
      )
        return false;
      if (filters.bedsRange !== null && subBeds !== null && c.beds != null) {
        if (filters.bedsRange === 0 && c.beds !== subBeds) return false;
        if (
          filters.bedsRange > 0 &&
          Math.abs(c.beds - subBeds) > filters.bedsRange
        )
          return false;
      }
      return true;
    });
    console.log("[comps] After filtering:", result.length, "comps visible");
    console.log("[comps] Filter state:", {
      radius: filters.radius,
      soldWithin: filters.days,
      sqftRange: filters.sqftRange,
      yearRange: filters.yearRange,
      bedsRange: filters.bedsRange,
    });
    return result;
  }, [processedComps, filters, propInfo]);

  const { tableComps, filteredIdsSet } = useMemo(() => {
    const filteredIdsSet = new Set(filteredComps.map((c) => c.id));
    const outsideFilter = processedComps.filter(
      (c) =>
        manuallySelected.has(c.id) &&
        selectedIds.has(c.id) &&
        !filteredIdsSet.has(c.id),
    );
    return { tableComps: [...filteredComps, ...outsideFilter], filteredIdsSet };
  }, [filteredComps, processedComps, manuallySelected, selectedIds]);

  const sortedTableComps = useMemo(() => {
    if (!sortCol || !sortDir) return tableComps;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...tableComps].sort((a, b) => {
      switch (sortCol) {
        case "address":
          return dir * a.address.localeCompare(b.address);
        case "beds":
          return dir * ((a.beds ?? 0) - (b.beds ?? 0));
        case "baths":
          return dir * ((a.baths ?? 0) - (b.baths ?? 0));
        case "sqft":
          return dir * ((a.sqft ?? 0) - (b.sqft ?? 0));
        case "built":
          return dir * ((a.yearBuilt ?? 0) - (b.yearBuilt ?? 0));
        case "sold":
          return dir * (a.daysAgo - b.daysAgo);
        case "dist":
          return dir * (a.distanceMiles - b.distanceMiles);
        case "price":
          return dir * (a.adjustedPrice - b.adjustedPrice);
        default:
          return 0;
      }
    });
  }, [tableComps, sortCol, sortDir]);

  const allVisibleSelected =
    sortedTableComps.length > 0 &&
    sortedTableComps.every((c) => selectedIds.has(c.id));
  const someVisibleSelected = sortedTableComps.some((c) =>
    selectedIds.has(c.id),
  );

  const selectedCount = selectedIds.size;

  const selectedCompsForPayload = useMemo(() => {
    return processedComps.filter((c) => selectedIds.has(c.id));
  }, [processedComps, selectedIds]);

  // ── Connection check ────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchParams.get("connected") === "true") {
      setConnectionStatus("connected");
      setConnectedBanner(true);
      setTimeout(() => setConnectedBanner(false), 4000);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("connected");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? "?" + qs : ""),
      );
      return;
    }
    if (!locationId) {
      setConnectionStatus("disconnected");
      return;
    }
    fetch(
      `/api/analyzer/check-connection?locationId=${encodeURIComponent(locationId)}`,
    )
      .then((r) => r.json())
      .then((data) =>
        setConnectionStatus(data.connected ? "connected" : "disconnected"),
      )
      .catch(() => setConnectionStatus("disconnected"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deal reload via dealId URL param ────────────────────────────────────────

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    const dealId = searchParams.get("dealId");
    if (!dealId || !locationId) return;

    setLoadingDeal(true);
    fetch(
      `/api/analyzer/deal?dealId=${encodeURIComponent(dealId)}&locationId=${encodeURIComponent(locationId)}`,
    )
      .then((r) => r.json())
      .then((deal) => {
        if (deal.error) return;

        setPlace({
          formattedAddress: deal.address,
          lat: deal.lat ?? 0,
          lng: deal.lng ?? 0,
        });
        setAddressInput(deal.address);
        setPropInfo({
          beds: deal.beds ?? "",
          baths: deal.baths ?? "",
          sqft: deal.sqft ?? "",
          parking: "none",
          garageSpaces: 1,
          features: [],
          condition:
            (deal.repairLevel as "light" | "full" | "heavy") ?? "light",
        });

        if (deal.compsRawJson) {
          try {
            const rawCompsData: RawComp[] = JSON.parse(deal.compsRawJson);
            setRawComps(rawCompsData);
            const withFreshDays = rawCompsData.map((c) => ({
              ...c,
              daysAgo: calcDaysSinceSold(c.saleDate),
            }));
            setAllComps(withFreshDays);
            sessionStorage.setItem(
              SESSION_KEY(deal.address),
              JSON.stringify(rawCompsData),
            );
            if (deal.compsJson) {
              const selectedComps: { id: string }[] = JSON.parse(
                deal.compsJson,
              );
              setSelectedIds(new Set(selectedComps.map((c) => c.id)));
            }
          } catch {
            /* corrupted */
          }
        }

        const reconstructed: SFRAnalysisResult = {
          comps: [],
          arv: {
            estimate: deal.arv,
            low: deal.arvLow ?? 0,
            high: deal.arvHigh ?? 0,
            confidence:
              (deal.arvConfidence as "high" | "medium" | "low") ?? "medium",
            confidence_reason: "",
          },
          as_is: {
            value: deal.asIsValue ?? null,
            low: deal.asIsLow ?? null,
            high: deal.asIsHigh ?? null,
            note: "",
          },
          exit_strategy: {
            recommendation:
              (deal.exitStrategy as
                | "WHOLESALE"
                | "FIX_AND_FLIP"
                | "SUBJECT_TO"
                | "PASS") ?? "WHOLESALE",
            reasoning: "",
          },
          narrative: deal.narrative ?? "",
          warnings: deal.warnings ?? [],
        };
        setAnalysis(reconstructed);
        setConditionUsedForAnalysis(deal.repairLevel);

        setInvestorPct(deal.investorPct ?? 70);
        setRepairLevel(
          (deal.repairLevel as "light" | "full" | "heavy") ?? "full",
        );
        setWholesaleFee(deal.wholesaleFee ?? 10000);

        if (
          deal.endBuyerMax != null &&
          deal.mao != null &&
          deal.anchorOffer != null
        ) {
          setCalcResults({
            pctAmount: deal.arv * ((deal.investorPct ?? 70) / 100),
            endBuyerMax: deal.endBuyerMax,
            mao: deal.mao,
            anchorOffer: deal.anchorOffer,
          });
          setTab2Unlocked(true);
          setTab3Unlocked(true);
        }

        setStep(4);
        setActiveTab(1);
      })
      .catch(() => {
        /* ignore network errors */
      })
      .finally(() => setLoadingDeal(false));
  }, [connectionStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Google Maps loading ─────────────────────────────────────────────────────

  function initAutocomplete() {
    if (!addressInputRef.current || !window.google?.maps?.places) return;
    autocompleteRef.current = new window.google.maps.places.Autocomplete(
      addressInputRef.current,
      {
        componentRestrictions: { country: "us" },
        fields: ["formatted_address", "geometry"],
      },
    );
    (
      autocompleteRef.current as {
        addListener: (e: string, cb: () => void) => void;
      }
    ).addListener("place_changed", () => {
      const ac = autocompleteRef.current as {
        getPlace: () => {
          formatted_address?: string;
          geometry?: { location: { lat: () => number; lng: () => number } };
        };
      };
      const p = ac.getPlace();
      if (!p.formatted_address || !p.geometry) return;
      const newPlace: PlaceSelection = {
        formattedAddress: p.formatted_address,
        lat: p.geometry.location.lat(),
        lng: p.geometry.location.lng(),
      };
      setPlace(newPlace);
      setAddressInput(p.formatted_address);
      setMelissaData(null);
      setStep(2);

      // Fire Melissa lookup in background — do not block step transition
      setMelissaLoading(true);
      fetch("/api/analyzer/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formattedAddress: p.formatted_address,
          locationId,
        }),
      })
        .then((r) => (r.ok ? r.json() : { found: false }))
        .then((data: MelissaResult) => {
          setMelissaData(data);
          if (data.found) {
            const parking: PropertyInfo["parking"] =
              data.garage && data.carport
                ? "both"
                : data.garage
                  ? "garage"
                  : data.carport
                    ? "carport"
                    : "none";
            setPropInfo((prev) => ({
              ...prev,
              beds: prev.beds === "" && data.beds ? data.beds : prev.beds,
              baths: prev.baths === "" && data.baths ? data.baths : prev.baths,
              sqft: prev.sqft === "" && data.sqft ? data.sqft : prev.sqft,
              parking,
              garageSpaces: data.garageSpaces ?? prev.garageSpaces,
              features: [
                ...(data.pool ? ["Pool"] : []),
                ...prev.features.filter((f) => f !== "Pool"),
              ],
            }));
          }
        })
        .catch(() => setMelissaData({ found: false }))
        .finally(() => setMelissaLoading(false));
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!key) return;

    window.initSFRGoogleMaps = () => {
      setGoogleMapsLoaded(true);
      initAutocomplete();
    };

    if (window.google?.maps) {
      setGoogleMapsLoaded(true);
      initAutocomplete();
      return;
    }

    if (!document.getElementById("gmaps-sfr")) {
      const script = document.createElement("script");
      script.id = "gmaps-sfr";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry&callback=initSFRGoogleMaps`;
      script.async = true;
      document.head.appendChild(script);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    if (
      step === 1 &&
      googleMapsLoaded &&
      addressInputRef.current &&
      !autocompleteRef.current
    ) {
      initAutocomplete();
    }
  }, [step, googleMapsLoaded, connectionStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map initialization ──────────────────────────────────────────────────────

  const updateCompMarkers = useCallback(() => {
    if (!gMapRef.current || !window.google?.maps) return;
    const g = window.google.maps;
    const currentIds = new Set(processedComps.map((c) => c.id));
    const filteredIds = new Set(filteredComps.map((c) => c.id));

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        (marker as { setMap: (m: null) => void }).setMap(null);
        markersRef.current.delete(id);
      }
    });

    processedComps.forEach((comp) => {
      if (!comp.latitude || !comp.longitude) return;
      const isFiltered = filteredIds.has(comp.id);
      const isSelected = selectedIds.has(comp.id);

      if (markersRef.current.has(comp.id)) {
        const m = markersRef.current.get(comp.id) as {
          setIcon: (i: unknown) => void;
          setMap: (m: unknown) => void;
        };
        if (!isFiltered) {
          m.setMap(null);
        } else {
          m.setMap(gMapRef.current);
          m.setIcon({
            path: g.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: isSelected ? "#22c55e" : "#eab308",
            fillOpacity: 1,
            strokeColor: "#000000",
            strokeWeight: 1,
          });
        }
      } else if (isFiltered) {
        const icon = {
          path: g.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: isSelected ? "#22c55e" : "#eab308",
          fillOpacity: 1,
          strokeColor: "#000000",
          strokeWeight: 1,
        };
        const marker = new g.Marker({
          position: { lat: comp.latitude, lng: comp.longitude },
          map: gMapRef.current,
          icon,
          title: comp.address,
        });
        marker.addListener("click", () => {
          const compId = comp.id;
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(compId)) next.delete(compId);
            else next.add(compId);
            return next;
          });
          setManuallySelected((prev) => {
            const next = new Set(prev);
            next.add(comp.id);
            return next;
          });
        });
        markersRef.current.set(comp.id, marker);
      }
    });
  }, [processedComps, filteredComps, selectedIds]);

  useEffect(() => {
    if (
      step !== 3 ||
      !googleMapsLoaded ||
      !place ||
      !mapContainerRef.current ||
      gMapRef.current
    )
      return;

    const g = window.google.maps;
    const map = new g.Map(mapContainerRef.current, {
      center: { lat: place.lat, lng: place.lng },
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: g.ControlPosition?.RIGHT_CENTER },
      styles: [
        { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#888888" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a1a" }] },
        {
          featureType: "road",
          elementType: "geometry",
          stylers: [{ color: "#2a2a2a" }],
        },
        {
          featureType: "road",
          elementType: "labels.text.fill",
          stylers: [{ color: "#666666" }],
        },
        {
          featureType: "water",
          elementType: "geometry",
          stylers: [{ color: "#0a0a0a" }],
        },
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
      ],
    });
    gMapRef.current = map;

    subjectMarkerRef.current = new g.Marker({
      position: { lat: place.lat, lng: place.lng },
      map,
      zIndex: 10,
      icon: {
        path: g.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#F5C842",
        fillOpacity: 1,
        strokeColor: "#000000",
        strokeWeight: 2,
      },
      title: "Subject Property",
    });

    circleRef.current = new g.Circle({
      strokeColor: "#F5C842",
      strokeOpacity: 0.4,
      strokeWeight: 1,
      fillColor: "#F5C842",
      fillOpacity: 0.06,
      map,
      center: { lat: place.lat, lng: place.lng },
      radius: filters.radius * 1609.34,
    });

    updateCompMarkers();
  }, [step, googleMapsLoaded, place]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!circleRef.current) return;
    (circleRef.current as { setRadius: (r: number) => void }).setRadius(
      filters.radius * 1609.34,
    );
  }, [filters.radius]);

  useEffect(() => {
    if (step === 3) updateCompMarkers();
  }, [step, processedComps, selectedIds, updateCompMarkers]);

  // ── Comp fetching ───────────────────────────────────────────────────────────

  async function fetchComps() {
    if (!place) return;
    setFetchingComps(true);
    setCompsError("");
    const storageKey = SESSION_KEY(place.formattedAddress);
    console.log("[comps] Storage key:", storageKey);
    try {
      console.log("[comps] Calling Rentcast API...");
      const res = await fetch("/api/analyzer/comps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: place.lat,
          lng: place.lng,
          formattedAddress: place.formattedAddress,
          locationId,
          beds: typeof propInfo.beds === "number" ? propInfo.beds : 0,
          sqft: typeof propInfo.sqft === "number" ? propInfo.sqft : 0,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setCompsError(d.error || "Failed to fetch comps");
        return;
      }
      const data: RawComp[] = await res.json();
      console.log("[comps] Rentcast returned:", data.length, "comps");
      setRawComps(data);
      sessionStorage.setItem(storageKey, JSON.stringify(data));
      console.log("[comps] Writing to storage, count:", data.length);
      const withFreshDays = data.map((c) => ({
        ...c,
        daysAgo: calcDaysSinceSold(c.saleDate),
      }));
      setAllComps(withFreshDays);
    } catch {
      setCompsError("Network error fetching comps. Try again.");
    } finally {
      setFetchingComps(false);
    }
  }

  useEffect(() => {
    if (step !== 3 || !place) return;
    const storageKey = SESSION_KEY(place.formattedAddress);
    console.log("[comps] Storage key:", storageKey);
    const stored = sessionStorage.getItem(storageKey);
    console.log(
      "[comps] Reading from storage:",
      stored ? `found ${JSON.parse(stored).length}` : "not found",
    );
    if (stored) {
      try {
        const data: RawComp[] = JSON.parse(stored);
        setRawComps(data);
        const withFreshDays = data.map((c) => ({
          ...c,
          daysAgo: calcDaysSinceSold(c.saleDate),
        }));
        setAllComps(withFreshDays);
        return;
      } catch {
        // corrupted cache — fall through to fetch
      }
    }
    fetchComps();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Analysis ────────────────────────────────────────────────────────────────

  async function runAnalysis() {
    if (!place) return;
    setAnalyzing(true);
    setAnalysisError("");
    setTab2Unlocked(false);
    setTab3Unlocked(false);
    setCalcResults(null);
    setActiveTab(1);

    try {
      const result = await analyzeSFR({
        subject: {
          address: place.formattedAddress,
          beds: propInfo.beds,
          baths: propInfo.baths,
          sqft: propInfo.sqft,
          parking: propInfo.parking,
          garageSpaces: propInfo.garageSpaces,
          features: propInfo.features,
          condition: propInfo.condition,
        },
        comps: selectedCompsForPayload.map((c) => ({
          address: c.address,
          salePrice: c.salePrice,
          adjustedPrice: c.adjustedPrice,
          adjustments: c.adjustments,
          beds: c.beds,
          baths: c.baths,
          sqft: c.sqft,
          distanceMiles: c.distanceMiles,
          daysSinceSold: c.daysAgo,
          pricePerSqft: c.pricePerSqft,
        })),
      });
      setAnalysis(result);
      setConditionUsedForAnalysis(propInfo.condition);
      setStep(4);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : "Analysis failed. Try again.",
      );
      setStep(4);
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Tab 2 calculator ────────────────────────────────────────────────────────

  function calculateOffer() {
    if (!analysis) return;
    const arv = analysis.arv.estimate;
    const sqft = typeof propInfo.sqft === "number" ? propInfo.sqft : 0;
    const repairs = sqft * REPAIR_RATES[repairLevel];
    const pctAmount = arv * (investorPct / 100);
    const endBuyerMax = pctAmount - repairs;
    const mao = endBuyerMax - wholesaleFee;
    const anchorOffer = mao * 0.8;
    setCalcResults({ pctAmount, endBuyerMax, mao, anchorOffer });
    setTab3Unlocked(true);
    setActiveTab(3);
  }

  // ── Save flow ───────────────────────────────────────────────────────────────

  function openSaveModal() {
    if (!place || !analysis || !calcResults) return;
    setSaveModalOpen(true);
    setSaveModalSearching(true);
    setSaveModalContacts([]);
    setSaveModalSelection(null);
    setSaveModalSellerName("");
    fetch("/api/analyzer/search-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, address: place.formattedAddress }),
    })
      .then((r) => r.json())
      .then((data) => setSaveModalContacts(data.contacts ?? []))
      .catch(() => setSaveModalContacts([]))
      .finally(() => setSaveModalSearching(false));
  }

  async function performSave(contactId: string | null, skipGhl: boolean) {
    if (!place || !analysis || !calcResults) return;
    setSaving(true);
    setSaveModalSaving(true);
    const sqft = typeof propInfo.sqft === "number" ? propInfo.sqft : 0;
    const repairs = sqft * REPAIR_RATES[repairLevel];
    try {
      const payload = {
        locationId,
        address: place.formattedAddress,
        dealType: "sfr",
        arv: analysis.arv.estimate,
        endBuyerMax: calcResults.endBuyerMax,
        repairLevel,
        repairs,
        wholesaleFee,
        mao: calcResults.mao,
        anchorOffer: calcResults.anchorOffer,
        investorPct,
        narrative: analysis.narrative,
        compsUsed: selectedCompsForPayload.length,
        contactId,
        skipGhl,
        beds: typeof propInfo.beds === "number" ? propInfo.beds : null,
        baths: typeof propInfo.baths === "number" ? propInfo.baths : null,
        sqft: typeof propInfo.sqft === "number" ? propInfo.sqft : null,
        arvLow: analysis.arv.low,
        arvHigh: analysis.arv.high,
        arvConfidence: analysis.arv.confidence,
        asIsValue: analysis.as_is.value,
        asIsLow: analysis.as_is.low,
        asIsHigh: analysis.as_is.high,
        exitStrategy: analysis.exit_strategy.recommendation,
        warnings: analysis.warnings,
        compsJson: JSON.stringify(selectedCompsForPayload),
        compsRawJson: JSON.stringify(rawComps),
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
      };
      console.log("[save] Payload being sent:", JSON.stringify(payload));
      const res = await fetch("/api/analyzer/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setSaveModalOpen(false);
      if (!res.ok) {
        setSaveFeedback({
          text: data.error || "Save failed. Try again.",
          variant: "error",
        });
      } else if (skipGhl) {
        setSaveFeedback({ text: "Saved locally.", variant: "success" });
      } else if (data.ghlSynced) {
        setSaveFeedback({
          text: "Saved and synced to CRM.",
          variant: "success",
        });
      } else {
        setSaveFeedback({
          text: "Saved locally. CRM sync failed — click again to retry.",
          variant: "warning",
        });
      }
    } catch {
      setSaveFeedback({ text: "Network error. Try again.", variant: "error" });
      setSaveModalOpen(false);
    } finally {
      setSaving(false);
      setSaveModalSaving(false);
      setTimeout(() => setSaveFeedback(null), 4000);
    }
  }

  async function handleSaveModalConfirm() {
    if (!saveModalSelection) return;

    if (saveModalSelection === "skip") {
      await performSave(null, true);
      return;
    }

    if (saveModalSelection === "new") {
      if (!saveModalSellerName.trim() || !place) return;
      setSaveModalSaving(true);
      let newContactId: string | null = null;
      try {
        const nameParts = saveModalSellerName.trim().split(/\s+/);
        const firstName = nameParts[0] ?? "";
        const lastName = nameParts.slice(1).join(" ");
        const res = await fetch("/api/analyzer/create-contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            firstName,
            lastName,
            address1: place.formattedAddress,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          newContactId = data.contactId ?? null;
        }
      } catch {
        // proceed without contactId
      }
      await performSave(newContactId, false);
      return;
    }

    // Existing contact selected
    await performSave(saveModalSelection, false);
  }

  // ── Step 2 validation ───────────────────────────────────────────────────────

  function validateStep2(): boolean {
    const errs: Record<string, string> = {};
    if (propInfo.beds === "") errs.beds = "Bedrooms is required";
    if (propInfo.baths === "") errs.baths = "Bathrooms is required";
    if (propInfo.sqft === "") errs.sqft = "Square footage is required";
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function toggleFeature(f: string) {
    setPropInfo((p) => ({
      ...p,
      features: p.features.includes(f)
        ? p.features.filter((x) => x !== f)
        : [...p.features, f],
    }));
  }

  function toggleComp(id: string) {
    const isCurrentlySelected = selectedIds.has(id);
    if (isCurrentlySelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setManuallySelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        n.add(id);
        return n;
      });
      setManuallySelected((prev) => {
        const n = new Set(prev);
        n.add(id);
        return n;
      });
    }
  }

  function handleSort(col: string) {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortCol(null);
      setSortDir(null);
    }
  }

  function resetAll() {
    setStep(1);
    setPlace(null);
    setAddressInput("");
    setPropInfo({
      beds: "",
      baths: "",
      sqft: "",
      parking: "none",
      garageSpaces: 1,
      features: [],
      condition: "light",
    });
    setRawComps([]);
    setAllComps([]);
    setSelectedIds(new Set());
    setManuallySelected(new Set());
    setFilters({
      radius: 1,
      days: null,
      sqftRange: null,
      yearRange: null,
      bedsRange: null,
    });
    setSortCol(null);
    setSortDir(null);
    setShowAdjModal(false);
    setAnalysis(null);
    setAnalysisError("");
    setActiveTab(1);
    setTab2Unlocked(false);
    setTab3Unlocked(false);
    setCalcResults(null);
    setSaveFeedback(null);
    setConditionUsedForAnalysis(null);
    setSaveModalOpen(false);
    setSaveModalContacts([]);
    setSaveModalSelection(null);
    setSaveModalSellerName("");
    setSaveModalSaving(false);
    setMelissaData(null);
    setMelissaLoading(false);
    gMapRef.current = null;
    markersRef.current.clear();
    circleRef.current = null;
    subjectMarkerRef.current = null;
    autocompleteRef.current = null;
  }

  const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ?? "";

  // ── Connection: checking ─────────────────────────────────────────────────────

  if (connectionStatus === "checking") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Spinner className="w-8 h-8 text-white/20" />
      </div>
    );
  }

  // ── Connection: disconnected → modal ─────────────────────────────────────────

  if (connectionStatus === "disconnected") {
    const installUrl =
      `https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation` +
      `?response_type=code` +
      `&redirect_uri=${encodeURIComponent("https://tools.reiblast.app/api/analyzer/callback")}` +
      `&client_id=${process.env.NEXT_PUBLIC_GHL_CLIENT_ID ?? ""}` +
      `&scope=contacts.readonly+contacts.write+locations.readonly` +
      `&state=${locationId ?? ""}`;

    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="bg-surface border border-border-default rounded-2xl p-8 max-w-[420px] w-full text-center">
          <div className="w-14 h-14 bg-gold/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-7 h-7 text-gold"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">
            Connect your account
          </h2>
          <p className="text-white/50 text-sm leading-relaxed mb-8">
            To use the REIblast Deal Analyzer (BETA), you need to connect your
            account. This only takes 30 seconds and is a one-time setup.
          </p>
          <button
            onClick={() => {
              window.location.href = installUrl;
            }}
            className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors mb-4"
          >
            Connect now
          </button>
          <p className="text-white/30 text-xs">
            You&apos;ll be redirected back automatically.
          </p>
        </div>
      </div>
    );
  }

  // ── Deal loading skeleton ────────────────────────────────────────────────────

  if (loadingDeal) {
    return (
      <div className="min-h-screen bg-black text-white">
        <MinimalHeader title="SFR Analyzer" />
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="max-w-3xl mx-auto">
            <AnalysisSkeleton />
          </div>
        </div>
      </div>
    );
  }

  // ── Connected: full analyzer ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Connected success banner */}
      {connectedBanner && (
        <div className="bg-green-400/10 border-b border-green-400/20 px-4 py-3 text-center">
          <p className="text-green-400 text-sm font-medium">
            Account connected. You&apos;re ready to analyze deals.
          </p>
        </div>
      )}

      <MinimalHeader title="SFR Analyzer" />

      {/* ── Save modal ── */}
      {saveModalOpen && place && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-4">
          <div className="bg-surface border border-border-default rounded-2xl p-6 max-w-[440px] w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-1">
              Save deal to REIblast
            </h2>
            <p className="text-white/40 text-sm mb-6 truncate">
              {place.formattedAddress}
            </p>

            {saveModalSearching ? (
              <div className="flex items-center justify-center gap-2 py-10 text-white/40 text-sm">
                <Spinner className="w-4 h-4" />
                <span>Searching your CRM...</span>
              </div>
            ) : (
              <div className="space-y-1 mb-6">
                {/* Existing contacts */}
                {saveModalContacts.map((contact) => (
                  <label
                    key={contact.id}
                    className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${
                      saveModalSelection === contact.id
                        ? "border-gold bg-gold/5"
                        : "border-transparent hover:border-border-default"
                    }`}
                  >
                    <input
                      type="radio"
                      name="save-contact"
                      value={contact.id}
                      checked={saveModalSelection === contact.id}
                      onChange={() => setSaveModalSelection(contact.id)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm">
                        {capitalizeName(contact.name)}
                      </p>
                      {contact.phone && (
                        <p className="text-white/40 text-xs mt-0.5">
                          {contact.phone}
                        </p>
                      )}
                      {contact.address && (
                        <p className="text-white/30 text-xs mt-0.5 truncate">
                          {contact.address}
                        </p>
                      )}
                    </div>
                  </label>
                ))}

                {/* Divider before "Not in CRM" */}
                {saveModalContacts.length > 0 && (
                  <div className="border-t border-border-default my-2" />
                )}

                {/* Not in CRM */}
                <label
                  className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${
                    saveModalSelection === "new"
                      ? "border-gold bg-gold/5"
                      : "border-transparent hover:border-border-default"
                  }`}
                >
                  <input
                    type="radio"
                    name="save-contact"
                    value="new"
                    checked={saveModalSelection === "new"}
                    onChange={() => setSaveModalSelection("new")}
                    className="mt-0.5 accent-gold shrink-0"
                  />
                  <div className="min-w-0 w-full">
                    <p className="text-white/60 text-sm italic">Not in CRM</p>
                  </div>
                </label>

                {/* Seller name input — only when "Not in CRM" selected */}
                {saveModalSelection === "new" && (
                  <div className="pl-7 pt-1">
                    <input
                      type="text"
                      value={saveModalSellerName}
                      onChange={(e) => setSaveModalSellerName(e.target.value)}
                      placeholder="Full name"
                      autoFocus
                      className="w-full bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-white/30"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setSaveModalOpen(false)}
                disabled={saveModalSaving}
                className="flex-1 border border-border-default text-white/50 font-semibold py-3 rounded-xl hover:border-white/20 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveModalConfirm}
                disabled={
                  saveModalSearching ||
                  saveModalSaving ||
                  !saveModalSelection ||
                  (saveModalSelection === "new" && !saveModalSellerName.trim())
                }
                className="flex-1 bg-gold text-black font-bold py-3 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saveModalSaving ? (
                  <>
                    <Spinner className="w-4 h-4" />
                    Saving…
                  </>
                ) : (
                  "Save Deal →"
                )}
              </button>
            </div>

            {/* Skip link */}
            <button
              onClick={() => performSave(null, true)}
              disabled={saveModalSaving}
              className="w-full text-white/30 text-xs py-3 hover:text-white/60 transition-colors text-center mt-1 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Skip and save locally only
            </button>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6">
        <StepProgress step={step} />

        {/* ── STEP 1: Address ── */}
        {step === 1 && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-xl font-bold mb-2 text-center">
              Enter the property address
            </h2>
            <p className="text-white/40 text-sm mb-8 text-center">
              We&apos;ll pull comps and let you confirm property details.
            </p>
            <div className="relative mb-3">
              <input
                ref={addressInputRef}
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="123 Main St, Dallas TX"
                className="w-full bg-surface-2 text-white rounded-xl border border-border-default focus:border-gold px-5 py-4 text-base outline-none transition-colors placeholder:text-white/30"
              />
            </div>
            <p className="text-white/30 text-xs text-center">
              Select from the dropdown — we need the coordinates.
            </p>
          </div>
        )}

        {/* ── STEP 2: Property Confirmation ── */}
        {step === 2 && place && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg font-bold mb-1">Confirm property details</h2>
            {melissaLoading ? (
              <div className="flex items-center gap-2 text-white/30 text-xs mb-6">
                <Spinner className="w-3 h-3" />
                Looking up property data…
              </div>
            ) : (
              <p className="text-white/40 text-sm mb-6">
                Verify the details below and make any corrections before pulling
                comps.
              </p>
            )}

            {/* Street View + Satellite */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-xl overflow-hidden border border-border-default">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${place.lat},${place.lng}&key=${MAPS_KEY}`}
                  alt="Street view"
                  className="w-full h-40 object-cover"
                />
                <p className="text-white/30 text-[10px] text-center py-1.5">
                  Street View
                </p>
              </div>
              <div className="rounded-xl overflow-hidden border border-border-default">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://maps.googleapis.com/maps/api/staticmap?center=${place.lat},${place.lng}&zoom=19&size=600x300&maptype=satellite&key=${MAPS_KEY}`}
                  alt="Satellite view"
                  className="w-full h-40 object-cover"
                />
                <p className="text-white/30 text-[10px] text-center py-1.5">
                  Satellite
                </p>
              </div>
            </div>

            {/* Read-only address/coords */}
            <div className="bg-surface border border-border-default rounded-xl p-4 mb-6">
              <div className="mb-3">
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">
                  Address
                </p>
                <p className="text-white font-medium text-sm">
                  {place.formattedAddress}
                </p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">
                  Coordinates
                </p>
                <p className="text-white/60 text-sm font-mono">
                  {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                </p>
              </div>
            </div>

            {/* Property intel card */}
            {melissaData?.found && !melissaLoading && (
              <div className="bg-surface-2 border border-border-default rounded-xl p-4 mb-6">
                <p className="text-white/30 text-[10px] uppercase tracking-wider mb-3">
                  Property intel
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                  {melissaData.ownerName && (
                    <div>
                      <p className="text-white/25 text-[10px] mb-0.5">Owner</p>
                      <p className="text-white/60 text-xs">
                        {melissaData.ownerName} —{" "}
                        {melissaData.ownerOccupied
                          ? "Owner occupied"
                          : "Absentee owner"}
                      </p>
                    </div>
                  )}
                  {melissaData.lastSalePrice ? (
                    <div>
                      <p className="text-white/25 text-[10px] mb-0.5">
                        Last sale
                      </p>
                      <p className="text-white/60 text-xs">
                        {fmt(melissaData.lastSalePrice)}
                        {melissaData.lastSaleDate
                          ? ` on ${new Date(melissaData.lastSaleDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : ""}
                      </p>
                    </div>
                  ) : null}
                  {melissaData.assessedValue ? (
                    <div>
                      <p className="text-white/25 text-[10px] mb-0.5">
                        Assessed value
                      </p>
                      <p className="text-white/60 text-xs">
                        {fmt(melissaData.assessedValue)}
                      </p>
                    </div>
                  ) : null}
                  {melissaData.estimatedValue ? (
                    <div>
                      <p className="text-white/25 text-[10px] mb-0.5">
                        Estimated value
                      </p>
                      <p className="text-white/60 text-xs">
                        {fmt(melissaData.estimatedValue)}
                        {melissaData.estimatedValueMin &&
                        melissaData.estimatedValueMax
                          ? ` (${fmt(melissaData.estimatedValueMin)} – ${fmt(melissaData.estimatedValueMax)})`
                          : ""}
                      </p>
                    </div>
                  ) : null}
                  {melissaData.mortgageAmount ? (
                    <div>
                      <p className="text-white/25 text-[10px] mb-0.5">
                        Mortgage
                      </p>
                      <p className="text-white/60 text-xs">
                        {fmt(melissaData.mortgageAmount)}
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-white/25 text-[10px] mb-0.5">
                      Tax delinquent
                    </p>
                    <p className="text-white/60 text-xs">
                      {melissaData.taxDelinquentYear || "No"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Beds / Baths / Sqft */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {(
                [
                  { key: "beds", label: "Bedrooms", placeholder: "3" },
                  { key: "baths", label: "Bathrooms", placeholder: "2" },
                  { key: "sqft", label: "Square Footage", placeholder: "1500" },
                ] as {
                  key: "beds" | "baths" | "sqft";
                  label: string;
                  placeholder: string;
                }[]
              ).map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">
                    {label}
                  </label>
                  <input
                    type="number"
                    value={propInfo[key] === "" ? "" : propInfo[key]}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPropInfo((p) => ({
                        ...p,
                        [key]: v === "" ? "" : Number(v),
                      }));
                      setValidationErrors((prev) => ({ ...prev, [key]: "" }));
                    }}
                    placeholder={placeholder}
                    min="0"
                    className={`w-full bg-surface-2 text-white rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-white/20 ${
                      validationErrors[key]
                        ? "border-red-500"
                        : "border-border-default focus:border-gold"
                    }`}
                  />
                  {validationErrors[key] && (
                    <p className="text-red-400 text-xs mt-1">
                      {validationErrors[key]}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Parking */}
            <div className="mb-6">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">
                Parking
              </p>
              <div className="grid grid-cols-4 gap-2">
                {(["garage", "carport", "both", "none"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() =>
                      setPropInfo((prev) => ({ ...prev, parking: p }))
                    }
                    className={`py-2.5 rounded-lg border text-sm font-medium capitalize transition-colors ${
                      propInfo.parking === p
                        ? "bg-gold text-black border-gold"
                        : "bg-surface-2 text-white/50 border-border-default hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {(propInfo.parking === "garage" ||
                propInfo.parking === "both") && (
                <div className="mt-3 flex items-center gap-3">
                  <label className="text-white/40 text-xs uppercase tracking-wider">
                    Garage spaces
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={propInfo.garageSpaces}
                    onChange={(e) =>
                      setPropInfo((p) => ({
                        ...p,
                        garageSpaces: Math.min(
                          4,
                          Math.max(1, Number(e.target.value)),
                        ),
                      }))
                    }
                    className="w-16 bg-surface-2 text-white rounded-lg border border-border-default focus:border-gold px-2 py-1.5 text-sm text-center outline-none"
                  />
                </div>
              )}
            </div>

            {/* Additional features */}
            <div className="mb-6">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">
                Additional features
              </p>
              <div className="flex flex-wrap gap-2">
                {["Pool", "Solar", "Fenced yard", "Shed / outbuilding"].map(
                  (f) => {
                    const on = propInfo.features.includes(f);
                    return (
                      <button
                        key={f}
                        onClick={() => toggleFeature(f)}
                        className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          on
                            ? "bg-gold/20 border-gold text-gold"
                            : "bg-surface-2 border-border-default text-white/50 hover:border-white/20 hover:text-white"
                        }`}
                      >
                        {f}
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            {/* Condition */}
            <div className="mb-8">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">
                Condition
              </p>
              <div className="space-y-2">
                {(
                  [
                    {
                      value: "light",
                      title: "Light cosmetic",
                      desc: "Paint, flooring, fixtures — property is livable",
                    },
                    {
                      value: "full",
                      title: "Full cosmetic + systems",
                      desc: "Kitchen, baths, HVAC, plumbing — real work needed",
                    },
                    {
                      value: "heavy",
                      title: "Heavy rehab",
                      desc: "Full gut, roof, electrical, structural — significant investment",
                    },
                  ] as const
                ).map(({ value, title, desc }) => (
                  <button
                    key={value}
                    onClick={() =>
                      setPropInfo((p) => ({ ...p, condition: value }))
                    }
                    className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${
                      propInfo.condition === value
                        ? "border-gold bg-gold/10"
                        : "border-border-default bg-surface-2 hover:border-white/20"
                    }`}
                  >
                    <p
                      className={`font-semibold text-sm ${propInfo.condition === value ? "text-gold" : "text-white"}`}
                    >
                      {title}
                    </p>
                    <p className="text-white/40 text-xs mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                if (validateStep2()) setStep(3);
              }}
              className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors mb-3"
            >
              Pull Comps →
            </button>
            <button
              onClick={() => setStep(1)}
              className="w-full text-white/40 text-sm py-2 hover:text-white transition-colors"
            >
              ← Change address
            </button>
          </div>
        )}

        {/* ── STEP 3: Comp Selection ── */}
        {step === 3 && (
          <div className="relative flex flex-col gap-4">
            {/* Adjustment modal — in-flow overlay */}
            {showAdjModal && (
              <div
                className="absolute inset-0 bg-black/80 z-20 flex items-center justify-center rounded-xl"
                style={{ minHeight: 320 }}
              >
                <div className="bg-surface border border-border-default rounded-xl p-6 max-w-md w-full mx-4">
                  <h3 className="text-[15px] font-medium text-white mb-3">
                    How sale prices are adjusted
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed mb-4">
                    To make fair comparisons, each comp&apos;s sale price is
                    adjusted based on how its features differ from your subject
                    property. This gives you a normalized price that reflects
                    what the comp would have sold for if it matched your
                    property.
                  </p>
                  <table className="w-full mb-4">
                    <thead>
                      <tr>
                        <th className="text-left text-white/40 text-[11px] uppercase tracking-wider pb-2">
                          Feature
                        </th>
                        <th className="text-right text-white/40 text-[11px] uppercase tracking-wider pb-2">
                          Adjustment
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Extra bedroom on comp", "−$10,000"],
                        ["Missing bedroom vs subject", "+$10,000"],
                        ["Extra bathroom on comp", "−$5,000"],
                        ["Missing bathroom vs subject", "+$5,000"],
                        ["Garage on comp, not on subject", "−$10,000"],
                        ["No garage on comp, subject has one", "+$10,000"],
                        ["Garage spaces difference", "±$5,000/space"],
                        ["Carport difference", "±$5,000"],
                        ["Pool on comp, not on subject", "−$10,000"],
                        ["No pool on comp, subject has one", "+$10,000"],
                      ].map(([feature, adj]) => (
                        <tr
                          key={feature}
                          className="border-t border-border-default"
                        >
                          <td className="py-2 text-white/60 text-xs pr-4">
                            {feature}
                          </td>
                          <td className="py-2 text-white text-xs text-right font-medium">
                            {adj}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-white/30 text-xs italic leading-relaxed mb-4">
                    The adjusted price is what the AI uses to calculate ARV and
                    as-is value. Original prices are shown for reference.
                  </p>
                  <button
                    onClick={() => setShowAdjModal(false)}
                    className="w-full bg-surface-2 border border-border-default text-white/60 font-semibold py-2.5 rounded-lg hover:text-white hover:border-white/20 transition-colors text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {/* 1. Map */}
            <div
              className="relative rounded-xl overflow-hidden border border-border-default"
              style={{ height: "40vh", minHeight: 240 }}
            >
              <div ref={mapContainerRef} className="w-full h-full" />
              {!googleMapsLoaded && <Skeleton className="absolute inset-0" />}
            </div>

            {/* 2. Filter bar */}
            <div className="bg-surface border border-border-default rounded-xl p-3">
              <div className="grid grid-cols-5 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">
                    Radius
                  </label>
                  <select
                    value={filters.radius}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        radius: Number(e.target.value) as Filters["radius"],
                      }))
                    }
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value={0.25}>0.25 mi</option>
                    <option value={0.5}>0.5 mi</option>
                    <option value={1}>1 mi</option>
                    <option value={2}>2 mi</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">
                    Sold within
                  </label>
                  <select
                    value={filters.days ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilters((f) => ({
                        ...f,
                        days:
                          v === ""
                            ? null
                            : (Number(v) as Filters["days"] & number),
                      }));
                    }}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value="">Any</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>180 days</option>
                    <option value={365}>1 year</option>
                    <option value={730}>2 years</option>
                    <option value={1095}>3 years</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">
                    Sqft range
                  </label>
                  <select
                    value={filters.sqftRange ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilters((f) => ({
                        ...f,
                        sqftRange:
                          v === ""
                            ? null
                            : (Number(v) as Filters["sqftRange"] & number),
                      }));
                    }}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value="">Any</option>
                    <option value={100}>±100</option>
                    <option value={250}>±250</option>
                    <option value={500}>±500</option>
                    <option value={750}>±750</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">
                    Year built
                  </label>
                  <select
                    value={filters.yearRange ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilters((f) => ({
                        ...f,
                        yearRange: v === "" ? null : (Number(v) as 5 | 10 | 20),
                      }));
                    }}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value="">Any</option>
                    <option value={5}>±5 yrs</option>
                    <option value={10}>±10 yrs</option>
                    <option value={20}>±20 yrs</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-white/30 text-[11px] uppercase tracking-wider">
                    Bedrooms
                  </label>
                  <select
                    value={filters.bedsRange ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilters((f) => ({
                        ...f,
                        bedsRange: v === "" ? null : (Number(v) as 0 | 1 | 2),
                      }));
                    }}
                    className="bg-surface-2 text-white text-xs border border-border-default rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-gold w-full"
                  >
                    <option value="">Any</option>
                    <option value={0}>Exact match</option>
                    <option value={1}>±1</option>
                    <option value={2}>±2</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 3. Comp count row + warning banners */}
            <div className="flex items-center justify-between px-1">
              <p className="text-white/50 text-sm">
                {allComps.length} properties loaded · {sortedTableComps.length}{" "}
                shown · {selectedCount} selected
              </p>
            </div>

            {!fetchingComps && selectedCount === 0 && (
              <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 text-yellow-400 text-sm">
                No comps selected. Analysis will use limited data and confidence
                will be low.
              </div>
            )}

            {!fetchingComps && selectedCount > 0 && selectedCount < 3 && (
              <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl px-4 py-3 text-yellow-400 text-sm">
                Only {selectedCount} comp{selectedCount === 1 ? "" : "s"}{" "}
                selected. Consider adding more for a more accurate analysis.
              </div>
            )}

            {/* 4. Comp table */}
            {fetchingComps ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((k) => (
                  <div
                    key={k}
                    className="bg-surface border border-border-default rounded-xl p-4 flex gap-3"
                  >
                    <Skeleton className="w-20 h-14 shrink-0 rounded" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : compsError ? (
              <div className="text-center py-10">
                <p className="text-red-400 text-sm mb-3">{compsError}</p>
                <button
                  onClick={() => fetchComps()}
                  className="text-gold hover:underline text-sm"
                >
                  Try again
                </button>
              </div>
            ) : sortedTableComps.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-10">
                No comparable sales found in this area. Try expanding your
                filters.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border-default">
                <table
                  style={{ tableLayout: "fixed", width: "100%", minWidth: 692 }}
                >
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: 52 }} />
                    <col style={{ width: 52 }} />
                    <col style={{ width: 64 }} />
                    <col style={{ width: 56 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 62 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border-default bg-surface">
                      <th className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                someVisibleSelected && !allVisibleSelected;
                          }}
                          onChange={(e) => {
                            const ids = sortedTableComps.map((c) => c.id);
                            if (e.target.checked) {
                              setSelectedIds((prev) => {
                                const n = new Set(prev);
                                ids.forEach((id) => n.add(id));
                                return n;
                              });
                              setManuallySelected((prev) => {
                                const n = new Set(prev);
                                ids.forEach((id) => n.add(id));
                                return n;
                              });
                            } else {
                              const toRemove = new Set(ids);
                              setSelectedIds((prev) => {
                                const n = new Set(prev);
                                toRemove.forEach((id) => n.delete(id));
                                return n;
                              });
                              setManuallySelected((prev) => {
                                const n = new Set(prev);
                                toRemove.forEach((id) => n.delete(id));
                                return n;
                              });
                            }
                          }}
                          style={{ accentColor: "#DABD59" }}
                          className="cursor-pointer"
                        />
                      </th>
                      {[
                        {
                          key: "address",
                          label: "Address",
                          align: "left" as const,
                        },
                        { key: "beds", label: "Beds", align: "right" as const },
                        {
                          key: "baths",
                          label: "Baths",
                          align: "right" as const,
                        },
                        { key: "sqft", label: "Sqft", align: "right" as const },
                        {
                          key: "built",
                          label: "Built",
                          align: "right" as const,
                        },
                        { key: "sold", label: "Sold", align: "left" as const },
                        { key: "dist", label: "Dist", align: "right" as const },
                      ].map(({ key, label, align }) => (
                        <th
                          key={key}
                          onClick={() => handleSort(key)}
                          className={`p-2 text-[11px] font-medium uppercase tracking-wider cursor-pointer select-none ${
                            sortCol === key ? "text-white" : "text-white/40"
                          } ${align === "right" ? "text-right" : "text-left"}`}
                        >
                          <span
                            className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end" : ""}`}
                          >
                            {label}
                            <SortIndicator
                              col={key}
                              sortCol={sortCol}
                              sortDir={sortDir}
                            />
                          </span>
                        </th>
                      ))}
                      <th className="p-2 text-right">
                        <span className="inline-flex items-center gap-0.5 justify-end">
                          <button
                            onClick={() => handleSort("price")}
                            className={`text-[11px] font-medium uppercase tracking-wider cursor-pointer ${
                              sortCol === "price"
                                ? "text-white"
                                : "text-white/40"
                            }`}
                          >
                            Sale price
                          </button>
                          <SortIndicator
                            col="price"
                            sortCol={sortCol}
                            sortDir={sortDir}
                          />
                          <div className="relative group ml-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowAdjModal(true);
                              }}
                              className="w-[15px] h-[15px] rounded-full border border-white/30 text-white/40 hover:text-white hover:border-white/60 transition-colors flex items-center justify-center text-[10px] font-bold"
                            >
                              i
                            </button>
                            <div className="absolute right-0 bottom-full mb-2 w-60 bg-surface border border-border-default rounded-lg p-3 text-xs text-white/60 leading-relaxed z-30 hidden group-hover:block shadow-lg">
                              Prices adjusted for differences in beds, baths,
                              garage, carport, and pool vs your subject
                              property.{" "}
                              <button
                                onClick={() => setShowAdjModal(true)}
                                className="text-gold underline"
                              >
                                Learn more
                              </button>
                            </div>
                          </div>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {sortedTableComps.map((comp) => {
                      const selected = selectedIds.has(comp.id);
                      const isOutsideFilter = !filteredIdsSet.has(comp.id);
                      const totalAdj = comp.adjustments.reduce(
                        (s, a) => s + a.amount,
                        0,
                      );
                      return (
                        <tr
                          key={comp.id}
                          onClick={() => toggleComp(comp.id)}
                          className={`cursor-pointer transition-colors hover:bg-surface-2 ${isOutsideFilter ? "opacity-70" : ""}`}
                        >
                          <td
                            className="p-2 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleComp(comp.id)}
                              style={{ accentColor: "#DABD59" }}
                              className="cursor-pointer"
                            />
                          </td>
                          <td className="p-2">
                            <p className="text-[13px] text-white truncate leading-tight">
                              {comp.address}
                            </p>
                            <p className="text-[11px] text-white/40 truncate">
                              {comp.city}, {comp.state} {comp.zip}
                              {isOutsideFilter && (
                                <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400 font-medium">
                                  outside filter
                                </span>
                              )}
                            </p>
                          </td>
                          <td className="p-2 text-right text-[13px] text-white/80">
                            {comp.beds}
                          </td>
                          <td className="p-2 text-right text-[13px] text-white/80">
                            {comp.baths}
                          </td>
                          <td className="p-2 text-right text-[13px] text-white/80">
                            {comp.sqft?.toLocaleString()}
                          </td>
                          <td className="p-2 text-right text-[13px] text-white/80">
                            {comp.yearBuilt}
                          </td>
                          <td className="p-2 text-[13px] text-white/80">
                            {relativeDate(comp.daysAgo)}
                          </td>
                          <td className="p-2 text-right text-[13px] text-white/80">
                            {comp.distanceMiles.toFixed(2)} mi
                          </td>
                          <td className="p-2 text-right">
                            {comp.priceSource === "none" ? (
                              <p className="text-[13px] text-white/30 italic">
                                No data
                              </p>
                            ) : (
                              <>
                                <p className="text-[13px] font-medium text-white">
                                  {fmt(comp.adjustedPrice)}
                                  {comp.priceSource === "assessment" && (
                                    <span className="ml-1 text-[10px] font-normal text-white/30 not-italic">
                                      Assessed
                                    </span>
                                  )}
                                </p>
                                {totalAdj !== 0 && (
                                  <p className="text-[11px] text-white/40">
                                    (orig {fmt(comp.salePrice)})
                                  </p>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 5. Sticky run analysis bar */}
            <div
              className="sticky bottom-0 bg-surface-2 flex items-center justify-between gap-4 z-10"
              style={{ borderTop: "0.5px solid #2A2A2A", padding: "10px 14px" }}
            >
              <div>
                {analyzing ? (
                  <p className="text-white/50 text-sm">
                    Analyzing… this takes 10–20 seconds
                  </p>
                ) : (
                  <p className="text-white/50 text-sm">
                    {selectedCount} comps selected
                  </p>
                )}
              </div>
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shrink-0 ${
                  analyzing
                    ? "bg-surface border border-border-default text-white/20 cursor-not-allowed"
                    : selectedCount === 0
                      ? "bg-yellow-400/80 text-black hover:bg-yellow-400"
                      : "bg-[#DABD59] text-black hover:bg-gold-hover"
                }`}
              >
                {analyzing ? (
                  <>
                    <Spinner className="w-4 h-4" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                      <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
                    </svg>
                    {selectedCount === 0
                      ? "Run analysis (limited data)"
                      : "Run analysis"}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Results ── */}
        {step === 4 && (
          <div className="max-w-3xl mx-auto">
            {/* Condition change banner */}
            {analysis &&
              conditionUsedForAnalysis &&
              propInfo.condition !== conditionUsedForAnalysis && (
                <div className="mb-6 bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4 flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="text-yellow-400 font-semibold text-sm">
                      Your repair condition has changed.
                    </p>
                    <p className="text-yellow-400/70 text-xs mt-0.5">
                      Re-run the analysis to get accurate results.
                    </p>
                  </div>
                  <button
                    onClick={runAnalysis}
                    disabled={analyzing}
                    className="text-yellow-400 border border-yellow-400/40 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-yellow-400/10 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {analyzing ? "Running…" : "Re-run analysis"}
                  </button>
                </div>
              )}

            {/* Tabs */}
            <div className="flex gap-1 bg-surface rounded-xl p-1 mb-6">
              {[
                { n: 1 as const, label: "AI Analysis" },
                {
                  n: 2 as const,
                  label: "Deal Calculator",
                  locked: !tab2Unlocked,
                },
                {
                  n: 3 as const,
                  label: "Offer Results",
                  locked: !tab3Unlocked,
                },
              ].map(({ n, label, locked }) => (
                <button
                  key={n}
                  onClick={() => !locked && setActiveTab(n)}
                  disabled={!!locked}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === n
                      ? "bg-gold text-black"
                      : locked
                        ? "text-white/20 cursor-not-allowed"
                        : "text-white/50 hover:text-white"
                  }`}
                >
                  {locked && (
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  )}
                  {label}
                </button>
              ))}
            </div>

            {/* ── TAB 1: AI Analysis ── */}
            {activeTab === 1 && (
              <div>
                {analyzing ? (
                  <AnalysisSkeleton />
                ) : analysisError ? (
                  <div className="text-center py-16">
                    <p className="text-red-400 mb-4 text-sm">{analysisError}</p>
                    <button
                      onClick={() => setStep(3)}
                      className="text-gold hover:underline text-sm"
                    >
                      ← Back to comps
                    </button>
                  </div>
                ) : analysis ? (
                  <div className="space-y-5">
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          gMapRef.current = null;
                          markersRef.current.clear();
                          circleRef.current = null;
                          subjectMarkerRef.current = null;
                          setStep(3);
                        }}
                        disabled={allComps.length === 0}
                        className="flex items-center gap-1.5 text-sm text-white/40 border border-border-default rounded-lg px-3 py-1.5 hover:text-white hover:border-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg
                          className="w-3.5 h-3.5 shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                        Re-run with different comps
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-surface border border-gold rounded-xl p-5">
                        <p className="text-gold text-[10px] uppercase tracking-wider mb-1">
                          After Repair Value
                        </p>
                        <p className="text-white/40 text-xs mb-1">
                          {fmt(analysis.arv.low)} — {fmt(analysis.arv.high)}
                        </p>
                        <p className="text-white text-2xl font-bold mb-2">
                          {fmt(analysis.arv.estimate)}
                        </p>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            analysis.arv.confidence === "high"
                              ? "bg-green-400/15 text-green-400"
                              : analysis.arv.confidence === "medium"
                                ? "bg-yellow-400/15 text-yellow-400"
                                : "bg-red-400/15 text-red-400"
                          }`}
                        >
                          {analysis.arv.confidence} confidence
                        </span>
                        <p className="text-white/30 text-[11px] mt-2 italic leading-relaxed">
                          {analysis.arv.confidence_reason}
                        </p>
                      </div>

                      <div className="bg-surface border border-border-default rounded-xl p-5">
                        <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">
                          As-Is Value
                        </p>
                        {analysis.as_is.value != null ? (
                          <>
                            <p className="text-white/40 text-xs mb-1">
                              {analysis.as_is.low != null
                                ? fmt(analysis.as_is.low)
                                : "—"}{" "}
                              —{" "}
                              {analysis.as_is.high != null
                                ? fmt(analysis.as_is.high)
                                : "—"}
                            </p>
                            <p className="text-white text-2xl font-bold mb-2">
                              {fmt(analysis.as_is.value)}
                            </p>
                          </>
                        ) : (
                          <p className="text-white/30 text-sm mt-2 mb-4">
                            Not enough AS_IS comps
                          </p>
                        )}
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            analysis.exit_strategy.recommendation ===
                            "WHOLESALE"
                              ? "bg-gold/15 text-gold"
                              : analysis.exit_strategy.recommendation ===
                                  "FIX_AND_FLIP"
                                ? "bg-blue-400/15 text-blue-400"
                                : analysis.exit_strategy.recommendation ===
                                    "SUBJECT_TO"
                                  ? "bg-purple-400/15 text-purple-400"
                                  : "bg-red-400/15 text-red-400"
                          }`}
                        >
                          {analysis.exit_strategy.recommendation.replace(
                            "_",
                            " ",
                          )}
                        </span>
                        <p className="text-white/30 text-[11px] mt-2 italic leading-relaxed">
                          {analysis.as_is.note}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {[
                        { label: "Beds", value: propInfo.beds },
                        { label: "Baths", value: propInfo.baths },
                        {
                          label: "Sqft",
                          value:
                            typeof propInfo.sqft === "number"
                              ? propInfo.sqft.toLocaleString()
                              : propInfo.sqft,
                        },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          className="bg-surface-2 rounded-lg px-3 py-2"
                        >
                          <p className="text-white/30 text-[10px]">{label}</p>
                          <p className="text-white font-semibold text-sm">
                            {value || "—"}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">
                        Comp Breakdown
                      </p>
                      <div className="space-y-2">
                        {analysis.comps.map((comp, i) => {
                          const original = selectedCompsForPayload.find(
                            (c) => c.address === comp.address,
                          );
                          return (
                            <div
                              key={i}
                              className="bg-surface border border-border-default rounded-xl p-4 flex gap-3"
                            >
                              {original?.latitude &&
                              original?.longitude &&
                              MAPS_KEY ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`https://maps.googleapis.com/maps/api/streetview?size=160x120&location=${original.latitude},${original.longitude}&key=${MAPS_KEY}`}
                                  alt=""
                                  className="w-16 h-12 object-cover rounded-lg shrink-0"
                                />
                              ) : (
                                <div className="w-16 h-12 bg-surface-2 rounded-lg shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <p className="text-white text-xs font-semibold truncate">
                                    {comp.address}
                                  </p>
                                  <span
                                    className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                      comp.type === "RENOVATED"
                                        ? "bg-blue-400/15 text-blue-400"
                                        : "bg-orange-400/15 text-orange-400"
                                    }`}
                                  >
                                    {comp.type}
                                  </span>
                                  <span
                                    className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                      comp.weight === "high"
                                        ? "bg-green-400/10 text-green-400"
                                        : comp.weight === "medium"
                                          ? "bg-yellow-400/10 text-yellow-400"
                                          : "bg-white/5 text-white/40"
                                    }`}
                                  >
                                    {comp.weight} weight
                                  </span>
                                </div>
                                <div className="flex items-baseline gap-2 mb-1.5">
                                  <span className="text-white/40 text-xs line-through">
                                    {fmt(comp.sale_price)}
                                  </span>
                                  <span className="text-white text-sm font-bold">
                                    → {fmt(comp.adjusted_price)}
                                  </span>
                                </div>
                                {original &&
                                  original.adjustments.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {original.adjustments.map((a, j) => (
                                        <span
                                          key={j}
                                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                            a.amount > 0
                                              ? "bg-green-400/10 text-green-400"
                                              : "bg-red-400/10 text-red-400"
                                          }`}
                                        >
                                          {a.label}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-surface border border-border-default rounded-xl p-5">
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">
                        AI Narrative
                      </p>
                      <p className="text-white text-sm leading-relaxed">
                        {analysis.narrative}
                      </p>
                    </div>

                    {analysis.warnings.length > 0 && (
                      <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-xl p-4">
                        <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-2">
                          Flags
                        </p>
                        <ul className="space-y-1">
                          {analysis.warnings.map((w, i) => (
                            <li
                              key={i}
                              className="text-yellow-400/70 text-xs flex gap-2"
                            >
                              <span className="mt-0.5 shrink-0">⚠</span>
                              <span>{w}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="bg-surface border border-border-default rounded-xl p-5">
                      <p className="text-white/30 text-[11px] uppercase tracking-widest mb-2">
                        Exit Strategy
                      </p>
                      <p className="text-white/70 text-sm leading-relaxed">
                        {analysis.exit_strategy.reasoning}
                      </p>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-border-default">
                      <p className="text-white/25 text-[11px] leading-relaxed">
                        ⓘ AriAI can make mistakes. Always verify ARV estimates
                        and comp data with your own due diligence before making
                        an offer.
                      </p>
                      <p className="text-white/25 text-[11px] leading-relaxed">
                        ⓘ Changing your repair tier in the calculator does not
                        update this analysis. Re-run the analysis with your
                        selected condition for the most accurate results.
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setTab2Unlocked(true);
                        setActiveTab(2);
                      }}
                      className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors"
                    >
                      Run the numbers →
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {/* ── TAB 2: Deal Calculator ── */}
            {activeTab === 2 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-white/40 text-xs uppercase tracking-wider">
                      Investor percentage
                    </label>
                    <span className="text-gold font-bold text-lg">
                      {investorPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={80}
                    step={1}
                    value={investorPct}
                    onChange={(e) => setInvestorPct(Number(e.target.value))}
                    className="w-full accent-gold"
                  />
                  <div className="flex justify-between text-white/20 text-xs mt-1">
                    <span>60%</span>
                    <span>80%</span>
                  </div>
                </div>

                {analysis && (
                  <div className="bg-surface-2 border border-border-default rounded-xl p-4">
                    <p className="text-white/40 text-xs uppercase tracking-wider mb-1">
                      ARV (from analysis)
                    </p>
                    <p className="text-white text-2xl font-bold">
                      {fmt(analysis.arv.estimate)}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-white/40 text-xs uppercase tracking-wider mb-3">
                    Repair level
                  </p>
                  <div className="space-y-2">
                    {(
                      [
                        { value: "light", rate: 6 },
                        { value: "full", rate: 17 },
                        { value: "heavy", rate: 40 },
                      ] as { value: "light" | "full" | "heavy"; rate: number }[]
                    ).map(({ value, rate }) => {
                      const est =
                        typeof propInfo.sqft === "number"
                          ? Math.round(propInfo.sqft * rate)
                          : null;
                      return (
                        <button
                          key={value}
                          onClick={() => setRepairLevel(value)}
                          className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${
                            repairLevel === value
                              ? "border-gold bg-gold/10"
                              : "border-border-default bg-surface-2 hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p
                              className={`font-semibold text-sm ${repairLevel === value ? "text-gold" : "text-white"}`}
                            >
                              {REPAIR_LABELS[value]}
                            </p>
                            {est != null && (
                              <p className="text-white/40 text-xs">
                                ~{fmt(est)}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-white/40 text-xs uppercase tracking-wider mb-1.5">
                    Desired wholesale fee
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">
                      $
                    </span>
                    <input
                      type="number"
                      value={wholesaleFee}
                      onChange={(e) => setWholesaleFee(Number(e.target.value))}
                      min={0}
                      className="w-full bg-surface-2 text-white rounded-xl border border-border-default focus:border-gold pl-7 pr-4 py-3 text-base outline-none transition-colors"
                    />
                  </div>
                </div>

                <button
                  onClick={calculateOffer}
                  className="w-full bg-gold text-black font-bold py-4 rounded-xl hover:bg-gold-hover transition-colors"
                >
                  Calculate offer →
                </button>
              </div>
            )}

            {/* ── TAB 3: Offer Results ── */}
            {activeTab === 3 && calcResults && analysis && (
              <div className="space-y-6">
                <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
                  <div className="divide-y divide-border-default">
                    {[
                      {
                        label: "ARV",
                        value: analysis.arv.estimate,
                        indent: false,
                        gold: false,
                      },
                      {
                        label: `× Investor % (${investorPct}%)`,
                        value: calcResults.pctAmount,
                        indent: true,
                        gold: false,
                      },
                      {
                        label: `− Repairs (${REPAIR_LABELS[repairLevel].toLowerCase()})`,
                        value: -(typeof propInfo.sqft === "number"
                          ? propInfo.sqft * REPAIR_RATES[repairLevel]
                          : 0),
                        indent: true,
                        gold: false,
                      },
                    ].map(({ label, value, indent, gold }) => (
                      <div
                        key={label}
                        className={`flex items-center justify-between px-5 py-3.5 ${indent ? "pl-8" : ""}`}
                      >
                        <span className="text-white/50 text-sm">{label}</span>
                        <span
                          className={`font-semibold text-sm ${gold ? "text-gold" : value < 0 ? "text-red-400" : "text-white"}`}
                        >
                          {value < 0 ? `−${fmt(Math.abs(value))}` : fmt(value)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-5 py-3 bg-surface-2">
                      <span className="text-white font-semibold text-sm">
                        End buyer max
                      </span>
                      <span className="text-white font-bold">
                        {fmt(calcResults.endBuyerMax)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5 pl-8">
                      <span className="text-white/50 text-sm">
                        − Wholesale fee
                      </span>
                      <span className="text-red-400 font-semibold text-sm">
                        −{fmt(wholesaleFee)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-4 bg-gold/10">
                      <span className="text-gold font-bold text-base">MAO</span>
                      <span className="text-gold font-bold text-xl">
                        {fmt(calcResults.mao)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div>
                        <p className="text-white font-semibold text-sm">
                          Anchor offer
                        </p>
                        <p className="text-white/30 text-xs mt-0.5">
                          Start here — gives you room to negotiate up to MAO
                        </p>
                      </div>
                      <span className="text-white font-bold text-lg">
                        {fmt(calcResults.anchorOffer)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-surface-2 border border-border-default rounded-xl p-4">
                  <p className="text-white/50 text-xs leading-relaxed">
                    ⚠ Your MAO changes with your wholesale fee. Never submit an
                    offer above end buyer max.
                  </p>
                </div>

                {/* Save feedback */}
                {saveFeedback && (
                  <div
                    className={`rounded-xl px-4 py-3 text-xs leading-relaxed ${
                      saveFeedback.variant === "success"
                        ? "bg-green-400/10 text-green-400"
                        : saveFeedback.variant === "warning"
                          ? "bg-yellow-400/10 text-yellow-400/80"
                          : "bg-red-400/10 text-red-400"
                    }`}
                  >
                    {saveFeedback.text}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setCalcResults(null);
                      setActiveTab(2);
                    }}
                    className="border border-border-default text-white/50 font-semibold py-3 rounded-xl hover:border-white/20 hover:text-white transition-colors"
                  >
                    Start over
                  </button>
                  <button
                    onClick={openSaveModal}
                    disabled={saving}
                    className="bg-gold text-black font-bold py-3 rounded-xl hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving…" : "Add to REIblast"}
                  </button>
                </div>

                <button
                  onClick={resetAll}
                  className="w-full text-white/30 text-sm py-2 hover:text-white transition-colors"
                >
                  ← New analysis
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SFRPage() {
  return (
    <Suspense fallback={null}>
      <SFRContent />
    </Suspense>
  );
}
