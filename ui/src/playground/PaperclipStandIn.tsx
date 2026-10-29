/// Where the app shows Paperclip's own page, below the menu bar: a plain stand-in, so the bar and the menus over it look as they do in the app.
export default function PaperclipStandIn() {
  const nav = ['Dashboard', 'Inbox', 'Issues', 'Goals', 'Agents', 'Approvals', 'Costs']
  return (
    <div aria-hidden className="fixed inset-x-0 top-8 bottom-0 -z-10 flex bg-neutral-50 text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
      <div className="flex w-56 flex-col gap-1 border-r border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-2 font-medium text-neutral-800 dark:text-neutral-200">
          <span className="grid size-6 place-items-center rounded bg-neutral-800 text-[10px] text-white dark:bg-neutral-200 dark:text-neutral-900">AEO</span>
          Aeon Intelligence
        </div>
        {nav.map((entry, index) => (
          <div key={entry} className={index === 0 ? 'rounded-md bg-neutral-200/70 px-2 py-1.5 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200' : 'px-2 py-1.5'}>
            {entry}
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="text-lg font-medium text-neutral-800 dark:text-neutral-200">Dashboard</div>
        <div className="grid grid-cols-3 gap-4">
          {['Open issues', 'Agents running', 'Spend this week'].map((title) => (
            <div key={title} className="h-24 rounded-lg border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
              {title}
            </div>
          ))}
        </div>
        <div className="flex-1 rounded-lg border border-dashed border-neutral-300 p-4 text-sm dark:border-neutral-700">Paperclip's own page appears here in the app.</div>
      </div>
    </div>
  )
}
