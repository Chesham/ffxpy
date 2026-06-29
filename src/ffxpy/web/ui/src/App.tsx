import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  Loader2, CheckCircle2, Plus, ChevronLeft, ChevronRight, 
  Settings2, Clock, Code, LocateFixed, 
  History as HistoryIcon, Layers, CircleDot, X, AlertCircle, PlayCircle, Film, Boxes, GripVertical, HelpCircle
} from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import yaml from 'js-yaml'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : ''
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

interface StreamInfo { index: number; codec_type: string; width?: number; height?: number }
interface VideoInfo { format_name: string; duration: string; duration_sec: number; streams: StreamInfo[] }
interface JobSetting { start?: string; end?: string; video_codec?: string; video_bitrate?: string; audio_codec?: string; audio_bitrate?: string; scale?: string; crop?: string; output_dir?: string; output_path?: string; keep_temp?: boolean; skip_existing?: boolean; deinterlace?: boolean }
interface Job { id: string; name: string; command: 'split' | 'merge' | 'crop'; setting: JobSetting }
interface JobStatus { status: string; completed: number; total: number; name?: string }
interface WorkflowState { status: string; overall_completed: number; overall_total: number; total_jobs: number; jobStatuses: Record<number, JobStatus> }

interface GlobalSetting {
  video_codec: string;
  audio_codec: string;
  video_bitrate: string;
  overwrite: boolean;
  keep_temp: boolean;
  skip_existing: boolean;
  deinterlace: boolean;
  output_dir: string;
  crop?: string;
}

