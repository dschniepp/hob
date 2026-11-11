import { execFile } from 'node:child_process'
import type { Tool } from '../agent/tool'
import { t } from '../../shared/i18n'

/**
 * The Notes app on this Mac, through JavaScript for Automation (the same way Mail is reached): find and read
 * notes, add them, change them, delete them (into Recently Deleted: the user can still get them back).
 */
type Runner = (script: string, args: string[], signal?: AbortSignal) => Promise<string>

let run: Runner = (script, args, signal) => new Promise((resolve, reject) => {
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 120_000, signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (!err) return resolve(stdout.trim())
    const e = stderr.trim()
    reject(new Error(/-1743|not allowed|Not authorized/i.test(e)
      ? "Hob isn't allowed to use Notes yet. Allow it in System Settings → Privacy & Security → Automation → Hob → Notes."
      : e || err.message))
  })
})
/** Tests and fake mode can supply a harmless runner. */
export const setNotesRunner = (r: Runner) => { run = r }

type Found = { id: string; title: string; folder: string; modified: string; snippet?: string; locked?: boolean }
type Note = Found & { created: string; text: string }
type Changed = { id: string; title: string; folder: string }

/** the folder where deleted notes wait: named by the Mac's language */
export const DELETED_FOLDERS = ['Recently Deleted', 'Zuletzt gelöscht', 'Récemment supprimées', 'Eliminados recientemente', 'Eliminati di recente', 'Onlangs verwijderd', 'Apagados recentemente', '最近削除した項目', '最近删除', '最近刪除', '최근 삭제된 항목', 'Недавно удалённые', 'Nyligen borttagna']

// JavaScript for Automation. One Apple event per property for a whole folder is fast; one per note is not.
const COMMON = `const DELETED = ${JSON.stringify(DELETED_FOLDERS)}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Notes stores a note as HTML; its first line is its title
const html = (text) => String(text).split('\\n').map((l) => l.trim() ? '<div>' + esc(l) + '</div>' : '<div><br></div>').join('')
const findFolder = (Notes, name) => {
  if (!name) return Notes.defaultAccount().defaultFolder()
  const f = Notes.folders().find((x) => x.name().toLowerCase() === String(name).toLowerCase())
  if (!f) throw new Error('There is no Notes folder called "' + name + '".')
  return f
}
const getNote = (Notes, id) => {
  const n = Notes.notes.byId(id)
  try { n.name() } catch (e) { throw new Error("Couldn't find that note. Search the notes again and use the id shown there.") }
  return n
}`

