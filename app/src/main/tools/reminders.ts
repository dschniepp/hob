import { execFile } from 'node:child_process'
import { macHelperPath } from './mac'
import type { Tool } from '../agent/tool'
import { t } from '../../shared/i18n'

type Reminder = {
  id?: string; title: string; due?: string; list: string; notes?: string; completed?: boolean; completedOn?: string
  url?: string; priority?: 'high' | 'medium' | 'low'; repeat?: string; repeatEvery?: number
}
type Fields = { due?: string; list?: string; notes?: string; url?: string; priority?: 'high' | 'medium' | 'low' | 'none'; repeat?: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'none'; repeatEvery?: number; alarm?: boolean }
type NewReminder = Fields & { title: string }
type ChangeReminder = Fields & { id: string; shown: string; title?: string; completed?: boolean }
type DeleteReminder = { id: string; title: string }
type Helper = (args: string[], signal?: AbortSignal) => Promise<unknown>

let helper: Helper = (args, signal) => new Promise((resolve, reject) => {
  execFile(macHelperPath(), args, { timeout: 150_000, signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return reject(new Error(stderr.trim() || err.message))
    try { resolve(JSON.parse(stdout)) } catch { reject(new Error('The Reminders helper gave an answer Hob could not read.')) }
  })
})
/** Tests and fake mode can supply a harmless helper. */
export const setReminderHelper = (h: Helper) => { helper = h }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const repeats = (r: Reminder) => r.repeat ? `${r.repeatEvery && r.repeatEvery > 1 ? `every ${r.repeatEvery} ` : ''}${r.repeat}` : ''
/** one reminder as a line the model can read, with the id it needs to change or delete it */
const line = (r: Reminder) => {
  const bits = [
    `${r.completed ? '✓ ' : ''}${r.title}`,
    r.completed && `completed${r.completedOn ? ` ${day(r.completedOn)}` : ''}`,
    r.due && `due ${when(r.due)}`,
    r.repeat && `repeats ${repeats(r)}`,
    r.priority && `${r.priority} priority`,
  ].filter(Boolean).join(' · ')
  const extra = [r.url, r.notes && r.notes.replace(/\s+/g, ' ').slice(0, 300)].filter(Boolean).map((x) => `\n  ${x}`).join('')
  return `- ${bits} [${r.list}]${r.id ? ` (id: ${r.id})` : ''}${extra}`
}
const fieldParams = {
  due: { type: 'string', description: 'Local date/time like 2026-10-21T15:00. Gets an alert at that time unless alarm is false. On a change, an empty string removes it.' },
  list: { type: 'string', description: 'Name of a reminders list' },
  notes: { type: 'string' },
  url: { type: 'string', description: 'A link to attach, like https://example.com' },
  priority: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
  repeat: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly', 'none'], description: 'Needs a due date. none stops repeating.' },
  repeatEvery: { type: 'number', description: 'With repeat: every N days/weeks/months/years (default 1)' },
  alarm: { type: 'boolean', description: 'Alert at the due time (default true)' },
}
const details = (a: Fields) => [
  a.list && t('List: {name}', { name: a.list }), a.due && `Due: ${a.due}`, a.repeat && a.repeat !== 'none' && `Repeats: ${a.repeat}${a.repeatEvery && a.repeatEvery > 1 ? ` (every ${a.repeatEvery})` : ''}`,
  a.priority && a.priority !== 'none' && `Priority: ${a.priority}`, a.url && `Link: ${a.url}`, a.alarm === false && 'No alert', a.notes,
].filter(Boolean).join('\n')

