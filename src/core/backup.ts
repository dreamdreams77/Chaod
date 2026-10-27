/**
 * Save backup codes: the whole profile as one line of text that can be copied from one browser
 * and pasted into another. Pure functions (btoa/atob exist in browsers and Node 22).
 */
import { Profile, migrateProfile } from './save.ts';

export const BACKUP_PREFIX = 'CHAOS1:';
const MAX_CODE = 2_000_000;

export function encodeSave(p: Profile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return BACKUP_PREFIX + btoa(bin);
}

/** The profile in a code, cleaned by the normal save migration; null when the text is not a valid code. */
export function decodeSave(text: string): Profile | null {
  const code = text.replace(/\s+/g, '');
  if (!code.startsWith(BACKUP_PREFIX) || code.length > MAX_CODE) return null;
  try {
    const bin = atob(code.slice(BACKUP_PREFIX.length));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    return migrateProfile(raw);
  } catch {
    return null;
  }
}