const SEARCH = `${COMMON}
function run(argv) {
  const o = JSON.parse(argv[0])
  const Notes = Application('Notes')
  const q = (o.query || '').toLowerCase(), since = o.modifiedSince ? new Date(o.modifiedSince) : null
  const out = []
  for (const f of Notes.folders()) {
    const folder = f.name()
    if (DELETED.includes(folder) || (o.folder && folder.toLowerCase() !== String(o.folder).toLowerCase())) continue
    const n = f.notes
    const ids = n.id(), names = n.name(), mods = n.modificationDate()
    let texts, locked
    try { texts = n.plaintext() } catch (e) { texts = names.map(() => '') }
    try { locked = n.passwordProtected() } catch (e) { locked = names.map(() => false) }
    for (let i = 0; i < ids.length; i++) {
      const text = locked[i] ? '' : (texts[i] || '')
      if (q && !((names[i] || '').toLowerCase().includes(q) || text.toLowerCase().includes(q))) continue
      if (since && new Date(mods[i]) < since) continue
      const rest = text.split('\\n').slice(1).join(' ').replace(/\\s+/g, ' ').trim()
      out.push({ id: ids[i], title: names[i], folder, modified: mods[i], snippet: rest.slice(0, 160), locked: !!locked[i] })
    }
  }
  out.sort((a, b) => new Date(b.modified) - new Date(a.modified))
  return JSON.stringify(out.slice(0, o.limit || 25))
}`
const READ = `${COMMON}
function run(argv) {
  const Notes = Application('Notes')
  const n = getNote(Notes, argv[0])
  if (n.passwordProtected()) throw new Error('That note is locked with a password, so Hob cannot read it.')
  return JSON.stringify({ id: n.id(), title: n.name(), folder: n.container().name(), created: n.creationDate(), modified: n.modificationDate(), text: (n.plaintext() || '').slice(0, 12000) })
}`
const ADD = `${COMMON}
function run(argv) {
  const o = JSON.parse(argv[0])
  const Notes = Application('Notes')
  const folder = findFolder(Notes, o.folder)
  const note = Notes.Note({ body: '<h1>' + esc(o.title) + '</h1>' + html(o.body || '') })
  folder.notes.push(note)
  let id = ''
  try { id = note.id() } catch (e) {
    // the newest note of the folder is the one just made
    const ids = folder.notes.id(), mods = folder.notes.modificationDate()
    let last = 0
    for (let i = 1; i < ids.length; i++) if (mods[i] > mods[last]) last = i
    id = ids[last]
  }
  return JSON.stringify({ id, title: o.title, folder: folder.name() })
}`
const UPDATE = `${COMMON}
function run(argv) {
  const o = JSON.parse(argv[0])
  const Notes = Application('Notes')
  const n = getNote(Notes, o.id)
  if (n.passwordProtected()) throw new Error('That note is locked with a password, so Hob cannot change it.')
  if (o.body !== undefined || o.title !== undefined) {
    // replacing the text starts the note over: its title and body, without the old formatting
    const old = (n.plaintext() || '').split('\\n')
    const title = o.title !== undefined ? o.title : old[0]
    const body = o.body !== undefined ? o.body : old.slice(1).join('\\n')
    n.body = '<h1>' + esc(title) + '</h1>' + html(body)
  }
  if (o.append) n.body = n.body() + html(o.append)
  if (o.folder) Notes.move(n, { to: findFolder(Notes, o.folder) })
  return JSON.stringify({ id: n.id(), title: n.name(), folder: n.container().name() })
}`
const SHOW = `${COMMON}
function run(argv) {
  const Notes = Application('Notes')
  const n = getNote(Notes, argv[0])
  Notes.show(n)
  Notes.activate()
  return JSON.stringify({ id: n.id(), title: n.name() })
}`
const DELETE = `${COMMON}
function run(argv) {
  const Notes = Application('Notes')
  const n = getNote(Notes, argv[0])
  const r = { id: n.id(), title: n.name(), folder: n.container().name() }
  Notes.delete(n)
  return JSON.stringify(r)
}`
/** tests run these against a pretend Notes */
export const NOTES_SCRIPTS = { SEARCH, READ, ADD, UPDATE, DELETE, SHOW }

/**
 * A link that opens the note in the Notes app: Hob's own, because the ids Notes gives out can not be put
 * in a notes:// link. A click in a reply comes back through openNote.
 */
