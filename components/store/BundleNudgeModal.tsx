"use client";

import Modal from "@/components/shared/Modal";
import Button from "@/components/shared/Button";
import { formatCents } from "@/lib/money";
import type { BundleNudge } from "./bundleNudge";
import type { StoreBundle, StoreTool } from "@/types/store";

interface BundleNudgeModalProps {
  nudge: BundleNudge | null;
  tools: StoreTool[];
  onClose: () => void;
  /** Same swap path as the Bundles-tab CTA (StoreClient#applySwap) — filters covered solo items, composes+adds the bundle line via composeBundleCartItem. One shared entry, anti-drift. */
  onApplySwap: (bundle: StoreBundle) => void;
}

const HOOK: Record<BundleNudge["type"], (bundleName: string) => string> = {
  A: (name) => `One more line and you're in ${name}.`,
  B: (name) => `You're one line from ${name}.`,
};

export default function BundleNudgeModal({ nudge, tools, onClose, onApplySwap }: BundleNudgeModalProps) {
  if (!nudge) return null;
  const { bundle, billDeltaCents, valueVsAlaCarteCents, freePackCount, perkValueCents, punchy, type } = nudge;
  const toolNames = Object.fromEntries(tools.map((t) => [t.featureSlug, t.name]));

  const handleGetBundle = () => {
    onApplySwap(bundle);
    onClose();
  };

  return (
    <Modal open={!!nudge} onClose={onClose} className="max-w-md!">
      <div className="flex items-start justify-between gap-4 mb-1">
        <span className="text-[11px] font-semibold tracking-wide text-gold uppercase">
          {type === "A" ? "Complete the bundle" : "Upgrade to Pro"}
        </span>
        <button onClick={onClose} aria-label="Close" className="text-gray hover:text-white text-2xl leading-none px-1.5 -mt-2">
          ×
        </button>
      </div>

      <p className={`leading-snug font-display font-semibold ${punchy ? "text-xl" : "text-lg"}`}>
        {HOOK[type](bundle.name)}
      </p>

      <div className="flex flex-col gap-1.5 mt-4 rounded-xl border border-border-default bg-black px-4 py-3.5">
        {bundle.lines.map((line) => (
          <div key={line.featureSlug + line.level} className="flex items-center justify-between text-[13px]">
            <span className="text-silver">{toolNames[line.featureSlug] ?? line.featureSlug}</span>
            <span className="whitespace-nowrap">
              <span className="text-gray line-through mr-1.5">{formatCents(line.priceCents)}</span>
              <span className="text-white font-medium">in bundle</span>
            </span>
          </div>
        ))}
        {freePackCount > 0 && (
          <div className="flex items-center justify-between text-[13px] pt-1.5 mt-1 border-t border-border-default/60">
            <span className="text-silver">+{freePackCount} packs/mo perk</span>
            <span className="whitespace-nowrap">
              <span className="text-gray line-through mr-1.5">{formatCents(perkValueCents)}</span>
              <span className="text-green font-medium">$0</span>
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm font-semibold pt-2 mt-1 border-t border-border-default">
          <span>{bundle.name} total</span>
          <span>+{formatCents(bundle.priceCents)}/mo</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 mt-3.5 text-[12.5px]">
        <div className="flex justify-between text-green">
          <span>Save vs à-la-carte</span>
          <span>{formatCents(valueVsAlaCarteCents)}/mo</span>
        </div>
        <div className="flex justify-between text-silver">
          <span>Actual bill change</span>
          <span>{billDeltaCents === 0 ? "+$0" : `+${formatCents(billDeltaCents)}`}/mo</span>
        </div>
      </div>

      <div className="flex gap-2.5 mt-5">
        <Button variant="gold-outline" size="sm" className="flex-1" onClick={onClose}>
          Not now
        </Button>
        <Button variant="gold" size="sm" className="flex-1" onClick={handleGetBundle}>
          Get {bundle.name}
        </Button>
      </div>
    </Modal>
  );
}
