import { accountLabel, type LabelInput } from "@/lib/admin/accountLabel";

/** Name, then the last 4 of the locationId in muted text. Use this wherever an admin view lists a location or account. */
export default function AccountLabel(props: LabelInput & { hqLocationId?: string | null }) {
  const { hqLocationId, ...input } = props;
  const l = accountLabel(input, hqLocationId === undefined ? process.env.GHL_HQ_LOCATION_ID : hqLocationId);
  return (
    <span>
      {l.name}
      {l.suffix && <span className="ml-2 text-xs text-white/40">{l.suffix}</span>}
    </span>
  );
}
