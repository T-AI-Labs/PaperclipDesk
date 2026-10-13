import { toast } from 'sonner'

import RemoteConnections from '@/connect/RemoteConnections'
import RemoteForm from '@/connect/RemoteForm'
import { SettingRow } from '@/components/setting-row'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type ConnectionProfile, type Snapshot, connectRemote, connectSavedProfile, errorMessage, setStartupProfile } from '@/lib/client'
import { t } from '@/i18n'

const CHOOSER = 'chooser'

const needsInsecureConfirmation = (profile: ConnectionProfile) => profile.remoteUrl?.startsWith('http://') === true && profile.allowInsecureHttp !== true

const failed = (e: unknown) => toast.error(errorMessage(e))

/// Everything about the connections themselves: the one opened at launch, the saved remotes and a new one.
export default function Connections({ snapshot, onChanged }: { snapshot: Snapshot; onChanged: (snapshot: Snapshot) => void }) {
  const { state, profiles } = snapshot
  const remembered = state.autoConnectLastProfile && !state.alwaysShowChooser ? profiles.find((profile) => profile.id === state.activeProfileId) : undefined

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent>
          <SettingRow label={t('Beim Start öffnen')} description={t('Die Verbindung, die beim Start ohne Nachfrage geöffnet wird.')}>
            <Select value={remembered?.id ?? CHOOSER} onValueChange={(value) => setStartupProfile(value === CHOOSER ? null : value).then(onChanged).catch(failed)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CHOOSER}>{t('Verbindungsauswahl anzeigen')}</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id} disabled={needsInsecureConfirmation(profile)}>
                    {profile.mode === 'local_embedded' ? t('Lokal') : profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      <RemoteConnections
        profiles={profiles.filter((profile) => profile.mode === 'remote_existing')}
        currentProfileId={snapshot.currentProfileId}
        onConnect={(profile) => connectSavedProfile(profile.id).catch(failed)}
        onChanged={onChanged}
      />
      <RemoteForm onConnect={(payload) => connectRemote(payload).catch(failed)} />
    </div>
  )
}
