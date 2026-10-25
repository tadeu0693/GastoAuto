import { requireNativeModule } from 'expo';

export type PendingNotif = { id: string; app: string; title: string; text: string; ts: number };

type Native = {
  hasPermission(): boolean;
  openPermissionSettings(): void;
  getPending(): string;
  removePending(ids: string[]): void;
  getAllowedPackages(): string[];
  setAllowedPackages(pkgs: string[]): void;
  getSeenPackages(): string[];
  getDefaultPackages(): string[];
};

const N = requireNativeModule<Native>('NotifCapture');

export const NotifCapture = {
  ...N,
  pending(): PendingNotif[] {
    try { return JSON.parse(N.getPending()); } catch { return []; }
  },
};
