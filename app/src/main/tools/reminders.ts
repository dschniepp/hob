import { execFile } from 'node:child_process'
import { macHelperPath } from './mac'
import type { Tool } from '../agent/tool'
import { t } from '../../shared/i18n'

type Reminder = { title: string; due?: string; list: string; notes?: string; completed?: boolean; completedOn?: string }
type NewReminder = { title: string; due?: string; list?: string; notes?: string }
type Helper = (args: string[], signal?: AbortSignal) => Promise<unknown>

let helper: Helper = (args, signal) => new Promise((resolve, reject) => {
  execFile(macHelperPath(), args, { timeout: 150_000, signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return reject(new Error(stderr.trim() || err.message))
    try { resolve(JSON.parse(stdout)) } catch { reject(new Error('The Reminders helper gave an answer Hob could not read.')) }
  })
})
/** Tests and fake mode can supply a harmless helper. */
export const setReminderHelper = (h: Helper) => { helper = h }

export const remindersList: Tool<{ query?: string; includeCompleted?: boolean; completedSince?: string }> = {
  spec: {
    name: 'reminders_list',
    description: "Find reminders in the user's Reminders app. Optionally search titles and notes; completed reminders are excluded unless requested, and are marked ✓ when included. Open reminders come first by due date, then completed ones, newest first.",
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
    return { text: found.map((r) => `- ${r.completed ? '✓ ' : ''}${r.title}${r.completed ? ` · completed${r.completedOn ? ` ${new Date(r.completedOn).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}` : ''}${r.due ? ` · due ${new Date(r.due).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''} [${r.list}]${r.notes ? `\n  ${r.notes.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n') }
  },
}

export const reminderAdd: Tool<NewReminder> = {
  spec: {
    name: 'reminder_add',
    description: "Add a reminder to the user's Reminders app. due is optional (a local date/time like 2026-10-21T15:00); list is optional and defaults to the system's default list.",
    params: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string' }, list: { type: 'string' }, notes: { type: 'string' } }, required: ['title'] },
  },
  title: (a) => t('Added “{title}” to Reminders', { title: a.title }),
  action: () => ({ kind: 'app', ask: true }),
  ask: (a) => a.due ? t('Add “{title}” to Reminders on {when}?', { title: a.title, when: new Date(a.due).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('Add “{title}” to Reminders?', { title: a.title }),
  askDetail: (a) => [a.list && t('List: {name}', { name: a.list }), a.due && `Due: ${a.due}`, a.notes].filter(Boolean).join('\n'),
  async run(a, ctx) {
    const r = await helper(['add-reminder', JSON.stringify(a)], ctx.signal) as Reminder
    return { text: `Added “${r.title}” to the ${r.list} reminders${r.due ? `, due ${new Date(r.due).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.` }
  },
}

export const macReminderTools: Tool<any>[] = [remindersList, reminderAdd]