export default function App() {
  const [videoPath, setVideoPath] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [globalSetting, setGlobalSetting] = useState<GlobalSetting>(() => {
    const saved = localStorage.getItem('ffxpy_global_settings')
    return saved ? JSON.parse(saved) : { video_codec: 'copy', audio_codec: 'copy', video_bitrate: '', overwrite: true, keep_temp: false, skip_existing: false, deinterlace: false, output_dir: '', crop: '' }
  })
  const [yamlText, setYamlText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [keyframes, setKeyframes] = useState<number[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'editor' | 'yaml'>('editor')
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [editTime, setEditTime] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [tempVideoPath, setTempVideoPath] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isCropMode, setIsCropMode] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const settingsInputRef = useRef<HTMLInputElement>(null)
  const isSyncingFromYaml = useRef(false)

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

  const handleProbe = useCallback(async (path: string, preserveJobs: boolean = false) => {
    if (!path) return
    setIsSubmitting(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/probe?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error('Probe failed')
      const d = await res.json(), m = d.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/)
      const ts = (parseInt(m?.[1]||'0')*3600)+(parseInt(m?.[2]||'0')*60)+parseFloat(m?.[3]||'0')
      
      // Auto-Reset UI State for new video
      if (!preserveJobs) {
        setJobs([])
        setActiveJobId(null)
        setKeyframes([])
      }
      setCurrentTime(0)
      setVideoPath(path)
      setEstablishedMap({})

      setVideoInfo({ ...d, duration_sec: ts })
      setEditTime(formatTime(0))
      if (!preserveJobs) setKeyframes([])

      if (d.bit_rate) {
        const kbps = Math.round(d.bit_rate / 1000)
        const bitrateStr = kbps >= 1000 ? `${parseFloat((kbps / 1000).toFixed(2))}M` : `${kbps}k`
        setGlobalSetting(prev => {
          if (prev.video_bitrate !== bitrateStr) {
            setToastMessage(`Auto-detected bitrate: ${bitrateStr}`)
            return { ...prev, video_bitrate: bitrateStr }
          }
          return prev
        })
      }

    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) } finally { setIsSubmitting(false) }
  }, [])

  const openSettings = useCallback(() => {
    setTempVideoPath(videoPath)
    setIsSettingsOpen(true)
  }, [videoPath])

  const applySettings = useCallback(() => {
    if (tempVideoPath !== videoPath) {
      handleProbe(tempVideoPath, videoPath === '')
    }
    setIsSettingsOpen(false)
  }, [tempVideoPath, videoPath, handleProbe])

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
    if (!isSettingsOpen || !tempVideoPath) return
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/probe?path=${encodeURIComponent(tempVideoPath)}`)
        if (res.ok) {
          const d = await res.json()
          if (d.bit_rate) {
            const kbps = Math.round(d.bit_rate / 1000)
            const bitrateStr = kbps >= 1000 ? `${parseFloat((kbps / 1000).toFixed(2))}M` : `${kbps}k`
            setGlobalSetting(prev => {
              if (prev.video_bitrate !== bitrateStr) {
                setToastMessage(`Auto-detected bitrate: ${bitrateStr}`)
                return { ...prev, video_bitrate: bitrateStr }
              }
              return prev
            })
          }
        }
      } catch (e) {
        // silently ignore probe errors during typing
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [tempVideoPath, isSettingsOpen])

  useEffect(() => {
    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
        try {
          const res = await fetch(`${API_BASE}/api/dialog/open`)
          if (res.ok) {
            const data = await res.json()
            if (data.path) {
              handleProbe(data.path)
            }
          }
        } catch (err) {
          console.error("Failed to open file dialog", err)
        }
      }
      if (isTyping) return
      
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
    setVideoPath('')
    setVideoInfo(null)
    setJobs([])
    setActiveJobId(null)
    setCurrentTime(0)
    setKeyframes([])
    setEstablishedMap({})
    setError(null)
  }

  useEffect(() => {
    localStorage.setItem('ffxpy_global_settings', JSON.stringify(globalSetting))
  }, [globalSetting])

  useEffect(() => {
    if (activeTab === 'yaml') return // Two-way binding separate paths
    const clean = (o: Record<string, unknown>) => {
       const r: Record<string, unknown> = { ...o }
       Object.keys(r).forEach(k => { if (r[k] === '' || r[k] === undefined) delete r[k] })
       return r
    }
    const flowObj = {
      setting: clean({ 
        video_codec: globalSetting.video_codec,
        video_bitrate: globalSetting.video_bitrate,
        audio_codec: globalSetting.audio_codec,
        overwrite: globalSetting.overwrite,
        keep_temp: globalSetting.keep_temp,
        skip_existing: globalSetting.skip_existing,
        deinterlace: globalSetting.deinterlace,
        crop: globalSetting.crop,
        input_path: videoPath 
      }),
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
  }, [globalSetting, jobs, videoPath, activeTab])

  const handleYamlChange = (v: string) => {
    setYamlText(v)
    try {
      isSyncingFromYaml.current = true
      const d = yaml.load(v)
      if (d && typeof d === 'object') {
        const dObj = d as Record<string, unknown>
        const setting = dObj.setting as Record<string, unknown> | undefined
        if (setting) {
          if (typeof setting.input_path === 'string') {
            const newPath = setting.input_path
            if (newPath !== videoPath) {
              handleProbe(newPath, true)
            }
            setVideoPath(newPath)
            setTempVideoPath(newPath)
          }
          const rest = { ...setting }
          delete rest.input_path
          setGlobalSetting((prev: GlobalSetting) => ({ ...prev, ...rest }))
        }
        const jobsList = dObj.jobs
        if (Array.isArray(jobsList)) {
          setJobs(jobsList.map((j: unknown) => {
            const jobObj = j as Record<string, unknown>
            return { 
              id: (jobObj.id as string) || generateId(), 
              ...jobObj, 
              setting: (jobObj.setting as JobSetting) || {} 
            } as Job
          }))
        }
      }
    } catch {
      // Ignore parse errors while typing
    } finally { isSyncingFromYaml.current = false }
  }

  // establishedMap stores confirmed neighbors: { [time]: { prev: number, next: number } }
  const [establishedMap, setEstablishedMap] = useState<Record<string, { prev?: number, next?: number }>>({})

  const stepKeyframe = async (dir: 'prev' | 'next') => {
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
      const res = await fetch(`${API_BASE}/api/keyframes?path=${encodeURIComponent(videoPath)}&time=${probeTime}&range_sec=10`)
      const data = await res.json()
      const newPoints: number[] = Array.from(new Set<number>(data.keyframes || [])).sort((a,b)=>a-b)
      
      // 3. Establish relationships between all returned points
      setEstablishedMap(prev => {
        const nextMap = { ...prev }
        for (let i = 0; i < newPoints.length; i++) {
          const k = newPoints[i].toFixed(2)
          const node = nextMap[k] || {}
          if (i > 0) node.prev = newPoints[i-1]
          if (i < newPoints.length - 1) node.next = newPoints[i+1]
          nextMap[k] = node
        }
        return nextMap
      })

      // 4. Find target in the results with a bit of buffer
      let target: number | undefined
      if (dir === 'prev') {
        target = [...newPoints].reverse().find(x => x < currentTime - 0.05)
      } else {
        target = newPoints.find(x => x > currentTime + 0.05)
      }

      // Final fallback to global rough list
      if (target === undefined) {
        if (dir === 'prev') {
          target = keyframes.slice().reverse().find(x => x < currentTime - 0.1) ?? (currentTime > 0 ? 0 : undefined)
        } else {
          target = keyframes.find(x => x > currentTime + 0.1)
        }
      }

      if (target !== undefined) seekTo(target)
    } catch (e) {
      console.error("Precision step failed", e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const addJob = (type: 'split' | 'merge' | 'crop') => {
    const id = generateId()
    const newJob: Job = { 
      id, 
      name: `${type.toUpperCase()} #${jobs.length + 1}`, 
      command: type, 
      setting: type === 'split' 
        ? { start: formatTime(currentTime), end: formatTime(videoInfo?.duration_sec || 0) } 
        : type === 'crop'
        ? { video_codec: 'libx264', video_bitrate: '5M' }
        : { video_codec: 'copy' } 
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
             <button onClick={handleCloseVideo} disabled={!videoPath} className="flex items-center gap-2 text-gray-500 hover:text-red-500 disabled:opacity-20 transition-colors uppercase font-black text-[9px] tracking-widest border-l border-white/5 pl-4"><X size={14}/> Close Video</button>
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
        <button onClick={handleExecute} disabled={isSubmitting||!jobs.length} className="bg-cyan-600 hover:bg-cyan-400 text-white font-black text-[10px] px-6 py-2 rounded-full shadow-lg transition-all flex items-center gap-2 tracking-widest uppercase">{isSubmitting ? <Loader2 className="animate-spin" size={14}/> : <PlayCircle size={14}/>} Run Flow</button>
      </nav>

      <div className="flex-1 flex overflow-hidden w-full">
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden bg-black/20">
           {error && (
             <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-6 py-4 rounded-2xl flex items-center justify-between animate-in slide-in-from-top duration-300">
               <div className="flex items-center gap-3">
                 <AlertCircle size={18} />
                 <span className="text-xs font-black uppercase tracking-widest">{error}</span>
               </div>
               <button onClick={() => setError(null)} className="p-1 hover:bg-white/5 rounded-lg transition-colors"><X size={16}/></button>
             </div>
           )}
           <div className="flex-1 bg-black rounded-3xl overflow-hidden border border-white/[0.03] shadow-2xl relative group">
              {videoInfo ? <video ref={videoRef} src={`${API_BASE}/api/stream?path=${encodeURIComponent(videoPath)}`} className="w-full h-full object-contain" 
                onTimeUpdate={()=>{
                  if(videoRef.current && !videoRef.current.seeking) {
                    const t = videoRef.current.currentTime
                    setCurrentTime(t)
                    if (!isTyping) setEditTime(formatTime(t))
                  }
                }} 
                onError={() => {
                  setError("Video resource unavailable (File may have been deleted or moved)");
                  setVideoInfo(null);
                  setKeyframes([]);
                  setEstablishedMap({});
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
              
              <div className="flex gap-[1px] opacity-10 px-1 pt-4">
                 {videoInfo && keyframes.length < 2000 && keyframes.map(k => (<div key={k} className="h-1 bg-cyan-500 rounded-full flex-1" />))}
                 </div>
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
                              onClick={()=>setActiveJobId(prev => prev === j.id ? null : j.id)} 
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
                               <div className="flex-1 flex justify-between items-center relative z-10"><div className="flex items-center gap-4">{isD ? <CheckCircle2 size={14} className="text-green-500"/> : isR ? <Loader2 size={14} className="text-cyan-500 animate-spin"/> : <div className={cn("w-6 h-6 flex items-center justify-center rounded-md font-black text-[9px] shadow-2xl", j.command==='split'?"bg-cyan-950 text-cyan-400":j.command==='crop'?"bg-amber-950 text-amber-400":"bg-indigo-950 text-indigo-400")}>{i+1}</div>}<span className="text-xs font-black text-white uppercase tracking-tighter">{j.name}</span></div><button onClick={e=>{e.stopPropagation();setJobs(jobs.filter(x=>x.id!==j.id))}} className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-500 transition-opacity p-1"><X size={16}/></button></div>
                               {isR && <div className="absolute bottom-0 left-0 h-[2px] bg-cyan-500 transition-all duration-300" style={{ width: `${Math.round((st.completed / st.total) * 100)}%` }} />}
                            </div>

                            {isActive && activeJob && (
                              <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/[0.05] space-y-6 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300 mx-2">
                                <div className="flex justify-between items-center border-b border-white/[0.03] pb-3"><h4 className="text-[9px] font-black text-cyan-500 uppercase tracking-widest flex items-center gap-2"><Settings2 size={12}/> Properties</h4></div>
                                <div className="space-y-5 text-[9px] uppercase font-black text-gray-500 tracking-wider">
                                    <div className="space-y-2"><label>Task Label</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-cyan-500/30 font-normal transition-colors" value={activeJob.name} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,name:e.target.value}:x))} /></div>
                                    {(activeJob.command==='split' || activeJob.command==='crop') && (
                                      <div className="grid grid-cols-2 gap-4 border-t border-white/[0.03] pt-5">
                                          <div className="space-y-2"><label className="text-cyan-600">In Point</label><div className="flex gap-1.5"><input className="flex-1 bg-black border border-white/[0.05] rounded-lg px-3 py-1.5 text-[11px] font-mono text-cyan-400 outline-none focus:border-cyan-500/30" value={activeJob.setting.start || ''} onChange={e => setJobs(prev => prev.map(x => x.id === activeJob.id ? {...x, setting: {...x.setting, start: e.target.value}} : x))}/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.start))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-cyan-500 transition-colors"><LocateFixed size={12}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,start:formatTime(currentTime)}}:x))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-white/50"><Clock size={12}/></button></div></div>
                                          <div className="space-y-2"><label className="text-red-600">Out Point</label><div className="flex gap-1.5"><input className="flex-1 bg-black border border-white/[0.05] rounded-lg px-3 py-1.5 text-[11px] font-mono text-red-400 outline-none focus:border-red-500/30" value={activeJob.setting.end || ''} onChange={e => setJobs(prev => prev.map(x => x.id === activeJob.id ? {...x, setting: {...x.setting, end: e.target.value}} : x))}/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.end))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-red-500 transition-colors"><LocateFixed size={12}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,end:formatTime(currentTime)}}:x))} className="p-1.5 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-white/50"><Clock size={12}/></button></div></div>
                                      </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4 border-t border-white/[0.03] pt-5">
                                      <div className="space-y-2"><label>Video Codec</label><select className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-bold appearance-none cursor-pointer" value={activeJob.setting.video_codec||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_codec:e.target.value||undefined}}:x))}><option value="">Inherit</option><option value="copy">COPY</option><option value="libx264">H.264</option><option value="h264_nvenc">NVENC</option></select></div>
                                      <div className="space-y-2"><label>Target Bitrate</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2 text-xs text-white outline-none font-mono font-normal" placeholder="e.g. 12M" value={activeJob.setting.video_bitrate||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_bitrate:e.target.value||undefined}}:x))} /></div>
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
                             <Plus size={18} /> New Job
                          </div>
                          <div className="absolute inset-0 flex opacity-0 group-hover:opacity-100 transition-all z-10 overflow-hidden rounded-2xl">
                             <button onClick={() => addJob('split')} className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-black text-[13px] flex items-center justify-center gap-2 uppercase tracking-tight">✂️ Split</button>
                             <button onClick={() => addJob('crop')} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-black text-[13px] flex items-center justify-center gap-2 uppercase tracking-tight">🖼️ Crop</button>
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
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Input Video Path</label>
                  <div className="flex gap-3">
                    <input 
                      ref={settingsInputRef}
                      className="flex-1 bg-black border border-white/[0.05] rounded-2xl px-5 py-4 text-xs text-white outline-none focus:border-cyan-500/30 font-mono transition-colors" 
                      placeholder="e.g. /path/to/video.mp4" 
                      value={tempVideoPath} 
                      onChange={e => setTempVideoPath(normalizePath(e.target.value))} 
                    />
                  </div>

                  <p className="text-[9px] text-gray-700 italic">Changing this path will reset all current jobs and timeline progress.</p>
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
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Global Bitrate</label>
                    <input 
                      className="w-full bg-black border border-white/[0.05] rounded-2xl px-4 py-3.5 text-xs text-white outline-none font-mono focus:border-cyan-500/30"
                      placeholder="e.g. 8M"
                      value={globalSetting.video_bitrate || ''}
                      onChange={e => setGlobalSetting({...globalSetting, video_bitrate: e.target.value})}
                    />
                  </div>
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

    </div>
  )
}
