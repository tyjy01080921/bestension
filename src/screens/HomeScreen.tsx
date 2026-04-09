import { useEffect, useState } from 'react'
import { getRackets, getBestSound, deleteRacket, clearAllData, type Racket } from '../db'
import { formatDate } from '../utils'

interface Props {
  onAddRacket: () => void
  onRecord: (racket: Racket) => void
  onCompare: (racket: Racket) => void
}

export default function HomeScreen({ onAddRacket, onRecord, onCompare }: Props) {
  const [rackets, setRackets] = useState<Racket[]>([])
  const [hasBest, setHasBest] = useState<Record<string, boolean>>({})
  const [showSettings, setShowSettings] = useState(false)

  const load = async () => {
    const list = await getRackets()
    setRackets(list)
    const bestMap: Record<string, boolean> = {}
    for (const r of list) {
      const b = await getBestSound(r.id)
      bestMap[r.id] = !!b
    }
    setHasBest(bestMap)
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('이 라켓과 모든 사운드 기록을 삭제할까요?')) return
    await deleteRacket(id)
    load()
  }

  const handleClearAll = async () => {
    if (!confirm('모든 라켓과 사운드 데이터를 초기화할까요?\n이 작업은 되돌릴 수 없어요.')) return
    await clearAllData()
    setShowSettings(false)
    load()
  }

  return (
    <div className="flex flex-col min-h-full bg-[#111]">
      {/* Header */}
      <div className="px-5 pt-12 pb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bestension</h1>
          <p className="text-sm text-white/40 mt-0.5">내 스트링 사운드 라이브러리</p>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(v => !v)}
          className="mt-1 text-white/30 text-xl p-1"
          aria-label="설정"
        >
          ⚙︎
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="mx-4 mb-3 bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={handleClearAll}
            className="w-full px-4 py-3.5 text-left text-sm text-red-400 font-medium"
          >
            🗑 전체 데이터 초기화
          </button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 px-4 pb-24 space-y-3">
        {rackets.length === 0 && (
          <div className="mt-16 text-center">
            <div className="text-4xl mb-4">🏸</div>
            <p className="text-white/40 text-sm leading-relaxed">
              아직 라켓이 없어요.<br />
              오른쪽 아래 + 버튼으로 추가하세요.
            </p>
          </div>
        )}

        {rackets.map(r => (
          <div key={r.id} className="bg-white/5 rounded-2xl p-4 border border-white/10">
            <div className="flex justify-between items-start mb-1">
              <span className="font-bold text-base">{r.name}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                hasBest[r.id]
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-white/10 text-white/30'
              }`}>
                {hasBest[r.id] ? '베스트 저장됨' : '저장 없음'}
              </span>
            </div>

            {(r.stringName || r.tension) && (
              <p className="text-xs text-white/40 mb-2">
                {[r.stringName, r.tension ? `${r.tension}${r.unit}` : null].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="text-[10px] text-white/20 mb-3">{formatDate(r.createdAt)}</p>

            <div className="flex gap-2 flex-wrap">
              {hasBest[r.id] ? (
                <button
                  onClick={() => onCompare(r)}
                  className="flex-1 text-xs font-bold py-2 px-3 rounded-lg bg-white text-black"
                >
                  비교하기
                </button>
              ) : null}
              <button
                onClick={() => onRecord(r)}
                className="flex-1 text-xs font-bold py-2 px-3 rounded-lg bg-white/10 text-white"
              >
                {hasBest[r.id] ? '재녹음' : '베스트 녹음'}
              </button>
              <button
                onClick={() => handleDelete(r.id)}
                className="text-xs py-2 px-3 rounded-lg text-white/30"
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* FAB */}
      <button
        onClick={onAddRacket}
        className="fixed bottom-8 right-6 w-14 h-14 rounded-full bg-white text-black text-2xl font-light flex items-center justify-center shadow-lg"
        aria-label="새 라켓 추가"
      >
        +
      </button>
    </div>
  )
}
