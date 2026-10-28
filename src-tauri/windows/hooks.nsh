; Uninstalling removes everything the app keeps: settings, connections, logs, the local server's instances with their
; backups, browser profiles and the downloaded server. An update runs the uninstaller too, with /UPDATE; it keeps all of it.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    ; A server killed with the app keeps its database open, and its files could not be removed.
    nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$LOCALAPPDATA\Paperclip\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    ; RmDir stops at MAX_PATH, and the server's node_modules go deeper; rd with \\?\ does not.
    nsExec::Exec `cmd /c rd /s /q "\\?\$APPDATA\Paperclip"`
    Pop $0
    nsExec::Exec `cmd /c rd /s /q "\\?\$LOCALAPPDATA\Paperclip"`
    Pop $0
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}
!macroend
