"use client";

import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { METADATA_MODES, ORIENTATION_POLICIES, type ProcessingOptions } from "@/lib/image/types";
import { copy } from "../strings";

interface ProcessingSettingsProps {
  value: ProcessingOptions;
  disabled?: boolean;
  onChange: (value: ProcessingOptions) => void;
}

export function ProcessingSettings({ value, disabled, onChange }: ProcessingSettingsProps) {
  const orientationDisabled = disabled || value.mode === "privacy";
  return (
    <div className="space-y-6">
      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="mb-3 text-sm font-medium">{copy.settings.modeLabel}</legend>
        <RadioGroup
          value={value.mode}
          onValueChange={(mode) => onChange({ ...value, mode: mode as ProcessingOptions["mode"] })}
          aria-label={copy.settings.modeLabel}
          disabled={disabled}
        >
          {METADATA_MODES.map((mode) => (
            <OptionRow
              key={mode}
              id={`mode-${mode}`}
              value={mode}
              title={copy.settings.modes[mode].title}
              description={copy.settings.modes[mode].description}
            />
          ))}
        </RadioGroup>
        <p className="flex gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {copy.settings.iccNote}
        </p>
      </fieldset>

      <fieldset className="space-y-3" disabled={orientationDisabled}>
        <legend className="mb-1 text-sm font-medium">{copy.settings.orientationLabel}</legend>
        {value.mode === "privacy" && <p className="text-xs text-muted-foreground">{copy.settings.orientationDisabled}</p>}
        <RadioGroup
          value={value.orientationPolicy}
          onValueChange={(policy) =>
            onChange({ ...value, orientationPolicy: policy as ProcessingOptions["orientationPolicy"] })
          }
          aria-label={copy.settings.orientationLabel}
          disabled={orientationDisabled}
          className={orientationDisabled ? "opacity-60" : undefined}
        >
          {ORIENTATION_POLICIES.map((policy) => (
            <OptionRow
              key={policy}
              id={`orientation-${policy}`}
              value={policy}
              title={copy.settings.orientation[policy].title}
              description={copy.settings.orientation[policy].description}
            />
          ))}
        </RadioGroup>
      </fieldset>
    </div>
  );
}

function OptionRow({ id, value, title, description }: { id: string; value: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-background/50 p-3 transition-colors hover:border-brand/40 has-[[data-state=checked]]:border-brand/60 has-[[data-state=checked]]:bg-brand/8 has-[[data-state=checked]]:ring-glow">
      <RadioGroupItem value={value} id={id} aria-describedby={`${id}-desc`} className="mt-0.5" />
      <div className="grid gap-1">
        <Label htmlFor={id} className="font-medium">
          {title}
        </Label>
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
