const article = document.querySelector('article')
const newBtn = document.querySelector('#newBtn')

article.addEventListener('input', () => {
  rememberCaret()
  debouncedSave()
})

// Keep caret position up to date (mouse/keyboard selection changes)
document.addEventListener('selectionchange', debounce(150, rememberCaret))

addEventListener('DOMContentLoaded', load)
addEventListener('hashchange', load)

newBtn.addEventListener('click', () => newDocument())

// Document identity (stable per "New" document)
let currentDocId = ''

const debouncedSave = debounce(500, save)

async function load() {
  try {
    if (location.hash !== '') await set(location.hash)
    else {
      await set(localStorage.getItem('hash') ?? '')
      if (article.textContent) history.replaceState({}, '', await get())
    }
  } catch (e) {
    article.textContent = ''
    article.removeAttribute('style')
    currentDocId = ''
  }

  updateTitle()
  focusEditor()
  restoreCaret()
}

async function save() {
  const hash = await get()
  if (location.hash !== hash) history.replaceState({}, '', hash)
  try { localStorage.setItem('hash', hash) } catch (e) {}
  updateTitle()
  // Ensure caret stays visible even after URL updates
  focusEditor()
  restoreCaret()
}

async function newDocument() {
  // Generate a stable doc id that stays the same while the content-hash changes
  currentDocId = makeDocId()

  article.textContent = ''
  article.removeAttribute('style')

  // Create a real, unique URL immediately (even before typing)
  const emptyData = await compress('')
  const newHash = '#' + emptyData + ';' + currentDocId
  history.pushState({}, '', newHash)

  try { localStorage.setItem('hash', newHash) } catch (e) {}

  updateTitle()
  focusEditor()
  setCaretOffset(article, 0)
  rememberCaret()
}

async function set(hash) {
  // Accept '' or '#...'
  const raw = (hash || '').startsWith('#') ? hash.slice(1) : hash
  if (!raw) {
    currentDocId = ''
    article.textContent = ''
    article.removeAttribute('style')
    return
  }

  const { data, docid } = parseHash(raw)
  currentDocId = docid || ''

  const decompressed = await decompress(data)
  const parts = decompressed.split('\x00')
  const content = parts[0] ?? ''
  const style = parts[1] ?? ''

  article.textContent = content
  if (style) article.setAttribute('style', style)
  else article.removeAttribute('style')
}

async function get() {
  const style = article.getAttribute('style')
  const content = article.textContent + (style !== null ? '\x00' + style : '')

  const data = await compress(content)
  // Preserve stable doc id if present (new docs),
  // otherwise keep the original behavior.
  return '#' + data + (currentDocId ? ';' + currentDocId : '')
}

function updateTitle() {
  const match = article.textContent.match(/^\n*#(.+)\n/)
  document.title = match?.[1] ?? 'Textarea'
}

// Base64 URL encoding with fallback for older browsers
function toBase64URL(uint8Array) {
  if (uint8Array.toBase64) {
    return uint8Array.toBase64({ alphabet: 'base64url' })
  }
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64URL(b64) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(b64, { alphabet: 'base64url' })
  }
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - b64.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function parseHash(raw) {
  // Format: <data>[;<docid>]
  const i = raw.indexOf(';')
  if (i === -1) return { data: raw, docid: '' }
  return { data: raw.slice(0, i), docid: raw.slice(i + 1) }
}

function makeDocId() {
  // Short, URL-safe, stable per document
  return (crypto?.randomUUID?.() ?? (Date.now() + '-' + Math.random()))
    .toString()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 16)
    .toLowerCase()
}

function focusEditor() {
  try { article.focus({ preventScroll: true }) } catch (e) { article.focus() }
}

function caretStorageKey() {
  // Prefer docid so caret survives content-hash changes while typing
  if (currentDocId) return 'caret:' + currentDocId
  // Legacy docs without docid: best-effort by current hash data
  return 'caret:' + location.hash.slice(1)
}

function rememberCaret() {
  const sel = getSelection()
  if (!sel || sel.rangeCount === 0) return
  if (document.activeElement !== article) return

  const offset = getCaretOffset(article)
  try { sessionStorage.setItem(caretStorageKey(), String(offset)) } catch (e) {}
}

function restoreCaret() {
  let offset = 0
  try {
    const v = sessionStorage.getItem(caretStorageKey())
    if (v != null) offset = Math.max(0, Number(v) || 0)
  } catch (e) {}

  setCaretOffset(article, offset)
}

function getCaretOffset(root) {
  const sel = getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return 0

  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

function setCaretOffset(root, offset) {
  focusEditor()

  const selection = getSelection()
  if (!selection) return

  const range = document.createRange()
  let remaining = offset

  // Walk text nodes and place caret by character offset
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let lastTextNode = null

  while (node) {
    lastTextNode = node
    const len = node.nodeValue.length
    if (remaining <= len) {
      range.setStart(node, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= len
    node = walker.nextNode()
  }

  // If no text nodes (empty), place caret at start of element
  if (!lastTextNode) {
    range.setStart(root, 0)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    return
  }

  // If offset is beyond content length, place caret at end
  range.setStart(lastTextNode, lastTextNode.nodeValue.length)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

async function compress(string) {
  const byteArray = new TextEncoder().encode(string)
  const stream = new CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  writer.write(byteArray)
  writer.close()
  const buffer = await new Response(stream.readable).arrayBuffer()
  return toBase64URL(new Uint8Array(buffer))
}

async function decompress(b64) {
  const byteArray = fromBase64URL(b64)
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  writer.write(byteArray)
  writer.close()
  const buffer = await new Response(stream.readable).arrayBuffer()
  return new TextDecoder().decode(buffer)
}

function debounce(ms, fn) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function saveToDisk() {
  const now = new Date()
  const timestamp = now.toISOString().slice(0, 19).replace(/[T:]/g, '-')

  const match = article.textContent.match(/^#\s*(.+)/m)
  const title = match?.[1].trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 30) || 'note'

  const blob = new Blob([article.textContent], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title}-${timestamp}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 's') {
    e.preventDefault()
    saveToDisk()
  }
})
