export type DriftKey = 'Space' | 'ShiftLeft' | 'KeyC' | 'KeyF';
export const DRIFT_KEY_STORAGE = 'coastline-rush-drift-key-v1';
export const DEFAULT_DRIFT_KEY: DriftKey = 'Space';
export const DRIFT_KEY_OPTIONS: readonly { code: DriftKey; label: string }[] = [
  { code: 'Space', label: '空格 Space' },
  { code: 'ShiftLeft', label: 'Shift（氮气改为空格）' },
  { code: 'KeyC', label: 'C 键' },
  { code: 'KeyF', label: 'F 键' },
];
export const isDriftKey = (value: unknown): value is DriftKey =>
  value === 'Space' || value === 'ShiftLeft' || value === 'KeyC' || value === 'KeyF';
export const displayDriftKey = (code: DriftKey) => code === 'Space' ? 'SPACE' : code === 'ShiftLeft' ? 'SHIFT' : code === 'KeyC' ? 'C' : 'F';
export function readDriftKey(storage: Pick<Storage, 'getItem'>): DriftKey {
  try {
    const value = storage.getItem(DRIFT_KEY_STORAGE);
    return isDriftKey(value) ? value : DEFAULT_DRIFT_KEY;
  } catch { return DEFAULT_DRIFT_KEY; }
}
export function saveDriftKey(storage: Pick<Storage, 'setItem'>, value: DriftKey): boolean {
  try { storage.setItem(DRIFT_KEY_STORAGE, value); return true; }
  catch { return false; }
}
