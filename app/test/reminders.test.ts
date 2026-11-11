import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { askMacAccess, macAccess, setMacDeps } from '../src/main/tools/mac'
import { reminderAdd, reminderDelete, remindersList, reminderUpdate, setReminderHelper } from '../src/main/tools/reminders'

const ctx = { signal: undefined } as any

describe('reminders tools', () => {
  it('lists reminders from the helper and marks the result untrusted', async () => {
    setReminderHelper(async (args) => { expect(args[0]).toBe('reminders'); return [{ title: 'Pay rent', list: 'Home', due: '2026-10-22T09:00:00Z' }] })
    const r = await remindersList.run({ query: 'rent' }, ctx)
    expect(r.text).toContain('Pay rent')
    expect(ctx.untrusted).toBe(true)
  })
  it('marks completed reminders so they can be told apart from open ones', async () => {
    setReminderHelper(async () => [
      { title: 'Pay rent', list: 'Home', completed: false },
      { title: 'Call Anna', list: 'Home', completed: true, completedOn: '2026-10-20T09:00:00Z' },
    ])
    const r = await remindersList.run({ includeCompleted: true }, ctx)
    expect(r.text).toContain('- Pay rent')
    expect(r.text).toContain('- ✓ Call Anna · completed')
  })
  it('shows what a reminder repeats, its priority, link and the id needed to change it', async () => {
    setReminderHelper(async () => [{ id: 'ABC-1', title: 'Water plants', list: 'Home', due: '2026-10-22T09:00:00Z', repeat: 'weekly', repeatEvery: 2, priority: 'high', url: 'https://example.com/plants' }])
    const r = await remindersList.run({}, ctx)
    expect(r.text).toContain('Water plants')
    expect(r.text).toContain('repeats every 2 weekly')
    expect(r.text).toContain('high priority')
    expect(r.text).toContain('https://example.com/plants')
    expect(r.text).toContain('(id: ABC-1)')
  })
  it('passes the date filter on only together with includeCompleted', async () => {
    const seen: any[] = []
    setReminderHelper(async (args) => { seen.push(JSON.parse(args[1])); return [] })
    await remindersList.run({ includeCompleted: true, completedSince: '2026-11-02T00:00' }, ctx)
    await remindersList.run({ completedSince: '2026-11-02T00:00' }, ctx)
    expect(seen[0]).toMatchObject({ includeCompleted: true, completedSince: '2026-11-02T00:00' })
    expect(seen[1].completedSince).toBeUndefined()
  })
  it('asks before adding and reports the list it used', async () => {
    setReminderHelper(async (args) => ({ ...JSON.parse(args[1]), list: 'Home' }))
    expect(reminderAdd.action({ title: 'x' } as any, ctx)).toMatchObject({ ask: true })
    expect((await reminderAdd.run({ title: 'Call mum' }, ctx)).text).toContain('Call mum')
  })
  it('adds a reminder with an alert, repeat, priority and link, and shows them before asking', async () => {
    let sent: any
    setReminderHelper(async (args) => { expect(args[0]).toBe('add-reminder'); sent = JSON.parse(args[1]); return { ...sent, id: 'N-1', list: 'Home', priority: 'high', repeat: 'weekly' } })
    const a = { title: 'Pay rent', due: '2026-11-28T09:00', repeat: 'monthly', priority: 'high', url: 'https://example.com', alarm: false } as const
    const detail = reminderAdd.askDetail!(a)
    expect(detail).toContain('Repeats: monthly')
    expect(detail).toContain('Priority: high')
    expect(detail).toContain('Link: https://example.com')
    expect(detail).toContain('No alert')
    const r = await reminderAdd.run({ ...a }, ctx)
    expect(sent).toEqual(a)
    expect(r.text).toContain('repeating weekly')
    expect(r.text).toContain('high priority')
    expect(r.text).toContain('(id: N-1)')
  })
  it('changes a reminder: the user sees which one, the helper gets the id and the changes but not the display title', async () => {
    let sent: any
    setReminderHelper(async (args) => { expect(args[0]).toBe('update-reminder'); sent = JSON.parse(args[1]); return { id: 'N-1', title: 'Pay rent', list: 'Home', completed: false, due: '2026-12-01T09:00:00Z' } })
    const a = { id: 'N-1', shown: 'Pay rent', due: '2026-12-01T09:00', priority: 'low' } as const
    expect(reminderUpdate.action(a as any, ctx)).toMatchObject({ kind: 'app', ask: true })
    expect(reminderUpdate.ask!(a as any)).toBe('Change “Pay rent” in Reminders?')
    const r = await reminderUpdate.run({ ...a }, ctx)
    expect(sent).toEqual({ id: 'N-1', due: '2026-12-01T09:00', priority: 'low' })
    expect(r.text).toContain('Pay rent')
    expect(r.text).toContain('open')
  })
  it('asks to tick off, not to change, when only completed is sent', async () => {
    let sent: any
    setReminderHelper(async (args) => { sent = JSON.parse(args[1]); return { id: 'N-1', title: 'Call Anna', list: 'Home', completed: true } })
    const a = { id: 'N-1', shown: 'Call Anna', completed: true }
    expect(reminderUpdate.ask!(a as any)).toBe('Tick off “Call Anna” in Reminders?')
    expect(reminderUpdate.ask!({ ...a, priority: 'high' } as any)).toBe('Change “Call Anna” in Reminders?')
    expect(reminderUpdate.askDetail!(a as any)).toContain('Mark as done')
    expect((await reminderUpdate.run(a, ctx)).text).toContain('done')
    expect(sent).toEqual({ id: 'N-1', completed: true })
    expect(reminderUpdate.askDetail!({ ...a, completed: false } as any)).toContain('Mark as not done')
  })
  it('asks before deleting, naming the reminder, and sends only the id', async () => {
    let sent: any
    setReminderHelper(async (args) => { expect(args[0]).toBe('delete-reminder'); sent = JSON.parse(args[1]); return { id: 'N-1', title: 'Old thing', list: 'Home' } })
    const a = { id: 'N-1', title: 'Old thing' }
    expect(reminderDelete.action(a, ctx)).toMatchObject({ kind: 'app', ask: true })
    expect(reminderDelete.ask!(a)).toBe('Delete “Old thing” from Reminders?')
    expect((await reminderDelete.run(a, ctx)).text).toBe('Deleted “Old thing” from the Home reminders.')
    expect(sent).toEqual({ id: 'N-1' })
  })
  it('requires an id and the shown title so a change can not be made blind', () => {
    expect((reminderUpdate.spec.params as any).required).toEqual(['id', 'shown'])
    expect((reminderDelete.spec.params as any).required).toEqual(['id', 'title'])
  })
})

