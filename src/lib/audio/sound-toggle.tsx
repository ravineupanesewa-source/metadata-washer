"use client";

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sound as t } from "@/features/image-sanitizer/strings";
import { playSound, setSoundEnabled, useSoundEnabled } from "./sound-engine";

/** Mute toggle for all sound (effects and music); the choice is remembered on this device. */
export function SoundToggle() {
  const on = useSoundEnabled();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={t.label}
      aria-pressed={on}
      title={on ? t.on : t.off}
      onClick={() => {
        setSoundEnabled(!on);
        // Turning sound back on answers with a click; turning it off answers with silence.
        if (!on) playSound("toggleOn");
      }}
      data-testid="sound-toggle"
      className="rounded-xl text-white/80 hover:bg-white/10"
    >
      {on ? <Volume2 aria-hidden /> : <VolumeX aria-hidden className="text-white/45" />}
    </Button>
  );
}
