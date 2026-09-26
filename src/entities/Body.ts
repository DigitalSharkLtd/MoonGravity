import * as THREE from 'three';
import { PhysicsWorld, Contact, MOON_G } from '../core/Physics';

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  jump: boolean; // held
  jumpPressed: boolean; // pressed this step
  sprint: boolean;
  crouch: boolean;
  yaw: number; // look delta (radians) around body up this step
  pitch: number; // look delta
}

export function emptyInput(): MoveInput {
  return { forward: 0, strafe: 0, jump: false, jumpPressed: false, sprint: false, crouch: false, yaw: 0, pitch: 0 };
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _id = new THREE.Quaternion();

export interface BodyEvents {
  landed: number; // impact speed if landed this step
  attached: boolean; // mag clamp engaged this step
  detached: boolean;
  jumped: boolean;
  footstep: boolean;
  jetStart: boolean;
}

/**
 * Kinematic astronaut body: lunar gravity, low-traction regolith, jetpack,
 * and magnetic boots that let the body walk on any metal surface (walls, facades, ceilings),
 * rolling smoothly around convex edges.
 */
export class Body {
  pos = new THREE.Vector3(); // feet
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  up = new THREE.Vector3(0, 1, 0);
  targetUp = new THREE.Vector3(0, 1, 0);
  pitch = 0;
  radius = 0.42;
  standHeight = 1.85;
  crouchHeight = 1.25;
  height = 1.85;
  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  onMetal = false;
  /** stuck by the mag-boots to a surface (any orientation) */
  attached = false;
  magOn = true;
  magDisabled = 0; // EMP timer
  jetFuel = 1;
  jetting = false;
  jetDelay = 0;
  airTime = 0;
  crouching = false;
  moveSpeed = 0;
  speedMul = 1;
  private detachTimer = 0;
  private flipTimer = 0;
  private terrainLock = 0;
  private stepDist = 0;
  private wasGrounded = false;
  private contacts: Contact[] = [];
  events: BodyEvents = { landed: 0, attached: false, detached: false, jumped: false, footstep: false, jetStart: false };
  world: PhysicsWorld;

  constructor(world: PhysicsWorld) {
    this.world = world;
  }

  get magActive(): boolean {
    return this.magOn && this.magDisabled <= 0;
  }

  /** true if standing on something other than "world up" (wall or ceiling). */
  get onWall(): boolean {
    return this.attached && this.up.y < 0.8;
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }
  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }
  /** full view direction including pitch */
  viewDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return out.set(0, sp, -cp).applyQuaternion(this.quat);
  }
  eyeHeight(): number {
    return this.height - 0.23;
  }
  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).addScaledVector(this.up, this.eyeHeight());
  }
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).addScaledVector(this.up, this.height * 0.5);
  }

  /** Place upright at a spawn, facing yaw. */
  reset(pos: THREE.Vector3, yaw: number): void {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.quat.setFromAxisAngle(WORLD_UP, yaw);
    this.up.set(0, 1, 0);
    this.targetUp.set(0, 1, 0);
    this.pitch = 0;
    this.attached = false;
    this.grounded = false;
    this.jetFuel = 1;
    this.magDisabled = 0;
    this.detachTimer = 0;
    this.flipTimer = 0;
  }

  setYaw(yaw: number): void {
    // only meaningful when upright
    this.quat.setFromAxisAngle(WORLD_UP, yaw);
    this.up.set(0, 1, 0);
  }

  /** Signed yaw/pitch deltas needed to look at a world direction (bots). */
  aimDeltas(dir: THREE.Vector3): { yaw: number; pitch: number } {
    const inv = _q2.copy(this.quat).invert();
    const l = _a.copy(dir).applyQuaternion(inv); // local space: forward = -z
    const yaw = Math.atan2(-l.x, -l.z);
    const pitch = Math.atan2(l.y, Math.hypot(l.x, l.z));
    return { yaw, pitch: pitch - this.pitch };
  }

  step(dt: number, input: MoveInput): void {
    const ev = this.events;
    ev.landed = 0;
    ev.attached = false;
    ev.detached = false;
    ev.jumped = false;
    ev.footstep = false;
    ev.jetStart = false;
    if (this.magDisabled > 0) this.magDisabled -= dt;
    if (this.detachTimer > 0) this.detachTimer -= dt;
    if (this.flipTimer > 0) this.flipTimer -= dt;
    if (this.terrainLock > 0) this.terrainLock -= dt;
    if (this.wallLock > 0) this.wallLock -= dt;
    if (this.jetDelay > 0) this.jetDelay -= dt;

    // ---- look ----
    if (input.yaw !== 0) {
      _q.setFromAxisAngle(WORLD_UP.clone().set(0, 1, 0), input.yaw);
      this.quat.multiply(_q);
    }
    this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch + input.pitch));
    this.quat.normalize();
    this.up.set(0, 1, 0).applyQuaternion(this.quat);

    // ---- crouch ----
    const wantCrouch = input.crouch;
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) this.crouching = true;
      else {
        // check headroom
        _p.copy(this.pos).addScaledVector(this.up, this.standHeight - this.radius);
        if (!this.world.pointBlocked(_p, this.radius * 0.9)) this.crouching = false;
      }
    }
    const targetH = this.crouching ? this.crouchHeight : this.standHeight;
    this.height += (targetH - this.height) * Math.min(1, dt * 12);

    // ---- wish direction ----
    const fwd = this.forward(_a);
    const right = this.right(_b);
    const wish = _c.set(0, 0, 0).addScaledVector(fwd, input.forward).addScaledVector(right, input.strafe);
    const wl = wish.length();
    if (wl > 1) wish.divideScalar(wl);
    const sprinting = input.sprint && input.forward > 0.3 && !this.crouching;
    const speed = (this.crouching ? 2.3 : sprinting ? 6.8 : 4.4) * this.speedMul;

    let magActive = this.magActive && this.detachTimer <= 0;
    let jumpedNow = false;

    if (this.grounded) {
      const n = this.groundNormal;
      // project wish onto ground plane
      const wd = wish.dot(n);
      const wg = _p.copy(wish).addScaledVector(n, -wd);
      const wgl = wg.length();
      if (wgl > 1e-4) wg.multiplyScalar(Math.min(1, wl) / wgl);
      const vn = this.vel.dot(n);
      const vt = this.vel.addScaledVector(n, -vn); // in-place: tangential
      const target = wg.multiplyScalar(speed);
      const accel = this.attached ? 38 : 24; // lunar regolith has poor traction
      const decel = this.attached ? 30 : 10;
      _n.copy(target).sub(vt);
      const dl = _n.length();
      const rate = (target.lengthSq() > 0.01 ? accel : decel) * dt;
      if (dl > rate) _n.multiplyScalar(rate / dl);
      vt.add(_n);
      // keep a small press toward the ground so resting contact is detected every step
      this.vel.copy(vt).addScaledVector(n, this.attached ? -0.5 : Math.min(0, vn));
      if (!this.attached) this.vel.y -= MOON_G * dt;

      if (input.jumpPressed) {
        const js = this.crouching ? 2.4 : 3.3;
        if (this.attached && this.up.y < 0.8) {
          // push off a wall/ceiling
          this.vel.addScaledVector(this.up, 3.6);
          this.detachTimer = 0.45;
        } else {
          this.vel.addScaledVector(this.up, js);
          this.detachTimer = 0.2;
        }
        this.grounded = false;
        this.attached = false;
        ev.jumped = true;
        this.jetDelay = 0.3;
        magActive = false;
        jumpedNow = true;
      }
    } else {
      // ---- airborne ----
      if (!(this.flipTimer > 0)) this.vel.y -= MOON_G * dt;
      // air control (weak), plus jetpack
      const hv = _p.copy(this.vel);
      hv.y = 0;
      const wishH = _n.copy(wish);
      wishH.y = 0;
      const air = this.jetting ? 5.5 : 1.6;
      if (wishH.lengthSq() > 0.001) {
        const along = hv.dot(wishH.clone().normalize());
        if (along < speed) this.vel.addScaledVector(wishH, air * dt);
      }
      const canJet = input.jump && this.jetFuel > 0.02 && this.jetDelay <= 0;
      if (canJet) {
        if (!this.jetting) ev.jetStart = true;
        this.jetting = true;
        this.vel.addScaledVector(WORLD_UP, 4.6 * dt);
        this.jetFuel = Math.max(0, this.jetFuel - dt / 2.6);
        // cap upward speed
        if (this.vel.y > 5.5) this.vel.y = 5.5;
      } else this.jetting = false;
      if (this.flipTimer > 0) {
        // magnetic pull toward the surface we're flipping onto
        this.vel.addScaledVector(this.targetUp, -9 * dt);
      }
    }
    if (this.grounded) {
      this.jetting = false;
      if (this.jetDelay <= 0) this.jetFuel = Math.min(1, this.jetFuel + dt * 0.45);
    }

    // ---- integrate ----
    this.pos.addScaledVector(this.vel, dt);

    // ---- collide ----
    const contacts = this.contacts;
    contacts.length = 0;
    const r = this.radius;
    for (let iter = 0; iter < 2; iter++) {
      const nSph = 3;
      for (let s = 0; s < nSph; s++) {
        const off = s === 0 ? r : s === 1 ? this.height * 0.5 : this.height - r;
        _p.copy(this.pos).addScaledVector(this.up, off);
        const before = contacts.length;
        this.world.resolveSphere(_p, r, contacts);
        if (contacts.length > before) {
          this.pos.copy(_p).addScaledVector(this.up, -off);
          for (let k = before; k < contacts.length; k++) {
            const cn = contacts[k].normal;
            const vn = this.vel.dot(cn);
            if (vn < 0) this.vel.addScaledVector(cn, -vn);
            (contacts[k] as Contact & { sphere?: number }).sphere = s;
          }
        }
      }
    }

    // ---- step up onto low ledges (slabs, curbs, rocks) ----
    if (this.wasGrounded && wl > 0.2 && this.up.y > 0.7) {
      for (const c of contacts) {
        if ((c as Contact & { sphere?: number }).sphere !== 0) continue;
        if (c.normal.dot(this.up) > 0.6) continue;
        if (-c.normal.dot(wish) / wl < 0.3) continue;
        const stepH = 0.55;
        _n.copy(wish).multiplyScalar((r + 0.15) / wl);
        const probe = _p.copy(this.pos).addScaledVector(this.up, stepH + r).add(_n);
        if (this.world.pointBlocked(probe, r * 0.95)) break;
        _a.copy(this.up).negate();
        const hit = this.world.raycast(probe, _a, stepH + r, { forMove: true });
        if (hit && hit.normal.dot(this.up) > 0.7) {
          const lift = _b.copy(hit.point).sub(this.pos).dot(this.up);
          if (lift > 0.02 && lift <= stepH + 0.02) {
            this.pos.addScaledVector(this.up, lift + 0.01);
            this.pos.addScaledVector(_n, 0.25);
          }
        }
        break;
      }
    }

    // ---- support / mag-boots ----
    const prevAttached = this.attached;
    this.grounded = false;
    this.onMetal = false;
    let supported = false;
    const up = this.up;
    const feet = _p.copy(this.pos).addScaledVector(up, r);
    const moving = wl > 0.2;

    if (magActive && this.flipTimer <= 0 && !jumpedNow) {
      // (a) deliberate transition: walking into a tall metal wall, or touching metal while airborne
      let bestWall: Contact | null = null;
      let bestScore = 0;
      for (const c of contacts) {
        if (!c.metal) continue;
        const sph = (c as Contact & { sphere?: number }).sphere ?? 0;
        const nd = c.normal.dot(up);
        if (this.wasGrounded) {
          if (nd > 0.5 || sph === 0 || !moving) continue;
          const into = -c.normal.dot(wish) / Math.max(wl, 1e-3);
          if (into > 0.45 && into > bestScore) {
            bestScore = into;
            bestWall = c;
          }
        } else {
          // airborne: clamp onto whatever we hit (ceilings, walls)
          const approach = 1 - nd; // prefer surfaces that differ from our up
          if (nd < 0.6 && approach > bestScore) {
            bestScore = approach;
            bestWall = c;
          }
        }
      }
      if (bestWall) {
        this.targetUp.copy(bestWall.normal);
        this.attached = true;
        supported = true;
        this.grounded = !this.wasGrounded ? false : true;
        this.groundNormal.copy(bestWall.normal);
        this.onMetal = true;
        if (!this.wasGrounded) {
          // flip in mid-air around the body center so the feet end up on the surface
          this.flipTimer = 0.32;
          this.pivotMid = true;
        } else this.pivotMid = false;
        this.wallLock = 0.45;
        ev.attached = true;
      } else {
        // (b) support probe: nearest metal under the feet (rolls around convex edges)
        const reach = r + (this.attached || this.wasGrounded ? 0.55 : 0.08);
        let d = this.world.nearestMetal(feet, reach, _a, _n, (nn) => {
          const s = nn.dot(up);
          // while terrain-locked only floors that are roughly world-up count
          if (this.terrainLock > 0 && nn.y < 0.6) return false;
          return s > 0.25;
        });
        if (d < reach && this.wallLock <= 0) {
          const edgeN = _n.copy(feet).sub(_a).normalize();
          // upright and the regolith is right below: step off the platform instead of rolling around its edge
          const terrainGap = feet.y - r - this.world.hf.heightAt(feet.x, feet.z);
          if (edgeN.y < 0.9 && up.y > 0.5 && terrainGap < 0.6) d = Infinity;
          // on a wall, walking down into the ground: hand over to the terrain
          if (d < reach && up.y < 0.7 && moving) {
            for (const c of contacts) {
              if (!c.terrain || c.normal.y < 0.45) continue;
              if (-c.normal.dot(wish) / Math.max(wl, 1e-3) > 0.4) {
                d = Infinity;
                break;
              }
            }
          }
        }
        if (d < reach) {
          // normal from contact point to sphere center: smooth around edges
          const nrm = _n.copy(feet).sub(_a);
          const nl = nrm.length();
          if (nl > 1e-5) nrm.divideScalar(nl);
          this.groundNormal.copy(nrm);
          this.targetUp.copy(nrm);
          // snap onto the surface
          if (d > r) {
            this.pos.addScaledVector(nrm, -(d - r));
          }
          const vn = this.vel.dot(nrm);
          if (vn > 0 && !input.jumpPressed) this.vel.addScaledVector(nrm, -vn);
          supported = true;
          this.grounded = true;
          this.attached = true;
          this.onMetal = true;
          if (!prevAttached) ev.attached = true;
        }
      }
    }

    if (!supported) {
      // ordinary ground: terrain or floors whose normal is close to world up
      let best: Contact | null = null;
      for (const c of contacts) {
        const walk = c.normal.y;
        if (walk > 0.55 && (!best || walk > best.normal.y)) best = c;
      }
      // attached and walking down a wall into the terrain: step off onto the ground
      if (this.attached && !best) {
        for (const c of contacts) {
          if (c.terrain && c.normal.y > 0.4 && moving) {
            best = c;
            break;
          }
        }
      }
      if (best && !jumpedNow) {
        this.grounded = true;
        this.groundNormal.copy(best.normal);
        this.onMetal = best.metal;
        if (this.attached) {
          this.terrainLock = 0.5;
          ev.detached = true;
        }
        this.attached = false;
        this.targetUp.copy(WORLD_UP);
      } else {
        // ground snap: keep contact when walking down gentle slopes
        if (this.wasGrounded && !prevAttached && !input.jumpPressed && this.detachTimer <= 0) {
          const hgt = this.world.hf.heightAt(this.pos.x, this.pos.z);
          const gap = this.pos.y - hgt;
          if (gap > 0 && gap < 0.3 && this.vel.y <= 0.5) {
            this.pos.y = hgt;
            this.grounded = true;
            this.world.hf.normalAt(this.pos.x, this.pos.z, this.groundNormal);
            if (this.vel.y > 0) this.vel.y = 0;
          }
        }
        if (!this.grounded) {
          if (this.attached && this.flipTimer <= 0) ev.detached = true;
          if (this.flipTimer <= 0) {
            this.attached = false;
            this.targetUp.copy(WORLD_UP);
          }
        }
      }
    }

    // ---- orientation: rotate body toward targetUp ----
    const dot = up.dot(this.targetUp);
    if (dot < 0.99999) {
      const rate = this.attached || this.flipTimer > 0 ? 13 : 4;
      const k = 1 - Math.exp(-dt * rate);
      if (dot < -0.9999) {
        // exactly opposite: pick an axis (the body's right) to flip around
        this.right(_n);
        _q.setFromAxisAngle(_n, Math.PI);
      } else _q.setFromUnitVectors(up, this.targetUp);
      _q2.copy(_id).slerp(_q, k);
      // pivot around feet sphere (walking) or body center (mid-air flips)
      const pivotOff = this.pivotMid ? this.height * 0.5 : r;
      _a.copy(this.pos).addScaledVector(up, pivotOff);
      this.quat.premultiply(_q2).normalize();
      this.up.set(0, 1, 0).applyQuaternion(this.quat);
      this.pos.copy(_a).addScaledVector(this.up, -pivotOff);
      if (this.attached) this.vel.applyQuaternion(_q2);
    } else this.pivotMid = false;

    // ---- events / bookkeeping ----
    if (this.grounded && !this.wasGrounded) {
      ev.landed = Math.max(0.01, this.lastAirSpeed);
      this.airTime = 0;
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.lastAirSpeed = Math.max(0, -this.vel.dot(this.up));
    }
    this.moveSpeed = this.grounded ? _a.copy(this.vel).addScaledVector(this.groundNormal, -this.vel.dot(this.groundNormal)).length() : 0;
    if (this.grounded && this.moveSpeed > 0.8) {
      this.stepDist += this.moveSpeed * dt;
      const stride = sprinting ? 2.1 : 1.5;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        ev.footstep = true;
      }
    }
    this.wasGrounded = this.grounded;
  }

  private pivotMid = false;
  private lastAirSpeed = 0;
  private wallLock = 0;

  /** Knockback / explosion impulses. */
  impulse(v: THREE.Vector3): void {
    this.vel.add(v);
    if (v.dot(this.up) > 1.5) {
      this.grounded = false;
      this.detachTimer = 0.3;
      this.attached = false;
    }
  }

  /** Disable mag-boots (EMP) */
  emp(seconds: number): void {
    this.magDisabled = Math.max(this.magDisabled, seconds);
  }
}
