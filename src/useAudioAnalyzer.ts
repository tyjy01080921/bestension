import { useRef, useState, useCallback, useEffect } from 'react'

// ── DSP 파라미터 ──────────────────────────────────────────────────────────────
// OfflineAudioContext 샘플레이트: 8kHz
// → 나이퀴스트 4kHz, 400-800Hz 대역통과에 충분
const OFFLINE_SAMPLE_RATE = 8000
const FFT_SIZE = 2048              // 8kHz에서 ~256ms 윈도우, 3.9Hz/bin
const HZ_PER_BIN = OFFLINE_SAMPLE_RATE / FFT_SIZE   // 3.906 Hz/bin
const BIN_START = Math.round(400 / HZ_PER_BIN)      // ≈ 102 (400Hz)
const BIN_END = Math.round(800 / HZ_PER_BIN)        // ≈ 205 (800Hz)
const BANDPASS_LOW = 400           // 체육관 배경 소음 · 프레임 진동(130-200Hz) 차단
const BANDPASS_HIGH = 800          // 스트링 기본 주파수 상한

// ── 타격 인식 파라미터 ────────────────────────────────────────────────────────
const SILENCE_THRESHOLD_RMS = 0.01  // 온셋 감지 임계값 (~-40dBFS)
const CAPTURE_WINDOW_MS = 300        // 타격 후 캡처 윈도우 (ms)
const REQUIRED_HITS = 5             // 수집할 타격 횟수
const MIN_HIT_INTERVAL_MS = 200     // 타격 간 최소 간격 (디바운스)
const MAX_WAIT_MS = 15000           // 전체 대기 타임아웃

export type AudioStatus = 'idle' | 'listening' | 'captured' | 'error'

interface UseAudioAnalyzerReturn {
  status: AudioStatus
  errorMessage: string | null
  fftData: number[] | null           // narrowband 스펙트럼 (400-800Hz, ~103개 빈)
  waveformData: number[]             // 실시간 파형 시각화 (0-255, 32개 바)
  hitCount: number                   // 현재까지 인식된 타격 수
  requiredHits: number               // 필요한 총 타격 수
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

  // 타격별 상태
  const hitsRef = useRef<Float32Array[]>([])      // 타격당 캡처된 오디오 세그먼트
  const capturingHitRef = useRef(false)           // 현재 캡처 윈도우 진행 중
  const lastHitTimeRef = useRef(0)                // 마지막 온셋 타임스탬프
  const segmentBufferRef = useRef<number[]>([])   // 현재 타격의 롤링 샘플 버퍼

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
    segmentBufferRef.current = []
    lastHitTimeRef.current = 0
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  /**
   * 단일 오디오 세그먼트 → narrowband FFT 스펙트럼 변환
   *
   * 파이프라인:
   * 1. OfflineAudioContext @ 8kHz (자동 리샘플링)
   * 2. BiquadFilter 체인: highpass(400Hz) → lowpass(800Hz)
   * 3. AnalyserNode (내장 Blackman 윈도우, FFT 2048)
   * 4. dB → 선형 진폭 변환
   * 5. 400-800Hz 빈 슬라이스 + 정규화
   */
  const segmentToNarrowbandFft = useCallback(
    (samples: Float32Array, nativeSampleRate: number): Promise<number[]> => {
      // 8kHz 오프라인 컨텍스트 길이: 캡처된 샘플을 8kHz로 리샘플한 예상 길이
      const offlineLength = Math.ceil(samples.length * (OFFLINE_SAMPLE_RATE / nativeSampleRate))
      const offline = new OfflineAudioContext(1, Math.max(offlineLength, FFT_SIZE), OFFLINE_SAMPLE_RATE)

      // 원본 레이트로 버퍼 생성 → 8kHz 컨텍스트가 렌더 시 자동 리샘플
      const buffer = offline.createBuffer(1, samples.length, nativeSampleRate)
      buffer.copyToChannel(new Float32Array(samples.buffer.slice(0) as ArrayBuffer), 0)

      const src = offline.createBufferSource()
      src.buffer = buffer

      // 대역통과 필터 체인 (400-800Hz)
      const highpass = offline.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = BANDPASS_LOW
      highpass.Q.value = 0.707  // Butterworth (-3dB at cutoff)

      const lowpass = offline.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = BANDPASS_HIGH
      lowpass.Q.value = 0.707

      const offlineAnalyser = offline.createAnalyser()
      offlineAnalyser.fftSize = FFT_SIZE
      // smoothingTimeConstant = 0: 순간 스냅샷 (과도 신호에 적합)
      offlineAnalyser.smoothingTimeConstant = 0

      src.connect(highpass)
      highpass.connect(lowpass)
      lowpass.connect(offlineAnalyser)
      offlineAnalyser.connect(offline.destination)
      src.start(0)

      return offline.startRendering().then(() => {
        const floatFreq = new Float32Array(offlineAnalyser.frequencyBinCount)
        offlineAnalyser.getFloatFrequencyData(floatFreq)

        // dB → 선형 진폭 (-Infinity 가드 포함)
        const linear = Array.from(floatFreq, db =>
          isFinite(db) ? Math.pow(10, db / 20) : 0
        )

        // 400-800Hz 대역 슬라이스
        const slice = linear.slice(BIN_START, BIN_END + 1)

        // 정규화: 최대값 기준으로 0-1 스케일
        const max = Math.max(...slice, 1e-10)
        return slice.map(v => v / max)
      })
    },
    []
  )

