import { useState } from 'react'
import { LoaderCircle, Plus, ShieldAlert, ShieldCheck } from 'lucide-react'

import { SettingRow, SwitchRow } from '@/components/setting-row'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { type RemoteConnect, type RemotePreflightResult, errorMessage, verifyRemote } from '@/lib/client'
import { cn } from '@/lib/utils'

import { TONE_DOT, describeVerification, isInsecureHttpUrl, verificationMeta } from './format'
import { t } from '@/i18n'

/// A new remote: check the URL first, then connect once or connect and keep it.
export default function RemoteForm({ rememberChoice, onConnect }: { rememberChoice: boolean; onConnect: (payload: RemoteConnect) => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [allowInsecure, setAllowInsecure] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState<RemotePreflightResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const insecure = isInsecureHttpUrl(url)
  const blockedByHttp = insecure && !allowInsecure
  const verified = result?.ok === true && !blockedByHttp
  const verdict = result && describeVerification(result)

  function changeUrl(value: string) {
    setUrl(value)
    setResult(null)
    setError(null)
  }

  async function verify() {
    if (!url.trim()) return setError(t('Bitte eine gültige Remote-URL eingeben.'))
    if (blockedByHttp) return setError(t('Bitte zuerst die Warnung zur unsicheren HTTP-Verbindung bestätigen.'))
    setVerifying(true)
    setError(null)
    try {
      setResult(await verifyRemote(url))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setVerifying(false)
    }
  }

  function connect(saveProfile: boolean) {
    if (!result?.ok) return
    onConnect({ remoteUrl: result.normalizedUrl, displayName: name.trim() || undefined, saveProfile, rememberChoice, allowInsecureHttp: result.insecureTransport && allowInsecure })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4 text-primary" /> {t('Neue Remote-Verbindung')}
        </CardTitle>
        <CardDescription>{t('Der Remote wird vor dem Verbinden geprüft: Health-Endpunkt, Anmeldung und Sitzung. HTTPS ist empfohlen; HTTP braucht eine ausdrückliche Bestätigung.')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void verify()
          }}
        >
          <Input value={url} onChange={(event) => changeUrl(event.target.value)} placeholder="https://paperclip.example.com" aria-label={t('Remote-URL')} aria-invalid={error !== null} spellCheck={false} />
          <Button type="submit" variant="outline" disabled={verifying}>
            {verifying ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} {verifying ? t('Prüfe …') : t('Prüfen')}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {insecure && (
          <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <ShieldAlert className="size-4" /> {t('Unsicheres HTTP')}
            </p>
            <SwitchRow
              id="allow-insecure-http"
              label={t('Ich kenne das Risiko und möchte diese HTTP-Verbindung zulassen')}
              description={t('Diese URL verzichtet auf TLS. Nur fortfahren, wenn du dem Netzwerkweg zu diesem Remote vertraust.')}
              checked={allowInsecure}
              onChange={setAllowInsecure}
            />
          </div>
        )}

        {result && verdict && (
          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span aria-hidden className={cn('size-2 rounded-full', TONE_DOT[verdict.tone])} />
                {verdict.badge}
              </span>
              <span className="text-xs text-muted-foreground">{verificationMeta(result)}</span>
            </div>
            <p className="text-sm text-muted-foreground">{verdict.detail}</p>
          </div>
        )}

        {verified && (
          <SettingRow label={t('Anzeigename')} description={t('Optional; ohne Namen heißt die Verbindung wie ihr Host.')} htmlFor="remote-name">
            <Input id="remote-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('z. B. Heimserver')} />
          </SettingRow>
        )}
      </CardContent>
      {verified && (
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" onClick={() => connect(false)}>
            {t('Einmalig verbinden')}
          </Button>
          <Button onClick={() => connect(true)}>{t('Verbinden und speichern')}</Button>
        </CardFooter>
      )}
    </Card>
  )
}
