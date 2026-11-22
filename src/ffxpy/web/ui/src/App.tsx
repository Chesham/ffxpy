import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Loader2, CheckCircle2, Plus, ChevronLeft, ChevronRight,
  Settings2, Clock, Code, LocateFixed,
  History as HistoryIcon, Layers, CircleDot, X, AlertCircle, PlayCircle, Film, Boxes, GripVertical, HelpCircle, Folder, FolderOpen, Trash2, RotateCcw, BookOpen
} from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import yaml from 'js-yaml'
import ReactMarkdown from 'react-markdown'
import Hls from 'hls.js'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
// Always relative: in prod the backend serves this same page, and in dev
// vite.config.ts proxies /api to the backend server-to-server. This avoids
// ever hardcoding a host/port that the browser has to reach directly, which
// breaks under WSL/remote setups (wrong hostname, or another unrelated
// service already shadowing that port on whatever machine the browser is on).
const API_BASE = ''
const normalizePath = (p: string) => p.replace(/\\/g, '/')
const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().split('-')[0] : Math.random().toString(36).substring(2, 10)

function VisualCropper({ 
  videoRef, 
  actualWidth, 
  actualHeight, 
  cropValue, 
  onChange, 
  isInherited 
}: { 
  videoRef: React.RefObject<HTMLVideoElement | null>, 
  actualWidth: number, 
  actualHeight: number, 
  cropValue: string, 
  onChange: (val: string) => void,
  isInherited?: boolean
}) {
  const [rect, setRect] = useState({ x: 0, y: 0, w: actualWidth, h: actualHeight })
  const overlayRef = useRef<SVGSVGElement>(null)
  const [dragMode, setDragMode] = useState<'move' | 'resize' | null>(null)
  const [startPos, setStartPos] = useState({ x: 0, y: 0, rect: { x: 0, y: 0, w: 0, h: 0 } })
  const [metrics, setMetrics] = useState({ sx: 1, sy: 1, offsetX: 0, offsetY: 0 })

  // Parse cropValue (w:h:x:y)
  useEffect(() => {
    if (cropValue) {
      const [w, h, x, y] = cropValue.split(':').map(Number)
      if (!isNaN(w) && !isNaN(h) && !isNaN(x) && !isNaN(y)) {
        const timer = setTimeout(() => setRect({ x, y, w, h }), 0)
        return () => clearTimeout(timer)
      }
    } else {
        const timer = setTimeout(() => setRect({ x: 0, y: 0, w: actualWidth, h: actualHeight }), 0)
        return () => clearTimeout(timer)
    }
  }, [cropValue, actualWidth, actualHeight])

  const updateMetrics = useCallback(() => {
    if (!videoRef.current) return
    const v = videoRef.current
    const vRect = v.getBoundingClientRect()
    
    // Video aspect ratio
    const videoRatio = actualWidth / actualHeight
    const containerRatio = vRect.width / vRect.height
    
    let displayW, displayH, offsetX = 0, offsetY = 0
    if (containerRatio > videoRatio) {
      displayH = vRect.height
      displayW = displayH * videoRatio
      offsetX = (vRect.width - displayW) / 2
    } else {
      displayW = vRect.width
      displayH = displayW / videoRatio
      offsetY = (vRect.height - displayH) / 2
    }
    
    setMetrics({ 
      sx: displayW / actualWidth, 
      sy: displayH / actualHeight,
      offsetX,
      offsetY
    })
  }, [actualWidth, actualHeight, videoRef])

  useEffect(() => {
    updateMetrics()
    window.addEventListener('resize', updateMetrics)
    return () => window.removeEventListener('resize', updateMetrics)
  }, [updateMetrics])

  const handleMouseDown = (e: React.MouseEvent, mode: 'move' | 'resize') => {
    e.stopPropagation()
    setDragMode(mode)
    setStartPos({ x: e.clientX, y: e.clientY, rect: { ...rect } })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragMode) return
    const { sx, sy } = metrics
    const dx = (e.clientX - startPos.x) / sx
    const dy = (e.clientY - startPos.y) / sy

    const nextRect = { ...startPos.rect }
    if (dragMode === 'move') {
      nextRect.x = Math.max(0, Math.min(actualWidth - nextRect.w, startPos.rect.x + dx))
      nextRect.y = Math.max(0, Math.min(actualHeight - nextRect.h, startPos.rect.y + dy))
    } else if (dragMode === 'resize') {
      nextRect.w = Math.max(10, Math.min(actualWidth - nextRect.x, startPos.rect.w + dx))
      nextRect.h = Math.max(10, Math.min(actualHeight - nextRect.y, startPos.rect.h + dy))
    }

    setRect(nextRect)
    onChange(`${Math.round(nextRect.w)}:${Math.round(nextRect.h)}:${Math.round(nextRect.x)}:${Math.round(nextRect.y)}`)
  }, [dragMode, metrics, startPos, actualWidth, actualHeight, onChange])

  const handleMouseUp = useCallback(() => setDragMode(null), [])

  useEffect(() => {
    if (dragMode) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragMode, handleMouseMove, handleMouseUp])

  const { sx, sy, offsetX, offsetY } = metrics
  
  return (
    <svg 
      ref={overlayRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-30"
      style={{ cursor: dragMode ? (dragMode === 'move' ? 'grabbing' : 'nwse-resize') : 'default' }}
    >
      <g transform={`translate(${offsetX}, ${offsetY}) scale(${sx}, ${sy})`}>
        {/* Dimmed background */}
        <path 
          d={`M0,0 H${actualWidth} V${actualHeight} H0 Z M${rect.x},${rect.y} V${rect.y + rect.h} H${rect.x + rect.w} V${rect.y} Z`} 
          fill="black" 
          fillOpacity="0.5" 
          fillRule="evenodd"
          className="pointer-events-auto"
        />
        {/* Crop rectangle */}
        <rect 
          x={rect.x} 
          y={rect.y} 
          width={rect.w} 
          height={rect.h} 
          fill="transparent" 
          stroke={isInherited ? "#06b6d480" : "#22d3ee"} 
          strokeWidth={4 / sx}
          strokeDasharray={isInherited ? "10,10" : "0"}
          className="pointer-events-auto cursor-grab active:cursor-grabbing"
          onMouseDown={e => handleMouseDown(e, 'move')}
        />
        {/* Resize handle */}
        <rect 
          x={rect.x + rect.w - 10 / sx} 
          y={rect.y + rect.h - 10 / sy} 
          width={20 / sx} 
          height={20 / sy} 
          fill="#22d3ee"
          className="pointer-events-auto cursor-nwse-resize"
          onMouseDown={e => handleMouseDown(e, 'resize')}
        />
        {/* Label */}
        <text 
            x={rect.x + 5 / sx} 
            y={rect.y + 20 / sy} 
            fill="white" 
            fontSize={12 / sx} 
            fontWeight="bold" 
            className="select-none pointer-events-none shadow-black drop-shadow-md"
        >
            {Math.round(rect.w)}x{Math.round(rect.h)} ({Math.round(rect.x)},{Math.round(rect.y)})
            {isInherited && " (Inherited)"}
        </text>
      </g>
    </svg>
  )
}

interface StreamInfo { index: number; codec_type: string; width?: number; height?: number; r_frame_rate?: string; bit_rate?: number }
interface VideoInfo { format_name: string; duration: string; duration_sec: number; streams: StreamInfo[]; bit_rate?: number }
interface JobSetting { input_path?: string; merge_paths?: string[]; start?: string; end?: string; video_codec?: string; video_bitrate?: string; audio_codec?: string; audio_bitrate?: string; scale?: string; crop?: string; fps?: string; output_dir?: string; output_path?: string; keep_temp?: boolean; skip_existing?: boolean; deinterlace?: boolean }
interface Job { id: string; name: string; command: 'split' | 'merge' | 'crop'; setting: JobSetting }
interface JobStatus { status: string; completed: number; total: number; name?: string }
interface WorkflowState { status: string; overall_completed: number; overall_total: number; total_jobs: number; jobStatuses: Record<number, JobStatus> }

// A single loaded source file in the Media Pool. Each job binds to one (or more, for merge) of these by path.
interface MediaSource {
  path: string
  info: VideoInfo
  establishedMap: Record<string, { prev?: number, next?: number }>
}

interface BrowseEntry { name: string; path: string; is_dir: boolean; size: number | null }
interface BrowseResult { path: string; parent: string | null; entries: BrowseEntry[]; warning?: string }

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

