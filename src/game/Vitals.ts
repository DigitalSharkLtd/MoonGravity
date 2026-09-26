import type { Game } from './Game';
import type { Fighter } from './Fighter';

/**
 * Life support: suit integrity, depressurisation, oxygen, suffocation, regen and status timers.
 * Runs on the authority (host/offline) for every fighter.
 *
 * - Suit integrity < 50 % → breach: oxygen leaks (faster the worse the suit is).
 * - Oxygen 0 → suffocation: health drains until death (credited to the last attacker).
 * - Sealant kit (H): 1.2 s channel restores the suit above the breach threshold.
 * - Health regenerates after 6 s without damage, but NOT while the suit is breached.
 */
export function updateVitals(g: Game, f: Fighter, dt: number): void {
  // timers that exist everywhere
  f.spawnProtect = Math.max(0, f.spawnProtect - dt);
  f.empT = Math.max(0, f.empT - dt);
  f.slowT = Math.max(0, f.slowT - dt);
  f.invulnT = Math.max(0, f.invulnT - dt);
  f.revealedT = Math.max(0, f.revealedT - dt);
  f.firingVisual = Math.max(0, f.firingVisual - dt);
  f.lastDamageT += dt;
  f.lastAttackerT += dt;
  if (!f.alive) return;

  // sealant channel
  if (f.sealT > 0) {
    f.sealT -= dt;
    if (f.sealT <= 0) {
      f.sealT = -1;
      f.suit = Math.max(f.suit, Math.min(f.maxSuit, f.suit + f.maxSuit * 0.45, f.maxSuit * 0.75));
      f.oxygen = Math.min(100, f.oxygen + 15);
      g.sound('sealant', f, 1);
    }
  }

  const frac = f.suitFrac;
  const wasBreached = f.breached;
  f.breached = frac < 0.5;
  if (f.breached && !wasBreached) g.onBreach(f);
  if (f.breached && f.invulnT <= 0) {
    const leak = 2.6 + (0.5 - frac) * 16; // % per second
    f.oxygen = Math.max(0, f.oxygen - leak * dt);
  } else if (!f.breached) {
    // closed suit slowly recovers reserve from the life-support pack
    f.oxygen = Math.min(100, f.oxygen + 4 * dt);
  }
  f.suffocating = f.oxygen <= 0;
  if (f.suffocating && f.invulnT <= 0) {
    const attacker = f.lastAttackerT < 60 ? g.fighterById(f.lastAttacker) : null;
    g.damage({ target: f, attacker, amount: 11 * dt, source: 'suffocation', part: 'body', dir: null, point: null, suitMul: 0, silent: true, noCredit: true });
  }
  if (!f.alive) return;
  // regeneration
  if (f.lastDamageT > 6 && !f.breached && f.health < f.maxHealth) {
    f.health = Math.min(f.maxHealth, f.health + 18 * dt);
  }
}

export function leakRate(f: Fighter): number {
  const frac = f.suitFrac;
  return frac < 0.5 ? 2.6 + (0.5 - frac) * 16 : 0;
}
