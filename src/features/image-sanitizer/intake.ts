"use client";

import { useEffect, useRef } from "react";

/**
 * Lets other parts of the page (the hero's drop pill, header CTA) hand files
 * to the sanitizer or open its file picker, without sharing React state.
 * Events are same-document only; nothing leaves the browser here.
 */

const FILES_EVENT = "cleanframe:files";
const PICKER_EVENT = "cleanframe:open-picker";

export function submitFiles(files: File[]): void {
  if (files.length > 0) window.dispatchEvent(new CustomEvent<File[]>(FILES_EVENT, { detail: files }));
}

/** Must be called from a user gesture (click) so the browser allows the picker to open. */
export function requestFilePicker(): void {
  window.dispatchEvent(new Event(PICKER_EVENT));
}

export function scrollToWorkbench(): void {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("workbench")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

export function useIntake(handlers: { onFiles?: (files: File[]) => void; onOpenPicker?: () => void }): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onFiles = (event: Event) => latest.current.onFiles?.((event as CustomEvent<File[]>).detail);
    const onPicker = () => latest.current.onOpenPicker?.();
    window.addEventListener(FILES_EVENT, onFiles);
    window.addEventListener(PICKER_EVENT, onPicker);
    return () => {
      window.removeEventListener(FILES_EVENT, onFiles);
      window.removeEventListener(PICKER_EVENT, onPicker);
    };
  }, []);
}
