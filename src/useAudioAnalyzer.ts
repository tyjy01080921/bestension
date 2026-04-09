import { useRef, useState, useCallback, useEffect } from 'react'

const FFT_SIZE = 4096
const SAMPLE_RATE = 44100
// 100Hz ~ 4000Hz 대역 bin 인덱스 계산
const HZ_PER_BIN = SAMPLE_RATE / FFT_SIZE
const BIN_START = Math.floor(100 / HZ_PER_BIN)
const BIN_END = Math.ceil(4000 / HZ_PER_BIN)

// amplitude threshold: RMS < this → silent
const SILENCE_THRESHOLD_RMS = 0.01   // roughly -40dBFS
const SEGMENT_SIZE_MS = 100          // peak-energy 100ms window

// multi-hit protocol
const REQUIRED_HITS = 3              // average this many hits
const MIN_HIT_INTERVAL_MS = 400      // minimum gap between consecutive hits (ms)
const MAX_WAIT_MS = 10000            // give up waiting after 10 seconds

export type AudioStatus = 'idle' | 'listening' | 'captured' | 'error'

interface UseAudioAnalyzerReturn {
  status: AudioStatus
  errorMessage: string | null
  fftData: number[] | null           // captured spectrum, null until captured
  waveformData: number[]             // live waveform bars for visualization (0-255)
  hitCount: number                   // how many hits detected so far (0..REQUIRED_HITS)
  requiredHits: number               // total hits needed
  startListening: () => Promise<void>
  stopListening: () => void
  reset: () => void
}

export const REQUIRED_HITS_COUNT = REQUIRED_HITS

