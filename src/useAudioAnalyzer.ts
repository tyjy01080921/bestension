import { useRef, useState, useCallback } from 'react'

const FFT_SIZE = 4096
const SAMPLE_RATE = 44100
// 100Hz ~ 4000Hz 대역 bin 인덱스 계산
const HZ_PER_BIN = SAMPLE_RATE / FFT_SIZE
const BIN_START = Math.floor(100 / HZ_PER_BIN)
const BIN_END = Math.ceil(4000 / HZ_PER_BIN)

// amplitude threshold: RMS < this → silent
const SILENCE_THRESHOLD_RMS = 0.01   // roughly -40dBFS
const CAPTURE_DURATION_MS = 2000     // 2초 — 줄 소리 충분히 담기
const SEGMENT_SIZE_MS = 100          // peak-energy 100ms window

export type AudioStatus = 'idle' | 'listening' | 'captured' | 'error'

interface UseAudioAnalyzerReturn {
  status: AudioStatus
  errorMessage: string | null
  fftData: number[] | null           // captured spectrum, null until captured
  waveformData: number[]             // live waveform bars for visualization (0-255)
  startListening: () => Promise<void>
  stopListening: () => void
  reset: () => void
}

export function useAudioAnalyzer(): UseAudioAnalyzerReturn {
  const [status, setStatus] = useState<AudioStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fftData, setFftData] = useState<number[] | null>(null)
  const [waveformData, setWaveformData] = useState<number[]>(new Array(32).fill(128))

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // segments collected during CAPTURE_DURATION_MS
  const segmentsRef = useRef<Float32Array[]>([])
  const capturingRef = useRef(false)

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    ctxRef.current?.close()
    ctxRef.current = null
    streamRef.current = null
    analyserRef.current = null
    capturingRef.current = false
    segmentsRef.current = []
  }, [])

  const processCapture = useCallback((segments: Float32Array[]) => {
    if (segments.length === 0) return

    const analyser = analyserRef.current
    if (!analyser) return

    // find the segment with highest RMS (peak-energy 100ms window)
    let bestIdx = 0
    let bestRms = 0
    for (let i = 0; i < segments.length; i++) {
      let sum = 0
      for (let j = 0; j < segments[i].length; j++) sum += segments[i][j] ** 2
      const rms = Math.sqrt(sum / segments[i].length)
      if (rms > bestRms) { bestRms = rms; bestIdx = i }
    }

    // re-run FFT on best segment by feeding it into a fresh offline context
    const sampleRate = ctxRef.current?.sampleRate ?? SAMPLE_RATE
    const segmentSamples = segments[bestIdx]
    const offline = new OfflineAudioContext(1, segmentSamples.length, sampleRate)
    const buffer = offline.createBuffer(1, segmentSamples.length, sampleRate)
    // copy via plain ArrayBuffer to avoid SharedArrayBuffer type mismatch
    const plainArray = new Float32Array(segmentSamples.buffer.slice(0) as ArrayBuffer)
    buffer.copyToChannel(plainArray, 0)

    const src = offline.createBufferSource()
    src.buffer = buffer

    const offlineAnalyser = offline.createAnalyser()
    offlineAnalyser.fftSize = FFT_SIZE

    src.connect(offlineAnalyser)
    offlineAnalyser.connect(offline.destination)
    src.start()

    offline.startRendering().then(() => {
      const floatFreq = new Float32Array(offlineAnalyser.frequencyBinCount)
      offlineAnalyser.getFloatFrequencyData(floatFreq)

      // extract 100-4000Hz bins, normalize to 0..1
      const slice = Array.from(floatFreq.slice(BIN_START, BIN_END + 1))
      // shift from [-Inf..0] dB range to positive by clamping to [-100, 0] then normalizing
      const normalized = slice.map(v => (Math.max(-100, v) + 100) / 100)

      setFftData(normalized)
      setStatus('captured')
      cleanup()
    })
  }, [cleanup])

  const startListening = useCallback(async () => {
    try {
      setStatus('listening')
      setErrorMessage(null)
      setFftData(null)
      segmentsRef.current = []
      capturingRef.current = false

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      // AudioContext must be created inside a user gesture handler
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
      let segmentBuffer: number[] = []

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

        // auto-trigger capture on sound
        if (!capturingRef.current && rms > SILENCE_THRESHOLD_RMS) {
          capturingRef.current = true
          segmentsRef.current = []
          segmentBuffer = []

          captureTimerRef.current = setTimeout(() => {
            // flush remaining segment
            if (segmentBuffer.length > 0) {
              segmentsRef.current.push(new Float32Array(segmentBuffer))
            }
            processCapture(segmentsRef.current)
          }, CAPTURE_DURATION_MS)
        }

        // collect segment data during capture
        if (capturingRef.current) {
          segmentBuffer.push(...Array.from(timeDomainData))
          while (segmentBuffer.length >= segmentSamples) {
            segmentsRef.current.push(new Float32Array(segmentBuffer.splice(0, segmentSamples)))
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
  }, [cleanup, processCapture])

  const stopListening = useCallback(() => {
    // manual trigger: process whatever we have
    if (capturingRef.current && segmentsRef.current.length > 0) {
      processCapture(segmentsRef.current)
    } else if (capturingRef.current) {
      cleanup()
      setStatus('idle')
    } else {
      cleanup()
      setStatus('idle')
    }
  }, [cleanup, processCapture])

  const reset = useCallback(() => {
    cleanup()
    setStatus('idle')
    setErrorMessage(null)
    setFftData(null)
    setWaveformData(new Array(32).fill(128))
  }, [cleanup])

  return { status, errorMessage, fftData, waveformData, startListening, stopListening, reset }
}