// The real helper checks what it is given before it asks macOS for anything, so these need no permission.
const helperPath = join(__dirname, '../resources/bin/hob-mac')
describe.runIf(process.platform === 'darwin' && existsSync(helperPath))('the Mac helper checks reminder fields', () => {
  const run = (cmd: string, json: object) => {
    try { execFileSync(helperPath, [cmd, JSON.stringify(json)], { encoding: 'utf8', stdio: 'pipe' }); return '' } catch (e: any) { return String(e.stderr).trim() }
  }
  it('refuses a priority it does not know', () => expect(run('add-reminder', { title: 'x', priority: 'urgent' })).toBe('priority must be high, medium, low or none.'))
  it('refuses a repeat it does not know', () => expect(run('add-reminder', { title: 'x', repeat: 'hourly', due: '2026-11-20T09:00' })).toBe('repeat must be daily, weekly, monthly, yearly or none.'))
  it('refuses a repeat without a due date', () => expect(run('add-reminder', { title: 'x', repeat: 'weekly' })).toBe('A repeating reminder needs a due date.'))
  it('refuses repeating every 0', () => expect(run('add-reminder', { title: 'x', repeat: 'daily', repeatEvery: 0, due: '2026-11-20' })).toBe('repeatEvery must be 1 or more.'))
  it('refuses a link it can not read', () => expect(run('add-reminder', { title: 'x', url: 'not a link' })).toBe('Couldn\'t read the link "not a link".'))
  it('refuses a blank title', () => expect(run('add-reminder', { title: '  ' })).toBe('add-reminder needs a title'))
})

describe('Reminders access', () => {
  it('is reported by macAccess without asking, and asked for by askMacAccess', async () => {
    const calls: string[] = []
    setMacDeps({ helper: async (args) => { calls.push(args[0]); return { status: args[0].startsWith('reminder') ? 'notDetermined' : 'granted' } }, mail: async () => '' })
    expect(await macAccess()).toEqual({ calendar: 'granted', mail: 'granted', reminders: 'notDetermined' })
    expect(calls).not.toContain('reminder-auth')
    expect(await askMacAccess()).toMatchObject({ reminders: 'notDetermined' })
    expect(calls).toContain('reminder-auth')
  })
})
