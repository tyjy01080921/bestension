import { useState } from 'react'
import { saveBestSound, type Racket, centroidHzFromFft } from '../db'
import { useAudioAnalyzer } from '../useAudioAnalyzer'
import { generateId } from '../utils'
import Waveform from '../components/Waveform'

interface Props {
  racket: Racket
  onBack: () => void
  onSaved: () => void
}

export default function RecordScreen({ racket, onBack, onSaved }: Props) {
  const { status, errorMessage, fftData, waveformData, hitCount, requiredHits, startListening, stopListening, reset } = useAudioAnalyzer()
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!fftData) return
    setSaving(true)
    try {
      await saveBestSound({
        id: generateId(),
        racketId: racket.id,
        type: 'best',
        fftData,
        recordedAt: Date.now(),
      })
      onSaved()
    } catch (err) {
      console.error('saveBestSound failed:', err)
      alert('저장 중 오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const isListening = status === 'listening'
  const isCaptured = status === 'captured'

  const waveColor = isListening ? '#ffffff' : isCaptured ? '#22c55e' : '#ffffff33'

  // 캡처 완료 시 스펙트럴 센트로이드 Hz 계산
  const centroidHz = isCaptured && fftData ? Math.round(centroidHzFromFft(fftData)) : null

  return (
    <div className="flex flex-col min-h-full bg-[#111]">
      <div className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-white/50 text-xl p-1">‹</button>
        <div>
          <h1 className="text-xl font-bold">베스트 사운드 녹음</h1>
          <p className="text-xs text-white/40">{racket.name}</p>
        </div>
      </div>

      <div className="flex-1 px-5 flex flex-col justify-between pb-10">

        {/* Racket info */}
        {(racket.stringName || racket.tension) && (
          <div className="bg-white/5 rounded-2xl px-4 py-3 mb-6 text-sm text-white/60">
            {[racket.stringName, racket.tension ? `${racket.tension}${racket.unit}` : null].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* Waveform */}
        <div className="bg-white/5 rounded-2xl p-4 mb-6">
          <Waveform data={waveformData} color={waveColor} height={64} />
          <p className="text-center text-xs text-white/30 mt-2">
            {isListening
              ? hitCount === 0
                ? '손바닥이나 라켓 옆면으로 줄을 쳐주세요...'
                : `${hitCount}/${requiredHits}번 감지됨 — 계속 쳐주세요`
              : isCaptured
              ? '녹음 완료!'
              : '마이크 버튼을 눌러 시작'}
          </p>
        </div>

        {/* Hit progress dots */}
        {isListening && (
          <div className="flex justify-center gap-3 mb-6">
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

        {/* Error */}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 mb-6 text-sm text-red-400">
            {errorMessage}
          </div>
        )}

        {/* Main action */}
        <div className="flex flex-col items-center gap-6">
          {!isCaptured ? (
            <>
              <button
                onClick={isListening ? stopListening : startListening}
                className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
                  isListening
                    ? 'bg-red-500 animate-pulse'
                    : 'bg-white'
                }`}
              >
                {isListening ? (
                  <span className="text-white text-3xl">⏹</span>
                ) : (
                  <MicIcon />
                )}
              </button>
              <p className="text-xs text-white/30 text-center">
                {isListening
                  ? `총 ${requiredHits}번 쳐주세요 — 자동으로 측정돼요`
                  : `버튼을 누른 뒤 줄을 ${requiredHits}번 쳐주세요`}
              </p>
            </>
          ) : (
            <div className="w-full space-y-3">
              <div className="text-center mb-2">
                <div className="text-5xl font-black text-green-400 mb-1">✓</div>
                <p className="text-sm text-white/60">사운드 캡처 완료 ({requiredHits}번 평균)</p>
                {centroidHz !== null && (
                  <div className="mt-3 bg-white/5 rounded-xl py-3">
                    <p className="text-2xl font-bold text-green-300">{centroidHz} Hz</p>
                    <p className="text-xs text-white/30 mt-0.5">스펙트럼 중심 주파수</p>
                  </div>
                )}
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-4 rounded-2xl bg-white text-black font-bold text-sm disabled:opacity-50"
              >
                {saving ? '저장 중...' : '베스트 사운드로 저장'}
              </button>
              <button
                onClick={reset}
                className="w-full py-3 rounded-2xl bg-white/5 text-white/40 text-sm"
              >
                다시 녹음
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-white/20 text-center mt-auto pt-6">
          손바닥이나 다른 라켓 옆면으로 줄을 {requiredHits}번 쳐주세요
        </p>
      </div>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="32" height="36" viewBox="0 0 32 36" fill="none">
      <rect x="10" y="1" width="12" height="20" rx="6" fill="#111"/>
      <path d="M5 18c0 6.075 4.925 11 11 11s11-4.925 11-11" stroke="#111" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="16" y1="29" x2="16" y2="34" stroke="#111" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="11" y1="34" x2="21" y2="34" stroke="#111" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}
