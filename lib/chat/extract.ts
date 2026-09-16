import { Lead } from './types';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** Strict-ish single-address validation (whole string must be an email). */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return new RegExp(`^${EMAIL_RE.source}$`).test(v);
}

/**
 * NANP-friendly phone validation: 10 digits, or 11 with a leading country
 * code of 1. Accepts common separators / parentheses around the digits.
 */
export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return true;
  if (digits.length === 11 && digits.startsWith('1')) return true;
  return false;
}

/** Format a 10/11-digit string as (xxx) xxx-xxxx; otherwise return trimmed input. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return value.trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** A name is anything non-empty with at least one letter. */
export function isValidName(value: string): boolean {
  return /[a-zA-Z]/.test(value.trim());
}

export function validateField(field: keyof Lead, value: string): boolean {
  switch (field) {
    case 'email':
      return isValidEmail(value);
    case 'phone':
      return isValidPhone(value);
    case 'name':
      return isValidName(value);
    default:
      return value.trim().length > 0;
  }
}

export function normalizeField(field: keyof Lead, value: string): string {
  if (field === 'phone') return normalizePhone(value);
  if (field === 'email') return value.trim().toLowerCase();
  return value.trim();
}

// --- Opportunistic extraction (used by AI mode in Sprint 2) ---------------

export function extractEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

export function extractPhone(text: string): string | null {
  // Look for a run that contains 10–11 digits among phone-ish characters.
  const candidates = text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g);
  if (!candidates) return null;
  for (const c of candidates) {
    if (isValidPhone(c)) return normalizePhone(c);
  }
  return null;
}

/** Best-effort lead extraction from free text. Email/phone only (no name guessing). */
export function extractLead(text: string): Partial<Lead> {
  const lead: Partial<Lead> = {};
  const email = extractEmail(text);
  const phone = extractPhone(text);
  if (email) lead.email = email;
  if (phone) lead.phone = phone;
  return lead;
}
