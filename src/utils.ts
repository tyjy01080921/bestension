export function generateId(): string {
  // crypto.randomUUID() requires HTTPS or localhost.
  // Use crypto.getRandomValues() which works in all contexts including HTTP.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40  // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80  // variant RFC 4122
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

export function matchColor(pct: number): string {
  if (pct >= 85) return '#22c55e'  // green
  if (pct >= 65) return '#f59e0b'  // amber
  return '#ef4444'                  // red
}

/**
 * 텐션 유지율 색상 (스펙트럴 센트로이드 기반 물리적 텐션 추정)
 * matchColor보다 엄격한 임계값 적용
 */
export function tensionColor(pct: number): string {
  if (pct > 100) return '#60a5fa'  // blue: 베스트보다 높은 텐션 (재스트링)
  if (pct >= 95) return '#22c55e'  // green: 양호
  if (pct >= 85) return '#f59e0b'  // amber: 주의
  return '#ef4444'                  // red: 교체 권장
}
