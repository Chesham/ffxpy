import { useState, useEffect, useRef } from 'react'
import { 
  Loader2, CheckCircle2, Search, Zap, Plus, Trash2, ChevronLeft, ChevronRight, 
  FileVideo, Settings2, Combine, ArrowRight, Clock, Code, LocateFixed, 
  History, MonitorPlay, Layers, CircleDot, X, AlertCircle, PlayCircle
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
interface WorkflowState { status: string; overall_completed: number; overall_total: number; jobStatuses: Record<number, JobStatus> }

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
      const kf = await (await fetch(`${API_BASE}/api/keyframes?path=${encodeURIComponent(videoPath)}`)).json()
      setKeyframes(kf.keyframes || [])
    } catch (e: any) { setError(e.message) } finally { setIsSubmitting(false) }
  }

  useEffect(() => {
    if (isSyncingFromYaml.current) return
    const clean = (o: any) => { const r={...o}; Object.keys(r).forEach(k=>{if(r[k]===''||r[k]===undefined) delete r[k]}); return r }
    setYamlText(yaml.dump({ setting: clean({...globalSetting, input_path: videoPath}), jobs: jobs.map(j=>({command:j.command, name:j.name, setting:clean(j.setting)})) }, { indent: 2, skipInvalid: true, noRefs: true }))
  }, [globalSetting, jobs, videoPath])

  const handleYamlChange = (v: string) => {
    setYamlText(v); try {
      isSyncingFromYaml.current = true; const d = yaml.load(v) as any
      if (d?.setting) { if(d.setting.input_path) setVideoPath(d.setting.input_path); const {input_path, ...rest}=d.setting; setGlobalSetting(prev => ({ ...prev, ...rest })) }
      if (Array.isArray(d?.jobs)) setJobs(d.jobs.map((j:any)=>({ id: Math.random().toString(36).substr(2,9), ...j, setting: j.setting||{} })))
    } catch(e){} finally { isSyncingFromYaml.current = false }
  }

  const stepKeyframe = (dir: 'prev' | 'next') => {
    if (!keyframes.length) return
    const t = dir === 'prev' ? (keyframes.slice().reverse().find(x=>x<currentTime-0.01) ?? keyframes[0]) : (keyframes.find(x=>x>currentTime+0.01) ?? keyframes[keyframes.length-1])
    seekTo(t)
  }

  const addJob = (type: 'split' | 'merge') => {
    const id = Math.random().toString(36).substr(2, 9)
    const newJob: Job = { id, name: `${type.toUpperCase()} #${jobs.length + 1}`, command: type, setting: type === 'split' ? { start: formatTime(currentTime), end: formatTime(videoInfo?.duration_sec || 0) } : { video_codec: 'copy' } }
    setJobs([...jobs, newJob]); setActiveJobId(id)
  }

  const handleExecute = async () => {
    setIsModalOpen(true); setIsSubmitting(true); setError(null);
    setWorkflow({ status: 'preparing', overall_completed: 0, overall_total: 1.0, jobStatuses: {} })
    try {
      const res = await fetch(`${API_BASE}/api/execute`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(yaml.load(yamlText)) })
      if (!res.ok) throw new Error(await res.text())
      const { job_id } = await res.json()
      const es = new EventSource(`${API_BASE}/api/events/${job_id}`)
      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        setWorkflow(prev => {
          const next = prev ? { ...prev } : { status: 'running', overall_completed: 0, overall_total: 1.0, jobStatuses: {} }
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
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=(s%60).toFixed(3)
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${sc.padStart(6,'0')}`
  }

  function parseTimeToSeconds(t: string|undefined): number {
    if (!t) return 0; const p = t.split(':').map(parseFloat)
    return p.length===3 ? (p[0]*3600)+(p[1]*60)+p[2] : parseFloat(t)||0
  }

  const activeJob = jobs.find(j => j.id === activeJobId)

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 w-full flex flex-col font-sans overflow-hidden">
      <nav className="h-14 border-b border-white/5 bg-[#111] flex items-center px-6 justify-between shrink-0 z-20 shadow-xl">
        <div className="flex items-center gap-6">
           <div className="flex items-center gap-2"><FileVideo className="text-cyan-500" size={20}/><span className="font-black text-white tracking-tighter italic text-lg">FFXPY.WEB</span></div>
           <div className="flex items-center gap-3">
              <input className="bg-black/60 border border-white/10 rounded px-4 py-1.5 text-[11px] w-[350px] outline-none focus:border-cyan-500/50 font-mono transition-all" placeholder="Path..." value={videoPath} onChange={e=>setVideoPath(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleProbe()}/>
              <button onClick={handleProbe} disabled={isSubmitting} className="bg-white text-black font-black text-[9px] px-3 py-1 rounded hover:bg-cyan-500 transition-colors uppercase disabled:opacity-50">Load</button>
           </div>
           <div className="h-6 w-[1px] bg-white/10" />
           <div className="flex gap-4 items-center text-gray-500 uppercase font-bold text-[9px]">
              <label className="flex items-center gap-2 cursor-pointer group"><input type="checkbox" className="sr-only peer" checked={globalSetting.keep_temp} onChange={e=>setGlobalSetting({...globalSetting, keep_temp: e.target.checked})}/><div className="w-7 h-4 bg-gray-800 peer-checked:bg-cyan-600 rounded-full relative transition-all"><div className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full transition-all peer-checked:left-4"></div></div><span>Keep Temp</span></label>
              <label className="flex items-center gap-2 cursor-pointer group"><input type="checkbox" className="sr-only peer" checked={globalSetting.skip_existing} onChange={e=>setGlobalSetting({...globalSetting, skip_existing: e.target.checked})}/><div className="w-7 h-4 bg-gray-800 peer-checked:bg-cyan-600 rounded-full relative transition-all"><div className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full transition-all peer-checked:left-4"></div></div><span>Skip Existing</span></label>
           </div>
        </div>
        <button onClick={handleExecute} disabled={isSubmitting||!jobs.length} className="bg-cyan-600 hover:bg-cyan-400 text-white font-black text-[10px] px-6 py-2 rounded-full shadow-lg transition-all flex items-center gap-2 tracking-widest uppercase">{isSubmitting ? <Loader2 className="animate-spin" size={14}/> : <PlayCircle size={14}/>} Run Flow</button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden">
           <div className="flex-1 bg-black rounded-2xl overflow-hidden border border-white/5 shadow-2xl relative group">
              {videoInfo ? <video ref={videoRef} src={`${API_BASE}/api/stream?path=${encodeURIComponent(videoPath)}`} className="w-full h-full object-contain" onTimeUpdate={()=>!videoRef.current?.seeking&&setCurrentTime(videoRef.current.currentTime)} controls /> : <div className="w-full h-full flex flex-col items-center justify-center opacity-5"><MonitorPlay size={100} /></div>}
           </div>
           <div className="bg-[#121212] p-5 rounded-2xl border border-white/5 space-y-4 shadow-xl shrink-0">
              <div className="flex justify-between items-center">
                 <div className="flex items-center gap-4 bg-black/40 p-1 rounded-xl border border-white/5">
                    <button onClick={() => stepKeyframe('prev')} className="p-2.5 hover:bg-white/5 rounded-lg text-cyan-500 transition-colors"><ChevronLeft size={24}/></button>
                    <div className="flex flex-col items-center px-4 min-w-[150px]"><span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">Timecode</span><span className="font-mono text-2xl text-white font-bold tracking-tighter">{formatTime(currentTime)}</span></div>
                    <button onClick={() => stepKeyframe('next')} className="p-2.5 hover:bg-white/5 rounded-lg text-cyan-500 transition-colors"><ChevronRight size={24}/></button>
                 </div>
                 <div className="flex gap-3">
                    <button onClick={() => addJob('split')} className="bg-white/5 hover:bg-cyan-500 hover:text-black border border-white/10 text-white font-black text-[10px] px-8 py-3 rounded-xl flex items-center gap-2 transition-all shadow-lg active:scale-95"><Plus size={16}/> ADD SPLIT</button>
                    <button onClick={() => addJob('merge')} className="bg-white/5 hover:bg-indigo-500 hover:text-white border border-white/10 text-white font-black text-[10px] px-8 py-3 rounded-xl flex items-center gap-2 transition-all shadow-lg active:scale-95"><Combine size={16}/> ADD MERGE</button>
                 </div>
              </div>
              <div className="flex gap-[1px] opacity-10">
                {videoInfo && keyframes.length < 1500 && keyframes.map(k => (<div key={k} className="h-1 bg-cyan-500 rounded-full flex-1" />))}
              </div>
           </div>
        </div>

        <div className="w-[500px] border-l border-white/5 bg-[#0e0e0e] flex flex-col shrink-0">
           <div className="flex border-b border-white/5 bg-[#121212] h-12 shrink-0">
              <button onClick={()=>setActiveTab('editor')} className={cn("flex-1 text-[9px] font-black tracking-widest uppercase flex items-center justify-center gap-2", activeTab==='editor'?"border-b border-cyan-500 text-white":"text-gray-600 opacity-40")}><Layers size={12}/> Editor</button>
              <button onClick={()=>setActiveTab('yaml')} className={cn("flex-1 text-[9px] font-black tracking-widest uppercase flex items-center justify-center gap-2", activeTab==='yaml'?"border-b border-cyan-500 text-white":"text-gray-600 opacity-40")}><Code size={12}/> YAML Flow</button>
           </div>
           
           <div className="flex-1 flex flex-col overflow-hidden relative">
              {activeTab === 'editor' ? (
                 <div className="flex-1 overflow-y-auto p-6 space-y-8 animate-in fade-in duration-300">
                    <div className="space-y-4"><h4 className="text-[10px] font-black text-gray-600 uppercase tracking-widest text-center">Job Queue</h4>
                    <div className="space-y-2">
                       {!jobs.length && <div className="text-center py-10 border border-dashed border-white/5 rounded-2xl opacity-10 text-sm italic uppercase tracking-tighter">Queue Empty</div>}
                       {jobs.map((j, i) => {
                         const st = workflow?.jobStatuses[i], isR = st?.status === 'processing', isD = st?.status === 'completed' || st?.status === 'job_done' || workflow?.status === 'finished'
                         return (
                          <div key={j.id} onClick={()=>setActiveJobId(j.id)} className={cn("group p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden", activeJobId===j.id?"bg-cyan-500/5 border-cyan-500/30 shadow-lg":"bg-black/40 border-white/5 hover:border-white/10")}>
                             <div className="flex justify-between items-center relative z-10">
                                <div className="flex items-center gap-3">
                                   {isD ? <CheckCircle2 size={12} className="text-green-500"/> : isR ? <Loader2 size={12} className="text-cyan-500 animate-spin"/> : <span className={cn("text-[9px] font-black w-6 h-6 flex items-center justify-center rounded-lg", j.command==='split'?"bg-cyan-900/50 text-cyan-400":"bg-indigo-900/50 text-indigo-400")}>{i+1}</span>}
                                   <span className="text-xs font-black text-white uppercase tracking-tight">{j.name}</span>
                                </div>
                                <button onClick={e=>{e.stopPropagation();setJobs(jobs.filter(x=>x.id!==j.id))}} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-500 transition-opacity"><Trash2 size={16}/></button>
                             </div>
                             {isR && <div className="absolute bottom-0 left-0 h-[2px] bg-cyan-500 transition-all duration-300" style={{ width: `${Math.round((st.completed / st.total) * 100)}%` }} />}
                          </div>
                         )
                       })}
                    </div></div>
                    {activeJob && (
                      <div className="bg-[#141414] p-6 rounded-2xl border border-white/10 space-y-6 shadow-2xl animate-in fade-in slide-in-from-right-2">
                         <div className="flex justify-between items-center border-b border-white/5 pb-4"><h4 className="text-[10px] font-black text-cyan-500 uppercase tracking-widest flex items-center gap-2"><Settings2 size={12}/> Properties</h4></div>
                         <div className="space-y-5 text-[9px] uppercase font-black text-gray-500">
                            <div className="space-y-1.5"><label>Name</label><input className="w-full bg-black border border-white/5 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40 font-normal" value={activeJob.name} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,name:e.target.value}:x))} /></div>
                            {activeJob.command==='split' && (
                               <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4">
                                  <div className="space-y-1.5"><label className="text-cyan-600 tracking-tighter">In Point</label><div className="flex gap-1"><input className="flex-1 bg-black border border-white/5 rounded px-2 py-1.5 text-[10px] font-mono text-cyan-400" value={activeJob.setting.start} readOnly/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.start))} className="p-1.5 bg-white/5 rounded text-cyan-500"><LocateFixed size={12}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,start:formatTime(currentTime)}}:x))} className="p-1.5 bg-white/5 rounded"><Clock size={12}/></button></div></div>
                                  <div className="space-y-1.5"><label className="text-red-600 tracking-tighter">Out Point</label><div className="flex gap-1"><input className="flex-1 bg-black border border-white/5 rounded px-2 py-1.5 text-[10px] font-mono text-red-400" value={activeJob.setting.end} readOnly/><button onClick={()=>seekTo(parseTimeToSeconds(activeJob.setting.end))} className="p-1.5 bg-white/5 rounded text-red-500"><LocateFixed size={12}/></button><button onClick={()=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,end:formatTime(currentTime)}}:x))} className="p-1.5 bg-white/5 rounded"><Clock size={12}/></button></div></div>
                               </div>
                            )}
                            <div className="grid grid-cols-2 gap-4"><div className="space-y-1.5"><label>Codec</label><select className="w-full bg-black border border-white/5 rounded px-3 py-2 text-xs text-white outline-none font-normal" value={activeJob.setting.video_codec||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_codec:e.target.value||undefined}}:x))}><option value="">Inherit</option><option value="copy">COPY</option><option value="libx264">H.264</option><option value="h264_nvenc">NVENC</option></select></div><div className="space-y-1.5"><label>Bitrate</label><input className="w-full bg-black border border-white/5 rounded px-3 py-2 text-xs text-white outline-none font-mono font-normal" placeholder="e.g. 8M" value={activeJob.setting.video_bitrate||''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,video_bitrate:e.target.value||undefined}}:x))} /></div></div>
                            <div className="space-y-1.5"><label>Output Path Override</label><input className="w-full bg-black border border-white/5 rounded px-3 py-2 text-xs text-white outline-none font-mono font-normal" placeholder="Relative path..." value={activeJob.setting.output_path || ''} onChange={e=>setJobs(jobs.map(x=>x.id===activeJob.id?{...x,setting:{...x.setting,output_path:e.target.value||undefined}}:x))} /></div>
                         </div>
                      </div>
                    )}
                 </div>
              ) : (
                 <div className="flex-1 flex flex-col bg-black animate-in fade-in duration-300">
                    <div className="px-6 py-3 border-b border-white/5 flex justify-between items-center bg-[#111]"><span className="text-[9px] font-black text-gray-600 uppercase tracking-widest flex items-center gap-2"><History size={10}/> FLOW SOURCE</span><button onClick={()=>navigator.clipboard.writeText(yamlText)} className="text-[9px] font-black text-cyan-600 hover:text-white uppercase transition-colors">Copy</button></div>
                    <textarea className="flex-1 bg-transparent p-8 text-[11px] font-mono text-green-500/60 outline-none resize-none leading-relaxed custom-scrollbar" value={yamlText} onChange={e=>handleYamlChange(e.target.value)} spellCheck={false} placeholder="Paste flow.yml here to restore..."/>
                 </div>
              )}
           </div>
        </div>
      </div>

      {/* MODAL: Execution Progress */}
      {isModalOpen && workflow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
           <div className="w-[600px] bg-[#0c0c0c] border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden">
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-[#111]">
                 <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-black uppercase tracking-[0.3em] text-white flex items-center gap-2"><CircleDot size={12} className="text-cyan-500 animate-pulse"/> Workflow Execution</h3>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{workflow.status === 'finished' ? 'Success' : workflow.status === 'preparing' ? 'Preparing backend...' : 'Running workflow steps...'}</p>
                 </div>
                 <button onClick={() => { setIsModalOpen(false); setWorkflow(null); }} className="p-3 bg-white/5 rounded-full hover:bg-white/10 transition-colors"><X size={20}/></button>
              </div>
              <div className="p-8 flex-1 overflow-y-auto max-h-[450px] space-y-4 custom-scrollbar">
                 <div className="bg-black/40 p-5 rounded-2xl border border-white/5 flex flex-col gap-3">
                    <div className="flex justify-between items-end">
                       <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Progress</span>
                       <span className="text-lg font-black text-white font-mono">{Math.round((workflow.overall_completed / (workflow.overall_total || 1)) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                       <div className="h-full bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all duration-700" style={{ width: `${Math.round((workflow.overall_completed / (workflow.overall_total || 1)) * 100)}%` }} />
                    </div>
                 </div>
                 <div className="space-y-2">
                    {jobs.map((job, idx) => {
                       const st = workflow.jobStatuses[idx], isR = st?.status === 'processing', isD = st?.status === 'completed' || st?.status === 'job_done' || workflow.status === 'finished', isF = st?.status === 'failed' || st?.status === 'error'
                       const jobP = st ? Math.round((st.completed / (st.total || 1)) * 100) : 0
                       return (
                         <div key={job.id} className={cn("p-4 rounded-xl border flex flex-col gap-2 transition-all", isR ? "bg-cyan-500/5 border-cyan-500/20" : isD ? "bg-green-500/5 border-green-500/20 opacity-50" : "bg-white/5 border-transparent opacity-20")}>
                            <div className="flex justify-between items-center">
                               <div className="flex items-center gap-3">
                                  {isD ? <CheckCircle2 size={14} className="text-green-500"/> : isF ? <AlertCircle size={14} className="text-red-500"/> : isR ? <Loader2 size={14} className="text-cyan-500 animate-spin"/> : <div className="w-3.5 h-3.5 border border-white/20 rounded-full"/>}
                                  <span className="text-[11px] font-black text-white">{job.name}</span>
                               </div>
                               {isR && <span className="text-[9px] font-mono text-cyan-400">{jobP}%</span>}
                            </div>
                            {isR && <div className="h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${jobP}%` }} /></div>}
                         </div>
                       )
                    })}
                 </div>
              </div>
              <div className="p-8 bg-[#111] border-t border-white/5 flex justify-center">
                 <button onClick={() => { setIsModalOpen(false); setWorkflow(null); }} className={cn("px-12 py-3 rounded-full font-black text-xs tracking-widest transition-all shadow-lg", workflow.status === 'finished' ? "bg-green-600 hover:bg-green-500 text-white shadow-green-900/20" : "bg-white/5 text-gray-500 cursor-not-allowed")}>{workflow.status === 'finished' ? 'CLOSE' : 'EXECUTING...'}</button>
              </div>
           </div>
        </div>
      )}
    </div>
  )
}
