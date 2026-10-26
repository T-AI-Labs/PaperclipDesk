import icons from './icons.json'

const OWNERS: Record<string, string> = icons.owners

/// Read by `npm run catalog`, so the page shows them without asking anyone.
export const CLIPMART_ICON = icons.clipmart

/// The avatar of a repository's owner, given as owner/name, if the snapshot has it.
export const ownerIcon = (repository: string) => OWNERS[repository.split('/')[0]] ?? null
