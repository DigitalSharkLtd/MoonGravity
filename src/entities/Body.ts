import * as THREE from 'three';
import { PhysicsWorld, Contact, BODY_G, JET_HOLD } from '../core/Physics';

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  jump: boolean; // held
  jumpPressed: boolean; // pressed this step
  sprint: boolean;
  crouch: boolean;
  yaw: number; // look delta (radians) around body up this step
  pitch: number; // look delta
  prone: boolean; // pressed: toggle prone
  roll: boolean; // pressed: combat roll
}

export function emptyInput(): MoveInput {
  return { forward: 0, strafe: 0, jump: false, jumpPressed: false, sprint: false, crouch: false, yaw: 0, pitch: 0, prone: false, roll: false };
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
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

export interface BodyEvents {
  landed: number; // impact speed if landed this step
  attached: boolean; // mag clamp engaged this step
  detached: boolean;
  jumped: boolean;
  footstep: boolean;
  jetStart: boolean;
  rolled: boolean;
  slid: boolean;
  mantled: boolean;
  grappleEnd: boolean;
  airbrake: boolean;
}

export type Stance = 'stand' | 'crouch' | 'prone' | 'slide' | 'roll';

interface Grapple {
  anchor: THREE.Vector3;
  normal: THREE.Vector3;
  metal: boolean;
  t: number;
  braking: boolean;
}

interface Mantle {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
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
  jumpHold = 0;
  /** jump-key hold needed to light the jetpack (bots use a shorter one) */
  jetHold = JET_HOLD;
  airTime = 0;
  crouching = false;
  moveSpeed = 0;
  speedMul = 1;
  // ---- movement tuning (defaults = standard suit; the game adjusts them per hero / passive) ----
  /** take-off speed of a standing jump (m/s): 2.85 → ~2.5 m apex, ~3.5 s airtime in 1/6 g */
  jumpSpeed = 4.8;
  /** suit RCS air control (m/s²) */
  airControl = 2.4;
  /** jetpack: vertical thrust (m/s²), climb-speed cap, fuel burn (1/s) and refuel rates */
  jetThrust = 12.5;
  jetCap = 4.2;
  jetBurn = 1 / 2.3;
  jetRegen = 0.5;
  /** fraction of the refuel rate that also works in the air while not thrusting (Condor) */
  jetRegenAir = 0;
  /** extra mid-air jumps (Blade's moon step) */
  airJumps = 0;
  /** mag-boot walking speed multiplier (scouts) */
  magSpeedMul = 1;
  /** true while the down-thrusters fire (crouch in the air) */
  diving = false;
  airJumpsLeft = 0;
  private detachTimer = 0;
  private flipTimer = 0;
  private terrainLock = 0;
  private stepDist = 0;
  private wasGrounded = false;
  private contacts: Contact[] = [];
  events: BodyEvents = { landed: 0, attached: false, detached: false, jumped: false, footstep: false, jetStart: false, rolled: false, slid: false, mantled: false, grappleEnd: false, airbrake: false };
  stance: Stance = 'stand';
  proneOn = false;
  proneHeight = 0.75;
  slideT = 0;
  rollT = 0;
  rollCd = 0;
  rollDir = new THREE.Vector3();
  grapple: Grapple | null = null;
  mantle: Mantle | null = null;
  private prevCrouch = false;
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
    this.grapple = null;
    this.mantle = null;
    this.proneOn = false;
    this.slideT = this.rollT = this.rollCd = 0;
    this.stance = 'stand';
    this.crouching = false;
    this.height = this.standHeight;
  }

  /** Fire the grappling hook: pull toward `anchor` with air brakes near the end. */
  startGrapple(anchor: THREE.Vector3, normal: THREE.Vector3, metal: boolean): void {
    this.grapple = { anchor: anchor.clone(), normal: normal.clone(), metal, t: 0, braking: false };
    this.proneOn = false;
    this.slideT = 0;
    this.rollT = 0;
    this.grounded = false;
    this.attached = false;
    this.detachTimer = 0.25;
    this.mantle = null;
  }

  stopGrapple(keepMomentum = true): void {
    if (!this.grapple) return;
    const g = this.grapple;
    this.grapple = null;
    this.events.grappleEnd = true;
    if (!keepMomentum) this.vel.multiplyScalar(0.35);
    // magnetic finish: clamp onto the metal surface we were pulled to
    if (g.metal && this.magActive && g.normal.dot(this.up) < 0.7) {
      this.targetUp.copy(g.normal);
      this.attached = true;
      this.flipTimer = 0.3;
      this.pivotMid = true;
      this.wallLock = 0.45;
      this.detachTimer = 0;
    } else if (g.normal.y > 0.7) {
      // pulled onto a ledge / roof: small hop so we land on top
      this.vel.y = Math.max(this.vel.y, 1.8);
    }
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

  /** Reset the per-tick events (the game calls this once per tick and steps with keepEvents). */
  clearEvents(): void {
    const ev = this.events;
    ev.landed = 0;
    ev.attached = false;
    ev.detached = false;
    ev.jumped = false;
    ev.footstep = false;
    ev.jetStart = false;
    ev.rolled = ev.slid = ev.mantled = ev.grappleEnd = ev.airbrake = false;
  }

  /**
   * Advance the body. `keepEvents`: accumulate events over several sub-steps (the game runs two
   * sub-steps per tick; without it a landing / jump in the first sub-step was lost).
   */
  step(dt: number, input: MoveInput, keepEvents = false): void {
    const ev = this.events;
    if (!keepEvents) this.clearEvents();
    if (this.rollCd > 0) this.rollCd -= dt;
    if (this.magDisabled > 0) this.magDisabled -= dt;
    if (this.detachTimer > 0) this.detachTimer -= dt;
    if (this.flipTimer > 0) this.flipTimer -= dt;
    if (this.terrainLock > 0) this.terrainLock -= dt;
    if (this.wallLock > 0) this.wallLock -= dt;
    if (this.jetDelay > 0) this.jetDelay -= dt;
    // how long the jump key has been held: tap = jump, a long hold lights the jetpack
    this.jumpHold = input.jump ? this.jumpHold + dt : 0;

    // ---- look ----
    if (input.yaw !== 0) {
      _q.setFromAxisAngle(WORLD_UP.clone().set(0, 1, 0), input.yaw);
      this.quat.multiply(_q);
    }
    this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch + input.pitch));
    this.quat.normalize();
    this.up.set(0, 1, 0).applyQuaternion(this.quat);

    // ---- mantle (kinematic vault onto a ledge) ----
    if (this.mantle) {
      const m = this.mantle;
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const e = k * k * (3 - 2 * k);
      // up first, then forward: an arc that clears the ledge edge
      const up = Math.min(1, e * 1.6);
      const fw = Math.max(0, (e - 0.35) / 0.65);
      this.pos.set(m.from.x + (m.to.x - m.from.x) * fw, m.from.y + (m.to.y - m.from.y) * up, m.from.z + (m.to.z - m.from.z) * fw);
      this.vel.set(0, 0, 0);
      if (k >= 1) {
        this.mantle = null;
        this.grounded = true;
      }
      this.height += (this.standHeight * 0.8 - this.height) * Math.min(1, dt * 10);
      return;
    }

    // ---- stance: crouch / slide / prone / roll ----
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (input.prone && this.grounded && this.up.y > 0.8) {
      if (this.proneOn) {
        _p.copy(this.pos).addScaledVector(this.up, this.crouchHeight - this.radius);
        if (!this.world.pointBlocked(_p, this.radius * 0.9)) this.proneOn = false;
      } else this.proneOn = true;
    }
    const crouchEdge = input.crouch && !this.prevCrouch;
    this.prevCrouch = input.crouch;
    if (crouchEdge && this.grounded && horizSpeed > 4.2 * Math.min(1, this.speedMul) && this.slideT <= 0 && !this.proneOn) {
      this.slideT = 0.95;
      _p.set(this.vel.x, 0, this.vel.z).normalize();
      this.vel.addScaledVector(_p, 2.2);
      ev.slid = true;
    }
    if (input.roll && this.rollCd <= 0 && this.grounded && !(this.attached && this.up.y < 0.8) && !this.proneOn) {
      this.rollT = 0.55;
      this.rollCd = 2.8;
      const f0 = this.forward(_a);
      const r0 = this.right(_b);
      this.rollDir.set(0, 0, 0).addScaledVector(f0, input.forward).addScaledVector(r0, input.strafe);
      if (this.rollDir.lengthSq() < 0.01) this.rollDir.copy(f0).negate();
      this.rollDir.y = 0;
      this.rollDir.normalize();
      this.vel.set(this.rollDir.x * 7.2, this.vel.y, this.rollDir.z * 7.2);
      this.slideT = 0;
      ev.rolled = true;
    }
    if (this.slideT > 0) this.slideT -= dt;
    if (this.rollT > 0) this.rollT -= dt;
    const wantCrouch = input.crouch;
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) this.crouching = true;
      else {
        // check headroom
        _p.copy(this.pos).addScaledVector(this.up, this.standHeight - this.radius);
        if (!this.world.pointBlocked(_p, this.radius * 0.9)) this.crouching = false;
      }
    }
    this.stance = this.rollT > 0 ? 'roll' : this.slideT > 0 ? 'slide' : this.proneOn ? 'prone' : this.crouching ? 'crouch' : 'stand';
    const targetH = this.stance === 'prone' ? this.proneHeight : this.stance === 'roll' || this.stance === 'slide' ? 1.0 : this.crouching ? this.crouchHeight : this.standHeight;
    this.height += (targetH - this.height) * Math.min(1, dt * 12);

    // ---- wish direction ----
    const fwd = this.forward(_a);
    const right = this.right(_b);
    const wish = _c.set(0, 0, 0).addScaledVector(fwd, input.forward).addScaledVector(right, input.strafe);
    const wl = wish.length();
    if (wl > 1) wish.divideScalar(wl);
    const sprinting = input.sprint && input.forward > 0.3 && !this.crouching;
    const speed = (this.stance === 'prone' ? 1.3 : this.crouching ? 2.3 : sprinting ? 6.8 : 4.4) * this.speedMul * (this.attached && this.up.y < 0.8 ? this.magSpeedMul : 1);

    let magActive = this.magActive && this.detachTimer <= 0;
    let jumpedNow = false;

    if (this.grapple) {
      // ---- grappling hook: strong pull, air brakes near the anchor ----
      const gp = this.grapple;
      gp.t += dt;
      const c = this.center(_p);
      const dir = _n.copy(gp.anchor).sub(c);
      const d = dir.length();
      dir.divideScalar(Math.max(d, 1e-4));
      const sp = this.vel.length();
      const brakeDist = Math.min(10, Math.max(2.4, sp * 0.42));
      if (input.jumpPressed) {
        // slingshot release: keep the momentum, add a hop
        this.stopGrapple(true);
        this.vel.addScaledVector(this.up, 2.5);
        ev.jumped = true;
      } else if (d < 1.5 || gp.t > 3.5) this.stopGrapple(false);
      else if (d < brakeDist) {
        gp.braking = true;
        ev.airbrake = true;
        this.vel.multiplyScalar(Math.exp(-dt * 6.5));
        this.vel.addScaledVector(dir, 9 * dt);
      } else {
        this.vel.addScaledVector(dir, 46 * dt);
        if (sp > 30) this.vel.multiplyScalar(30 / sp);
      }
      this.vel.y -= BODY_G * 0.25 * dt;
      this.grounded = false;
      this.attached = false;
      this.jetting = false;
    } else if (this.grounded) {
      const n = this.groundNormal;
      // project wish onto ground plane
      const wd = wish.dot(n);
      const wg = _p.copy(wish).addScaledVector(n, -wd);
      const wgl = wg.length();
      if (wgl > 1e-4) wg.multiplyScalar(Math.min(1, wl) / wgl);
      const vn = this.vel.dot(n);
      const vt = this.vel.addScaledVector(n, -vn); // in-place: tangential
      const target = wg.multiplyScalar(speed);
      // regolith has poor traction (you keep drifting a little), mag-boots grip hard
      let accel = this.attached ? 38 : 30;
      let decel = this.attached ? 30 : 16;
      if (this.stance === 'slide') {
        // sliding on regolith: carry momentum, only light steering
        target.copy(vt).multiplyScalar(0.6);
        accel = 2.5;
        decel = 2.5;
      } else if (this.stance === 'roll') {
        target.copy(this.rollDir).multiplyScalar(this.rollT > 0.15 ? 7.2 : 3);
        accel = 30;
        decel = 30;
      }
      _n.copy(target).sub(vt);
      const dl = _n.length();
      const rate = (target.lengthSq() > 0.01 ? accel : decel) * dt;
      if (dl > rate) _n.multiplyScalar(rate / dl);
      vt.add(_n);
      // keep a small press toward the ground so resting contact is detected every step
      this.vel.copy(vt).addScaledVector(n, this.attached ? -0.5 : Math.min(0, vn));
      if (!this.attached) this.vel.y -= BODY_G * dt;

      if (input.jumpPressed && this.proneOn) {
        // jump from prone = stand up
        this.proneOn = false;
      } else if (input.jumpPressed) {
        const js = this.stance === 'slide' ? this.jumpSpeed + 0.6 : this.crouching ? this.jumpSpeed * 0.8 : this.jumpSpeed;
        if (this.attached && this.up.y < 0.8) {
          // push off a wall/ceiling
          this.vel.addScaledVector(this.up, 4.4);
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
      } else if (input.jump && this.jumpHold >= this.jetHold && this.jetFuel > 0.05 && !this.proneOn && !(this.attached && this.up.y < 0.8)) {
        // jump still held on the ground (standing, or landed while holding): the jetpack lifts off
        this.vel.y = Math.max(this.vel.y, 1.2);
        this.grounded = false;
        this.attached = false;
        this.jetDelay = 0;
        magActive = false;
        jumpedNow = true;
      }
    } else {
      // ---- airborne ----
      if (!(this.flipTimer > 0)) this.vel.y -= BODY_G * dt;
      // air control (suit RCS thrusters), plus jetpack
      const hv = _p.copy(this.vel);
      hv.y = 0;
      const wishH = _n.copy(wish);
      wishH.y = 0;
      const air = this.jetting ? 6 : this.airControl;
      if (wishH.lengthSq() > 0.001) {
        const along = hv.dot(_a.copy(wishH).normalize());
        if (along < speed) this.vel.addScaledVector(wishH, air * dt);
      }
      if (input.jumpPressed && this.airJumpsLeft > 0 && this.flipTimer <= 0 && this.airTime > 0.12) {
        // moon step: a second kick off the suit thrusters, redirected toward the wish direction
        this.airJumpsLeft--;
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (wishH.lengthSq() > 0.01) {
          _a.copy(wishH).normalize().multiplyScalar(Math.max(hs, speed * 1.15));
          this.vel.x = _a.x;
          this.vel.z = _a.z;
        }
        this.vel.y = Math.max(this.vel.y * 0.3, 0) + this.jumpSpeed * 0.85;
        this.jetDelay = 0.35;
        ev.jumped = true;
      }
      const canJet = input.jump && (this.jetting || this.jumpHold >= this.jetHold) && this.jetFuel > 0.02 && this.jetDelay <= 0;
      if (canJet) {
        if (!this.jetting) ev.jetStart = true;
        this.jetting = true;
        this.vel.addScaledVector(WORLD_UP, this.jetThrust * dt);
        this.jetFuel = Math.max(0, this.jetFuel - dt * this.jetBurn);
        // cap climb speed (the thrust stays useful as a brake when falling fast)
        if (this.vel.y > this.jetCap) this.vel.y = Math.max(this.jetCap, this.vel.y - 6 * dt);
      } else this.jetting = false;
      // down-thrusters: hold crouch in the air to cut the lunar hang time (costs a little fuel)
      this.diving = !this.jetting && input.crouch && this.jetFuel > 0.02 && this.flipTimer <= 0 && this.vel.y > -12;
      if (this.diving) {
        this.vel.y -= 6 * dt;
        this.jetFuel = Math.max(0, this.jetFuel - dt * 0.12);
      }
      if (this.flipTimer > 0) {
        // magnetic pull toward the surface we're flipping onto
        this.vel.addScaledVector(this.targetUp, -9 * dt);
      }
    }
    if (this.grounded) {
      this.jetting = false;
      this.diving = false;
      if (this.jetDelay <= 0) this.jetFuel = Math.min(1, this.jetFuel + dt * this.jetRegen);
    } else if (!this.jetting && !this.diving && this.jetRegenAir > 0 && this.jetDelay <= 0) {
      this.jetFuel = Math.min(1, this.jetFuel + dt * this.jetRegen * this.jetRegenAir);
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

    // ---- mantle: vault onto ledges up to ~2.4 m when pushing forward into them ----
    if (!this.grapple && !this.mantle && this.up.y > 0.7 && input.forward > 0.3 && this.stance !== 'prone') {
      let blocked = false;
      for (const c of contacts) {
        const sph = (c as Contact & { sphere?: number }).sphere ?? 0;
        if (sph >= 1 && c.normal.dot(this.up) < 0.35 && -c.normal.dot(wish) > 0.4 * Math.max(wl, 0.3)) blocked = true;
      }
      const approaching = !this.wasGrounded && this.vel.y < 2.5;
      if (blocked || approaching) {
        const fh = _a.set(0, 0, -1).applyQuaternion(this.quat);
        fh.y = 0;
        if (fh.lengthSq() > 1e-4) {
          fh.normalize();
          const origin = _p.copy(this.pos).addScaledVector(fh, r + 0.45);
          origin.y += 2.6;
          const hit = this.world.raycast(origin, _n.set(0, -1, 0), 2.6, { forMove: true });
          if (hit && hit.normal.y > 0.7) {
            const lift = hit.point.y - this.pos.y;
            if (lift > 0.55 && lift < 2.45 && (blocked || lift > 0.2)) {
              const land = _b.copy(hit.point);
              land.y += r + 0.08;
              if (!this.world.pointBlocked(land, r * 0.9)) {
                land.y += 1.0;
                if (!this.world.pointBlocked(land, r * 0.85)) {
                  this.mantle = { from: this.pos.clone(), to: hit.point.clone().addScaledVector(fh, 0.2), t: 0, dur: 0.24 + lift * 0.09 };
                  this.vel.set(0, 0, 0);
                  ev.mantled = true;
                }
              }
            }
          }
        }
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
          if (nd > 0.5 || !moving) continue;
          // the feet sphere only counts against a wall that keeps going up (not a curb / low ledge):
          // leaning arches and vault feet touch the feet first
          // (walking down a wall into a floor always counts: a floor is never a curb)
          if (sph === 0 && !(c.normal.y > 0.7 && up.y < 0.7) && !this.tallMetalWall(c.normal, up)) continue;
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
        let d = this.world.nearestMetal(
          feet,
          reach,
          _a,
          _n,
          (nn) => {
            const s = nn.dot(up);
            // while terrain-locked only floors that are roughly world-up count
            if (this.terrainLock > 0 && nn.y < 0.6) return false;
            return s > 0.25;
          },
        );
        if (d < reach && this.wallLock <= 0) {
          const edgeN = _n.copy(feet).sub(_a).normalize();
          // upright and the regolith is right below: step off the platform instead of rolling around its edge
          const terrainGap = feet.y - r - this.world.hf.heightAt(feet.x, feet.z);
          if (edgeN.y < 0.9 && up.y > 0.5 && terrainGap < 0.6) d = Infinity;
          // on a wall, walking down into the ground or onto a (non-metal) roof / floor: hand over to it
          // (a parapet's inner face ends on the roof slab: without this the boots kept you glued to it)
          if (d < reach && up.y < 0.7 && moving) {
            for (const c of contacts) {
              if (c.normal.y < (c.terrain ? 0.45 : 0.6)) continue;
              if (c.metal && !c.terrain && c.normal.dot(up) < 0.5 && -c.normal.dot(wish) / Math.max(wl, 1e-3) > 0.45) continue; // (a) handles metal floors
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
      // attached and walking down a wall into the terrain / a floor: step off onto the ground
      if (this.attached && !best) {
        for (const c of contacts) {
          if (c.normal.y > (c.terrain ? 0.4 : 0.55) && moving) {
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
      ev.landed = Math.max(ev.landed, 0.01, this.lastAirSpeed);
      this.airTime = 0;
    }
    if (this.grounded) this.airJumpsLeft = this.airJumps;
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

  /** does a metal wall with this normal continue above the feet (a real wall, not a curb)? */
  private tallMetalWall(n: THREE.Vector3, up: THREE.Vector3): boolean {
    const o = _t1.copy(this.pos).addScaledVector(up, Math.min(this.height - this.radius, 1.1));
    const into = _t2.copy(n).negate();
    // the wall at knee/chest height must be (about) as close as at the feet: a stair's next riser or a
    // set-back storey is further away and does not count
    const hit = this.world.raycast(o, into, this.radius + 0.12, { forMove: true });
    return !!hit && hit.metal && hit.normal.dot(n) > 0.8;
  }

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
