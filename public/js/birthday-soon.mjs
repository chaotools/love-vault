import { nextOccurrence, daysUntil } from './lunar.js';

export function isBirthdaySoon(person, now = new Date()) {
  if (!person || !person.birthday) return false;
  const next = nextOccurrence(person.birthday, person.lunar === true, person.leap === true, now);
  if (!next) return false;
  const days = daysUntil(next, now);
  return days >= 0 && days <= 30;
}
