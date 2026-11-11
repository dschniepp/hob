import { describe, expect, it } from 'vitest'
import { askMacAccess, macAccess, setMacDeps } from '../src/main/tools/mac'
import { reminderAdd, remindersList, setReminderHelper } from '../src/main/tools/reminders'

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
  it('asks before adding and reports the list it used', async () => {
    setReminderHelper(async (args) => ({ ...JSON.parse(args[1]), list: 'Home' }))
    expect(reminderAdd.action({ title: 'x' } as any, ctx)).toMatchObject({ ask: true })
    expect((await reminderAdd.run({ title: 'Call mum' }, ctx)).text).toContain('Call mum')
  })
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
