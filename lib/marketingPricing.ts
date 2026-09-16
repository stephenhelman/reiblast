/**
 * Single source of truth for REIblast's billing/telecom pricing constants.
 * Previously duplicated as literals in CostEstimatorModal.tsx and the FAQ
 * page copy — both now import from here so a price change can't desync.
 */
export const CORE_PRICE = 57;
export const PHONE_PRICE = 1.265;
export const A2P_SETUP = 23.5;
export const A2P_MONTHLY_SOLE = 2.1;
export const A2P_MONTHLY_LLC = 10.5;
export const TEXT_RATE = 0.0091;
export const DAILY_CAP_SOLE = 3000;
export const DAILY_CAP_LLC = 6000;
export const SEND_DAYS = 22;
export const RAMP_RUNGS = [500, 750, 1000, 1500, 2000, 3500, 5000];
export const TRIAL_DAYS = 5;
