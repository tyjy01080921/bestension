import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-6 flex justify-center">
      <div className="w-full max-w-sm bg-[#1e1e1e] border border-white/15 rounded-2xl px-5 py-4 shadow-2xl flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">새 버전이 있어요</p>
          <p className="text-xs text-white/40 mt-0.5">업데이트 후 계속 사용하세요</p>
        </div>
        <button
          onClick={() => updateServiceWorker(true)}
          className="shrink-0 px-4 py-2 rounded-xl bg-white text-black text-sm font-bold"
        >
          업데이트
        </button>
      </div>
    </div>
  )
}
