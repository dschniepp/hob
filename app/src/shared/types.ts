import type { NewSkill, PluginInfo, PluginResult, SkillRef, StarterRef } from './plugins'
import type { ApprovalAnswer, ApprovalRequest, Attachment, ChatSummary, FolderCheck, LiveSummary, LiveTurn, ModelRow, Project, ProjectInput, Step, StoredMessage, UserSettings } from './agent'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ModelSummary = { id: string; name: string; sizeGB: number; estTokPerSec: number; blurb: string }

/** A row in the "choose a different model" list. */
export type ModelOption = ModelSummary & {
  description: string
  recommended: boolean
  available: boolean
  /** why it can't be picked: too big for memory, or too slow on this computer */
  reason?: 'memory' | 'slow'
  needsDiskGB: number
}

/** Calendar and Mail access. Reminders has its own independent macOS permission state. */
export type MacAccess = { calendar: string; mail: string }
export type RemindersAccess = { reminders: string }
/** Google or Microsoft sign-in for calendar and email: what can be signed in to, and who is */
export type AccountsState = { available: ('google' | 'microsoft')[]; current: { provider: 'google' | 'microsoft'; email: string } | null }

/** Hob's eyes: the small model that looks at images. off: not downloaded yet (it comes after the main model) */
export type VisionState =
  | { phase: 'off' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready'; name: string; sizeGB: number }
  | { phase: 'error'; message: string }

export type StorageUsage = { modelsGB: number; chatModelsGB: number; imageSupportGB: number; voiceModelsGB: number; filesGB: number; codeToolsGB: number }

export type SetupState =
  | { phase: 'probing'; firstRun?: boolean }
  | { phase: 'choose'; recommended: ModelSummary; models: ModelOption[]; liteMode: boolean; needsDiskGB: number; computer: string; starter?: ModelSummary; downloadsDir?: string }
  | { phase: 'downloading'; target: ModelSummary; progress: number; etaSec: number; chatReady: boolean; note?: string; starter?: ModelSummary; initialUpgrade?: boolean }
  | { phase: 'ready'; model: ModelSummary; liteMode: boolean; note?: string; canRetry?: boolean }
  | { phase: 'error'; message: string }

export interface HobApi {
  platform: string
  /** test mode: canned model, search and dictation */
  fake: boolean
  copy(text: string): Promise<void>
  pathsForFiles(files: File[]): string[]
  fileUrl(path: string): string
  setup: {
    getState(): Promise<SetupState>
    confirm(modelId?: string): Promise<void>
    retry(): Promise<void>
    pickDownloads(): Promise<void>
    onState(cb: (s: SetupState) => void): () => void
  }
  chats: {
    list(): Promise<ChatSummary[]>
    search(query: string): Promise<(ChatSummary & { snippet?: string })[]>
    get(id: string): Promise<{ chat: ChatSummary; messages: StoredMessage[]; live?: LiveTurn } | null>
    create(projectId?: string | null): Promise<ChatSummary>
    rename(id: string, title: string): Promise<void>
    pin(id: string, pinned: boolean): Promise<void>
    save(id: string): Promise<string | null>
    remove(id: string): Promise<void>
    keep(id: string, n: number): Promise<boolean>
    removeAll(): Promise<void>
    onChanged(cb: () => void): () => void
  }
  files: {
    add(chatId: string, paths: string[]): Promise<Attachment[] | { error: 'too-big'; gb: number } | { error: 'already-here'; message: string }>
    paste(chatId: string, bytes: Uint8Array, type: string): Promise<Attachment[]>
    pick(): Promise<string[]>
    open(path: string): Promise<void>
    show(path: string): Promise<void>
    saveImage(dataUrl: string, name: string): Promise<string | null>
  }
  projects: {
    list(): Promise<Project[]>
    create(p: ProjectInput): Promise<Project | { error: string }>
    update(id: string, p: ProjectInput): Promise<Project | { error: string }>
    remove(id: string): Promise<void>
    pickFolders(): Promise<FolderCheck[]>
    checkFolders(paths: string[]): Promise<FolderCheck[]>
    open(id: string, folder?: string): Promise<void>
  }
  chat: {
    send(chatId: string, requestId: string, text: string, attachments: Attachment[]): Promise<StoredMessage>
    warm(chatId: string | null, projectId: string | null, pending?: string[]): Promise<void>
    stop(requestId: string): Promise<void>
    onToken(cb: (requestId: string, text: string, thought: boolean) => void): () => void
    onStep(cb: (requestId: string, step: Step) => void): () => void
    onReset(cb: (requestId: string) => void): () => void
    onApproval(cb: (req: ApprovalRequest) => void): () => void
    onDone(cb: (requestId: string, reply: StoredMessage | null) => void): () => void
    live(): Promise<LiveSummary[]>
    onLive(cb: (list: LiveSummary[]) => void): () => void
    onOpen(cb: (chatId: string) => void): () => void
  }
  approval: { answer(id: string, answer: ApprovalAnswer): Promise<void> }
  /** Calendar and Mail permissions, plus independent Reminders access on macOS. */
  mac: {
    access(): Promise<MacAccess | null>
    ask(): Promise<MacAccess | null>
    remindersAccess(): Promise<RemindersAccess | null>
    askReminders(): Promise<RemindersAccess | null>
    openAccounts(): Promise<void>
    onChanged(cb: (access: MacAccess | null) => void): () => void
    onRemindersChanged(cb: (access: RemindersAccess | null) => void): () => void
  }
  accounts: {
    get(): Promise<AccountsState>
    signIn(provider: 'google' | 'microsoft'): Promise<AccountsState>
    cancel(): Promise<void>
    signOut(): Promise<AccountsState>
    onChanged(cb: (s: AccountsState) => void): () => void
  }
  vision: { getState(): Promise<VisionState>; onState(cb: (s: VisionState) => void): () => void; retry(): Promise<void> }
  task: { undo(messageId: number): Promise<{ done: boolean; failed: number }> }
  settings: { get(): Promise<UserSettings>; set(patch: Partial<UserSettings>): Promise<UserSettings>; pickFilesDir(): Promise<string | null> }
  models: { list(): Promise<ModelRow[]>; use(id: string): Promise<void>; remove(id: string): Promise<boolean>; cancel(): Promise<boolean> }
  storage: { get(): Promise<StorageUsage>; removeHob(): Promise<void> }
  plugins: {
    list(): Promise<PluginInfo[]>
    setEnabled(id: string, on: boolean): Promise<void>
    add(): Promise<PluginResult | null>
    link(): Promise<PluginResult | null>
    remove(id: string): Promise<void>
    show(id: string): Promise<void>
    setSetting(id: string, key: string, value: string): Promise<void>
    saveSkill(s: NewSkill, replace?: boolean): Promise<PluginResult>
    getSkill(name: string): Promise<NewSkill | null>
    removeSkill(name: string): Promise<void>
    connectApp(o: { name: string; command: string; env?: string }): Promise<PluginResult>
    addFile(path: string): Promise<PluginResult | null>
    connect(id: string): Promise<PluginResult>
    cancelConnect(id: string): Promise<void>
    signOut(id: string): Promise<void>
    choosePath(kind: 'directory' | 'file', multiple: boolean): Promise<string[]>
    onOpened(cb: (r: PluginResult) => void): () => void
    skills(): Promise<SkillRef[]>
    starters(): Promise<StarterRef[]>
    onChanged(cb: () => void): () => void
  }
  speech: { prepare(): Promise<{ modelBase: string } | { fake: true }>; onProgress(cb: (fraction: number) => void): () => void; mic(): Promise<boolean>; openMicSettings(): Promise<void> }
}
