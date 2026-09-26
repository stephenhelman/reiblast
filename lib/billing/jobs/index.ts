import { runBalances } from "./balances";
import { runReplay } from "./replay";
import { runTxSweep } from "./txSweep";
import type { JobFn, JobName } from "./types";
import { runWalletUsage } from "./walletUsage";

export const JOBS: Record<JobName, JobFn> = {
  replay: runReplay,
  tx_sweep: runTxSweep,
  wallet_usage: runWalletUsage,
  balances: runBalances,
};
