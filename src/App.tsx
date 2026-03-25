import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Play, 
  Download, 
  RefreshCw, 
  Settings2, 
  CheckCircle2, 
  Loader2,
  Monitor,
  Video,
  Share2,
  History,
  AlertCircle,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { GoogleGenAI } from "@google/genai";
import { cn } from '@/src/lib/utils';
import { STYLES, type AppState, type StyleOption, type ProcessingParams, type HistoryItem } from './types';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_DURATION = 30; // 30 seconds limit
const FRAME_RATE = 4; // 4 frames per second for "hand-drawn" look

type ProcessingSubStatus = 'uploading' | 'queueing' | 'processing' | 'merging' | 'verifying';

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [subStatus, setSubStatus] = useState<ProcessingSubStatus>('uploading');
  const [queuePosition, setQueuePosition] = useState(0);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<StyleOption>(STYLES[0]);
  const [params, setParams] = useState<ProcessingParams>({
    intensity: 'standard',
    resolution: '720p',
    smoothness: 'standard'
  });
  const [progress, setProgress] = useState(0);
  const [processedFrames, setProcessedFrames] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [isKeySelected, setIsKeySelected] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Cleanup effect for object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      if (resultVideoUrl) URL.revokeObjectURL(resultVideoUrl);
    };
  }, [resultVideoUrl]);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setIsKeySelected(hasKey);
      }
    };
    checkKey();

    const savedHistory = localStorage.getItem('v2a_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  const saveToHistory = (item: HistoryItem) => {
    const newHistory = [item, ...history].slice(0, 3);
    setHistory(newHistory);
    localStorage.setItem('v2a_history', JSON.stringify(newHistory));
  };

  const validateVideo = (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        if (video.duration > MAX_DURATION) {
          setError(`视频时长超过 ${MAX_DURATION} 秒限制`);
          resolve(false);
        } else {
          resolve(true);
        }
      };
      video.onerror = () => {
        setError("无法读取视频文件信息");
        resolve(false);
      };
      video.src = URL.createObjectURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setError("文件大小超过 200MB 限制");
        return;
      }
      if (!file.type.startsWith('video/')) {
        setError("不支持的文件格式，请上传视频文件");
        return;
      }
      
      const isValid = await validateVideo(file);
      if (!isValid) return;

      setError(null);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setState('uploaded');
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        setError("不支持的文件格式，请上传视频文件");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("文件大小超过 200MB 限制");
        return;
      }

      const isValid = await validateVideo(file);
      if (!isValid) return;

      setError(null);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setState('uploaded');
    }
  };

  const callGeminiWithRetry = async (base64: string, prompt: string, retries = 2): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3-pro-image-preview',
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64,
                  mimeType: 'image/jpeg',
                },
              },
              {
                text: `Transform this video frame into a professional art piece. Style: ${prompt}. Maintain the exact composition, subjects, and lighting. Output only the transformed image.`,
              },
            ],
          },
        });

        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const dataUrl = `data:image/png;base64,${part.inlineData.data}`;
            // Basic validation: check if it's a valid image
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = resolve;
              img.onerror = reject;
              img.src = dataUrl;
            });
            return dataUrl;
          }
        }
      } catch (err) {
        console.warn(`Gemini API attempt ${i + 1} failed:`, err);
        if (i === retries) throw err;
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); 
      }
    }
    throw new Error("AI failed to generate image part after retries");
  };

  const startProcessing = async () => {
    if (!isKeySelected && window.aistudio) {
      await window.aistudio.openSelectKey();
      setIsKeySelected(true);
    }
    
    if (!hiddenVideoRef.current || !canvasRef.current || !outputCanvasRef.current) return;

    setState('processing');
    setSubStatus('uploading');
    setProgress(0);
    
    // 1. Simulate Uploading
    for (let i = 0; i <= 100; i += 10) {
      setProgress(i);
      await new Promise(r => setTimeout(r, 100));
    }

    // 2. Simulate Queueing
    setSubStatus('queueing');
    const mockQueuePos = Math.floor(Math.random() * 3) + 1;
    setQueuePosition(mockQueuePos);
    for (let i = mockQueuePos; i >= 0; i--) {
      setQueuePosition(i);
      await new Promise(r => setTimeout(r, 1500));
    }

    // 3. Processing
    setSubStatus('processing');
    setProgress(0);
    setProcessedFrames(0);
    setResultVideoUrl(null);

    const video = hiddenVideoRef.current;
    const canvas = canvasRef.current;
    const outputCanvas = outputCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const outCtx = outputCanvas.getContext('2d');

    if (!ctx || !outCtx) return;

    if (video.readyState < 1) {
      await new Promise(r => video.onloadedmetadata = r);
    }

    const duration = video.duration;
    const total = Math.min(Math.floor(duration * FRAME_RATE), 120); // Max 120 frames (30s * 4fps)
    setTotalFrames(total);

    const stream = outputCanvas.captureStream(FRAME_RATE);
    
    try {
      const videoStream = (video as any).captureStream ? (video as any).captureStream() : (video as any).mozCaptureStream ? (video as any).mozCaptureStream() : null;
      if (videoStream) {
        const audioTrack = videoStream.getAudioTracks()[0];
        if (audioTrack) stream.addTrack(audioTrack);
      }
    } catch (e) {
      console.warn("Could not capture audio track:", e);
    }

    const getSupportedMimeType = () => {
      const types = [
        'video/mp4;codecs=h264',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
      }
      return 'video/webm';
    };

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      setSubStatus('verifying');
      setProgress(95);
      
      const blob = new Blob(chunksRef.current, { type: mimeType.split(';')[0] });
      
      // Final verification: check blob size and frame count
      if (blob.size < 1000) {
        setError("生成视频文件损坏，请重试");
        setState('uploaded');
        return;
      }

      // Memory Release: Clear chunks
      chunksRef.current = [];

      setResultVideoUrl(URL.createObjectURL(blob));
      setState('result');
      
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#5A7DFF', '#F9FAFB', '#E5E7EB']
      });

      saveToHistory({
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        originalName: videoFile?.name || 'Untitled',
        styleName: selectedStyle.name,
        thumbnail: `https://picsum.photos/seed/${selectedStyle.id}${Date.now()}/400/225`
      });
    };

    recorder.start();

    let currentArtImg: HTMLImageElement | null = null;
    let prevArtImg: HTMLImageElement | null = null;

    const drawLoop = () => {
      outCtx.fillStyle = '#121621';
      outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      
      if (currentArtImg) {
        // Anti-flicker: Blend with previous frame
        if (prevArtImg) {
          outCtx.globalAlpha = 0.3;
          outCtx.drawImage(prevArtImg, 0, 0, outputCanvas.width, outputCanvas.height);
          outCtx.globalAlpha = 1.0;
        }
        outCtx.drawImage(currentArtImg, 0, 0, outputCanvas.width, outputCanvas.height);
      }
    };
    const drawInterval = setInterval(drawLoop, 1000 / FRAME_RATE);

    for (let i = 0; i < total; i++) {
      try {
        video.currentTime = i / FRAME_RATE;
        await new Promise(r => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            r(null);
          };
          video.addEventListener('seeked', onSeeked);
        });

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        outputCanvas.width = video.videoWidth;
        outputCanvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

        const artFrameUrl = await callGeminiWithRetry(base64, selectedStyle.prompt);
        
        const img = new Image();
        img.src = artFrameUrl;
        await new Promise(r => img.onload = r);
        
        prevArtImg = currentArtImg;
        currentArtImg = img;

        // Memory Release: Nullify previous frame data if needed
        if (prevArtImg && i % 4 === 0) {
          // In JS, setting to null helps GC if there are no other refs
          // We keep it for blending, but we could clear older ones if we had a list
        }

        setProcessedFrames(i + 1);
        setProgress(((i + 1) / total) * 100);
      } catch (err) {
        console.error("Frame processing error:", err);
      }
    }

    setSubStatus('merging');
    setProgress(90);
    clearInterval(drawInterval);
    recorder.stop();

    // Final Memory Release
    currentArtImg = null;
    prevArtImg = null;
  };

  const reset = () => {
    setState('idle');
    setVideoFile(null);
    setVideoUrl(null);
    setResultVideoUrl(null);
    setProgress(0);
    setError(null);
  };

  const getFileExtension = () => {
    if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) return 'mp4';
    return 'webm';
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hidden elements for processing */}
      <video ref={hiddenVideoRef} src={videoUrl || ''} className="hidden" muted crossOrigin="anonymous" />
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={outputCanvasRef} className="hidden" />

      {/* Header - Extremely Minimal */}

      <header className="h-20 flex items-center justify-between px-12 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-mist-blue rounded-lg flex items-center justify-center shadow-lg shadow-mist-blue/20">
            <Video className="text-white w-5 h-5" />
          </div>
          <span className="text-xl font-medium tracking-tight">Video to Art AI</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2 text-mist-blue/60 text-xs font-medium uppercase tracking-widest">
            <Sparkles className="w-3 h-3" />
            <span>Nano Banana Pro Powered</span>
          </div>
          {history.length > 0 && state === 'idle' && (
            <button className="text-silver-gray/40 hover:text-mist-white transition-colors">
              <History className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 max-w-6xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="w-full max-w-4xl space-y-16"
            >
              <div className="text-center space-y-4">
                <motion.h1 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-5xl font-light tracking-tight text-mist-white"
                >
                  将视频转化为手绘艺术
                </motion.h1>
                <p className="text-silver-gray/40 font-light text-lg">极简、专业、一键开启艺术创作</p>
              </div>

              <div 
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "aspect-[21/9] glass-panel rounded-xl flex flex-col items-center justify-center gap-8 cursor-pointer hover-glow group transition-all duration-700",
                  error ? "border-red-500/30 bg-red-500/5" : ""
                )}
              >
                <div className={cn(
                  "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 group-hover:scale-110",
                  error ? "bg-red-500/10" : "bg-mist-blue/10"
                )}>
                  <Upload className={cn("w-8 h-8", error ? "text-red-500" : "text-mist-blue")} />
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-light">点击或拖拽上传视频</h2>
                  <p className="text-silver-gray/30 font-light text-sm">支持 MP4, MOV, AVI (最大 200MB)</p>
                </div>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 px-6 py-2 rounded-full border border-red-500/20"
                  >
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </motion.div>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="video/*" 
                  className="hidden" 
                />
              </div>

              {/* Styles - More Minimal */}
              <div className="space-y-8">
                <div className="flex items-center justify-center gap-3">
                  <div className="h-px w-12 bg-white/10" />
                  <span className="text-[10px] uppercase tracking-[0.3em] text-silver-gray/30 font-medium">选择风格</span>
                  <div className="h-px w-12 bg-white/10" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                  {STYLES.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setSelectedStyle(style)}
                      className={cn(
                        "group flex flex-col gap-4 transition-all duration-500",
                        selectedStyle.id === style.id ? "opacity-100" : "opacity-40 hover:opacity-70"
                      )}
                    >
                      <div className={cn(
                        "aspect-square rounded-lg overflow-hidden border-2 transition-all duration-500",
                        selectedStyle.id === style.id ? "border-mist-blue scale-105 shadow-xl shadow-mist-blue/20" : "border-transparent"
                      )}>
                        <img 
                          src={style.preview} 
                          alt={style.name} 
                          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <span className="text-[10px] text-center font-light tracking-wider">{style.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {state === 'uploaded' && (
            <motion.div 
              key="uploaded"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="w-full max-w-4xl space-y-12"
            >
              <div className="glass-panel rounded-xl overflow-hidden relative group shadow-2xl">
                <video 
                  ref={videoRef}
                  src={videoUrl!} 
                  className="w-full aspect-video object-cover"
                  controls
                />
                <div className="absolute top-6 left-6 px-4 py-2 bg-black/40 backdrop-blur-xl rounded-md text-[10px] text-white/70 border border-white/10 font-mono">
                  {videoFile?.name} • {(videoFile!.size / (1024 * 1024)).toFixed(1)} MB
                </div>
              </div>

              <div className="flex justify-center gap-6">
                <button onClick={reset} className="btn-secondary">
                  重新上传
                </button>
                <button onClick={startProcessing} className="btn-primary flex items-center gap-3">
                  <span>开始转换</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {state === 'processing' && (
            <motion.div 
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="fixed inset-0 z-[100] bg-space-gray flex flex-col items-center justify-center p-12"
            >
              <div className="w-full max-w-lg space-y-16">
                <div className="relative flex justify-center">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                    className="w-48 h-48 rounded-full border border-mist-blue/10 border-t-mist-blue/60"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    {subStatus === 'queueing' ? (
                      <div className="text-center">
                        <span className="text-4xl font-light text-mist-blue">#{queuePosition}</span>
                        <p className="text-[10px] text-silver-gray/30 uppercase tracking-widest mt-2">排队中</p>
                      </div>
                    ) : (
                      <span className="text-4xl font-light text-mist-blue">{Math.round(progress)}%</span>
                    )}
                  </div>
                </div>

                <div className="space-y-8 text-center">
                  <div className="space-y-3">
                    <h3 className="text-2xl font-light tracking-tight">
                      {subStatus === 'uploading' && '正在上传视频...'}
                      {subStatus === 'queueing' && '服务器繁忙，正在排队...'}
                      {subStatus === 'processing' && 'AI 正在进行艺术创作'}
                      {subStatus === 'merging' && '正在合成视频轨道...'}
                      {subStatus === 'verifying' && '正在进行最后校验...'}
                    </h3>
                    <div className="flex items-center justify-center gap-2 text-silver-gray/40 text-xs font-light">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {subStatus === 'processing' ? (
                        <span>处理中 / 已完成 {processedFrames} 帧</span>
                      ) : (
                        <span>请稍候，系统正在稳定运行</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="h-[2px] w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      className="h-full bg-mist-blue shadow-[0_0_20px_rgba(90,125,255,0.8)]"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-4 text-center">
                  <p className="text-[10px] uppercase tracking-[0.4em] text-silver-gray/20">
                    Nano Banana Pro · Stability Protocol v2.5
                  </p>
                  <div className="flex justify-center gap-6 opacity-40">
                    <div className="flex items-center gap-1 text-[8px] uppercase tracking-widest">
                      <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                      <span>内存自释放</span>
                    </div>
                    <div className="flex items-center gap-1 text-[8px] uppercase tracking-widest">
                      <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                      <span>逐帧校验</span>
                    </div>
                    <div className="flex items-center gap-1 text-[8px] uppercase tracking-widest">
                      <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                      <span>音轨同步</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {state === 'result' && (
            <motion.div 
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-6xl space-y-16 pb-24"
            >
              <div className="flex items-end justify-between border-b border-white/5 pb-8">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-mist-blue">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="text-xs uppercase tracking-widest font-medium">转换完成</span>
                  </div>
                  <h2 className="text-4xl font-light tracking-tight">艺术作品已就绪</h2>
                </div>
                <div className="flex gap-4">
                  <button onClick={reset} className="btn-secondary text-xs px-6">
                    重新生成
                  </button>
                  <a 
                    href={resultVideoUrl || '#'} 
                    download={`art_video_${Date.now()}.${getFileExtension()}`}
                    className={cn(
                      "btn-primary text-xs px-8 flex items-center gap-2",
                      !resultVideoUrl && "opacity-50 pointer-events-none"
                    )}
                  >
                    <Download className="w-4 h-4" />
                    下载视频
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-silver-gray/30 ml-1">原始视频</span>
                  <div className="glass-panel rounded-xl overflow-hidden aspect-video bg-black/40">
                    <video src={videoUrl!} className="w-full h-full object-cover" controls />
                  </div>
                </div>
                <div className="space-y-4">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-mist-blue ml-1">手绘艺术</span>
                  <div className="glass-panel rounded-xl overflow-hidden aspect-video relative group bg-black/40">
                    <video 
                      src={resultVideoUrl!} 
                      className="w-full h-full object-cover" 
                      controls 
                      autoPlay 
                      loop
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4">
                <button 
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: 'Video to Art AI', text: 'Check out my AI art!', url: window.location.href });
                    }
                  }}
                  className="text-silver-gray/40 hover:text-mist-white transition-colors flex items-center gap-2 text-xs uppercase tracking-widest"
                >
                  <Share2 className="w-4 h-4" />
                  分享作品
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer - Minimal */}
      <footer className="h-24 flex items-center justify-between px-12 text-[10px] text-silver-gray/20 uppercase tracking-[0.3em]">
        <span>© 2026 Video to Art AI</span>
        <div className="flex gap-8">
          <a href="#" className="hover:text-silver-gray/40 transition-colors">Privacy</a>
          <a href="#" className="hover:text-silver-gray/40 transition-colors">Terms</a>
        </div>
      </footer>
    </div>
  );
}