export function useAudioAnalyzer(): UseAudioAnalyzerReturn {
  const [status, setStatus] = useState<AudioStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fftData, setFftData] = useState<number[] | null>(null)
  const [waveformData, setWaveformData] = useState<number[]>(new Array(32).fill(128))
  const [hitCount, setHitCount] = useState(0)

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // per-hit: track segments and state
  const hitsRef = useRef<Float32Array[]>([])         // best segment per hit
  const currentSegmentsRef = useRef<Float32Array[]>([])  // segments for current hit window
  const capturingHitRef = useRef(false)              // currently in a hit capture window
  const lastHitTimeRef = useRef(0)                   // timestamp of last detected onset
  const segmentBufferRef = useRef<number[]>([])      // rolling sample buffer for current hit

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    ctxRef.current?.close()
    ctxRef.current = null
    streamRef.current = null
    analyserRef.current = null
    capturingHitRef.current = false
    hitsRef.current = []
    currentSegmentsRef.current = []
    segmentBufferRef.current = []
    lastHitTimeRef.current = 0
  }, [])

  // Clean up on unmount to release microphone
  useEffect(() => () => cleanup(), [cleanup])

  // Run FFT on a single segment (Float32Array of time-domain samples)
  const segmentToFft = useCallback((samples: Float32Array, sampleRate: number): Promise<number[]> => {
    const offline = new OfflineAudioContext(1, samples.length, sampleRate)
    const buffer = offline.createBuffer(1, samples.length, sampleRate)
    const plainArray = new Float32Array(samples.buffer.slice(0) as ArrayBuffer)
    buffer.copyToChannel(plainArray, 0)

    const src = offline.createBufferSource()
    src.buffer = buffer

    const offlineAnalyser = offline.createAnalyser()
    offlineAnalyser.fftSize = FFT_SIZE

    src.connect(offlineAnalyser)
    offlineAnalyser.connect(offline.destination)
    src.start()

    return offline.startRendering().then(() => {
      const floatFreq = new Float32Array(offlineAnalyser.frequencyBinCount)
      offlineAnalyser.getFloatFrequencyData(floatFreq)
      const slice = Array.from(floatFreq.slice(BIN_START, BIN_END + 1))
      return slice.map(v => (Math.max(-100, v) + 100) / 100)
    })
  }, [])

  // Pick the best (highest-RMS) segment from a list
  const pickBestSegment = useCallback((segments: Float32Array[]): Float32Array | null => {
    if (segments.length === 0) return null
    let bestIdx = 0
    let bestRms = 0
    for (let i = 0; i < segments.length; i++) {
      let sum = 0
      for (let j = 0; j < segments[i].length; j++) sum += segments[i][j] ** 2
      const rms = Math.sqrt(sum / segments[i].length)
      if (rms > bestRms) { bestRms = rms; bestIdx = i }
    }
    return segments[bestIdx]
  }, [])

  // Average multiple FFT spectra element-wise
  const averageFfts = useCallback((ffts: number[][]): number[] => {
    const len = ffts[0].length
    const result = new Array(len).fill(0)
    for (const fft of ffts) {
      for (let i = 0; i < len; i++) result[i] += fft[i]
    }
    return result.map(v => v / ffts.length)
  }, [])

  // Process all collected hits: FFT each best segment, average, emit
  const processHits = useCallback(async (hitSegments: Float32Array[]) => {
    const sampleRate = ctxRef.current?.sampleRate ?? SAMPLE_RATE
    cleanup()

    const ffts = await Promise.all(hitSegments.map(seg => segmentToFft(seg, sampleRate)))
    const averaged = averageFfts(ffts)

    setFftData(averaged)
    setStatus('captured')
  }, [cleanup, segmentToFft, averageFfts])

  const startListening = useCallback(async () => {
    try {
      setStatus('listening')
      setErrorMessage(null)
      setFftData(null)
      setHitCount(0)
      hitsRef.current = []
      currentSegmentsRef.current = []
      segmentBufferRef.current = []
      capturingHitRef.current = false
      lastHitTimeRef.current = 0

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const ctx = new AudioContext()
      ctxRef.current = ctx
      await ctx.resume()

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0.3
      analyserRef.current = analyser

      source.connect(analyser)

      const timeDomainData = new Float32Array(FFT_SIZE)
      const byteFreqData = new Uint8Array(analyser.frequencyBinCount)

      const segmentSamples = Math.floor((SEGMENT_SIZE_MS / 1000) * ctx.sampleRate)
      // timeout: give up after MAX_WAIT_MS if not enough hits detected
      maxWaitTimerRef.current = setTimeout(() => {
        if (hitsRef.current.length > 0) {
          // process whatever hits we got
          processHits(hitsRef.current)
        } else {
          cleanup()
          setStatus('idle')
        }
      }, MAX_WAIT_MS)

      const tick = () => {
        if (!analyserRef.current) return

        analyser.getFloatTimeDomainData(timeDomainData)
        analyser.getByteFrequencyData(byteFreqData)

        // update waveform visualization (downsample to 32 bars)
        const step = Math.floor(byteFreqData.length / 32)
        const bars = Array.from({ length: 32 }, (_, i) => byteFreqData[i * step] ?? 0)
        setWaveformData(bars)

        // RMS of time domain
        let sum = 0
        for (let i = 0; i < timeDomainData.length; i++) sum += timeDomainData[i] ** 2
        const rms = Math.sqrt(sum / timeDomainData.length)

        const now = performance.now()

        // onset detection: new hit if RMS exceeds threshold AND enough time since last hit
        if (!capturingHitRef.current && rms > SILENCE_THRESHOLD_RMS) {
          const timeSinceLast = now - lastHitTimeRef.current
          if (timeSinceLast >= MIN_HIT_INTERVAL_MS || lastHitTimeRef.current === 0) {
            capturingHitRef.current = true
            lastHitTimeRef.current = now
            currentSegmentsRef.current = []
            segmentBufferRef.current = []
          }
        }

        // collect segments during current hit window (100ms per segment)
        if (capturingHitRef.current) {
          for (let j = 0; j < timeDomainData.length; j++) {
            segmentBufferRef.current.push(timeDomainData[j])
          }
          while (segmentBufferRef.current.length >= segmentSamples) {
            currentSegmentsRef.current.push(
              new Float32Array(segmentBufferRef.current.splice(0, segmentSamples))
            )
          }

          // end hit window after SEGMENT_SIZE_MS * 4 = 400ms worth of segments
          if (currentSegmentsRef.current.length >= 4) {
            capturingHitRef.current = false
            const best = pickBestSegment(currentSegmentsRef.current)
            if (best) {
              hitsRef.current = [...hitsRef.current, best]
              const newCount = hitsRef.current.length
              setHitCount(newCount)

              if (newCount >= REQUIRED_HITS) {
                if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current)
                cancelAnimationFrame(rafRef.current)
                processHits(hitsRef.current)
                return  // stop tick loop
              }
            }
            currentSegmentsRef.current = []
            segmentBufferRef.current = []
          }
        }

        rafRef.current = requestAnimationFrame(tick)
      }

      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('denied')) {
        setErrorMessage('마이크 접근이 거부되었습니다. 브라우저 설정에서 마이크를 허용해주세요.')
      } else {
        setErrorMessage('마이크를 사용할 수 없습니다: ' + msg)
      }
      setStatus('error')
      cleanup()
    }
  }, [cleanup, processHits, pickBestSegment])

  const stopListening = useCallback(() => {
    if (hitsRef.current.length > 0) {
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current)
      cancelAnimationFrame(rafRef.current)
      processHits(hitsRef.current)
    } else {
      cleanup()
      setStatus('idle')
    }
  }, [cleanup, processHits])

  const reset = useCallback(() => {
    cleanup()
    setStatus('idle')
    setErrorMessage(null)
    setFftData(null)
    setWaveformData(new Array(32).fill(128))
    setHitCount(0)
  }, [cleanup])

  return { status, errorMessage, fftData, waveformData, hitCount, requiredHits: REQUIRED_HITS, startListening, stopListening, reset }
}
