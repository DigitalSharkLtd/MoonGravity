import type * as THREE from 'three';
import type { Fighter } from './Fighter';
import type { Projectile } from './Combat';
import type { WeaponId } from './Types';

/**
 * Hooks through which the simulation publishes replicated events.
 * Offline play uses the no-op bridge; NetGame implements host/client versions.
 */
export interface NetBridge {
  role: 'offline' | 'host' | 'client';
  fireFx(f: Fighter, weapon: WeaponId, from: THREE.Vector3, to: THREE.Vector3): void;
  projectile(p: Projectile, visualFrom: THREE.Vector3): void;
  boom(p: Projectile, what: string): void;
  ability(f: Fighter, id: string, pos?: THREE.Vector3): void;
}

export const offlineBridge: NetBridge = {
  role: 'offline',
  fireFx() {},
  projectile() {},
  boom() {},
  ability() {},
};
