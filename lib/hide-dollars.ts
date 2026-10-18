"use client";

import { useSyncExternalStore } from "react";

/** localStorage flag for hiding dollar amounts on the combined Budget tab. */
export const HIDE_DOLLARS_STORAGE_KEY = "dolla.budget.hideDollars";

const CHANGE_EVENT = "dolla-budget-hide-dollars";

/** In-memory fallback when storage is blocked (private mode). */
let memoryOverride: boolean | null = null;

export function parseHideDollars(value: string | null): boolean {
  return value === "1";
}

export function serializeHideDollars(hidden: boolean): string {
  return hidden ? "1" : "0";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function readHideDollars(): boolean {
  if (memoryOverride !== null) return memoryOverride;
  try {
    return parseHideDollars(window.localStorage.getItem(HIDE_DOLLARS_STORAGE_KEY));
  } catch {
    return false;
  }
}

function serverHideDollars(): boolean {
  return false;
}

export function writeHideDollars(hidden: boolean): void {
  try {
    window.localStorage.setItem(HIDE_DOLLARS_STORAGE_KEY, serializeHideDollars(hidden));
    memoryOverride = null;
  } catch {
    memoryOverride = hidden;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useHideDollars(): readonly [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(subscribe, readHideDollars, serverHideDollars);
  return [hidden, writeHideDollars];
}
