import { useEffect, useRef, useState } from 'react'
import { getBestSound, getComparisonHistory, saveComparisonSound, type Racket, type SoundProfile } from '../db'
import { useAudioAnalyzer } from '../useAudioAnalyzer'
import { cosineSimilarity } from '../similarity'
import { generateId, formatDate, matchColor } from '../utils'
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
  const [newFft, setNewFft] = useState<number[] | null>(null)
  // 캡처 1회당 1번만 저장되도록 — best 변경으로 인한 effect 재실행 방지
  const savedRef = useRef(false)

  const { status, errorMessage, fftData, waveformData, startListening, stopListening, reset } = useAudioAnalyzer()

  const load = async () => {
    const b = await getBestSound(racket.id)
    setBest(b ?? null)
    const h = await getComparisonHistory(racket.id)
    setHistory(h)
  }

  useEffect(() => { load() }, [])

  // when new fft captured, calculate match — fftData 변경 시에만 실행
  useEffect(() => {
    if (status !== 'captured' || !fftData) return
    if (savedRef.current) return   // 이미 저장됨, 재실행 방지
    if (!best) return

    savedRef.current = true
    setNewFft(fftData)
    const pct = cosineSimilarity(best.fftData, fftData)
    setMatchPct(pct)
    setStep('result')

    saveComparisonSound({
      id: generateId(),
      racketId: racket.id,
      type: 'comparison',
      fftData,
      recordedAt: Date.now(),
      matchPct: pct,
    }).then(load)
  }, [status, fftData])   // best는 의존성에서 제거 — best 갱신으로 재실행되지 않도록

  const handleStartRecord = async () => {
    savedRef.current = false   // 새 녹음 시작 전 리셋
    setStep('recording')
    reset()
    await startListening()
  }

  const handleRetry = () => {
    savedRef.current = false   // 다음 캡처를 저장할 수 있도록 리셋
    setStep('ready')
    setMatchPct(null)
    setNewFft(null)
    reset()
  }

  // static waveform from fftData (best or new) for display
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

        {/* Best waveform */}
        <div>
          <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">
            🏆 베스트 사운드 · {formatDate(best.recordedAt)}
          </p>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-3">
            <Waveform data={fftToWaveform(best.fftData)} color="#60a5fa" height={48} />
          </div>
        </div>

        {/* New waveform or record prompt */}
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
          </div>
        </div>

        {/* Error */}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 text-sm text-red-400">
            {errorMessage}
          </div>
        )}

        {/* Match result */}
        {step === 'result' && matchPct !== null && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">일치율</p>
            <div className="text-7xl font-black tracking-tighter" style={{ color: matchColor(matchPct) }}>
              {matchPct}<span className="text-3xl font-normal text-white/30">%</span>
            </div>
            {/* bar */}
            <div className="h-1.5 bg-white/10 rounded-full mt-3 mx-4 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${matchPct}%`, background: matchColor(matchPct) }}
              />
            </div>
            <p className="text-xs text-white/30 mt-2">주파수 스펙트럼 유사도</p>
          </div>
        )}

        {/* Action button */}
        {step === 'ready' && (
          <button
            onClick={handleStartRecord}
            className="w-full py-4 rounded-2xl bg-white text-black font-bold text-sm"
          >
            새 스트링 녹음하기
          </button>
        )}

        {step === 'recording' && (
          <div className="space-y-3">
            <button
              onClick={stopListening}
              className="w-full py-4 rounded-2xl bg-red-500 text-white font-bold text-sm animate-pulse"
            >
              줄을 튕겨주세요 — 또는 여기 탭
            </button>
          </div>
        )}

        {step === 'result' && (
          <button
            onClick={handleRetry}
            className="w-full py-3 rounded-2xl bg-white/5 text-white/40 text-sm"
          >
            다시 녹음
          </button>
        )}

        {/* History */}
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
                  <span
                    className="text-sm font-bold"
                    style={{ color: matchColor(h.matchPct ?? 0) }}
                  >
                    {h.matchPct ?? '—'}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
