// Builds Hob's native helpers (Mac only): resources/bin/<name> from native/<name>/main.swift
// (hob-pdf: PDFs with PDFKit and Vision; hob-mac: Calendar with EventKit).
// Skipped when the binary is newer than its source, or when there's no Swift compiler (non-Mac builds).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const helpers = ['hob-pdf', 'hob-mac']
if (process.platform !== 'darwin') process.exit(0)
for (const name of helpers) {
  const src = join(root, `native/${name}/main.swift`)
  const out = join(root, `resources/bin/${name}`)
  // a helper that asks for Calendar / Reminders / Mail access carries its own Info.plist with the usage texts;
  // without one macOS silently refuses to show the prompt
  const plist = join(root, `native/${name}/Info.plist`)
  const inputs = existsSync(plist) ? [src, plist] : [src]
  if (existsSync(out) && statSync(out).mtimeMs > Math.max(...inputs.map((f) => statSync(f).mtimeMs))) continue
  mkdirSync(dirname(out), { recursive: true })
  const embed = existsSync(plist) ? ['-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist] : []
  execFileSync('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos13', ...embed, src, '-o', out], { stdio: 'inherit' })
  if (embed.length) execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'app.hob.mac-helper', out], { stdio: 'inherit' })
  console.log('built', out)
}