export const remindersList: Tool<{ query?: string; includeCompleted?: boolean; completedSince?: string }> = {
  spec: {
    name: 'reminders_list',
    description: "Find reminders in the user's Reminders app. Optionally search titles and notes; completed reminders are excluded unless requested, and are marked ✓ when included. Open reminders come first by due date, then completed ones, newest first. Each line ends with an id for reminder_update and reminder_delete.",
    params: { type: 'object', properties: {
      query: { type: 'string', description: 'Words to match in reminder titles or notes' },
      includeCompleted: { type: 'boolean', description: 'Include completed reminders (default false)' },
      completedSince: { type: 'string', description: 'With includeCompleted: only completed reminders finished on or after this local date/time, like 2026-11-02T00:00' },
    } },
  },
  title: (a) => a.query ? t('Searched your reminders for “{query}”', { query: a.query }) : t('Looked at your reminders'),
  action: () => ({ kind: 'run' }),
  async run(a, ctx) {
    const found = await helper(['reminders', JSON.stringify({ query: a.query?.trim() ?? '', includeCompleted: !!a.includeCompleted, completedSince: a.includeCompleted ? a.completedSince : undefined })], ctx.signal) as Reminder[]
    if (!found.length) return { text: a.query ? `No reminders matching “${a.query}”.` : 'There are no reminders.' }
    ctx.untrusted = true
    return { text: found.map(line).join('\n') }
  },
}

export const reminderAdd: Tool<NewReminder> = {
  spec: {
    name: 'reminder_add',
    description: "Add a reminder to the user's Reminders app. All but the title are optional; list defaults to the system's default list.",
    params: { type: 'object', properties: { title: { type: 'string' }, ...fieldParams }, required: ['title'] },
  },
  title: (a) => t('Added “{title}” to Reminders', { title: a.title }),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => a.due ? t('Add “{title}” to Reminders on {when}?', { title: a.title, when: when(a.due) }) : t('Add “{title}” to Reminders?', { title: a.title }),
  askDetail: details,
  async run(a, ctx) {
    const r = await helper(['add-reminder', JSON.stringify(a)], ctx.signal) as Reminder
    return { text: `Added “${r.title}” to the ${r.list} reminders${r.due ? `, due ${when(r.due)}` : ''}${r.repeat ? `, repeating ${repeats(r)}` : ''}${r.priority ? `, ${r.priority} priority` : ''}. (id: ${r.id})` }
  },
}

export const reminderUpdate: Tool<ChangeReminder> = {
  spec: {
    name: 'reminder_update',
    description: "Change a reminder in the user's Reminders app, or tick it off with completed: true (completed: false reopens it). id comes from reminders_list. shown is the title as listed, so the user sees which reminder; title renames it. Send only what changes.",
    params: { type: 'object', properties: { id: { type: 'string' }, shown: { type: 'string' }, title: { type: 'string' }, completed: { type: 'boolean' }, ...fieldParams }, required: ['id', 'shown'] },
  },
  title: (a) => a.completed === true ? t('Ticked off “{title}”', { title: a.shown }) : t('Changed “{title}” in Reminders', { title: a.shown }),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => a.completed === true && Object.keys(a).every((k) => ['id', 'shown', 'completed'].includes(k))
    ? t('Tick off “{title}” in Reminders?', { title: a.shown })
    : t('Change “{title}” in Reminders?', { title: a.shown }),
  askDetail: (a) => [a.title && t('New title: {name}', { name: a.title }), a.completed !== undefined && (a.completed ? t('Mark as done') : t('Mark as not done')), details(a)].filter(Boolean).join('\n'),
  async run(a, ctx) {
    const { shown: _shown, ...change } = a
    const r = await helper(['update-reminder', JSON.stringify(change)], ctx.signal) as Reminder
    return { text: `Updated “${r.title}”: ${r.completed ? 'done' : 'open'}${r.due ? `, due ${when(r.due)}` : ''}${r.repeat ? `, repeating ${repeats(r)}` : ''}${r.priority ? `, ${r.priority} priority` : ''}.` }
  },
}

export const reminderDelete: Tool<DeleteReminder> = {
  spec: {
    name: 'reminder_delete',
    description: "Delete a reminder from the user's Reminders app for good. id comes from reminders_list; title is the title as listed. Prefer completed: true on reminder_update unless the user wants it gone.",
    params: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] },
  },
  title: (a) => t('Deleted “{title}” from Reminders', { title: a.title }),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => t('Delete “{title}” from Reminders?', { title: a.title }),
  async run(a, ctx) {
    const r = await helper(['delete-reminder', JSON.stringify({ id: a.id })], ctx.signal) as Reminder
    return { text: `Deleted “${r.title}” from the ${r.list} reminders.` }
  },
}

export const macReminderTools: Tool<any>[] = [remindersList, reminderAdd, reminderUpdate, reminderDelete]
