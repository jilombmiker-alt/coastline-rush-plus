import type { VehicleId } from './types';

export type { VehicleId } from './types';

export interface VehicleConfig {
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly color: number;
  /** Motor target in m/s; the arcade motor settles slightly above this target. */
  readonly baseSpeed: number;
  readonly acceleration: number;
  readonly boostAcceleration: number;
  readonly steering: number;
  readonly driftSteering: number;
  readonly grip: number;
  readonly driftGrip: number;
  readonly boostSpeedGain: number;
  /** Energy units per second while holding nitro. Every car has a 100-unit tank. */
  readonly boostEnergyCost: number;
  readonly driftGain: number;
  readonly impactLoss: number;
  readonly silhouette: readonly number[];
}

export const DEFAULT_VEHICLE: VehicleId = 'tide';
export const VEHICLE_ORDER: readonly VehicleId[] = Object.freeze(['tide', 'reef', 'gale', 'pulse', 'bulwark'] as const);

export function isVehicle(value: unknown): value is VehicleId {
  return value === 'tide' || value === 'reef' || value === 'gale' || value === 'pulse' || value === 'bulwark';
}

/** Vehicles tune the player only; difficulty continues to control the same rival field. */
export const VEHICLES: Readonly<Record<VehicleId, VehicleConfig>> = Object.freeze({
  tide: Object.freeze({
    name: '浪潮07', subtitle: '均衡巡航',
    description: '速度、转向与氮气均衡，适合第一次探索海岸公路。', color: 0x2faab0,
    baseSpeed: 52, acceleration: 22, boostAcceleration: 38,
    steering: 1.45, driftSteering: 1.35, grip: 3.7, driftGrip: 1.9,
    boostSpeedGain: 20, boostEnergyCost: 30, driftGain: 1, impactLoss: 1,
    silhouette: [1, 1, 1],
  }),
  reef: Object.freeze({
    name: '珊瑚12', subtitle: '灵巧弯道',
    description: '起步轻快，转向灵活，氮气更耐用；直路极速稍低。', color: 0xf17b6c,
    baseSpeed: 49, acceleration: 24, boostAcceleration: 40,
    steering: 1.74, driftSteering: 1.6, grip: 3.7, driftGrip: 1.9,
    boostSpeedGain: 18, boostEnergyCost: 26, driftGain: 0.96, impactLoss: 1.1,
    silhouette: [0.92, 0.94, 0.98],
  }),
  gale: Object.freeze({
    name: '海风21', subtitle: '长路疾行',
    description: '直路极速更高；起步和转向较慢，氮气需要精打细算。', color: 0xf4c95e,
    baseSpeed: 56, acceleration: 19, boostAcceleration: 35,
    steering: 1.25, driftSteering: 1.16, grip: 3.2, driftGrip: 1.75,
    boostSpeedGain: 21, boostEnergyCost: 34, driftGain: 0.84, impactLoss: 1.14,
    silhouette: [0.94, 0.93, 1.08],
  }),
  pulse: Object.freeze({
    name: '脉冲33', subtitle: '漂移蓄能',
    description: '有效漂移蓄能更快，出弯小喷更强；直线速度略低。', color: 0x9c76e9,
    baseSpeed: 50.8, acceleration: 22, boostAcceleration: 37,
    steering: 1.54, driftSteering: 1.68, grip: 3.7, driftGrip: 2.1,
    boostSpeedGain: 19, boostEnergyCost: 30, driftGain: 1.45, impactLoss: 1.08,
    silhouette: [0.96, 0.92, 1.03],
  }),
  bulwark: Object.freeze({
    name: '礁盾45', subtitle: '抗撞灵活',
    description: '车身接触后速度损失更少，转向灵活；长直道极速偏低。', color: 0x79ae80,
    baseSpeed: 50.5, acceleration: 22.3, boostAcceleration: 38,
    steering: 1.62, driftSteering: 1.49, grip: 3.7, driftGrip: 1.9,
    boostSpeedGain: 18, boostEnergyCost: 29, driftGain: 0.93, impactLoss: 0.55,
    silhouette: [1.1, 1.04, 0.98],
  }),
});
