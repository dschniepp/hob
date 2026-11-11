import { describe, expect, it } from 'vitest'
import { askMacAccess, macAccess, setMacDeps } from '../src/main/tools/mac'
import { NOTES_SCRIPTS, noteAdd, noteDelete, noteIdOf, noteLink, notesRead, notesSearch, noteUpdate, openNote, setNotesRunner } from '../src/main/tools/notes'

const ctx = { signal: undefined } as any

describe('notes tools', () => {
  it('lists notes with the id needed to read or change them, and marks the result untrusted', async () => {
    let sent: any
    setNotesRunner(async (script, args) => { expect(script).toBe(NOTES_SCRIPTS.SEARCH); sent = JSON.parse(args[0]); return JSON.stringify([{ id: 'N-1', title: 'Trip ideas', folder: 'Notes', modified: '2026-10-20T08:00:00Z', snippet: 'Lisbon, Porto' }, { id: 'N-2', title: 'Diary', folder: 'Private', modified: '2026-10-19T08:00:00Z', locked: true }]) })
    const c = { signal: undefined } as any
    const r = await notesSearch.run({ query: ' trip ', folder: 'Notes', modifiedSince: '2026-10-01T00:00', limit: 500 }, c)
    expect(sent).toEqual({ query: 'trip', folder: 'Notes', modifiedSince: '2026-10-01T00:00', limit: 100 })
    expect(r.text).toContain('Trip ideas')
    expect(r.text).toContain('(id: N-1)')
    expect(r.text).toContain('Lisbon, Porto')
    expect(r.text).toContain('(locked)')
    expect(r.text).toContain('[open](hob-note://N-1)')
    expect(c.untrusted).toBe(true)
  })
  it('says so when nothing matches', async () => {
    setNotesRunner(async () => '[]')
    expect((await notesSearch.run({ query: 'xyz' }, ctx)).text).toBe('No notes matching “xyz”.')
    expect((await notesSearch.run({}, ctx)).text).toBe('There are no notes.')
  })
  it('reads one note and marks it untrusted', async () => {
    setNotesRunner(async (script, args) => { expect(script).toBe(NOTES_SCRIPTS.READ); expect(args).toEqual(['N-1']); return JSON.stringify({ id: 'N-1', title: 'Trip ideas', folder: 'Notes', created: '2026-10-01T08:00:00Z', modified: '2026-10-20T08:00:00Z', text: 'Trip ideas\nLisbon' }) })
    const c = { signal: undefined } as any
    const r = await notesRead.run({ id: 'N-1' }, c)
    expect(r.text).toContain('Lisbon')
    expect(r.title).toBe('Read “Trip ideas”')
    expect(r.text).toContain('link: hob-note://N-1')
    expect(c.untrusted).toBe(true)
  })
  it('asks before adding, shows the folder and text, and reports the id', async () => {
    let sent: any
    setNotesRunner(async (script, args) => { expect(script).toBe(NOTES_SCRIPTS.ADD); sent = JSON.parse(args[0]); return JSON.stringify({ id: 'N-9', title: sent.title, folder: sent.folder ?? 'Notes' }) })
    const a = { title: 'Groceries', body: 'Milk\nEggs', folder: 'Home' }
    expect(noteAdd.action(a, ctx)).toMatchObject({ kind: 'app', ask: true })
    expect(noteAdd.ask!(a)).toBe('Add “Groceries” to Notes?')
    expect(noteAdd.askDetail!(a)).toContain('Folder: Home')
    expect(noteAdd.askDetail!(a)).toContain('Milk')
    const r = await noteAdd.run(a, ctx)
    expect(sent).toEqual(a)
    expect(r.text).toBe('Added “Groceries” to the Home notes. (id: N-9) Link: hob-note://N-9')
  })
  it('changes a note: the user sees which one, the runner gets the id and the changes but not the display title', async () => {
    let sent: any
    setNotesRunner(async (script, args) => { expect(script).toBe(NOTES_SCRIPTS.UPDATE); sent = JSON.parse(args[0]); return JSON.stringify({ id: 'N-1', title: 'Trip ideas', folder: 'Notes' }) })
    const a = { id: 'N-1', shown: 'Trip ideas', append: 'Madeira' }
    expect(noteUpdate.action(a, ctx)).toMatchObject({ kind: 'app', ask: true })
    expect(noteUpdate.ask!(a)).toBe('Add to “Trip ideas” in Notes?')
    expect(noteUpdate.ask!({ ...a, title: 'Trips' })).toBe('Change “Trip ideas” in Notes?')
    expect(noteUpdate.ask!({ id: 'N-1', shown: 'Trip ideas', body: 'x' })).toBe('Change “Trip ideas” in Notes?')
    expect(noteUpdate.ask!({ id: 'N-1', shown: 'Trip ideas', folder: 'Home' })).toBe('Change “Trip ideas” in Notes?')
    expect(noteUpdate.askDetail!({ ...a, title: 'Trips' })).toContain('New title: Trips')
    const r = await noteUpdate.run({ ...a }, ctx)
    expect(sent).toEqual({ id: 'N-1', append: 'Madeira' })
    expect(r.text).toContain('Trip ideas')
    expect(r.text).toContain('Link: hob-note://N-1')
  })
  it('asks before deleting, naming the note, and sends only the id', async () => {
    let sent: any
    setNotesRunner(async (script, args) => { expect(script).toBe(NOTES_SCRIPTS.DELETE); sent = args; return JSON.stringify({ id: 'N-1', title: 'Old', folder: 'Notes' }) })
    const a = { id: 'N-1', title: 'Old' }
    expect(noteDelete.action(a, ctx)).toMatchObject({ kind: 'app', ask: true })
    expect(noteDelete.ask!(a)).toBe('Delete “Old” from Notes?')
    expect((await noteDelete.run(a, ctx)).text).toContain('Recently Deleted')
    expect(sent).toEqual(['N-1'])
  })
  it('makes a link from the long ids Notes gives out and reads the id back from it', () => {
    const id = 'x-coredata://4F0B1A2C-1111-2222-3333-444455556666/ICNote/p123'
    const link = noteLink(id)
    expect(link).toMatch(/^hob-note:\/\/[^/]+$/)
    expect(noteIdOf(link)).toBe(id)
    expect(noteIdOf('hob-note://%E0%A4%A')).toBe('')
  })
  it('opens a note in Notes by its id', async () => {
    let seen: any
    setNotesRunner(async (script, args) => { seen = { script, args }; return '{}' })
    await openNote('N-1')
    expect(seen).toEqual({ script: NOTES_SCRIPTS.SHOW, args: ['N-1'] })
  })
  it('requires an id and the shown title so a change can not be made blind', () => {
    expect((noteUpdate.spec.params as any).required).toEqual(['id', 'shown'])
    expect((noteDelete.spec.params as any).required).toEqual(['id', 'title'])
  })
})

