import { runBalances } from "./balances";
import { runDiscordOutbox } from "./discordOutbox";
import { runReplay } from "./replay";
import { runSubSweep } from "./subSweep";
import { runTxSweep } from "./txSweep";
import type { JobFn, JobName } from "./types";
import { runWalletMonthRefresh } from "./walletMonthRefresh";
import { runWalletRetention } from "./walletRetention";
import { runWalletUsage } from "./walletUsage";

export const JOBS: Record<JobName, JobFn> = {
  replay: runReplay,
  tx_sweep: runTxSweep,
  wallet_usage: runWalletUsage,
  wallet_month_refresh: runWalletMonthRefresh,
  wallet_retention: runWalletRetention,
  balances: runBalances,
  sub_sweep: runSubSweep,
  discord_outbox: runDiscordOutbox,
};
