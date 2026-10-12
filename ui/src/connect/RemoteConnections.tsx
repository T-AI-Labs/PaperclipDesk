import { useState } from 'react'
import { Copy, Globe, Pencil, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { SwitchRow } from '@/components/setting-row'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { type ConnectionProfile, type Snapshot, deleteProfile, duplicateProfile, errorMessage, saveRemoteProfile } from '@/lib/client'
import { cn } from '@/lib/utils'

import { TONE_STYLE, isInsecureHttpUrl, profileHealth, relativeTime } from './format'
import { t } from '@/i18n'

function EditSheet({ profile, onClose, onSaved }: { profile: ConnectionProfile; onClose: () => void; onSaved: (snapshot: Snapshot) => void }) {
  const [name, setName] = useState(profile.name)
  const [url, setUrl] = useState(profile.remoteUrl ?? '')
  const [allowInsecure, setAllowInsecure] = useState(profile.allowInsecureHttp === true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const insecure = isInsecureHttpUrl(url)

  async function save() {
    setSaving(true)
    try {
      onSaved(await saveRemoteProfile({ profileId: profile.id, name, remoteUrl: url, allowInsecureHttp: insecure && allowInsecure }))
      toast.success(t('Verbindung gespeichert'))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('Verbindung bearbeiten')}</SheetTitle>
          <SheetDescription>{t('Remote-Profile werden vor jeder Nutzung geprüft und speichern nie Passwörter.')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">{t('Name')}</Label>
            <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Name der Verbindung')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-url">URL</Label>
            <Input id="edit-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://paperclip.example.com" aria-invalid={error !== null} spellCheck={false} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          {insecure && (
            <div className="flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <ShieldAlert className="size-4" /> {t('Unsicheres HTTP')}
              </p>
              <div className="flex items-start justify-between gap-3">
                <Label htmlFor="edit-allow-insecure" className="text-xs leading-relaxed font-normal text-muted-foreground">
                  {t('Mit dieser URL laufen künftige Verbindungen im Klartext. Ich kenne das Risiko und möchte sie so speichern.')}
                </Label>
                <Switch id="edit-allow-insecure" checked={allowInsecure} onCheckedChange={setAllowInsecure} />
              </div>
            </div>
          )}
        </div>
        <SheetFooter className="flex-row justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('Abbrechen')}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {t('Speichern')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/// The saved remotes: connect, edit, duplicate, delete.
export default function RemoteConnections({
  profiles,
  currentProfileId,
  rememberChoice,
  onRememberChoice,
  onConnect,
  onChanged,
}: {
  profiles: ConnectionProfile[]
  currentProfileId: string | null
  rememberChoice: boolean
  onRememberChoice: (value: boolean) => void
  onConnect: (profile: ConnectionProfile) => void
  onChanged: (snapshot: Snapshot) => void
}) {
  const [editing, setEditing] = useState<ConnectionProfile | null>(null)
  const [deleting, setDeleting] = useState<ConnectionProfile | null>(null)

  function run(action: Promise<Snapshot>, success: string) {
    action
      .then((snapshot) => {
        onChanged(snapshot)
        toast.success(success)
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-primary" /> {t('Gespeicherte Verbindungen')}
        </CardTitle>
        <CardDescription>{t('Jede Verbindung hat ihr eigenes Browserprofil, Anmeldungen bleiben also getrennt.')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {profiles.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t('Noch keine Remote-Verbindung gespeichert.')}</p>}
        <ul className="flex flex-col gap-2">
          {profiles.map((profile) => {
            const health = profileHealth(profile)
            const last = relativeTime(profile.lastConnectedAt)
            return (
              <li key={profile.id} className={cn('flex items-center gap-3 rounded-xl border bg-card/60 px-3 py-2.5', profile.id === currentProfileId && 'border-primary/50')}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{profile.name}</span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', TONE_STYLE[health.tone])}>{health.label}</span>
                    {profile.allowInsecureHttp && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', TONE_STYLE.pending)}>HTTP</span>}
                  </div>
                  <span className="truncate font-mono text-xs text-muted-foreground">{profile.remoteUrl}</span>
                  {last && <span className="text-[11px] text-muted-foreground">{t('Zuletzt verbunden {when}', { when: last })}</span>}
                </div>
                <Button variant="ghost" size="icon-sm" title={t('Bearbeiten')} aria-label={t('Bearbeiten')} onClick={() => setEditing(profile)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" title={t('Duplizieren')} aria-label={t('Duplizieren')} onClick={() => run(duplicateProfile(profile.id), t('Verbindung dupliziert'))}>
                  <Copy />
                </Button>
                <Button variant="ghost" size="icon-sm" title={t('Löschen')} aria-label={t('Löschen')} onClick={() => setDeleting(profile)}>
                  <Trash2 />
                </Button>
                <Button size="sm" onClick={() => onConnect(profile)}>
                  {t('Verbinden')}
                </Button>
              </li>
            )
          })}
        </ul>
        {profiles.length > 0 && (
          <div className="border-t pt-3.5">
            <SwitchRow
              id="remember-remote"
              label={t('Beim Start wieder mit dem gewählten Remote verbinden')}
              description={t('Gilt für die Verbindung, die du als Nächstes öffnest.')}
              checked={rememberChoice}
              onChange={onRememberChoice}
            />
          </div>
        )}
      </CardContent>

      {editing && <EditSheet key={editing.id} profile={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('Verbindung löschen?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('„{name}“ wird entfernt. Die Sitzungsdaten dieser Verbindung werden ebenfalls gelöscht. Das lässt sich nicht rückgängig machen.', { name: deleting?.name ?? '' })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Abbrechen')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && run(deleteProfile(deleting.id), t('Verbindung gelöscht'))}>{t('Löschen')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