  /**
   * 수집된 모든 타격 세그먼트를 FFT 분석 후 원소별 평균을 내어
   * 최종 narrowband 스펙트럼을 확정합니다.
   */
  const processHits = useCallback(
    async (hitSegments: Float32Array[]) => {
      const nativeSampleRate = ctxRef.current?.sampleRate ?? 44100
      cleanup()

      const ffts = await Promise.all(
        hitSegments.map(seg => segmentToNarrowbandFft(seg, nativeSampleRate))
      )

      // 원소별 평균 (다중 타격 노이즈 평균화)
      const len = ffts[0].length
      const averaged = new Array(len).fill(0)
      for (const fft of ffts) {
        for (let i = 0; i < len; i++) averaged[i] += fft[i]
      }
      const result = averaged.map(v => v / ffts.length)

      setFftData(result)
      setStatus('captured')
    },
    [cleanup, segmentToNarrowbandFft]
  )

  const startListening = useCallback(async () => {
    try {
      setStatus('listening')
      setErrorMessage(null)
      setFftData(null)
      setHitCount(0)
      hitsRef.current = []
      segmentBufferRef.current = []
      capturingHitRef.current = false
      lastHitTimeRef.current = 0

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const ctx = new AudioContext()
      ctxRef.current = ctx
      await ctx.resume()

      const source = ctx.createMediaStreamSource(stream)

      // 실시간 파형 시각화용 analyser (원본 레이트, 전대역)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.3
      analyserRef.current = analyser
      source.connect(analyser)

      const timeDomainData = new Float32Array(analyser.fftSize)
      const byteFreqData = new Uint8Array(analyser.frequencyBinCount)

      // 300ms 캡처 윈도우 = native sampleRate × 0.3초
      const segmentSamples = Math.floor((CAPTURE_WINDOW_MS / 1000) * ctx.sampleRate)

      // 타임아웃: 충분한 타격이 수집되지 않으면 처리
      maxWaitTimerRef.current = setTimeout(() => {
        if (hitsRef.current.length > 0) {
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

        // 파형 시각화 업데이트 (32개 바로 다운샘플)
        const step = Math.floor(byteFreqData.length / 32)
        const bars = Array.from({ length: 32 }, (_, i) => byteFreqData[i * step] ?? 0)
        setWaveformData(bars)

        // RMS 계산으로 온셋 감지
        let sum = 0
        for (let i = 0; i < timeDomainData.length; i++) sum += timeDomainData[i] ** 2
        const rms = Math.sqrt(sum / timeDomainData.length)

        const now = performance.now()

        // 온셋 트리거: RMS 임계값 초과 + 최소 간격 경과
        if (!capturingHitRef.current && rms > SILENCE_THRESHOLD_RMS) {
          const timeSinceLast = now - lastHitTimeRef.current
          if (timeSinceLast >= MIN_HIT_INTERVAL_MS || lastHitTimeRef.current === 0) {
            capturingHitRef.current = true
            lastHitTimeRef.current = now
            segmentBufferRef.current = []
          }
        }

        // 캡처 윈도우: 300ms분 샘플 축적
        if (capturingHitRef.current) {
          for (let j = 0; j < timeDomainData.length; j++) {
            segmentBufferRef.current.push(timeDomainData[j])
          }

          if (segmentBufferRef.current.length >= segmentSamples) {
            // 캡처 완료: 첫 segmentSamples개만 사용
            const captured = new Float32Array(segmentBufferRef.current.slice(0, segmentSamples))
            capturingHitRef.current = false
            segmentBufferRef.current = []

            hitsRef.current = [...hitsRef.current, captured]
            const newCount = hitsRef.current.length
            setHitCount(newCount)

            if (newCount >= REQUIRED_HITS) {
              if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current)
              cancelAnimationFrame(rafRef.current)
              processHits(hitsRef.current)
              return  // tick 루프 종료
            }
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
  }, [cleanup, processHits])

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

  return {
    status,
    errorMessage,
    fftData,
    waveformData,
    hitCount,
    requiredHits: REQUIRED_HITS,
    startListening,
    stopListening,
    reset,
  }
}