export const noteLink = (id: string) => `hob-note://${encodeURIComponent(id)}`
export const noteIdOf = (link: string) => { try { return decodeURIComponent(link.replace(/^hob-note:\/\//, '')) } catch { return '' } }
export async function openNote(id: string): Promise<void> { await run(SHOW, [id]) }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const call = async <T>(script: string, arg: unknown, signal?: AbortSignal) => JSON.parse(await run(script, [typeof arg === 'string' ? arg : JSON.stringify(arg)], signal)) as T

export const notesSearch: Tool<{ query?: string; folder?: string; modifiedSince?: string; limit?: number }> = {
  spec: {
    name: 'notes_search',
    description: "Find notes in the user's Notes app by words in the title or text, newest change first. Leave the query out for the latest notes. Returns ids for notes_read, note_update and note_delete.",
    params: { type: 'object', properties: {
      query: { type: 'string' },
      folder: { type: 'string', description: 'Only this folder' },
      modifiedSince: { type: 'string', description: 'Only notes changed on or after this local date/time, like 2026-11-02T00:00' },
      limit: { type: 'number', description: 'How many (default 25, at most 100)' },
    } },
  },
  title: (a) => a.query ? t('Searched your notes for “{query}”', { query: a.query }) : t('Looked at your latest notes'),
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const found = await call<Found[]>(NOTES_SCRIPTS.SEARCH, { query: a.query?.trim() ?? '', folder: a.folder, modifiedSince: a.modifiedSince, limit: Math.min(Number(a.limit) || 25, 100) }, ctx.signal)
    if (!found.length) return { text: a.query ? `No notes matching “${a.query}”.` : 'There are no notes.' }
    ctx.untrusted = true
    return { text: found.map((n) => `- ${n.title || '(no title)'} · changed ${when(n.modified)} [${n.folder}]${n.locked ? ' (locked)' : ''} (id: ${n.id}) [open](${noteLink(n.id)})${n.snippet ? `\n  ${n.snippet}` : ''}`).join('\n') }
  },
}

export const notesRead: Tool<{ id: string }> = {
  spec: {
    name: 'notes_read',
    description: 'Read one note, by the id notes_search gave.',
    params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  title: () => t('Read a note'),
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const n = await call<Note>(NOTES_SCRIPTS.READ, String(a.id), ctx.signal)
    ctx.untrusted = true
    return { text: `${n.title}\n[${n.folder}] · created ${when(n.created)} · changed ${when(n.modified)} · link: ${noteLink(n.id)}\n\n${n.text}`, title: t('Read “{title}”', { title: n.title }) }
  },
}

export const noteAdd: Tool<{ title: string; body?: string; folder?: string }> = {
  spec: {
    name: 'note_add',
    description: "Add a note to the user's Notes app. The title becomes its first line. folder is optional and defaults to the Notes app's default folder.",
    params: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string', description: 'The text under the title; new lines are kept' }, folder: { type: 'string' } }, required: ['title'] },
  },
  title: (a) => t('Added “{title}” to Notes', { title: a.title }),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => t('Add “{title}” to Notes?', { title: a.title }),
  askDetail: (a) => [a.folder && t('Folder: {name}', { name: a.folder }), a.body?.slice(0, 300)].filter(Boolean).join('\n'),
  async run(a, ctx) {
    const n = await call<Changed>(NOTES_SCRIPTS.ADD, a, ctx.signal)
    return { text: `Added “${n.title}” to the ${n.folder} notes. (id: ${n.id}) Link: ${noteLink(n.id)}` }
  },
}

type ChangeNote = { id: string; shown: string; title?: string; body?: string; append?: string; folder?: string }
export const noteUpdate: Tool<ChangeNote> = {
  spec: {
    name: 'note_update',
    description: "Change a note in the user's Notes app. id comes from notes_search; shown is the title as listed, so the user sees which note. append adds text at the end and keeps everything else. title or body replace the title or the text under it, and drop the note's other formatting (lists, pictures, tables), so prefer append unless the user wants the text rewritten. folder moves it. Send only what changes.",
    params: { type: 'object', properties: { id: { type: 'string' }, shown: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, append: { type: 'string' }, folder: { type: 'string' } }, required: ['id', 'shown'] },
  },
  title: (a) => t('Changed “{title}” in Notes', { title: a.shown }),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => !a.title && a.body === undefined && !a.folder && a.append ? t('Add to “{title}” in Notes?', { title: a.shown }) : t('Change “{title}” in Notes?', { title: a.shown }),
  askDetail: (a) => [a.title && t('New title: {name}', { name: a.title }), a.folder && t('Folder: {name}', { name: a.folder }), a.body?.slice(0, 300), a.append?.slice(0, 300)].filter(Boolean).join('\n'),
  async run(a, ctx) {
    const { shown: _shown, ...change } = a
    const n = await call<Changed>(NOTES_SCRIPTS.UPDATE, change, ctx.signal)
    return { text: `Updated “${n.title}” in the ${n.folder} notes. Link: ${noteLink(n.id)}` }
  },
}

export const noteDelete: Tool<{ id: string; title: string }> = {
  spec: {
    name: 'note_delete',
    description: "Delete a note from the user's Notes app. It goes to Recently Deleted, where the user can still get it back for about 30 days. id comes from notes_search; title is the title as listed.",
    params: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] },
  },
  title: (a) => t('Deleted “{title}” from Notes', { title: a.title }),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => t('Delete “{title}” from Notes?', { title: a.title }),
  async run(a, ctx) {
    const n = await call<Changed>(NOTES_SCRIPTS.DELETE, a.id, ctx.signal)
    return { text: `Deleted “${n.title}” from the ${n.folder} notes. It is in Recently Deleted for now.` }
  },
}

export const macNoteTools: Tool<any>[] = [notesSearch, notesRead, noteAdd, noteUpdate, noteDelete]
