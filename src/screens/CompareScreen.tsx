import { useEffect, useRef, useState } from 'react'
import {
  getBestSound,
  getComparisonHistory,
  saveComparisonSound,
  type Racket,
  type SoundProfile,
  centroidHzFromFft,
} from '../db'
import { useAudioAnalyzer } from '../useAudioAnalyzer'
import { cosineSimilarity, calculateTensionRetention, formatTensionMessage } from '../similarity'
import { generateId, formatDate, matchColor, tensionColor } from '../utils'
import Waveform from '../components/Waveform'

interface Props {
  racket: Racket
  onBack: () => void
}

type CompareStep = 'ready' | 'recording' | 'result'

export default function CompareScreen({ racket, onBack }: Props) {
  const [best, setBest] = useState<SoundProfile | null>(null)
  const [history, setHistory] = useState<SoundProfile[]>([])
  const [step, setStep] = useState<CompareStep>('ready')
  const [matchPct, setMatchPct] = useState<number | null>(null)
  const [tensionPct, setTensionPct] = useState<number | null>(null)
  const [newFft, setNewFft] = useState<number[] | null>(null)
  const savedRef = useRef(false)
  const bestRef = useRef<SoundProfile | null>(null)

  const { status, errorMessage, fftData, waveformData, hitCount, requiredHits, startListening, stopListening, reset } = useAudioAnalyzer()

  const load = async () => {
    const b = await getBestSound(racket.id)
    setBest(b ?? null)
    bestRef.current = b ?? null
    const h = await getComparisonHistory(racket.id)
    setHistory(h)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (status !== 'captured' || !fftData) return
    if (savedRef.current) return
    if (!bestRef.current) return

    savedRef.current = true
    setNewFft(fftData)

    // 지각적 일치율: 코사인 유사도 (소리 지문 전체 비교)
    const pct = cosineSimilarity(bestRef.current.fftData, fftData)
    setMatchPct(pct)

    // 물리적 텐션 유지율: 스펙트럴 센트로이드 비율²
    const bestHz = centroidHzFromFft(bestRef.current.fftData)
    const currentHz = centroidHzFromFft(fftData)
    const tPct = calculateTensionRetention(bestHz, currentHz)
    setTensionPct(tPct)

    setStep('result')

    saveComparisonSound({
      id: generateId(),
      racketId: racket.id,
      type: 'comparison',
      fftData,
      recordedAt: Date.now(),
      matchPct: pct,
      tensionPct: tPct,
    }).then(load)
  }, [status, fftData])

  const handleStartRecord = async () => {
    savedRef.current = false
    setStep('recording')
    reset()
    await startListening()
  }

  const handleRetry = () => {
    savedRef.current = false
    setStep('ready')
    setMatchPct(null)
    setTensionPct(null)
    setNewFft(null)
    reset()
  }

  const fftToWaveform = (data: number[]) =>
    Array.from({ length: 32 }, (_, i) => {
      const idx = Math.floor((i / 32) * data.length)
      return Math.round(data[idx] * 255)
    })

  if (!best) {
    return (
      <div className="flex flex-col min-h-full bg-[#111] px-5">
        <div className="pt-12 pb-4 flex items-center gap-3">
          <button onClick={onBack} className="text-white/50 text-xl p-1">‹</button>
          <h1 className="text-xl font-bold">비교하기</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-white/40 text-sm">베스트 사운드가 아직 없어요.<br/>먼저 녹음해주세요.</p>
          <button onClick={onBack} className="mt-6 py-3 px-6 rounded-xl bg-white text-black text-sm font-bold">
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  // 베스트 사운드의 스펙트럴 센트로이드 Hz
  const bestCentroidHz = Math.round(centroidHzFromFft(best.fftData))

  // 현재 비교 결과의 센트로이드 Hz
  const currentCentroidHz = newFft ? Math.round(centroidHzFromFft(newFft)) : null

  // 텐션 메시지
  const tensionMsg = tensionPct !== null && currentCentroidHz !== null
    ? formatTensionMessage(tensionPct, bestCentroidHz, currentCentroidHz)
    : null

  return (
    <div className="flex flex-col min-h-full bg-[#111]">
      <div className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-white/50 text-xl p-1">‹</button>
        <div>
          <h1 className="text-xl font-bold">사운드 비교</h1>
          <p className="text-xs text-white/40">{racket.name}</p>
        </div>
      </div>

      <div className="flex-1 px-5 pb-10 space-y-4 overflow-y-auto">

        {/* 베스트 사운드 */}
        <div>
          <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">
            🏆 베스트 사운드 · {formatDate(best.recordedAt)}
          </p>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3">
            <Waveform data={fftToWaveform(best.fftData)} color="#60a5fa" height={48} />
            <p className="text-center text-xs text-blue-300/60 mt-1.5">
              스펙트럼 중심 {bestCentroidHz} Hz
            </p>
          </div>
        </div>

        {/* 새 스트링 */}
        <div>
          <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">
            🎾 새 스트링
          </p>
          <div className={`rounded-2xl p-3 border ${
            step === 'result'
              ? 'bg-orange-500/10 border-orange-500/20'
              : 'bg-white/5 border-white/10'
          }`}>
            <Waveform
              data={step === 'result' && newFft ? fftToWaveform(newFft) : waveformData}
              color={step === 'result' ? '#fb923c' : (status === 'listening' ? '#ffffff' : '#ffffff22')}
              height={48}
            />
            {step === 'result' && currentCentroidHz !== null && (
              <p className="text-center text-xs text-orange-300/60 mt-1.5">
                스펙트럼 중심 {currentCentroidHz} Hz
              </p>
            )}
          </div>
        </div>

        {/* 타격 진행 도트 */}
        {step === 'recording' && status === 'listening' && (
          <div className="flex justify-center gap-3">
            {Array.from({ length: requiredHits }, (_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                  i < hitCount ? 'bg-green-400 scale-110' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        )}

        {/* 오류 */}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 text-sm text-red-400">
            {errorMessage}
          </div>
        )}

        {/* 결과: 이중 지표 */}
        {step === 'result' && matchPct !== null && tensionPct !== null && (
          <div className="space-y-3">

            {/* 사운드 유사도 (코사인 유사도 — 지각적) */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">
                사운드 유사도
              </p>
              <div className="flex items-baseline gap-1">
                <span
                  className="text-5xl font-black tracking-tighter"
                  style={{ color: matchColor(matchPct) }}
                >
                  {matchPct}
                </span>
                <span className="text-xl font-normal text-white/30">%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${matchPct}%`, background: matchColor(matchPct) }}
                />
              </div>
              <p className="text-xs text-white/25 mt-1.5">소리 지문 전체 일치율 ({requiredHits}번 평균)</p>
            </div>

            {/* 텐션 유지율 (스펙트럴 센트로이드 — 물리적) */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">
                추정 텐션 유지율
              </p>
              <div className="flex items-baseline gap-1">
                <span
                  className="text-5xl font-black tracking-tighter"
                  style={{ color: tensionColor(tensionPct) }}
                >
                  {tensionPct > 100 ? '>100' : tensionPct}
                </span>
                <span className="text-xl font-normal text-white/30">%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${Math.min(tensionPct, 100)}%`,
                    background: tensionColor(tensionPct),
                  }}
                />
              </div>
              {tensionMsg && (
                <div className="mt-2 space-y-0.5">
                  <p className="text-xs text-white/50">{tensionMsg.primary}</p>
                  <p className="text-xs text-white/30">{tensionMsg.secondary}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 액션 버튼 */}
        {step === 'ready' && (
          <button
            onClick={handleStartRecord}
            className="w-full py-4 rounded-2xl bg-white text-black font-bold text-sm"
          >
            새 스트링 녹음하기
          </button>
        )}

        {step === 'recording' && (
          <button
            onClick={stopListening}
            className="w-full py-4 rounded-2xl bg-red-500 text-white font-bold text-sm animate-pulse"
          >
            {hitCount === 0
              ? `줄을 ${requiredHits}번 쳐주세요`
              : `${hitCount}/${requiredHits}번 — 계속 쳐주세요`}
          </button>
        )}

        {step === 'result' && (
          <button
            onClick={handleRetry}
            className="w-full py-3 rounded-2xl bg-white/5 text-white/40 text-sm"
          >
            다시 녹음
          </button>
        )}

        {/* 히스토리 */}
        {history.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-semibold text-white/40 mb-2">비교 히스토리</p>
            <div className="bg-white/5 rounded-2xl overflow-hidden">
              {history.map((h, i) => (
                <div
                  key={h.id}
                  className={`flex justify-between items-center px-4 py-3 ${
                    i < history.length - 1 ? 'border-b border-white/5' : ''
                  }`}
                >
                  <span className="text-xs text-white/40">{formatDate(h.recordedAt)}</span>
                  <div className="flex gap-3">
                    {h.matchPct !== undefined && (
                      <span className="text-xs" style={{ color: matchColor(h.matchPct) }}>
                        유사 {h.matchPct}%
                      </span>
                    )}
                    {h.tensionPct !== undefined && (
                      <span className="text-xs font-bold" style={{ color: tensionColor(h.tensionPct) }}>
                        텐션 {h.tensionPct > 100 ? '>100' : h.tensionPct}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
