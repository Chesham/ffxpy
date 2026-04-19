import { useState, useEffect, useRef } from 'react'
import { 
  Loader2, CheckCircle2, Search, Zap, Plus, Trash2, ChevronLeft, ChevronRight, 
  FileVideo, Settings2, Combine, ArrowRight, Clock, Code, LocateFixed, 
  History as HistoryIcon, MonitorPlay, Layers, CircleDot, X, AlertCircle, PlayCircle, Film, Boxes
} from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import yaml from 'js-yaml'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
const API_BASE = 'http://localhost:8000'

interface VideoInfo { format_name: string; duration: string; duration_sec: number }
interface JobSetting { start?: string; end?: string; video_codec?: string; video_bitrate?: string; audio_codec?: string; audio_bitrate?: string; scale?: string; output_dir?: string; output_path?: string; keep_temp?: boolean; skip_existing?: boolean }
interface Job { id: string; name: string; command: 'split' | 'merge'; setting: JobSetting }
interface JobStatus { status: string; completed: number; total: number; name?: string }
interface WorkflowState { status: string; overall_completed: number; overall_total: number; total_jobs: number; jobStatuses: Record<number, JobStatus> }

export default function App() {
  const [videoPath, setVideoPath] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [globalSetting, setGlobalSetting] = useState({ video_codec: 'copy', audio_codec: 'copy', overwrite: true, keep_temp: false, skip_existing: false })
  const [yamlText, setYamlText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [keyframes, setKeyframes] = useState<number[]>([])
  const [knownKeyframes, setKnownKeyframes] = useState<number[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'editor' | 'yaml'>('editor')
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const isSyncingFromYaml = useRef(false)

  const seekTo = (t: number) => {
    const val = Math.max(0, Math.min(t, videoInfo?.duration_sec || 0)); setCurrentTime(val)
    if (videoRef.current) videoRef.current.currentTime = val
  }

  const handleProbe = async () => {
    if (!videoPath) return
    setIsSubmitting(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/probe?path=${encodeURIComponent(videoPath)}`)
      if (!res.ok) throw new Error('Probe failed')
      const d = await res.json(), m = d.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/)
      const ts = (parseInt(m?.[1]||'0')*3600)+(parseInt(m?.[2]||'0')*60)+parseFloat(m?.[3]||'0')
      setVideoInfo({ ...d, duration_sec: ts })
      setKeyframes([])
      setKnownKeyframes([0])
    } catch (e: any) { setError(e.message) } finally { setIsSubmitting(false) }
  }

  useEffect(() => {
    if (isSyncingFromYaml.current) return
    const clean = (o: any) => {
       const r = { ...o }
       Object.keys(r).forEach(k => { if (r[k] === '' || r[k] === undefined) delete r[k] })
       return r
    }
    const flowObj = {
      setting: clean({ ...globalSetting, input_path: videoPath }),
      jobs: jobs.map(j => ({ command: j.command, name: j.name, setting: clean(j.setting) }))
    }
    setYamlText(yaml.dump(flowObj, { indent: 2, skipInvalid: true, noRefs: true }))
  }, [globalSetting, jobs, videoPath])

  const handleYamlChange = (v: string) => {
    setYamlText(v)
    try {
      isSyncingFromYaml.current = true
      const d = yaml.load(v) as any
      if (d && typeof d === 'object') {
        if (d.setting) {
          if (d.setting.input_path) setVideoPath(d.setting.input_path)
          const { input_path, ...rest } = d.setting
          setGlobalSetting(prev => ({ ...prev, ...rest }))
        }
        if (Array.isArray(d.jobs)) {
          setJobs(d.jobs.map((j: any) => ({ id: j.id || Math.random().toString(36).substr(2, 9), ...j, setting: j.setting || {} })))
        }
      }
    } catch(e) {} finally { isSyncingFromYaml.current = false }
  }

  // establishedMap stores confirmed neighbors: { [time]: { prev: number, next: number } }
  const [establishedMap, setEstablishedMap] = useState<Record<string, { prev?: number, next?: number }>>({})

  const stepKeyframe = async (dir: 'prev' | 'next') => {
    // 1. Check ESTABLISHED RELATIONSHIPS first (Zero Latency)
    // We use a small epsilon for float comparison
    const currentKey = currentTime.toFixed(3)
    const established = establishedMap[currentKey]
    const fastTarget = dir === 'prev' ? established?.prev : established?.next

    if (fastTarget !== undefined) {
      console.log(`[DEBUG] Instant jump via established relationship: ${currentKey} -> ${fastTarget.toFixed(3)}`)
      seekTo(fastTarget)
      return 
    }

    // 2. New Territory - Perform network probe
    setIsSubmitting(true)
    try {
      const probeTime = Math.max(0, currentTime)
      const res = await fetch(`${API_BASE}/api/keyframes?path=${encodeURIComponent(videoPath)}&time=${probeTime}&range_sec=5`)
      const data = await res.json()
      const newPoints: number[] = Array.from(new Set<number>(data.keyframes || [])).sort((a,b)=>a-b)
      
      // 3. Establish relationships between all returned points
      setEstablishedMap(prev => {
        const nextMap = { ...prev }
        for (let i = 0; i < newPoints.length; i++) {
          const k = newPoints[i].toFixed(3)
          const node = nextMap[k] || {}
          if (i > 0) node.prev = newPoints[i-1]
          if (i < newPoints.length - 1) node.next = newPoints[i+1]
          nextMap[k] = node
        }
        return nextMap
      })

      // 4. Find target in the results
      let target: number | undefined
      if (dir === 'prev') {
        target = [...newPoints].reverse().find(x => x < currentTime - 0.01)
      } else {
        target = newPoints.find(x => x > currentTime + 0.01)
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

  const addJob = (type: 'split' | 'merge') => {
    const id = Math.random().toString(36).substr(2, 9)
    const newJob: Job = { id, name: `${type.toUpperCase()} #${jobs.length + 1}`, command: type, setting: type === 'split' ? { start: formatTime(currentTime), end: formatTime(videoInfo?.duration_sec || 0) } : { video_codec: 'copy' } }
    setJobs([...jobs, newJob]); setActiveJobId(id)
  }

  const handleExecute = async () => {
    setIsModalOpen(true); setWorkflow({ status: 'preparing', overall_completed: 0, overall_total: 1.0, total_jobs: jobs.length, jobStatuses: {} }); setIsSubmitting(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/execute`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(yaml.load(yamlText)) })
      if (!res.ok) throw new Error(await res.text())
      const { job_id } = await res.json()
      const es = new EventSource(`${API_BASE}/api/events/${job_id}`)
      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        setWorkflow(prev => {
          const next = prev ? { ...prev } : { status: 'running', overall_completed: 0, overall_total: 1.0, total_jobs: jobs.length, jobStatuses: {} }
          if (data.status === 'finished') { next.status = 'finished'; next.overall_completed = 1.0; }
          else if (data.status === 'failed') next.status = 'failed'
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
    } catch (e: any) { setError(e.message); setWorkflow(p=>p?{...p, status:'failed'}:null); setIsSubmitting(false); } finally { setIsSubmitting(false) }
  }

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
           <div className="flex items-center gap-3">
              <input className="bg-black/80 border border-white/5 rounded-md px-4 py-1.5 text-[11px] w-[400px] outline-none focus:border-cyan-500/50 font-mono transition-all" placeholder="Video path..." value={videoPath} onChange={e=>setVideoPath(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleProbe()}/>
              <button onClick={handleProbe} disabled={isSubmitting} className="bg-white/90 text-black font-black text-[10px] px-4 py-1.5 rounded-md hover:bg-cyan-500 transition-colors uppercase disabled:opacity-50 tracking-widest">Load</button>
           </div>
           <div className="h-6 w-[1px] bg-white/10" />
           <div className="flex gap-6 items-center text-gray-500 uppercase font-black text-[9px]">
              <label className="flex items-center gap-2 cursor-pointer group"><input type="checkbox" className="sr-only peer" checked={globalSetting.keep_temp} onChange={e=>setGlobalSetting({...globalSetting, keep_temp: e.target.checked})}/><div className="w-7 h-3.5 bg-white/5 border border-white/5 peer-checked:bg-cyan-600 rounded-full relative transition-all"><div className="absolute left-0.5 top-0.5 w-2 h-2 bg-white rounded-full transition-all peer-checked:left-4"></div></div><span className="group-hover:text-gray-300">Keep Temp</span></label>
              <label className="flex items-center gap-2 cursor-pointer group"><input type="checkbox" className="sr-only peer" checked={globalSetting.skip_existing} onChange={e=>setGlobalSetting({...globalSetting, skip_existing: e.target.checked})}/><div className="w-7 h-3.5 bg-white/5 border border-white/5 peer-checked:bg-cyan-600 rounded-full relative transition-all"><div className="absolute left-0.5 top-0.5 w-2 h-2 bg-white rounded-full transition-all peer-checked:left-4"></div></div><span className="group-hover:text-gray-300">Skip Existing</span></label>
           </div>
        </div>
        <button onClick={handleExecute} disabled={isSubmitting||!jobs.length} className="bg-cyan-600 hover:bg-cyan-400 text-white font-black text-[10px] px-6 py-2 rounded-full shadow-lg transition-all flex items-center gap-2 tracking-widest uppercase">{isSubmitting ? <Loader2 className="animate-spin" size={14}/> : <PlayCircle size={14}/>} Run Pipeline</button>
      </nav>

      <div className="flex-1 flex overflow-hidden w-full">
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden bg-black/20">
           <div className="flex-1 bg-black rounded-3xl overflow-hidden border border-white/[0.03] shadow-2xl relative group">
              {videoInfo ? <video ref={videoRef} src={`${API_BASE}/api/stream?path=${encodeURIComponent(videoPath)}`} className="w-full h-full object-contain" onTimeUpdate={()=>!videoRef.current?.seeking&&setCurrentTime(videoRef.current.currentTime)} controls /> : <div className="w-full h-full flex flex-col items-center justify-center opacity-[0.03]"><Film size={180} /></div>}
           </div>
           <div className="bg-[#0e0e0e]/80 backdrop-blur-md p-5 rounded-3xl border border-white/[0.05] space-y-5 shadow-2xl shrink-0">
              <div className="flex justify-between items-center px-2">
                 <div className="flex items-center gap-4 bg-white/[0.02] p-1 rounded-2xl border border-white/[0.03]">
                    <button onClick={() => stepKeyframe('prev')} disabled={isSubmitting} className="p-3 hover:bg-white/5 rounded-xl text-cyan-500 disabled:opacity-20 transition-colors shadow-inner"><ChevronLeft size={28}/></button>
                    <div className="flex flex-col items-center px-6 min-w-[180px] border-x border-white/[0.03]"><span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.3em] mb-1">Timecode Position</span><span className="font-mono text-2xl text-white font-black tracking-tight">{formatTime(currentTime)}</span></div>
                    <button onClick={() => stepKeyframe('next')} disabled={isSubmitting} className="p-3 hover:bg-white/5 rounded-xl text-cyan-500 disabled:opacity-20 transition-colors shadow-inner"><ChevronRight size={28}/></button>
                 </div>
                 <div className="flex gap-3">
                    <button onClick={() => addJob('split')} className="bg-white/5 hover:bg-cyan-500 hover:text-black border border-white/10 text-white font-black text-[11px] px-10 py-3.5 rounded-2xl flex items-center gap-2 transition-all shadow-xl active:scale-95 group"><Plus size={18} className="group-hover:rotate-90 transition-transform"/> ADD SPLIT JOB</button>
                    <button onClick={() => addJob('merge')} className="bg-white/5 hover:bg-indigo-500 hover:text-white border border-white/10 text-white font-black text-[11px] px-10 py-3.5 rounded-2xl flex items-center gap-2 transition-all shadow-xl active:scale-95 group"><Combine size={18}/> ADD MERGE JOB</button>
                 </div>
              </div>
              <div className="flex gap-[1px] opacity-10 px-1">
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
                         return (
                          <div key={j.id} onClick={()=>setActiveJobId(j.id)} className={cn("group p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden", activeJobId===j.id?"bg-cyan-500/[0.04] border-cyan-500/30 shadow-2xl":"bg-white/[0.01] border-white/[0.03] hover:border-white/[0.08]")}>
                             <div className="flex justify-between items-center relative z-10"><div className="flex items-center gap-4">{isD ? <CheckCircle2 size={14} className="text-green-500"/> : isR ? <Loader2 size={14} className="text-cyan-500 animate-spin"/> : <div className={cn("w-6 h-6 flex items-center justify-center rounded-md font-black text-[9px] shadow-2xl", j.command==='split'?"bg-cyan-950 text-cyan-400":"bg-indigo-950 text-indigo-400")}>{i+1}</div>}<span className="text-xs font-black text-white uppercase tracking-tighter">{j.name}</span></div><button onClick={e=>{e.stopPropagation();setJobs(jobs.filter(x=>x.id!==j.id))}} className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-500 transition-opacity p-1"><X size={16}/></button></div>
                             {isR && <div className="absolute bottom-0 left-0 h-[2px] bg-cyan-500 transition-all duration-300" style={{ width: `${Math.round((st.completed / st.total) * 100)}%` }} />}
                          </div>
                         )
                       })}
                    </div>
                    {activeJob && (
                      <div className="bg-white/[0.02] p-7 rounded-[2rem] border border-white/[0.05] space-y-7 shadow-2xl animate-in slide-in-from-right-4">
                         <div className="flex justify-between items-center border-b border-white/[0.03] pb-4"><h4 className="text-[10px] font-black text-cyan-500 uppercase tracking-widest flex items-center gap-2"><Settings2 size={14}/> Properties</h4></div>
                         <div className="space-y-6 text-[9px] uppercase font-black text-gray-500 tracking-wider">
                            <div className="space-y-2"><label>Task Label</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-cyan-500/30 font-normal transition-colors" value={activeJob.name} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,name:e.target.value}:x))} /></div>
                            {activeJob.command==='split' && (
                               <div className="grid grid-cols-2 gap-5 border-t border-white/[0.03] pt-6">
                                  <div className="space-y-2"><label className="text-cyan-600">In Point</label><div className="flex gap-1.5"><input className="flex-1 bg-black border border-white/[0.05] rounded-lg px-3 py-2 text-[11px] font-mono text-cyan-400 outline-none focus:border-cyan-500/30" value={activeJob.setting.start || ''} onChange={e => setJobs(prev => prev.map(x => x.id === activeJob.id ? {...x, setting: {...x.setting, start: e.target.value}} : x))}/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.start))} className="p-2 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-cyan-500 transition-colors"><LocateFixed size={14}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,start:formatTime(currentTime)}}:x))} className="p-2 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-white/50"><Clock size={14}/></button></div></div>
                                  <div className="space-y-2"><label className="text-red-600">Out Point</label><div className="flex gap-1.5"><input className="flex-1 bg-black border border-white/[0.05] rounded-lg px-3 py-2 text-[11px] font-mono text-red-400 outline-none focus:border-red-500/30" value={activeJob.setting.end || ''} onChange={e => setJobs(prev => prev.map(x => x.id === activeJob.id ? {...x, setting: {...x.setting, end: e.target.value}} : x))}/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.end))} className="p-2 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-red-500 transition-colors"><LocateFixed size={14}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,end:formatTime(currentTime)}}:x))} className="p-2 bg-white/[0.03] rounded-lg hover:bg-white/[0.08] text-white/50"><Clock size={14}/></button></div></div>
                               </div>
                            )}
                            <div className="grid grid-cols-2 gap-5 border-t border-white/[0.03] pt-6">
                               <div className="space-y-2"><label>Video Codec</label><select className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2.5 text-xs text-white outline-none font-bold appearance-none cursor-pointer" value={activeJob.setting.video_codec||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_codec:e.target.value||undefined}}:x))}><option value="">Inherit</option><option value="copy">COPY</option><option value="libx264">H.264</option><option value="h264_nvenc">NVENC</option></select></div>
                               <div className="space-y-2"><label>Target Bitrate</label><input className="w-full bg-black border border-white/[0.05] rounded-xl px-4 py-2.5 text-xs text-white outline-none font-mono font-normal" placeholder="e.g. 12M" value={activeJob.setting.video_bitrate||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_bitrate:e.target.value||undefined}}:x))} /></div>
                            </div>
                         </div>
                      </div>
                    )}
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
                 <div className="flex flex-col gap-1.5"><h3 className="text-base font-black uppercase tracking-[0.4em] text-white flex items-center gap-3"><CircleDot size={14} className="text-cyan-500 animate-pulse"/> Pipeline Execution</h3><p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">{workflow.status === 'finished' ? 'Process Finalized' : 'Executing Workflow...'}</p></div>
                 <button onClick={() => { setIsModalOpen(false); setWorkflow(null); }} className="p-4 bg-white/[0.03] rounded-full hover:bg-white/[0.08] transition-colors"><X size={24}/></button>
              </div>
              <div className="p-10 flex-1 overflow-y-auto max-h-[500px] space-y-6 custom-scrollbar">
                 <div className="bg-black/60 p-7 rounded-[2rem] border border-white/[0.03] flex flex-col gap-4 shadow-inner"><div className="flex justify-between items-end"><span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">Total Pipeline Progress</span><span className="text-2xl font-black text-white font-mono tracking-tighter">{Math.round((workflow.overall_completed / workflow.overall_total) * 100)}%</span></div><div className="h-2 bg-white/[0.02] rounded-full overflow-hidden shadow-inner"><div className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-700 shadow-[0_0_20px_rgba(6,182,212,0.5)]" style={{ width: `${Math.round((workflow.overall_completed / workflow.overall_total) * 100)}%` }} /></div></div>
                 <div className="space-y-2.5">
                    {jobs.map((job, idx) => {
                       const st = workflow.jobStatuses[idx], isR = st?.status === 'processing', isD = st?.status === 'completed' || st?.status === 'job_done' || workflow.status === 'finished', isF = st?.status === 'failed' || st?.status === 'error'
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
              <div className="p-10 bg-white/[0.01] border-t border-white/[0.03] flex justify-center">
                 <button onClick={() => { setIsModalOpen(false); setWorkflow(null); }} className={cn("px-16 py-4 rounded-full font-black text-[11px] tracking-[0.2em] transition-all shadow-2xl uppercase", workflow.status === 'finished' ? "bg-green-600 hover:bg-green-500 text-white shadow-green-900/40" : "bg-white/[0.03] text-gray-600 cursor-not-allowed")}>{workflow.status === 'finished' ? 'Pipeline Finalized' : 'Processing Pipeline...'}</button>
              </div>
           </div>
        </div>
      )}
    </div>
  )
}
