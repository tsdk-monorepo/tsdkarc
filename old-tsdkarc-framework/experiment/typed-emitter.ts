// src/lib/typed-emitter.ts
// Pure utility. Creates a typed wrapper around a raw EventEmitter.

import { EventEmitter } from "node:events";

export type EventMap = Record<string, unknown>;

export type TypedEmitter<T extends EventMap> = {
  emit<K extends keyof T>(event: K & string, payload: T[K]): void;
  on<K extends keyof T>(event: K & string, cb: (payload: T[K]) => void): void;
  off<K extends keyof T>(event: K & string, cb: (payload: T[K]) => void): void;
};

/** Creates a fully typed EventEmitter scoped to a domain event map. */
export function createEmitter<T extends EventMap>(): TypedEmitter<T> {
  const e = new EventEmitter();
  return {
    emit: (event, payload) => e.emit(event, payload),
    on: (event, cb) => e.on(event, cb),
    off: (event, cb) => e.off(event, cb),
  };
}