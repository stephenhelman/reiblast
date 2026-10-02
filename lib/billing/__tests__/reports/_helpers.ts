import { AGENCY_CASH_CATEGORIES, ONE_TIME_CATEGORIES, TAX_CATEGORIES } from "../../reports/costs";
export const parseCategoryGroups = () => ({ oneTime: ONE_TIME_CATEGORIES.length, agency: AGENCY_CASH_CATEGORIES.length, tax: TAX_CATEGORIES.length });
