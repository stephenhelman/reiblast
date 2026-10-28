"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const pad = (n: number) => String(n).padStart(2, "0");

/** Ticks down to the claim open time and refreshes the page when it arrives so the claim form appears without a reload. */
export default function Countdown({ openAtIso }: { openAtIso: string }) {
  const router = useRouter();
  const target = new Date(openAtIso).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = target - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) router.refresh();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, router]);

  if (left === null) return <p className="text-gold font-extrabold text-3xl tabular-nums">&nbsp;</p>;
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  return (
    <p className="text-gold font-extrabold text-3xl tabular-nums" aria-live="off">
      {d > 0 ? `${d}d ` : ""}
      {pad(Math.floor((s % 86400) / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </p>
  );
}
