import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/// Label and help text on the left, the control on the right; rows are separated by the parent's divide-y.
export function SettingRow({ label, description, htmlFor, children }: { label: string; description?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={htmlFor} className="leading-snug">
          {label}
        </Label>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="flex w-56 shrink-0 justify-end">{children}</div>
    </div>
  )
}

export function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <SettingRow label={label} description={description} htmlFor={id}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </SettingRow>
  )
}