/** a pretend Notes app: the scripts Hob sends to the real one run against this */
function pretendNotes(seed: { id: string; text: string; folder: string; modified: string; locked?: boolean }[]) {
  const folders = ['Notes', 'Work', 'Recently Deleted']
  const store = seed.map((s) => ({ ...s, body: '' }))
  const toText = (html: string) => html.replace(/<\/(div|h1)>/g, '\n').replace(/<br>/g, '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\n$/, '')
  const toHtml = (text: string) => text.split('\n').map((l, i) => i === 0 ? `<h1>${l}</h1>` : `<div>${l}</div>`).join('')
  for (const n of store) n.body = toHtml(n.text)
  const note = (n: (typeof store)[number]) => new Proxy({} as any, {
    get: (_, k) => ({
      id: () => n.id, name: () => n.text.split('\n')[0], body: () => n.body, plaintext: () => toText(n.body),
      passwordProtected: () => !!n.locked, modificationDate: () => new Date(n.modified), creationDate: () => new Date(n.modified),
      container: () => ({ name: () => n.folder }),
    } as any)[k as string],
    set: (_, k, v) => { if (k === 'body') { n.body = v; n.text = toText(v); n.modified = '2026-11-11T12:00:00Z' } return true },
  })
  const inFolder = (name: string) => store.filter((n) => n.folder === name)
  const folder = (name: string) => ({
    name: () => name,
    notes: Object.assign({}, {
      id: () => inFolder(name).map((n) => n.id), name: () => inFolder(name).map((n) => n.text.split('\n')[0]),
      plaintext: () => inFolder(name).map((n) => toText(n.body)), modificationDate: () => inFolder(name).map((n) => new Date(n.modified)),
      passwordProtected: () => inFolder(name).map((n) => !!n.locked),
      push: (made: any) => { const id = `N-${store.length + 1}`; store.push({ id, text: toText(made.body), body: made.body, folder: name, modified: '2026-11-11T12:00:00Z' }); made.id = () => id },
    }),
  })
  const Notes = {
    folders: () => folders.map(folder),
    defaultAccount: () => ({ defaultFolder: () => folder('Notes') }),
    notes: { byId: (id: string) => { const n = store.find((x) => x.id === id); return n ? note(n) : { name: () => { throw new Error('Invalid index') } } } },
    Note: (props: { body: string }) => ({ ...props }),
    move: (n: any, o: { to: { name(): string } }) => { store.find((x) => x.id === n.id())!.folder = o.to.name() },
    shown: '' as string,
    show: (n: any) => { Notes.shown = n.id() },
    activate: () => { Notes.activated = true },
    activated: false,
    delete: (n: any) => { store.find((x) => x.id === n.id())!.folder = 'Recently Deleted' },
  }
  const exec = (script: string, arg: unknown) => new Function('Application', `${script}; return run(${JSON.stringify([typeof arg === 'string' ? arg : JSON.stringify(arg)])})`)(() => Notes) as string
  return { store, exec, Notes }
}

describe('the scripts Hob sends to Notes', () => {
  const seed = () => pretendNotes([
    { id: 'N-1', text: 'Trip ideas\nLisbon and Porto', folder: 'Notes', modified: '2026-10-20T08:00:00Z' },
    { id: 'N-2', text: 'Shopping\nMilk, eggs\nand a trip to the market', folder: 'Notes', modified: '2026-11-05T08:00:00Z' },
    { id: 'N-3', text: 'Standup', folder: 'Work', modified: '2026-11-01T08:00:00Z' },
    { id: 'N-4', text: 'Old trip', folder: 'Recently Deleted', modified: '2026-11-06T08:00:00Z' },
    { id: 'N-5', text: 'Diary\nsecret trip', folder: 'Notes', modified: '2026-09-01T08:00:00Z', locked: true },
  ])
  const search = (n: ReturnType<typeof seed>, o: object) => JSON.parse(n.exec(NOTES_SCRIPTS.SEARCH, o)) as { id: string; snippet: string; locked: boolean }[]

  it('finds the newest first, and leaves out what is in Recently Deleted', () => {
    expect(search(seed(), {}).map((n) => n.id)).toEqual(['N-2', 'N-3', 'N-1', 'N-5'])
  })
  it('matches the title and the text, but never the text of a locked note', () => {
    expect(search(seed(), { query: 'TRIP' }).map((n) => n.id)).toEqual(['N-2', 'N-1'])
    expect(search(seed(), { query: 'secret' })).toEqual([])
    expect(search(seed(), { query: 'diary' })[0]).toMatchObject({ id: 'N-5', locked: true, snippet: '' })
  })
  it('limits to a folder, to notes changed since a date, and to a number', () => {
    expect(search(seed(), { folder: 'work' }).map((n) => n.id)).toEqual(['N-3'])
    expect(search(seed(), { modifiedSince: '2026-11-01T00:00:00Z' }).map((n) => n.id)).toEqual(['N-2', 'N-3'])
    expect(search(seed(), { limit: 1 }).map((n) => n.id)).toEqual(['N-2'])
  })
  it('gives a snippet without the title line', () => {
    expect(search(seed(), { query: 'shopping' })[0].snippet).toBe('Milk, eggs and a trip to the market')
  })
  it('reads a note, and refuses a locked one or an id that is gone', () => {
    const n = seed()
    expect(JSON.parse(n.exec(NOTES_SCRIPTS.READ, 'N-1'))).toMatchObject({ id: 'N-1', title: 'Trip ideas', folder: 'Notes', text: 'Trip ideas\nLisbon and Porto' })
    expect(() => n.exec(NOTES_SCRIPTS.READ, 'N-5')).toThrow('locked with a password')
    expect(() => n.exec(NOTES_SCRIPTS.READ, 'N-99')).toThrow("Couldn't find that note")
  })
  it('adds a note: the title first, the text in lines, special characters kept as text', () => {
    const n = seed()
    const r = JSON.parse(n.exec(NOTES_SCRIPTS.ADD, { title: 'Tom & Jerry <3', body: 'one\n\ntwo' }))
    expect(r).toMatchObject({ title: 'Tom & Jerry <3', folder: 'Notes' })
    const made = n.store.at(-1)!
    expect(made.body).toBe('<h1>Tom &amp; Jerry &lt;3</h1><div>one</div><div><br></div><div>two</div>')
  })
  it('adds into a named folder, and says so when there is none of that name', () => {
    const n = seed()
    expect(JSON.parse(n.exec(NOTES_SCRIPTS.ADD, { title: 'Plan', folder: 'work' })).folder).toBe('Work')
    expect(() => n.exec(NOTES_SCRIPTS.ADD, { title: 'Plan', folder: 'Nope' })).toThrow('There is no Notes folder called "Nope"')
  })
  it('appends without touching what is there', () => {
    const n = seed()
    n.exec(NOTES_SCRIPTS.UPDATE, { id: 'N-1', append: 'Madeira' })
    expect(n.store[0].body).toBe('<h1>Trip ideas</h1><div>Lisbon and Porto</div><div>Madeira</div>')
  })
  it('renames keeping the text, and rewrites the text keeping the title', () => {
    const n = seed()
    n.exec(NOTES_SCRIPTS.UPDATE, { id: 'N-1', title: 'Portugal' })
    expect(n.store[0].text).toBe('Portugal\nLisbon and Porto')
    n.exec(NOTES_SCRIPTS.UPDATE, { id: 'N-1', body: 'Only Madeira' })
    expect(n.store[0].text).toBe('Portugal\nOnly Madeira')
  })
  it('moves a note to another folder, and refuses a locked one', () => {
    const n = seed()
    expect(JSON.parse(n.exec(NOTES_SCRIPTS.UPDATE, { id: 'N-1', folder: 'Work' })).folder).toBe('Work')
    expect(() => n.exec(NOTES_SCRIPTS.UPDATE, { id: 'N-5', append: 'x' })).toThrow('locked with a password')
  })
  it('shows a note in the Notes app and brings Notes forward, and says so when the note is gone', () => {
    const n = seed()
    expect(JSON.parse(n.exec(NOTES_SCRIPTS.SHOW, 'N-3'))).toMatchObject({ id: 'N-3', title: 'Standup' })
    expect(n.Notes.shown).toBe('N-3')
    expect(n.Notes.activated).toBe(true)
    expect(() => n.exec(NOTES_SCRIPTS.SHOW, 'N-99')).toThrow("Couldn't find that note")
  })
  it('deletes into Recently Deleted, where the search no longer sees it', () => {
    const n = seed()
    expect(JSON.parse(n.exec(NOTES_SCRIPTS.DELETE, 'N-1'))).toMatchObject({ id: 'N-1', title: 'Trip ideas' })
    expect(n.store[0].folder).toBe('Recently Deleted')
    expect(search(n, {}).map((x) => x.id)).not.toContain('N-1')
  })
})

describe('Notes access', () => {
  it('is checked without asking, and asked for in turn with the others', async () => {
    const calls: string[] = []
    setMacDeps({ helper: async (args) => { calls.push(args[0]); return { status: args[0] === 'notes-status' ? 'notDetermined' : 'granted' } }, mail: async () => '' })
    expect(await macAccess()).toEqual({ calendar: 'granted', mail: 'granted', reminders: 'granted', notes: 'notDetermined' })
    expect(calls).not.toContain('notes-auth')
    setMacDeps({ helper: async () => ({ status: 'granted' }), mail: async () => '' })
    expect((await askMacAccess()).notes).toBe('granted')
  })
  it('says unavailable when the helper can not be run', async () => {
    setMacDeps({ helper: async () => { throw new Error('no helper') }, mail: async () => '' })
    expect((await macAccess()).notes).toBe('unavailable')
  })
})
