import { useState } from 'react'
import { saveRacket, type Racket } from '../db'
import { generateId } from '../utils'

interface Props {
  onBack: () => void
  onSaved: (racket: Racket) => void
}

export default function AddRacketScreen({ onBack, onSaved }: Props) {
  const [name, setName] = useState('')
  const [stringName, setStringName] = useState('')
  const [tension, setTension] = useState('')
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs')
  const [saving, setSaving] = useState(false)

  const canSave = name.trim().length > 0

  const handleSave = async (goRecord: boolean) => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const racket: Racket = {
        id: generateId(),
        name: name.trim(),
        stringName: stringName.trim() || undefined,
        tension: tension ? parseFloat(tension) : undefined,
        unit,
        createdAt: Date.now(),
      }
      await saveRacket(racket)
      if (goRecord) {
        onSaved(racket)
      } else {
        onBack()
      }
    } catch (err) {
      console.error('saveRacket failed:', err)
      alert('저장 중 오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-[#111]">
      <div className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-white/50 text-xl p-1">‹</button>
        <h1 className="text-xl font-bold">새 라켓 추가</h1>
      </div>

      <div className="flex-1 px-5 pb-8 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-white/40 mb-1.5 uppercase tracking-wide">
            라켓 이름 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="예: Yonex Astrox 88D"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/30"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-white/40 mb-1.5 uppercase tracking-wide">
            스트링 <span className="text-white/20">(선택)</span>
          </label>
          <input
            type="text"
            value={stringName}
            onChange={e => setStringName(e.target.value)}
            placeholder="예: BG80 Power"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/30"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-white/40 mb-1.5 uppercase tracking-wide">
            텐션 <span className="text-white/20">(선택)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={tension}
              onChange={e => setTension(e.target.value)}
              placeholder="예: 27"
              inputMode="decimal"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/30"
            />
            <div className="flex bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              {(['lbs', 'kg'] as const).map(u => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`px-4 py-3 text-sm font-semibold transition-colors ${
                    unit === u ? 'bg-white text-black' : 'text-white/40'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 space-y-3">
          <button
            onClick={() => handleSave(true)}
            disabled={!canSave || saving}
            className="w-full py-4 rounded-2xl bg-white text-black font-bold text-sm disabled:opacity-30"
          >
            저장 후 베스트 사운드 녹음하기
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={!canSave || saving}
            className="w-full py-3 rounded-2xl bg-white/5 text-white/50 text-sm disabled:opacity-30"
          >
            저장만 하기 (나중에 녹음)
          </button>
        </div>
      </div>
    </div>
  )
}
