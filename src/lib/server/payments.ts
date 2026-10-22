import "server-only";

import { HttpError, badRequest } from "./http";

/**
 * Simulated card processor (test mode). Validates like a real gateway — Luhn checksum,
 * expiry, CVC — and supports the well-known decline test numbers. Card numbers are never
 * persisted; only brand and last four digits end up in the wallet ledger.
 */

export const TEST_CARD_SUCCESS = "4242 4242 4242 4242";
const DECLINES: Record<string, { code: string; message: string }> = {
  "4000000000000002": { code: "CARD_DECLINED", message: "Your card was declined." },
  "4000000000009995": { code: "CARD_INSUFFICIENT_FUNDS", message: "Your card has insufficient funds." },
};

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function brandOf(digits: string): string {
  if (/^4/.test(digits)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  return "Card";
}

export type CardCharge = { brand: string; last4: string };

export function chargeCard(card: { number: string; expiry: string; cvc: string }): CardCharge {
  const digits = card.number.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits) || !luhnValid(digits)) {
    throw badRequest("That card number isn't valid.", "CARD_INVALID");
  }
  const [, mm, yy] = card.expiry.match(/^(\d{2})\s*\/\s*(\d{2})$/) ?? [];
  const expiresAt = new Date(2000 + Number(yy), Number(mm), 1); // first day after the expiry month
  if (!mm || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw badRequest("That card has expired.", "CARD_EXPIRED");
  }
  const brand = brandOf(digits);
  if (brand === "Amex" ? card.cvc.length !== 4 : card.cvc.length !== 3) {
    throw badRequest("The security code doesn't look right.", "CARD_CVC_INVALID");
  }
  const decline = DECLINES[digits];
  if (decline) throw new HttpError(402, decline.code, decline.message);
  return { brand, last4: digits.slice(-4) };
}
