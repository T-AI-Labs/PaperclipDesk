import { Power } from 'lucide-react'
import { toast } from 'sonner'

import RemoteConnections from '@/connect/RemoteConnections'
import RemoteForm from '@/connect/RemoteForm'
import { SwitchRow } from '@/components/setting-row'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ConnectionProfile, type Snapshot, connectRemote, connectSavedProfile, errorMessage, setOpenAtStart } from '@/lib/client'
import { t } from '@/i18n'

const needsInsecureConfirmation = (profile: ConnectionProfile) => profile.remoteUrl?.startsWith('http://') === true && profile.allowInsecureHttp !== true

const failed = (e: unknown) => toast.error(errorMessage(e))

/// Everything about the connections themselves: the ones opened at launch, the saved remotes and a new one.
export default function Connections({ snapshot, onChanged }: { snapshot: Snapshot; onChanged: (snapshot: Snapshot) => void }) {
  const { state, profiles } = snapshot

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="size-4 text-primary" /> {t('Beim Start öffnen')}
          </CardTitle>
          <CardDescription>{t('Diese Verbindungen öffnet die App beim Start ohne Nachfrage; die zuletzt genutzte liegt vorn. Ohne Auswahl zeigt sie die Verbindungsseite.')}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {profiles.map((profile) => (
            <SwitchRow
              key={profile.id}
              id={`open-at-start-${profile.id}`}
              label={profile.mode === 'local_embedded' ? t('Lokal') : profile.name}
              description={profile.remoteUrl}
              checked={state.startupProfileIds.includes(profile.id)}
              disabled={needsInsecureConfirmation(profile)}
              onChange={(open) => setOpenAtStart(profile.id, open).then(onChanged).catch(failed)}
            />
          ))}
        </CardContent>
      </Card>

      <RemoteConnections
        profiles={profiles.filter((profile) => profile.mode === 'remote_existing')}
        openProfileIds={snapshot.openConnections.map((connection) => connection.profileId)}
        onConnect={(profile) => connectSavedProfile(profile.id).catch(failed)}
        onChanged={onChanged}
      />
      <RemoteForm onConnect={(payload) => connectRemote(payload).catch(failed)} />
    </div>
  )
}
