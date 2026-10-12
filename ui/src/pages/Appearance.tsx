import { Check, Monitor, Moon, Sun } from "lucide-react";

import { SettingRow } from "@/components/setting-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PageProps } from "@/lib/client";
import {
  ACCENTS,
  type ColorScheme,
  THEMES,
  type ThemePreset,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export default function Appearance({ settings, saving, save }: PageProps) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Modus und Farbe')}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow label={t('Design')} description={t('Gilt für dieses Fenster; Paperclip selbst hat sein eigenes Design.')}>
            <Select
              value={settings.theme}
              disabled={saving}
              onValueChange={(value) => void save({ ...settings, theme: value as ThemePreset }, t('Design gespeichert'))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={t('Farbschema')} description={t('„System“ folgt dem hellen oder dunklen Modus von Windows.')}>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={settings.color_scheme}
              disabled={saving}
              onValueChange={(value) =>
                value &&
                void save(
                  { ...settings, color_scheme: value as ColorScheme },
                  t('Farbschema gespeichert'),
                )
              }
            >
              <ToggleGroupItem value="system" aria-label={t('System')}>
                <Monitor /> {t('System')}
              </ToggleGroupItem>
              <ToggleGroupItem value="light" aria-label={t('Hell')}>
                <Sun /> {t('Hell')}
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label={t('Dunkel')}>
                <Moon /> {t('Dunkel')}
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label={t('Farbe')}
            description={t('Färbt das ganze Design. „Farben des Designs“ lässt es, wie es ist; Schwarz-Weiß nimmt alle Farbe heraus.')}
          >
            <div className="flex flex-wrap justify-end gap-1">
              {ACCENTS.map(({ value, label, swatch }) => {
                const active = settings.accent === value;
                return (
                  <button
                    key={value}
                    type="button"
                    title={t(label)}
                    aria-label={t(label)}
                    aria-pressed={active}
                    disabled={saving}
                    onClick={() =>
                      void save({ ...settings, accent: value }, t('Farbe gespeichert'))
                    }
                    className={cn(
                      "grid size-6 place-items-center rounded-full border ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                      active && "ring-2 ring-foreground",
                    )}
                    style={{ background: swatch }}
                  >
                    {active && (
                      <Check className="size-3 text-white drop-shadow-[0_0_2px_rgb(0_0_0/0.9)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </CardContent>
      </Card>

    </div>
  );
}