// In-page directory browser backed by /api/browse. Replaces the native OS file
// picker: browsers never expose a real filesystem path from <input type="file">,
// and this app needs one to hand off to ffmpeg, so it renders its own folder
// navigator instead of shelling out to a GUI toolkit on the backend.
function FileBrowserModal({ initialPath, onConfirm, onClose }: { initialPath?: string | null, onConfirm: (paths: string[]) => void, onClose: () => void }) {
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<BrowseEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [manualPath, setManualPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Tracked so an in-flight debounced navigation can tell, once it resolves,
  // whether the user has kept typing since -- and if so, skip clobbering
  // whatever they've typed with the (now stale) resolved directory path.
  const manualPathRef = useRef(manualPath)
  manualPathRef.current = manualPath

  const load = useCallback(async (path?: string | null, opts?: { keepInputIfStale?: boolean }) => {
    setLoading(true); setError(null); setWarning(null)
    try {
      const url = path ? `${API_BASE}/api/browse?path=${encodeURIComponent(path)}` : `${API_BASE}/api/browse`
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Failed to browse directory (HTTP ${res.status})`)
      }
      const d: BrowseResult = await res.json()
      setCurrentPath(d.path)
      setParent(d.parent)
      setEntries(d.entries)
      setWarning(d.warning || null)
      if (d.path) {
        localStorage.setItem('ffxpy_last_browse_dir', d.path)
      }
      if (!opts?.keepInputIfStale || manualPathRef.current === path) {
        setManualPath(d.path)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const startPath = initialPath || localStorage.getItem('ffxpy_last_browse_dir') || null
    load(startPath)
  }, [load, initialPath])

  // The text after the last "/" is treated as a live filter against the
  // already-loaded directory (no network round-trip) instead of part of the
  // path to navigate to -- typing "/D" inside a loaded folder filters its
  // entries down to names starting with "D" (case-sensitive, matching Linux).
  const stripTrailingSlash = (p: string | null) => (p || '').replace(/\/+$/, '') || '/'
  // True right after a load, before the user has typed anything past it -- in
  // this state the last path segment is the loaded directory's own name, not
  // filter text, so it must never be parsed as one (that would misread e.g.
  // ".../Downloads" as filtering "Downloads" out of its parent and silently
  // auto-navigate up a level).
  const atRest = stripTrailingSlash(manualPath) === stripTrailingSlash(currentPath)
  const lastSlash = manualPath.lastIndexOf('/')
  const dirPart = lastSlash >= 0 ? (manualPath.slice(0, lastSlash) || '/') : ''
  const filterPart = lastSlash >= 0 ? manualPath.slice(lastSlash + 1) : manualPath
  const inFilterMode = !atRest && lastSlash >= 0 && stripTrailingSlash(dirPart) === stripTrailingSlash(currentPath)

  // Debounce: once the user pauses typing a directory portion that isn't the
  // one already loaded, jump to it automatically. Only the directory portion
  // (not the trailing filter text) is ever sent to /api/browse.
  useEffect(() => {
    if (atRest || inFilterMode || !dirPart) return
    const timer = setTimeout(() => { load(dirPart, { keepInputIfStale: true }) }, 500)
    return () => clearTimeout(timer)
  }, [dirPart, inFilterMode, atRest, load])

  const filteredEntries = inFilterMode && filterPart
    ? entries.filter(e => e.name.startsWith(filterPart))
    : entries

  // Keep a highlighted candidate ready so Enter works immediately while typing.
  useEffect(() => {
    setHighlight(inFilterMode && filterPart && filteredEntries.length > 0 ? 0 : -1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, filterPart, inFilterMode])

  useEffect(() => {
    if (highlight < 0) return
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault()
      if (parent) load(parent)
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Plain Enter is already used to navigate into a highlighted folder or
      // toggle a file's selection, so use Ctrl/Cmd+Enter to submit -- lets the
      // "Add N Source(s)" button fire without leaving the path input to click it.
      e.preventDefault()
      if (selected.size > 0) onConfirm(Array.from(selected))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(filteredEntries.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = highlight >= 0 ? filteredEntries[highlight] : null
      if (target) {
        if (target.is_dir) load(target.path); else toggleSelect(target.path)
      } else {
        load(dirPart || manualPath)
      }
    }
  }

  // Close only on a genuine click on the backdrop itself -- both mousedown and
  // mouseup need to land on the backdrop. A plain onClick={onClose} here would
  // also fire when the user drags to select text inside the modal and happens
  // to release the mouse button outside of it.
  const backdropMouseDownOnSelf = useRef(false)

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
      onMouseDown={e => { backdropMouseDownOnSelf.current = e.target === e.currentTarget }}
      onMouseUp={e => {
        if (backdropMouseDownOnSelf.current && e.target === e.currentTarget) onClose()
        backdropMouseDownOnSelf.current = false
      }}
    >
      <div
        className="w-full max-w-2xl h-[70vh] bg-[#0c0c0c] border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300"
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      >
        <div className="p-6 border-b border-white/[0.05] flex justify-between items-center shrink-0">
          <h3 className="text-sm font-black uppercase tracking-[0.3em] text-white flex items-center gap-3"><FolderOpen size={16} className="text-cyan-500"/> Select Video File(s)</h3>
          <button onClick={onClose} className="p-2 bg-white/[0.03] rounded-full hover:bg-white/[0.08] transition-colors"><X size={18}/></button>
        </div>
        <div className="px-6 py-3 border-b border-white/[0.03] flex gap-2 items-center shrink-0">
          <button onClick={() => parent && load(parent)} disabled={!parent} title="Up one level" className="p-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-20 disabled:cursor-not-allowed text-gray-400 transition-colors"><ChevronLeft size={16}/></button>
          <input
            autoFocus
            className="flex-1 bg-black border border-white/[0.05] rounded-xl px-3 py-2 text-xs text-white font-mono outline-none focus:border-cyan-500/30"
            value={manualPath}
            onChange={e => setManualPath(normalizePath(e.target.value))}
            onKeyDown={handleInputKeyDown}
          />
          <button onClick={() => load(dirPart || manualPath)} className="px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-[10px] font-black uppercase tracking-widest transition-colors">Go</button>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
          {loading && <div className="text-center text-gray-600 text-xs py-10 uppercase tracking-widest font-bold">Loading...</div>}
          {error && (
            <div className="flex flex-col items-center gap-3 py-10">
              <span className="text-center text-red-500 text-xs uppercase tracking-widest font-bold px-6">{error}</span>
              <button onClick={() => load(currentPath)} className="px-4 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-gray-300 text-[10px] font-black uppercase tracking-widest transition-colors">Retry</button>
            </div>
          )}
          {!loading && !error && warning && (
            <div className="flex items-center gap-2 px-4 py-2 mb-1 rounded-xl bg-amber-500/10 text-amber-500 text-[10px] font-bold">
              <AlertCircle size={12} className="shrink-0"/> {warning}
            </div>
          )}
          {!loading && !error && parent && (
            <div
              onClick={() => load(parent)}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-white/[0.04] text-gray-300 border-b border-white/[0.03] mb-1 group"
            >
              <Folder size={14} className="text-amber-500/80 group-hover:text-amber-500 shrink-0" />
              <span className="text-xs font-mono font-bold text-cyan-400 group-hover:text-cyan-300">.. (Parent Directory)</span>
              <span className="text-[10px] text-gray-600 truncate flex-1">{parent}</span>
              <ChevronRight size={14} className="text-gray-600 shrink-0" />
            </div>
          )}
          {!loading && !error && filteredEntries.length === 0 && <div className="text-center text-gray-700 text-xs italic py-10">{filterPart ? 'No matches' : 'Empty directory'}</div>}
          {!loading && !error && filteredEntries.map((entry, idx) => {
            const isSelected = !entry.is_dir && selected.has(entry.path)
            const isHighlighted = idx === highlight
            return (
              <div
                key={entry.path}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => entry.is_dir ? load(entry.path) : toggleSelect(entry.path)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition-colors",
                  isSelected ? "bg-cyan-500/10" : isHighlighted ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                )}
              >
                {entry.is_dir
                  ? <Folder size={14} className="text-amber-500 shrink-0"/>
                  : <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(entry.path)} onClick={e => e.stopPropagation()} className="shrink-0"/>}
                <span className={cn("text-xs truncate flex-1", entry.is_dir ? "text-gray-300" : "text-gray-400")}>{entry.name}</span>
                {!entry.is_dir && entry.size != null && <span className="text-[10px] text-gray-700 font-mono shrink-0">{formatBytes(entry.size)}</span>}
                {entry.is_dir && <ChevronRight size={14} className="text-gray-700 shrink-0"/>}
              </div>
            )
          })}
        </div>
        <div className="p-6 border-t border-white/[0.03] flex justify-between items-center shrink-0">
          <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest truncate">{currentPath}</span>
          <button
            onClick={() => onConfirm(Array.from(selected))}
            disabled={selected.size === 0}
            className="shrink-0 px-8 py-2.5 bg-cyan-600 hover:bg-cyan-400 disabled:opacity-20 disabled:cursor-not-allowed text-white font-black text-[10px] tracking-[0.2em] rounded-full transition-all uppercase"
          >
            Add {selected.size > 0 ? selected.size : ''} Source{selected.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

interface GlobalSetting {
  video_codec: string;
  audio_codec: string;
  video_bitrate: string;
  audio_bitrate?: string;
  overwrite: boolean;
  keep_temp: boolean;
  skip_existing: boolean;
  deinterlace: boolean;
  output_dir: string;
  temp_dir: string;
  crop?: string;
  fps?: string;
}

export default function App() {
  // Media Pool: every source file the user has loaded, keyed by (normalized) path.
  const [sources, setSources] = useState<Record<string, MediaSource>>({})
  const [sourceOrder, setSourceOrder] = useState<string[]>([])
  const [activeSourcePath, setActiveSourcePath] = useState<string>('')
  const [currentTime, setCurrentTime] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [globalSetting, setGlobalSetting] = useState<GlobalSetting>(() => {
    const saved = localStorage.getItem('ffxpy_global_settings')
    return saved ? { temp_dir: '', ...JSON.parse(saved) } : { video_codec: 'copy', audio_codec: 'copy', video_bitrate: '', audio_bitrate: '', overwrite: true, keep_temp: false, skip_existing: false, deinterlace: false, output_dir: '', temp_dir: '', crop: '' }
  })
  const [yamlText, setYamlText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'editor' | 'yaml'>('editor')
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [editTime, setEditTime] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [newSourcePath, setNewSourcePath] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isCropMode, setIsCropMode] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [about, setAbout] = useState<{version: string; changelog: string} | null>(null)
  const [aboutError, setAboutError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_BASE}/api/about`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then(data => { setAbout(data); setAboutError(null) })
      .catch(error => {
        if (!controller.signal.aborted) setAboutError(String(error))
      })
    return () => controller.abort()
  }, [])

  const [isBrowserOpen, setIsBrowserOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [clearedJobs, setClearedJobs] = useState<Job[] | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const settingsInputRef = useRef<HTMLInputElement>(null)
  const isSyncingFromYaml = useRef(false)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const sourceOrderRef = useRef(sourceOrder)
  sourceOrderRef.current = sourceOrder

  const videoInfo = sources[activeSourcePath]?.info ?? null
  // HLS.js transmuxes requested TS segments to MSE; no whole-file MP4 cache.
  useEffect(() => {
    const video = videoRef.current
    const info = sources[activeSourcePath]?.info
    if (!video || !info?.format_name?.includes('mpegts')) return
    const url = `${API_BASE}/api/hls/playlist.m3u8?path=${encodeURIComponent(activeSourcePath)}`
    let hls: Hls | undefined
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, maxBufferLength: 24, backBufferLength: 16 })
      hls.loadSource(url)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError(`HLS 預覽失敗：${data.details}`)
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
    } else {
      setError('此瀏覽器不支援 HLS/MSE 預覽')
    }
    return () => {
      hls?.destroy()
      if (video.src === url) {
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [activeSourcePath, sources[activeSourcePath]?.info?.format_name])

  const establishedMap = sources[activeSourcePath]?.establishedMap ?? {}
  const fpsToFloat = (fps: string): number => {
    const [num, den] = fps.split('/')
    const d = parseFloat(den)
    return d ? parseFloat(num) / d : parseFloat(num)
  }
  // Reference-only hint (never auto-applied) so users don't have to look up a
  // source's native frame rate themselves before deciding whether/what to type.
  const fpsHintFor = (path: string | undefined): string | undefined =>
    path ? sources[path]?.info?.streams.find(s => s.codec_type === 'video')?.r_frame_rate : undefined
  const bitrateHintFor = (path: string | undefined): string | undefined => {
    const br = path ? sources[path]?.info?.bit_rate : undefined
    return br ? `${(br / 1_000_000).toFixed(1)}M` : undefined
  }
  const audioBitrateHintFor = (path: string | undefined): string | undefined => {
    const br = path ? sources[path]?.info?.streams.find(s => s.codec_type === 'audio')?.bit_rate : undefined
    return br ? `${Math.round(br / 1000)}k` : undefined
  }
  // Recomputed from scratch (not ratcheted) over exactly the given paths, so
  // it stays correct whether sources were added *or* removed -- removing the
  // one source that justified a high value shouldn't leave that value
  // stranded once nothing in the pool still supports it.
  const computeSeededSettings = useCallback((
    sourcesMap: typeof sources,
    paths: string[]
  ): { video_bitrate?: string; audio_bitrate?: string; fps?: string } => {
    let maxVideoBitrate = 0, maxAudioBitrate = 0, maxFps = 0
    let fpsStr: string | undefined
    for (const p of paths) {
      const info = sourcesMap[p]?.info
      if (!info) continue
      const videoStream = info.streams?.find(s => s.codec_type === 'video')
      const audioStream = info.streams?.find(s => s.codec_type === 'audio')
      if (info.bit_rate && info.bit_rate > maxVideoBitrate) maxVideoBitrate = info.bit_rate
      if (audioStream?.bit_rate && audioStream.bit_rate > maxAudioBitrate) maxAudioBitrate = audioStream.bit_rate
      const fpsVal = videoStream?.r_frame_rate ? fpsToFloat(videoStream.r_frame_rate) : 0
      if (fpsVal > maxFps) { maxFps = fpsVal; fpsStr = videoStream!.r_frame_rate }
    }
    const video_bitrate = maxVideoBitrate ? (() => {
      const kbps = Math.round(maxVideoBitrate / 1000)
      return kbps >= 1000 ? `${parseFloat((kbps / 1000).toFixed(2))}M` : `${kbps}k`
    })() : undefined
    const audio_bitrate = maxAudioBitrate ? `${Math.round(maxAudioBitrate / 1000)}k` : undefined
    return { video_bitrate, audio_bitrate, fps: fpsStr }
  }, [])
  const sourceList = sourceOrder.map(p => sources[p]).filter((s): s is MediaSource => !!s)
  const basename = (p: string) => p.split('/').pop() || p

  const handleDragStart = (idx: number) => {
    setDragIdx(idx)
  }

  const handleDragEnter = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) return
    const newJobs = [...jobs]
    const item = newJobs.splice(dragIdx, 1)[0]
    newJobs.splice(idx, 0, item)
    setDragIdx(idx)
    setJobs(newJobs)
  }

  const handleDragEnd = () => {
    setDragIdx(null)
  }

  const seekTo = (t: number) => {
    const val = Math.max(0, Math.min(t, videoInfo?.duration_sec || 0)); setCurrentTime(val)
    if (videoRef.current) videoRef.current.currentTime = val
  }

  // Probe a file and add it to the Media Pool. No-ops (just activates) if already loaded.
  const addSource = useCallback(async (rawPath: string, opts?: { silent?: boolean }) => {
    const path = normalizePath(rawPath)
    if (!path) return
    if (sourcesRef.current[path]) {
      setActiveSourcePath(path)
      return
    }
    setIsSubmitting(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/probe?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error(`Probe failed: ${path}`)
      const d = await res.json(), m = d.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/)
      const ts = (parseInt(m?.[1]||'0')*3600)+(parseInt(m?.[2]||'0')*60)+parseFloat(m?.[3]||'0')

      setSources(prev => ({ ...prev, [path]: { path, info: { ...d, duration_sec: ts }, establishedMap: {} } }))
      setSourceOrder(prev => prev.includes(path) ? prev : [...prev, path])
      setActiveSourcePath(path)
      setCurrentTime(0)
      setEditTime(formatTime(0))

      // Global defaults seed to the highest value seen across the whole
      // Media Pool -- not just this one source -- so mixing a low-bitrate/
      // low-fps source with a higher one still lands on the higher source's
      // numbers. Recomputed from scratch over every current source (see
      // computeSeededSettings) rather than incrementally ratcheted, so this
      // stays correct if a higher source is later removed too. These are
      // plain values the user can freely overwrite -- harmless if left as-is
      // alongside video_codec/audio_codec=copy (ffmpeg just ignores bitrate
      // on a copied stream), but NOT harmless for fps: a copy job with a
      // filter attached is invalid and ffmpeg will refuse to run it, which
      // is exactly the point -- an incompatible combination should fail
      // loudly with a log instead of being silently "fixed" for the user.
      const newSourcesMap = {
        ...sourcesRef.current,
        [path]: { path, info: { ...d, duration_sec: ts }, establishedMap: {} },
      }
      const allPaths = sourceOrderRef.current.includes(path)
        ? sourceOrderRef.current
        : [...sourceOrderRef.current, path]
      const recomputed = computeSeededSettings(newSourcesMap, allPaths)
      setGlobalSetting(prev => {
        const next = { ...prev }
        const seeded: string[] = []
        if (recomputed.video_bitrate && recomputed.video_bitrate !== prev.video_bitrate) {
          next.video_bitrate = recomputed.video_bitrate
          seeded.push(`video ${next.video_bitrate}`)
        }
        if (recomputed.audio_bitrate && recomputed.audio_bitrate !== prev.audio_bitrate) {
          next.audio_bitrate = recomputed.audio_bitrate
          seeded.push(`audio ${next.audio_bitrate}`)
        }
        if (recomputed.fps && recomputed.fps !== prev.fps) {
          next.fps = recomputed.fps
          seeded.push(`fps ${next.fps}`)
        }
        if (seeded.length) setToastMessage(`Auto-detected (max across sources): ${seeded.join(', ')}`)
        return next
      })
    } catch (e: unknown) {
      if (!opts?.silent) setError(e instanceof Error ? e.message : String(e))
    } finally { setIsSubmitting(false) }
  }, [computeSeededSettings])

  const addSources = useCallback(async (paths: string[]) => {
    for (const p of paths) {
      await addSource(p)
    }
  }, [addSource])

  const removeSource = (path: string) => {
    // Closing media must remain possible even after it has been assigned to a
    // job. Keep the flow itself, but detach this path from ordinary jobs and
    // remove just this entry from a merge job's explicit source list.
    setJobs(prev => prev.map(job => ({
      ...job,
      setting: {
        ...job.setting,
        input_path: job.setting.input_path === path ? undefined : job.setting.input_path,
        merge_paths: job.setting.merge_paths?.filter(p => p !== path),
      },
    })))
    setSources(prev => { const next = { ...prev }; delete next[path]; return next })
    const remaining = sourceOrder.filter(p => p !== path)
    setSourceOrder(remaining)
    if (activeSourcePath === path) setActiveSourcePath(remaining[0] || '')

    // Recompute (not just leave stale) -- the value(s) this source seeded
    // shouldn't stay stranded in Global Settings once it's the only source
    // that supported them.
    const recomputed = computeSeededSettings(sources, remaining)
    setGlobalSetting(prev => ({
      ...prev,
      video_bitrate: recomputed.video_bitrate ?? '',
      audio_bitrate: recomputed.audio_bitrate,
      fps: recomputed.fps,
    }))
    setToastMessage(`Closed ${basename(path)} and detached it from the flow`)
  }

  const toggleClearFlow = () => {
    if (jobs.length > 0) {
      setClearedJobs(jobs)
      setJobs([])
      setActiveJobId(null)
      setToastMessage('Flow cleared — click Undo Clear to restore it')
    } else if (clearedJobs) {
      setJobs(clearedJobs)
      setActiveJobId(clearedJobs[0]?.id ?? null)
      setClearedJobs(null)
      setToastMessage('Flow restored')
    }
  }

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])

  const applySettings = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])

  useEffect(() => {
    if (isSettingsOpen) {
      // Small timeout to ensure the drawer animation/render is processed
      const timer = setTimeout(() => settingsInputRef.current?.focus(), 100)
      return () => clearTimeout(timer)
    }
  }, [isSettingsOpen])

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toastMessage])

  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isBrowserOpen) {
          setIsBrowserOpen(false)
          return
        }
        if (isAboutOpen) {
          setIsAboutOpen(false)
          return
        }
        if (isHelpOpen) {
          setIsHelpOpen(false)
          return
        }
        if (isSettingsOpen) {
          setIsSettingsOpen(false)
          return
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setIsBrowserOpen(true)
      }
      if (isTyping || isBrowserOpen || isAboutOpen) return

      if (e.code === 'KeyS' && e.altKey) {
        e.preventDefault()
        openSettings()
      }

      if (e.code === 'KeyQ' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        handleCloseVideo()
      }

      if (e.code === 'Digit1' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        addJob('split')
      }

      if (e.code === 'Digit2' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        addJob('crop')
      }

      if (e.code === 'Digit3' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        addJob('merge')
      }

      if (e.code === 'KeyH' && !isModalOpen && !isSettingsOpen && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        setIsHelpOpen(p => !p)
      }

      if (e.code === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (!isSubmitting && jobs.length > 0 && !isModalOpen && !isSettingsOpen) {
          handleExecute()
        }
      }

      if (e.code === 'BracketLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        stepKeyframe('prev')
      }

      if (e.code === 'BracketRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        stepKeyframe('next')
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }) // No dependency array to ensure closures always have the latest state for handlers like handleCloseVideo and handleExecute

  const handleCloseVideo = async () => {
    try {
      await fetch(`${API_BASE}/api/close`, { method: 'POST' })
    } catch { /* ignore */ }
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.src = '' // Explicitly set to empty string to forcefully abort pending browser requests
      videoRef.current.load()
    }
    setSources({})
    setSourceOrder([])
    setActiveSourcePath('')
    setJobs([])
    setClearedJobs(null)
    setActiveJobId(null)
    setCurrentTime(0)
    setError(null)
  }

  useEffect(() => {
    localStorage.setItem('ffxpy_global_settings', JSON.stringify(globalSetting))
  }, [globalSetting])

  useEffect(() => {
    if (activeTab === 'yaml') return // Two-way binding separate paths
    const clean = (o: Record<string, unknown>) => {
       const r: Record<string, unknown> = { ...o }
       Object.keys(r).forEach(k => {
         const v = r[k]
         if (v === '' || v === undefined || (Array.isArray(v) && v.length === 0)) delete r[k]
       })
       return r
    }
    const flowObj = {
      setting: clean({
        video_codec: globalSetting.video_codec,
        video_bitrate: globalSetting.video_bitrate,
        audio_codec: globalSetting.audio_codec,
        audio_bitrate: globalSetting.audio_bitrate,
        overwrite: globalSetting.overwrite,
        keep_temp: globalSetting.keep_temp,
        skip_existing: globalSetting.skip_existing,
        deinterlace: globalSetting.deinterlace,
        crop: globalSetting.crop,
        fps: globalSetting.fps,
        temp_dir: globalSetting.temp_dir,
      }),
      // Every job carries its own input_path (Media Pool source) instead of
      // relying on a single flow-level input_path, so jobs can target different files.
      jobs: jobs.map(j => {
        const jobSetting = { ...j.setting }
        // Only apply global output_dir to merge jobs if not overridden
        if (j.command === 'merge' && globalSetting.output_dir && !jobSetting.output_dir) {
          jobSetting.output_dir = globalSetting.output_dir
        }
        return { command: j.command, name: j.name, setting: clean(jobSetting) }
      })
    }
    const newYaml = yaml.dump(flowObj, { indent: 2, skipInvalid: true, noRefs: true })
    setYamlText(newYaml)
  }, [globalSetting, jobs, activeTab])

  const handleYamlChange = (v: string) => {
    setYamlText(v)
    try {
      isSyncingFromYaml.current = true
      const d = yaml.load(v)
      if (d && typeof d === 'object') {
        const dObj = d as Record<string, unknown>
        const setting = dObj.setting as Record<string, unknown> | undefined
        if (setting) {
          // Back-compat: a top-level setting.input_path is treated as a source to load into the pool
          if (typeof setting.input_path === 'string' && setting.input_path) {
            addSource(setting.input_path)
          }
          const rest = { ...setting }
          delete rest.input_path
          setGlobalSetting((prev: GlobalSetting) => ({ ...prev, ...rest }))
        }
        const jobsList = dObj.jobs
        if (Array.isArray(jobsList)) {
          const newJobs = jobsList.map((j: unknown) => {
            const jobObj = j as Record<string, unknown>
            return {
              id: (jobObj.id as string) || generateId(),
              ...jobObj,
              setting: (jobObj.setting as JobSetting) || {}
            } as Job
          })
          setJobs(newJobs)

          // Make sure every source file referenced by a job is loaded into the Media Pool
          const referenced = new Set<string>()
          newJobs.forEach(j => {
            if (j.setting.input_path) referenced.add(j.setting.input_path)
            j.setting.merge_paths?.forEach(p => referenced.add(p))
          })
          const missing = Array.from(referenced).filter(p => !sourcesRef.current[p])
          if (missing.length) addSources(missing)
        }
      }
    } catch {
      // Ignore parse errors while typing
    } finally { isSyncingFromYaml.current = false }
  }

  const stepKeyframe = async (dir: 'prev' | 'next') => {
    const path = activeSourcePath
    if (!path) return

    // 1. Check ESTABLISHED RELATIONSHIPS first (Zero Latency)
    // Increase tolerance to 0.01s for browser floating point jitter
    const currentKey = currentTime.toFixed(2)
    const established = establishedMap[currentKey]
    const fastTarget = dir === 'prev' ? established?.prev : established?.next

    if (fastTarget !== undefined) {
      seekTo(fastTarget)
      return
    }

    // 2. New Territory - Perform network probe
    setIsSubmitting(true)
    try {
      const probeTime = Math.max(0, currentTime)
      const res = await fetch(`${API_BASE}/api/keyframes?path=${encodeURIComponent(path)}&time=${probeTime}&range_sec=10`)
      const data = await res.json()
      const newPoints: number[] = Array.from(new Set<number>(data.keyframes || [])).sort((a,b)=>a-b)

      // 3. Establish relationships between all returned points, scoped to this source
      setSources(prev => {
        const src = prev[path]
        if (!src) return prev
        const nextMap = { ...src.establishedMap }
        for (let i = 0; i < newPoints.length; i++) {
          const k = newPoints[i].toFixed(2)
          const node = nextMap[k] || {}
          if (i > 0) node.prev = newPoints[i-1]
          if (i < newPoints.length - 1) node.next = newPoints[i+1]
          nextMap[k] = node
        }
        return { ...prev, [path]: { ...src, establishedMap: nextMap } }
      })

      // 4. Find target in the results with a bit of buffer
      let target: number | undefined
      if (dir === 'prev') {
        target = [...newPoints].reverse().find(x => x < currentTime - 0.05) ?? (currentTime > 0 ? 0 : undefined)
      } else {
        target = newPoints.find(x => x > currentTime + 0.05)
      }

      if (target !== undefined) seekTo(target)
    } catch (e) {
      console.error("Precision step failed", e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const addJob = (type: 'split' | 'merge' | 'crop') => {
    if (type !== 'merge' && !activeSourcePath) return
    const id = generateId()
    const newJob: Job = {
      id,
      name: `${type.toUpperCase()} #${jobs.length + 1}`,
      command: type,
      setting: type === 'split'
        ? { input_path: activeSourcePath, start: formatTime(currentTime), end: formatTime(videoInfo?.duration_sec || 0) }
        : type === 'crop'
        ? { input_path: activeSourcePath, video_codec: 'libx264', video_bitrate: '5M' }
        : { merge_paths: [] }
    }
    setJobs([...jobs, newJob]); setActiveJobId(id)
  }

  const handleCancel = async () => {
    if (!currentJobId) return
    setWorkflow(prev => prev ? { ...prev, status: 'cancelling' } : null)
    try {
      await fetch(`${API_BASE}/api/cancel/${currentJobId}`, { method: 'POST' })
    } catch (e: unknown) {
      console.error("Cancel failed", e)
      setWorkflow(prev => prev ? { ...prev, status: 'failed' } : null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleExecute = async () => {
    setIsModalOpen(true); setWorkflow({ status: 'preparing', overall_completed: 0, overall_total: 1.0, total_jobs: jobs.length, jobStatuses: {} }); setIsSubmitting(true); setError(null); setCurrentJobId(null)
    try {
      const res = await fetch(`${API_BASE}/api/execute`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(yaml.load(yamlText)) })
      if (!res.ok) throw new Error(await res.text())
      const { job_id } = await res.json()
      setCurrentJobId(job_id)
      const es = new EventSource(`${API_BASE}/api/events/${job_id}`)
      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        setWorkflow(prev => {
          const next = prev ? { ...prev } : { status: 'running', overall_completed: 0, overall_total: 1.0, total_jobs: jobs.length, jobStatuses: {} }
          if (data.status === 'finished') { next.status = 'finished'; next.overall_completed = 1.0; }
          else if (data.status === 'failed') { next.status = 'failed'; if (data.error) setError(data.error); }
          else {
            next.status = 'running'
            if (data.job_index !== undefined) {
              next.jobStatuses[data.job_index] = { status: data.status, completed: data.completed || 0, total: data.total || 1, name: data.job_name }
              if (data.overall_completed > next.overall_completed) next.overall_completed = data.overall_completed
            }
          }
          return { ...next }
        })
        if (data.status === 'finished' || data.status === 'failed') es.close()
      }
      es.onerror = () => { es.close(); setIsSubmitting(false); }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); setWorkflow(p=>p?{...p, status:'failed'}:null); setIsSubmitting(false); } finally { setIsSubmitting(false) }
  }

  // Keyboard shortcuts for Modal
  useEffect(() => {
    const handleModalKeyDown = (e: KeyboardEvent) => {
      if (!isModalOpen) return
      
      if (e.key === 'Escape') {
        e.preventDefault()
        if (workflow?.status === 'running' || workflow?.status === 'preparing') {
          handleCancel()
        } else if (workflow?.status === 'finished' || workflow?.status === 'failed') {
          setIsModalOpen(false)
          setWorkflow(null)
        }
      } else if (e.key === 'Enter') {
        if (workflow?.status === 'finished' || workflow?.status === 'failed') {
          e.preventDefault()
          setIsModalOpen(false)
          setWorkflow(null)
        }
      }
    }
    window.addEventListener('keydown', handleModalKeyDown)
    return () => window.removeEventListener('keydown', handleModalKeyDown)
  }, [isModalOpen, workflow?.status, handleCancel])

  function formatTime(s: number) {
    if (isNaN(s)) return "00:00:00.000"
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = (s % 60).toFixed(3)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sc.padStart(6, '0')}`
  }

  function parseTimeToSeconds(t: string | undefined): number {
    if (!t) return 0
    const parts = t.split(':').map(parseFloat)
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
    return parseFloat(t) || 0
  }

  const activeJob = jobs.find(j => j.id === activeJobId)

  return (
    <div className="h-screen w-screen bg-[#050505] text-gray-300 flex flex-col font-sans overflow-hidden">
      <nav className="h-14 border-b border-white/[0.03] bg-black/40 backdrop-blur-xl flex items-center px-6 justify-between shrink-0 z-20 shadow-2xl">
        <div className="flex items-center gap-8">
           <div className="flex items-center gap-2.5 group cursor-default">
             <div className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-900/40 group-hover:rotate-6 transition-transform"><Boxes size={20} className="text-white" /></div>
             <div className="flex flex-col leading-none"><span className="font-black text-white tracking-tighter text-base uppercase">FFXPY</span><span className="text-[9px] font-bold text-cyan-500 uppercase tracking-widest">Workflow Studio</span></div>
           </div>
           <div className="h-6 w-[1px] bg-white/10" />
           <div className="flex items-center gap-4">
             <button onClick={openSettings} className="flex items-center gap-2 text-gray-500 hover:text-cyan-500 transition-colors uppercase font-black text-[9px] tracking-widest"><Settings2 size={14}/> Flow Settings</button>
             <button onClick={toggleClearFlow} disabled={!jobs.length && !clearedJobs} className="flex items-center gap-2 text-gray-500 hover:text-amber-400 disabled:opacity-20 transition-colors uppercase font-black text-[9px] tracking-widest border-l border-white/5 pl-4">
               {jobs.length ? <Trash2 size={14}/> : <RotateCcw size={14}/>} {jobs.length ? 'Clear Flow' : 'Undo Clear'}
             </button>
             <button onClick={handleCloseVideo} disabled={!sourceOrder.length} className="flex items-center gap-2 text-gray-500 hover:text-red-500 disabled:opacity-20 transition-colors uppercase font-black text-[9px] tracking-widest border-l border-white/5 pl-4"><X size={14}/> Close All Sources</button>
             <div className="flex items-center gap-3 px-4 py-1.5 bg-white/[0.02] border border-white/[0.05] rounded-full">
               <div className="flex items-center gap-2 border-r border-white/5 pr-3">
                 <span className="text-[10px] font-black text-gray-600 uppercase tracking-tighter">Video</span>
                 <span className="text-[11px] font-bold text-cyan-500/80 font-mono uppercase">{globalSetting.video_codec}</span>
                 {globalSetting.video_bitrate && <span className="text-[11px] font-bold text-gray-400 font-mono">@{globalSetting.video_bitrate}</span>}
               </div>
               <div className="flex items-center gap-2">
                 <span className="text-[10px] font-black text-gray-600 uppercase tracking-tighter">Audio</span>
                 <span className="text-[11px] font-bold text-indigo-400/80 font-mono uppercase">{globalSetting.audio_codec}</span>
               </div>
             </div>
           </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsAboutOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-[10px] font-bold text-gray-400 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors"
            aria-label="查看 FFXPy 版本與更新紀錄"
            title="版本資訊與更新紀錄"
          >
            <BookOpen size={13}/>
            <span className="font-mono">{about ? `v${about.version}` : '版本資訊'}</span>
          </button>
          <button onClick={handleExecute} disabled={isSubmitting||!jobs.length} className="bg-cyan-600 hover:bg-cyan-400 text-white font-black text-[10px] px-6 py-2 rounded-full shadow-lg transition-all flex items-center gap-2 tracking-widest uppercase">{isSubmitting ? <Loader2 className="animate-spin" size={14}/> : <PlayCircle size={14}/>} Run Flow</button>
        </div>
      </nav>

      <div className="flex-1 flex overflow-hidden w-full">
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden bg-black/20">
           {error && (
             <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-6 py-4 rounded-2xl flex flex-col gap-3 animate-in slide-in-from-top duration-300">
               <div className="flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <AlertCircle size={18} />
                   <span className="text-xs font-black uppercase tracking-widest">Flow Failed</span>
                 </div>
                 <button onClick={() => setError(null)} className="p-1 hover:bg-white/5 rounded-lg transition-colors"><X size={16}/></button>
               </div>
               <pre className="text-[11px] font-mono normal-case whitespace-pre-wrap break-words max-h-64 overflow-y-auto bg-black/30 rounded-xl p-4">{error}</pre>
             </div>
           )}
           <div className="flex items-center gap-2 overflow-x-auto shrink-0 custom-scrollbar">
              <button onClick={() => setIsBrowserOpen(true)} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-white/10 text-gray-500 hover:border-cyan-500/40 hover:text-cyan-400 text-[10px] font-black uppercase tracking-widest transition-colors"><Plus size={12}/> Add Source</button>
              {sourceList.map(s => (
                <div
                  key={s.path}
                  onClick={() => setActiveSourcePath(s.path)}
                  title={s.path}
                  className={cn(
                    "shrink-0 flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full border text-[10px] font-bold cursor-pointer transition-colors",
                    s.path === activeSourcePath ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400" : "bg-white/[0.02] border-white/[0.05] text-gray-500 hover:border-white/20"
                  )}
                >
                  <Film size={12} className="shrink-0" />
                  <span className="max-w-[160px] truncate normal-case">{basename(s.path)}</span>
                  <button onClick={e => { e.stopPropagation(); removeSource(s.path) }} className="p-0.5 hover:text-red-500 transition-colors shrink-0"><X size={10}/></button>
                </div>
              ))}
           </div>
           <div className="flex-1 bg-black rounded-3xl overflow-hidden border border-white/[0.03] shadow-2xl relative group">
              {videoInfo ? <video ref={videoRef} src={videoInfo.format_name?.includes("mpegts") ? undefined : `${API_BASE}/api/stream?path=${encodeURIComponent(activeSourcePath)}`} className="w-full h-full object-contain"
                onTimeUpdate={()=>{
                  if(videoRef.current && !videoRef.current.seeking) {
                    const t = videoRef.current.currentTime
                    setCurrentTime(t)
                    if (!isTyping) setEditTime(formatTime(t))
                  }
                }}
                onError={async () => {
                  const brokenPath = activeSourcePath
                  // A playback error here can mean the file is genuinely
                  // gone, but just as often means the browser simply can't
                  // decode this container/codec (e.g. a file named .mp4 that
                  // is actually a raw MPEG-TS stream) -- which has no bearing
                  // on whether ffmpeg can still process it. Check the real
                  // HTTP status via a 1-byte range request instead of
                  // assuming, so we only evict the source (and blame
                  // "deleted or moved") when it's actually missing.
                  let status = 0
                  try {
                    const res = await fetch(
                      `${API_BASE}/api/stream?path=${encodeURIComponent(brokenPath)}`,
                      { headers: { Range: 'bytes=0-0' } }
                    )
                    status = res.status
                  } catch {
                    status = 0
                  }
                  if (status === 404) {
                    setError('Video resource unavailable (File may have been deleted or moved)')
                    setSources(prev => { const next = { ...prev }; delete next[brokenPath]; return next })
                    setSourceOrder(prev => prev.filter(p => p !== brokenPath))
                    setActiveSourcePath('')
                  } else {
                    setError('無法在瀏覽器預覽此檔案（容器/編碼格式不支援，例如副檔名是 .mp4 但實際是 MPEG-TS 串流），但檔案本身存在，仍可正常用於轉檔，不會從 Media Pool 移除。')
                  }
                }}
                controls /> : <div className="w-full h-full flex flex-col items-center justify-center opacity-[0.03]"><Film size={180} /></div>}
              
              {isCropMode && videoInfo && (
                <VisualCropper 
                  videoRef={videoRef}
                  actualWidth={videoInfo.streams.find(s => s.codec_type === 'video')?.width || 1920}
                  actualHeight={videoInfo.streams.find(s => s.codec_type === 'video')?.height || 1080}
                  cropValue={
                    isSettingsOpen 
                      ? (globalSetting.crop || '') 
                      : (activeJob?.setting.crop || globalSetting.crop || '')
                  }
                  isInherited={!isSettingsOpen && !activeJob?.setting.crop && !!globalSetting.crop}
                  onChange={(val) => {
                    if (isSettingsOpen) {
                      setGlobalSetting({ ...globalSetting, crop: val })
                    } else if (activeJob) {
                      setJobs(jobs.map(x => x.id === activeJob.id ? { ...x, setting: { ...x.setting, crop: val } } : x))
                    }
                  }}
                />
              )}
           </div>
           <div className="bg-[#0e0e0e]/80 backdrop-blur-md p-5 rounded-3xl border border-white/[0.05] shadow-2xl shrink-0">
              <div className="flex items-center bg-white/[0.02] p-1 rounded-2xl border border-white/[0.03] w-full group/seek">
                 <button onClick={() => stepKeyframe('prev')} disabled={isSubmitting} className="p-4 hover:bg-white/5 rounded-xl text-cyan-500 disabled:opacity-20 transition-colors shrink-0"><ChevronLeft size={32}/></button>
                 
                 <div className="flex-1 flex items-center justify-center gap-6 overflow-hidden px-4 h-16">
                    {/* Left Keyframes (Prior) */}
                    <div className="flex items-center gap-3 opacity-20 hover:opacity-100 transition-opacity">
                      {Object.keys(establishedMap)
                        .map(Number)
                        .filter(t => t < currentTime - 0.05)
                        .sort((a, b) => a - b)
                        .slice(-2)
                        .map(t => (
                          <button key={t} onClick={() => seekTo(t)} className="px-3 py-1.5 rounded-lg font-mono text-[10px] font-bold border border-white/10 hover:border-cyan-500/50 hover:text-cyan-400 transition-all shrink-0">
                            {formatTime(t)}
                          </button>
                        ))}
                    </div>

                    {/* Center: Current Timecode with Keyframe Magnet Logic */}
                    {(() => {
                      const isAtKeyframe = Object.keys(establishedMap).map(Number).some(t => Math.abs(t - currentTime) < 0.05);
                      return (
                        <div className={cn(
                          "relative px-8 py-2 rounded-2xl border transition-all duration-300 flex flex-col items-center",
                          isAtKeyframe 
                            ? "bg-cyan-500/10 border-cyan-500/40 shadow-[0_0_30px_rgba(6,182,212,0.2)]" 
                            : "bg-black/20 border-white/[0.05]"
                        )}>
                          <span className={cn("text-[8px] font-black uppercase tracking-[0.3em] mb-1 transition-colors", isAtKeyframe ? "text-cyan-400" : "text-gray-600")}>
                            {isAtKeyframe ? "✨ Keyframe Locked" : "Position"}
                          </span>
                          <input 
                            className="bg-transparent border-none outline-none font-mono text-2xl text-white font-black tracking-tight text-center w-[180px] selection:bg-cyan-500/30" 
                            value={editTime} 
                            onFocus={()=>setIsTyping(true)} 
                            onBlur={()=>setIsTyping(false)} 
                            onChange={e=>setEditTime(e.target.value)} 
                            onKeyDown={e=>e.key==='Enter'&&seekTo(parseTimeToSeconds(editTime))}
                          />
                        </div>
                      );
                    })()}

                    {/* Right Keyframes (Coming up) */}
                    <div className="flex items-center gap-3 opacity-20 hover:opacity-100 transition-opacity">
                      {Object.keys(establishedMap)
                        .map(Number)
                        .filter(t => t > currentTime + 0.05)
                        .sort((a, b) => a - b)
                        .slice(0, 2)
                        .map(t => (
                          <button key={t} onClick={() => seekTo(t)} className="px-3 py-1.5 rounded-lg font-mono text-[10px] font-bold border border-white/10 hover:border-cyan-500/50 hover:text-cyan-400 transition-all shrink-0">
                            {formatTime(t)}
                          </button>
                        ))}
                    </div>
                 </div>

                 <button onClick={() => stepKeyframe('next')} disabled={isSubmitting} className="p-4 hover:bg-white/5 rounded-xl text-cyan-500 disabled:opacity-20 transition-colors shrink-0"><ChevronRight size={32}/></button>
              </div>
              
              <div className="flex gap-[1px] opacity-10 px-1 pt-4"></div>
                 </div>
                 </div>

                 <div className="w-[550px] border-l border-white/[0.03] bg-[#080808] flex flex-col shrink-0">
           <div className="flex bg-[#111] h-12 shrink-0 border-b border-white/[0.03]">
              <button onClick={()=>setActiveTab('editor')} className={cn("flex-1 text-[10px] font-black tracking-widest transition-all uppercase flex items-center justify-center gap-2", activeTab==='editor'?"bg-[#080808] text-cyan-500 border-t-2 border-cyan-500 shadow-2xl":"text-gray-600 opacity-40 hover:opacity-80 hover:bg-white/[0.01]")}><Layers size={14}/> Job Queue</button>
              <button onClick={()=>setActiveTab('yaml')} className={cn("flex-1 text-[10px] font-black tracking-widest transition-all uppercase flex items-center justify-center gap-2", activeTab==='yaml'?"bg-[#080808] text-cyan-500 border-t-2 border-cyan-500 shadow-2xl":"text-gray-600 opacity-40 hover:opacity-80 hover:bg-white/[0.01]")}><Code size={14}/> Flow Definition</button>
           </div>

           <div className="flex-1 flex flex-col overflow-hidden p-4">
              {activeTab === 'editor' ? (
                 <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar animate-in fade-in duration-300 px-2">
                    <div className="space-y-3">
                       {jobs.length === 0 ? <div className="text-center py-20 border-2 border-dashed border-white/[0.02] rounded-[2rem] opacity-10 text-xs italic uppercase">Queue is empty</div> : jobs.map((j, i) => {
                         const st = workflow?.jobStatuses[i], isR = st?.status === 'processing', isD = st?.status === 'completed' || st?.status === 'job_done' || workflow?.status === 'finished'
                         const isActive = activeJobId === j.id
                         return (
                          <div key={j.id} className="space-y-3">
                            <div
                              onClick={()=>{
                                setActiveJobId(prev => prev === j.id ? null : j.id)
                                if (j.setting.input_path && j.setting.input_path !== activeSourcePath) setActiveSourcePath(j.setting.input_path)
                              }}
                              draggable
                              onDragStart={() => handleDragStart(i)}
                              onDragEnter={() => handleDragEnter(i)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => e.preventDefault()}
                              className={cn(
                                "group p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden flex items-center gap-4", 
                                isActive?"bg-cyan-500/[0.04] border-cyan-500/30 shadow-2xl":"bg-white/[0.01] border-white/[0.03] hover:border-white/[0.08]",
                                dragIdx === i && "opacity-20 border-cyan-500 border-dashed"
                              )}
                            >
                               <div className="text-gray-700 cursor-grab active:cursor-grabbing hover:text-cyan-500 transition-colors">
                                 <GripVertical size={16} />
                               </div>
                               <div className="flex-1 flex justify-between items-center relative z-10"><div className="flex items-center gap-4 min-w-0">{isD ? <CheckCircle2 size={14} className="text-green-500 shrink-0"/> : isR ? <Loader2 size={14} className="text-cyan-500 animate-spin shrink-0"/> : <div className={cn("w-6 h-6 flex items-center justify-center rounded-md font-black text-[9px] shadow-2xl shrink-0", j.command==='split'?"bg-cyan-950 text-cyan-400":j.command==='crop'?"bg-amber-950 text-amber-400":"bg-indigo-950 text-indigo-400")}>{i+1}</div>}<div className="flex flex-col min-w-0 gap-0.5"><span className="text-xs font-black text-white uppercase tracking-tighter truncate">{j.name}</span><span className="text-[9px] font-bold text-gray-600 normal-case truncate">{j.command === 'merge' ? (j.setting.merge_paths?.length ? `${j.setting.merge_paths.length} sources` : 'auto-chain') : (j.setting.input_path ? basename(j.setting.input_path) : 'no source')}</span></div></div><button onClick={e=>{e.stopPropagation();setJobs(jobs.filter(x=>x.id!==j.id))}} className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-500 transition-opacity p-1 shrink-0"><X size={16}/></button></div>
                               {isR && <div className="absolute bottom-0 left-0 h-[2px] bg-cyan-500 transition-all duration-300" style={{ width: `${Math.round((st.completed / st.total) * 100)}%` }} />}
                            </div>

                            {isActive && activeJob && (
                              <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/[0.05] space-y-6 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300 mx-2">
                                <div className="flex justify-between items-center border-b border-white/[0.03] pb-3"><h4 className="text-[9px] font-black text-cyan-500 uppercase tracking-widest flex items-center gap-2"><Settings2 size={12}/> Properties</h4></div>
                                <div className="space-y-5 text-[9px] uppercase font-black text-gray-500 tracking-wider">
                                    <div className="space-y-2"><label>Task Label</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-cyan-500/30 font-normal transition-colors" value={activeJob.name} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,name:e.target.value}:x))} /></div>
                                    {(activeJob.command==='split' || activeJob.command==='crop') && (
                                      <div className="space-y-2">
                                        <label>Source File</label>
                                        <select
                                          className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-bold appearance-none cursor-pointer"
                                          value={activeJob.setting.input_path || ''}
                                          onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,input_path:e.target.value||undefined}}:x))}
                                        >
                                          {!activeJob.setting.input_path && <option value="">Select a source...</option>}
                                          {sourceList.map(s => <option key={s.path} value={s.path}>{basename(s.path)}</option>)}
                                        </select>
                                      </div>
                                    )}
                                    {activeJob.command==='merge' && (
                                      <div className="space-y-2 border-t border-white/[0.03] pt-5">
                                        <label>Sources To Merge</label>
                                        {sourceList.length === 0 ? (
                                          <p className="text-[10px] text-gray-700 italic normal-case">No sources in the Media Pool yet.</p>
                                        ) : (
                                          <div className="space-y-1.5">
                                            {sourceList.map(s => {
                                              const checked = activeJob.setting.merge_paths?.includes(s.path) || false
                                              return (
                                                <label key={s.path} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.05] bg-black cursor-pointer">
                                                  <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={e => {
                                                      const cur = activeJob.setting.merge_paths || []
                                                      const next = e.target.checked ? [...cur, s.path] : cur.filter(p => p !== s.path)
                                                      setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,merge_paths:next}}:x))
                                                    }}
                                                  />
                                                  <span className="text-[11px] text-gray-300 font-normal normal-case truncate">{basename(s.path)}</span>
                                                </label>
                                              )
                                            })}
                                          </div>
                                        )}
                                        <p className="text-[9px] text-gray-700 italic normal-case">Leave empty to auto-chain the outputs of earlier Split/Crop jobs in this flow.</p>
                                      </div>
                                    )}
                                    {(activeJob.command==='split' || activeJob.command==='crop') && (
                                      <div className="grid grid-cols-2 gap-4 border-t border-white/[0.03] pt-5">
                                          <div className="space-y-2"><label className="text-cyan-600">In Point</label><div className="flex gap-1.5"><input className="w-[104px] shrink-0 bg-black border border-white/[0.05] rounded-lg px-3 py-1.5 text-[11px] font-mono text-cyan-400 outline-none focus:border-cyan-500/30" value={activeJob.setting.start || ''} onChange={e => setJobs(prev => prev.map(x => x.id === activeJob.id ? {...x, setting: {...x.setting, start: e.target.value}} : x))}/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.start))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-cyan-500 transition-colors"><LocateFixed size={12}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,start:formatTime(currentTime)}}:x))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-white/50"><Clock size={12}/></button></div></div>
                                          <div className="space-y-2"><label className="text-red-600">Out Point</label><div className="flex gap-1.5"><input className="w-[104px] shrink-0 bg-black border border-white/[0.05] rounded-lg px-3 py-1.5 text-[11px] font-mono text-red-400 outline-none focus:border-red-500/30" value={activeJob.setting.end || ''} onChange={e => setJobs(prev => prev.map(x => x.id === activeJob.id ? {...x, setting: {...x.setting, end: e.target.value}} : x))}/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.end))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-red-500 transition-colors"><LocateFixed size={12}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,end:formatTime(currentTime)}}:x))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-white/50"><Clock size={12}/></button></div></div>
                                      </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4 border-t border-white/[0.03] pt-5">
                                      <div className="space-y-2"><label>Video Codec</label><select className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-bold appearance-none cursor-pointer" value={activeJob.setting.video_codec||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_codec:e.target.value||undefined}}:x))}><option value="">Inherit</option><option value="copy">COPY</option><option value="libx264">H.264</option><option value="h264_nvenc">NVENC</option></select></div>
                                      <div className="space-y-2"><label>Target Bitrate {bitrateHintFor(activeJob.setting.input_path) && <span className="text-gray-600 normal-case">(source: {bitrateHintFor(activeJob.setting.input_path)})</span>}</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-mono font-normal" placeholder={bitrateHintFor(activeJob.setting.input_path) || 'e.g. 12M'} value={activeJob.setting.video_bitrate||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_bitrate:e.target.value||undefined}}:x))} /></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-2"><label>Audio Codec</label><select className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-bold appearance-none cursor-pointer" value={activeJob.setting.audio_codec||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,audio_codec:e.target.value||undefined}}:x))}><option value="">Inherit</option><option value="copy">COPY</option><option value="aac">AAC</option></select></div>
                                      <div className="space-y-2"><label>Audio Bitrate {audioBitrateHintFor(activeJob.setting.input_path) && <span className="text-gray-600 normal-case">(source: {audioBitrateHintFor(activeJob.setting.input_path)})</span>}</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-mono font-normal" placeholder={audioBitrateHintFor(activeJob.setting.input_path) || 'e.g. 192k'} value={activeJob.setting.audio_bitrate||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,audio_bitrate:e.target.value||undefined}}:x))} /></div>
                                    </div>
                                    <div className="space-y-2">
                                      <label>Frame Rate {fpsHintFor(activeJob.setting.input_path) && <span className="text-gray-600 normal-case">(source: {fpsHintFor(activeJob.setting.input_path)})</span>}</label>
                                      <input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-mono font-normal" placeholder={fpsHintFor(activeJob.setting.input_path) || 'e.g. 60000/1001 or 30'} value={activeJob.setting.fps||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,fps:e.target.value||undefined}}:x))} />
                                    </div>
                                    <div className="space-y-2 border-t border-white/[0.03] pt-5">
                                      <div className="flex justify-between items-center mb-1">
                                        <label>Crop Area (W:H:X:Y)</label>
                                        <div className="flex gap-2">
                                          {activeJob.setting.crop && (
                                            <button 
                                              onClick={() => setJobs(jobs.map(x => x.id === activeJob.id ? { ...x, setting: { ...x.setting, crop: undefined } } : x))}
                                              className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md text-gray-500 hover:text-white transition-colors"
                                            >
                                              Reset
                                            </button>
                                          )}
                                          <button 
                                            onClick={() => setIsCropMode(!isCropMode)}
                                            className={cn(
                                              "text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full transition-all border",
                                              isCropMode ? "bg-amber-500 text-black border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]" : "bg-white/[0.03] text-gray-500 border-white/5 hover:bg-white/[0.08]"
                                            )}
                                          >
                                            {isCropMode ? "✨ Active Mode" : "Select Area"}
                                          </button>
                                        </div>
                                      </div>
                                      <input 
                                        className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-cyan-400 outline-none focus:border-cyan-500/30 font-mono font-normal transition-colors" 
                                        placeholder="e.g. 1920:1080:0:0" 
                                        value={activeJob.setting.crop||''} 
                                        onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,crop:e.target.value||undefined}}:x))} 
                                      />
                                    </div>
                                    <div className="space-y-2 border-t border-white/[0.03] pt-6">
                                      <label className="flex items-center justify-between cursor-pointer group">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-[11px] font-black text-white uppercase tracking-wider group-hover:text-cyan-500 transition-colors">Deinterlace</span>
                                          <span className="text-[9px] text-gray-600 font-bold uppercase tracking-[0.05em]">Auto-detect and fix interlaced video</span>
                                        </div>
                                        <div className="relative w-10 h-5">
                                          <input type="checkbox" className="sr-only peer" checked={activeJob.setting.deinterlace || false} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,deinterlace:e.target.checked}}:x))}/>
                                          <div className="w-10 h-5 bg-white/5 border border-white/10 peer-checked:bg-cyan-600 rounded-full transition-all shadow-inner"></div>
                                          <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-all peer-checked:translate-x-5 shadow-md pointer-events-none"></div>
                                        </div>
                                      </label>
                                    </div>
                                    <div className="space-y-2 border-t border-white/[0.03] pt-6"><label>Output Directory Override</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-cyan-500/30 font-normal transition-colors" placeholder="e.g. ./output" value={activeJob.setting.output_dir||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,output_dir:normalizePath(e.target.value)||undefined}}:x))} /></div>

                                </div>
                              </div>
                            )}
                          </div>
                         )
                       })}

                       <div className="relative group">
                          <div className="p-4 rounded-2xl border-2 border-dashed border-white/[0.03] bg-white/[0.01] flex items-center justify-center gap-3 text-[13px] font-black text-gray-600 uppercase tracking-widest group-hover:border-cyan-500/30 group-hover:bg-cyan-500/[0.02] group-hover:text-cyan-500 transition-all">
                             <Plus size={18} /> New Job {activeSourcePath && <span className="text-[9px] normal-case font-bold text-gray-700">for {basename(activeSourcePath)}</span>}
                          </div>
                          <div className="absolute inset-0 flex opacity-0 group-hover:opacity-100 transition-all z-10 overflow-hidden rounded-2xl">
                             <button onClick={() => addJob('split')} disabled={!activeSourcePath} title={!activeSourcePath ? 'Select a source in the Media Pool first' : ''} className="flex-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:cursor-not-allowed text-white font-black text-[13px] flex items-center justify-center gap-2 uppercase tracking-tight">✂️ Split</button>
                             <button onClick={() => addJob('crop')} disabled={!activeSourcePath} title={!activeSourcePath ? 'Select a source in the Media Pool first' : ''} className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:cursor-not-allowed text-white font-black text-[13px] flex items-center justify-center gap-2 uppercase tracking-tight">🖼️ Crop</button>
                             <button onClick={() => addJob('merge')} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[13px] flex items-center justify-center gap-2 uppercase tracking-tight">🔗 Merge</button>
                          </div>
                       </div>
                    </div>
                 </div>
              ) : (
                 <div className="flex-1 flex flex-col bg-black/40 rounded-3xl overflow-hidden border border-white/[0.02] animate-in fade-in duration-300">
                    <div className="px-6 py-3 border-b border-white/[0.03] flex justify-between items-center bg-white/[0.01]"><span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2"><HistoryIcon size={12}/> Pipeline YAML Source</span><button onClick={()=>navigator.clipboard.writeText(yamlText)} className="text-[10px] font-black text-cyan-600 hover:text-white uppercase transition-colors uppercase tracking-widest">Copy Code</button></div>
                    <textarea className="flex-1 bg-transparent p-8 text-xs font-mono text-green-500/40 outline-none resize-none leading-relaxed custom-scrollbar selection:bg-green-500/20" value={yamlText} onChange={e=>handleYamlChange(e.target.value)} spellCheck={false} placeholder="Paste flow configuration here..."/>
                 </div>
              )}
           </div>
        </div>
      </div>

      {isModalOpen && workflow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050505]/90 backdrop-blur-2xl animate-in fade-in duration-500">
           <div className="w-[650px] bg-[#0c0c0c] border border-white/[0.05] rounded-[3rem] shadow-[0_0_100px_rgba(0,0,0,1)] flex flex-col overflow-hidden">
              <div className="p-10 border-b border-white/[0.03] flex justify-between items-center bg-white/[0.01]">
                 <div className="flex flex-col gap-1.5">
                   <h3 className="text-base font-black uppercase tracking-[0.4em] text-white flex items-center gap-3">
                     <CircleDot size={14} className={cn("text-cyan-500", (workflow.status === 'running' || workflow.status === 'preparing') && "animate-pulse")}/> Flow Execution
                   </h3>
                   <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                     {workflow.status === 'finished' ? 'Process Finalized' : 
                      workflow.status === 'cancelling' ? 'Cancelling Flow...' :
                      workflow.status === 'failed' ? 'Process Terminated' : 'Executing Flow...'}
                   </p>
                 </div>
                 <button onClick={() => { setIsModalOpen(false); setWorkflow(null); }} className="p-4 bg-white/[0.03] rounded-full hover:bg-white/[0.08] transition-colors"><X size={24}/></button>
              </div>
              <div className="p-10 flex-1 overflow-y-auto max-h-[500px] space-y-6 custom-scrollbar">
                 <div className="bg-black/60 p-7 rounded-[2rem] border border-white/[0.03] flex flex-col gap-4 shadow-inner"><div className="flex justify-between items-end"><span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">Total Flow Progress</span><span className="text-2xl font-black text-white font-mono tracking-tighter">{Math.round((workflow.overall_completed / workflow.overall_total) * 100)}%</span></div><div className="h-2 bg-white/[0.02] rounded-full overflow-hidden shadow-inner"><div className={cn("h-full transition-all duration-700 shadow-[0_0_20px_rgba(6,182,212,0.5)]", workflow.status==='failed'?"bg-red-500":"bg-gradient-to-r from-cyan-600 to-cyan-400")} style={{ width: `${Math.round((workflow.overall_completed / workflow.overall_total) * 100)}%` }} /></div></div>
                 <div className="space-y-2.5">
                    {jobs.map((job, idx) => {
                       const st = workflow.jobStatuses[idx]
                       const isActive = workflow.status === 'running' || workflow.status === 'preparing' || workflow.status === 'cancelling'
                       const isR = st?.status === 'processing' && isActive
                       const isD = st?.status === 'completed' || st?.status === 'job_done' || workflow.status === 'finished'
                       const isF = st?.status === 'failed' || st?.status === 'error' || (st?.status === 'processing' && !isActive)
                       const jobP = st ? Math.round((st.completed / (st.total || 1)) * 100) : 0
                       return (
                         <div key={job.id} className={cn("p-5 rounded-2xl border transition-all flex flex-col gap-3", isR ? "bg-cyan-500/[0.03] border-cyan-500/20" : isD ? "bg-green-500/[0.02] border-green-500/10 opacity-40" : "bg-white/[0.01] border-transparent opacity-20")}>
                            <div className="flex justify-between items-center px-1">
                               <div className="flex items-center gap-4">
                                  {isD ? <CheckCircle2 size={16} className="text-green-500"/> : isF ? <AlertCircle size={16} className="text-red-500"/> : isR ? <Loader2 size={16} className="text-cyan-500 animate-spin"/> : <div className="w-4 h-4 border border-white/10 rounded-full"/>}<span className="text-xs font-black text-white uppercase tracking-tight">{job.name}</span></div>
                               {isR && <span className="text-[10px] font-black font-mono text-cyan-400">{jobP}%</span>}
                            </div>
                            {isR && <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden shadow-inner"><div className="h-full bg-cyan-500/60 transition-all duration-500" style={{ width: `${jobP}%` }} /></div>}
                         </div>
                       )
                    })}
                 </div>
              </div>
              <div className="p-10 bg-white/[0.01] border-t border-white/[0.03] flex justify-center gap-4">
                 {workflow.status === 'running' || workflow.status === 'preparing' ? (
                   <button onClick={handleCancel} className="px-16 py-4 rounded-full font-black text-[11px] tracking-[0.2em] transition-all shadow-2xl uppercase bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/20">Cancel Execution</button>
                 ) : (
                   <button onClick={() => { setIsModalOpen(false); setWorkflow(null); }} className={cn("px-16 py-4 rounded-full font-black text-[11px] tracking-[0.2em] transition-all shadow-2xl uppercase", (workflow.status === 'finished' || workflow.status === 'failed') ? "bg-green-600 hover:bg-green-500 text-white shadow-green-900/40" : "bg-white/[0.03] text-gray-600 cursor-not-allowed")}>{workflow.status === 'finished' ? 'Flow Finalized' : workflow.status === 'failed' ? 'Close' : 'Processing Flow...'}</button>
                 )}
              </div>
           </div>
        </div>
      )}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsSettingsOpen(false)}>
          <div
            className="w-full bg-[#0c0c0c] border-t border-white/[0.05] rounded-t-[3rem] shadow-[0_-20px_50px_rgba(0,0,0,0.5)] p-10 space-y-8 animate-in slide-in-from-bottom duration-500"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.key === 'Enter' && applySettings()}
          >

            <div className="flex justify-between items-center">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-black uppercase tracking-[0.4em] text-white flex items-center gap-3"><Settings2 size={18} className="text-cyan-500"/> Flow Settings</h3>
                <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Global configuration for current flow</p>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="p-3 bg-white/[0.03] rounded-full hover:bg-white/[0.08] transition-colors"><X size={20}/></button>
            </div>

            <div className="grid grid-cols-2 gap-10">
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Media Pool</label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                    {sourceList.length === 0 && <p className="text-[10px] text-gray-700 italic py-2">No sources loaded yet.</p>}
                    {sourceList.map(s => {
                      const isActive = s.path === activeSourcePath
                      return (
                        <div key={s.path} className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-colors", isActive ? "bg-cyan-500/10 border-cyan-500/30" : "bg-black border-white/[0.05]")}>
                          <button onClick={() => setActiveSourcePath(s.path)} title={s.path} className={cn("flex-1 text-left truncate font-mono", isActive ? "text-cyan-400" : "text-gray-400 hover:text-white")}>{basename(s.path)}</button>
                          <button onClick={() => removeSource(s.path)} title="Close source and detach it from jobs" className="p-1 text-gray-600 hover:text-red-500 transition-colors shrink-0"><X size={12}/></button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <input
                      ref={settingsInputRef}
                      className="flex-1 bg-black border border-white/[0.05] rounded-2xl px-5 py-3 text-xs text-white outline-none focus:border-cyan-500/30 font-mono transition-colors"
                      placeholder="e.g. /path/to/video.mp4"
                      value={newSourcePath}
                      onChange={e => setNewSourcePath(normalizePath(e.target.value))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); if (newSourcePath) { addSource(newSourcePath); setNewSourcePath('') } } }}
                    />
                    <button onClick={() => { if (newSourcePath) { addSource(newSourcePath); setNewSourcePath('') } }} className="px-4 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-[10px] font-black uppercase tracking-widest transition-colors">Add</button>
                    <button onClick={() => setIsBrowserOpen(true)} className="px-4 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-[10px] font-black uppercase tracking-widest transition-colors">Browse</button>
                  </div>
                  <p className="text-[9px] text-gray-700 italic">Each job binds to one source, so different jobs can edit different files in the same flow.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">TEMP Directory (Local SSD)</label>
                  <input
                    className="w-full bg-black border border-white/[0.05] rounded-2xl px-5 py-4 text-xs text-amber-400 outline-none focus:border-amber-500/30 font-mono transition-colors"
                    placeholder="e.g. C:/ffxpy-temp or /mnt/ssd/ffxpy-temp"
                    value={globalSetting.temp_dir || ''}
                    onChange={e => setGlobalSetting({...globalSetting, temp_dir: normalizePath(e.target.value)})}
                  />
                  <p className="text-[9px] text-gray-700 italic">Split/Crop intermediate files and the merge list are written here. Leave empty to use the source directory.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Default Merge Output Directory</label>
                  <input 
                    className="w-full bg-black border border-white/[0.05] rounded-2xl px-5 py-4 text-xs text-cyan-400 outline-none focus:border-cyan-500/30 font-mono transition-colors" 
                    placeholder="e.g. /path/to/merged/videos" 
                    value={globalSetting.output_dir || ''} 
                    onChange={e => setGlobalSetting({...globalSetting, output_dir: normalizePath(e.target.value)})}
                  />
                  <p className="text-[9px] text-gray-700 italic">Only applies to Merge tasks that don't have an override.</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Global Video Codec</label>
                    <select 
                      className="w-full bg-black border border-white/[0.05] rounded-2xl px-4 py-3.5 text-xs text-white outline-none font-bold appearance-none cursor-pointer focus:border-cyan-500/30"
                      value={globalSetting.video_codec}
                      onChange={e => setGlobalSetting({...globalSetting, video_codec: e.target.value})}
                    >
                      <option value="copy">COPY</option>
                      <option value="libx264">H.264</option>
                      <option value="h264_nvenc">NVENC</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Global Bitrate {bitrateHintFor(activeSourcePath) && <span className="normal-case text-gray-600">(active source: {bitrateHintFor(activeSourcePath)})</span>}</label>
                    <input
                      className="w-full bg-black border border-white/[0.05] rounded-2xl px-4 py-3.5 text-xs text-white outline-none font-mono focus:border-cyan-500/30"
                      placeholder={bitrateHintFor(activeSourcePath) || 'e.g. 8M'}
                      value={globalSetting.video_bitrate || ''}
                      onChange={e => setGlobalSetting({...globalSetting, video_bitrate: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Global Audio Codec</label>
                    <select
                      className="w-full bg-black border border-white/[0.05] rounded-2xl px-4 py-3.5 text-xs text-white outline-none font-bold appearance-none cursor-pointer focus:border-cyan-500/30"
                      value={globalSetting.audio_codec}
                      onChange={e => setGlobalSetting({...globalSetting, audio_codec: e.target.value})}
                    >
                      <option value="copy">COPY</option>
                      <option value="aac">AAC</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Global Audio Bitrate {audioBitrateHintFor(activeSourcePath) && <span className="normal-case text-gray-600">(active source: {audioBitrateHintFor(activeSourcePath)})</span>}</label>
                    <input
                      className="w-full bg-black border border-white/[0.05] rounded-2xl px-4 py-3.5 text-xs text-white outline-none font-mono focus:border-cyan-500/30"
                      placeholder={audioBitrateHintFor(activeSourcePath) || 'e.g. 192k'}
                      value={globalSetting.audio_bitrate || ''}
                      onChange={e => setGlobalSetting({...globalSetting, audio_bitrate: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Global Frame Rate {fpsHintFor(activeSourcePath) && <span className="normal-case text-gray-600">(active source: {fpsHintFor(activeSourcePath)})</span>}</label>
                  <input
                    className="w-full bg-black border border-white/[0.05] rounded-2xl px-5 py-4 text-xs text-cyan-400 outline-none focus:border-cyan-500/30 font-mono transition-colors"
                    placeholder={fpsHintFor(activeSourcePath) || 'e.g. 60000/1001 or 30'}
                    value={globalSetting.fps || ''}
                    onChange={e => setGlobalSetting({...globalSetting, fps: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Global Crop Area (W:H:X:Y)</label>
                  <input 
                    className="w-full bg-black border border-white/[0.05] rounded-2xl px-5 py-4 text-xs text-cyan-400 outline-none focus:border-cyan-500/30 font-mono transition-colors" 
                    placeholder="e.g. 1920:1080:0:0" 
                    value={globalSetting.crop || ''} 
                    onChange={e => setGlobalSetting({...globalSetting, crop: e.target.value})}
                  />
                </div>

                <div className="flex flex-col gap-5 pt-2">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-black text-white uppercase tracking-wider group-hover:text-cyan-500 transition-colors">Keep Temporary Files</span>
                      <span className="text-[9px] text-gray-600 font-bold uppercase tracking-[0.05em]">Do not delete segments after merge</span>
                    </div>
                    <div className="relative w-10 h-5">
                      <input type="checkbox" className="sr-only peer" checked={globalSetting.keep_temp} onChange={e=>setGlobalSetting({...globalSetting, keep_temp: e.target.checked})}/>
                      <div className="w-10 h-5 bg-white/5 border border-white/10 peer-checked:bg-cyan-600 rounded-full transition-all shadow-inner"></div>
                      <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-all peer-checked:translate-x-5 shadow-md pointer-events-none"></div>
                    </div>
                  </label>

                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-black text-white uppercase tracking-wider group-hover:text-cyan-500 transition-colors">Skip Existing Files</span>
                      <span className="text-[9px] text-gray-600 font-bold uppercase tracking-[0.05em]">Prevent overwriting of output files</span>
                    </div>
                    <div className="relative w-10 h-5">
                      <input type="checkbox" className="sr-only peer" checked={globalSetting.skip_existing} onChange={e=>setGlobalSetting({...globalSetting, skip_existing: e.target.checked})}/>
                      <div className="w-10 h-5 bg-white/5 border border-white/10 peer-checked:bg-cyan-600 rounded-full transition-all shadow-inner"></div>
                      <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-all peer-checked:translate-x-5 shadow-md pointer-events-none"></div>
                    </div>
                  </label>

                  <label className="flex items-center justify-between cursor-pointer group">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-black text-white uppercase tracking-wider group-hover:text-cyan-500 transition-colors">Auto Deinterlace</span>
                      <span className="text-[9px] text-gray-600 font-bold uppercase tracking-[0.05em]">Globally auto-detect interlaced video</span>
                    </div>
                    <div className="relative w-10 h-5">
                      <input type="checkbox" className="sr-only peer" checked={globalSetting.deinterlace} onChange={e=>setGlobalSetting({...globalSetting, deinterlace: e.target.checked})}/>
                      <div className="w-10 h-5 bg-white/5 border border-white/10 peer-checked:bg-cyan-600 rounded-full transition-all shadow-inner"></div>
                      <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-all peer-checked:translate-x-5 shadow-md pointer-events-none"></div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
            <div className="pt-4 flex justify-center">
              <button onClick={applySettings} className="px-12 py-3 bg-cyan-600 hover:bg-cyan-400 text-white font-black text-[10px] tracking-[0.2em] rounded-full transition-all uppercase shadow-lg shadow-cyan-900/20">Apply & Close</button>
            </div>
          </div>
        </div>
      )}

      {isAboutOpen && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          onClick={() => setIsAboutOpen(false)}
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="ffxpy-about-title"
            className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#0c0c0c] border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden"
            onClick={event => event.stopPropagation()}
          >
            <header className="flex justify-between items-center border-b border-white/10 p-6 shrink-0">
              <div>
                <h3 id="ffxpy-about-title" className="text-lg font-black text-white flex items-center gap-3"><BookOpen size={20} className="text-cyan-500"/> 更新紀錄</h3>
                <p className="text-xs text-gray-500 mt-1">FFXPy {about ? `v${about.version}` : '版本資訊'}</p>
              </div>
              <button aria-label="關閉更新紀錄" onClick={() => setIsAboutOpen(false)} className="p-3 rounded-full bg-white/[0.03] hover:bg-white/[0.08]"><X size={20}/></button>
            </header>
            <div className="p-7 overflow-y-auto custom-scrollbar text-gray-300 text-sm leading-relaxed">
              {about ? (
                <div className="space-y-3">
                  <ReactMarkdown components={{
                    h1: ({children}) => <h4 className="text-xl font-black text-white mb-4">{children}</h4>,
                    h2: ({children}) => <h5 className="text-lg font-bold text-cyan-400 pt-5 pb-2 border-b border-white/10">{children}</h5>,
                    h3: ({children}) => <h6 className="text-sm font-bold text-white mt-4 mb-2">{children}</h6>,
                    p: ({children}) => <p className="my-2 text-gray-400">{children}</p>,
                    ul: ({children}) => <ul className="list-disc pl-6 space-y-1.5 my-3">{children}</ul>,
                    li: ({children}) => <li className="text-gray-400">{children}</li>,
                    strong: ({children}) => <strong className="text-gray-200">{children}</strong>,
                    hr: () => <hr className="border-white/10 my-6"/>,
                    a: ({children, href}) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">{children}</a>,
                  }}>{about.changelog}</ReactMarkdown>
                </div>
              ) : aboutError ? (
                <p className="text-red-400">無法讀取更新紀錄：{aboutError}</p>
              ) : (
                <p className="text-gray-400">讀取更新紀錄中…</p>
              )}
            </div>
          </section>
        </div>
      )}
      {isHelpOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setIsHelpOpen(false)}>
          <div
            className="w-full max-w-2xl bg-[#0c0c0c] border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] p-10 space-y-8 animate-in zoom-in-95 duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-white/[0.05] pb-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-xl font-black uppercase tracking-[0.3em] text-white flex items-center gap-3"><HelpCircle size={22} className="text-cyan-500"/> Keyboard Shortcuts</h3>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Master your workflow with keys</p>
              </div>
              <button onClick={() => setIsHelpOpen(false)} className="p-3 bg-white/[0.03] rounded-full hover:bg-white/[0.08] transition-colors"><X size={20}/></button>
            </div>

            <div className="grid grid-cols-2 gap-x-12 gap-y-6">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-cyan-600 uppercase tracking-[0.2em]">Global Actions</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Open Video</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Ctrl + O</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Close Video</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Alt + Q</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Flow Settings</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Alt + S</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Toggle Help</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">H</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Prev Keyframe</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">[</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Next Keyframe</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">]</kbd></div>
                </div>
                <h4 className="text-[10px] font-black text-cyan-600 uppercase tracking-[0.2em] pt-4">File Selector</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Navigate List</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">↑ / ↓</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Open Folder / Toggle File</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Enter</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Add Selected Sources</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Ctrl + Enter</kbd></div>
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-cyan-600 uppercase tracking-[0.2em]">Job Management</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Add Split Job</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Alt + 1</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Add Crop Job</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Alt + 2</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Add Merge Job</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Alt + 3</kbd></div>
                </div>
                <h4 className="text-[10px] font-black text-cyan-600 uppercase tracking-[0.2em] pt-4">During Execution</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Run Flow</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Ctrl + Enter</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Cancel Flow</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Esc</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Close Modal</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Enter / Esc</kbd></div>
                </div>
                <h4 className="text-[10px] font-black text-cyan-600 uppercase tracking-[0.2em] pt-4">Other Windows</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">Close Panel</span><kbd className="px-2.5 py-1 bg-white/[0.05] border border-white/[0.1] rounded text-[10px] font-mono text-gray-300 shadow-sm">Esc</kbd></div>
                </div>
              </div>
            </div>
            
            <div className="pt-4 flex justify-center">
              <button onClick={() => setIsHelpOpen(false)} className="px-12 py-3 bg-white/[0.05] hover:bg-white/[0.1] text-white font-black text-[10px] tracking-[0.2em] rounded-full transition-all uppercase">Got It</button>
            </div>
          </div>
        </div>
      )}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-cyan-900/90 border border-cyan-500/50 text-cyan-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-[100] animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 size={16} className="text-cyan-400" />
          <span className="text-xs font-bold tracking-wide">{toastMessage}</span>
        </div>
      )}
      {isBrowserOpen && (
        <FileBrowserModal
          initialPath={activeSourcePath || (sourceOrder.length ? sourceOrder[0] : null)}
          onClose={() => setIsBrowserOpen(false)}
          onConfirm={async (paths) => {
            setIsBrowserOpen(false)
            if (paths.length) await addSources(paths)
          }}
        />
      )}

    </div>
  )
}
