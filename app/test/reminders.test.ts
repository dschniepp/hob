import { describe, expect, it } from 'vitest'
import { reminderAdd, remindersList, setReminderHelper } from '../src/main/tools/reminders'

const ctx = { signal: undefined } as any

describe('reminders tools', () => {
  it('lists reminders from the helper and marks the result untrusted', async () => {
    setReminderHelper(async (args) => { expect(args[0]).toBe('reminders'); return [{ title: 'Pay rent', list: 'Home', due: '2026-10-22T09:00:00Z' }] })
    const r = await remindersList.run({ query: 'rent' }, ctx)
    expect(r.text).toContain('Pay rent')
    expect(ctx.untrusted).toBe(true)
  })
  it('asks before adding and reports the list it used', async () => {
    setReminderHelper(async (args) => ({ ...JSON.parse(args[1]), list: 'Home' }))
    expect(reminderAdd.action({ title: 'x' } as any, ctx)).toMatchObject({ ask: true })
    expect((await reminderAdd.run({ title: 'Call mum' }, ctx)).text).toContain('Call mum')
  })
})
