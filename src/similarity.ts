/**
 * 코사인 유사도 (지각적 일치율)
 * 두 FFT 빈 벡터의 전체 스펙트럼 형태를 비교합니다.
 * 선수가 귀로 판단하는 방식과 가장 유사 — 기본 주파수 + 배음 구조 + 음색 모두 반영.
 * 반환값: 0-100 (%)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  if (len === 0) return 0

  let dot = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }

  if (magA === 0 || magB === 0) return 0

  const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB))
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100)
}

/**
 * 텐션 유지율 (물리적 추정)
 * 스펙트럴 센트로이드 비율로 텐션을 추정합니다.
 * 장력은 주파수 제곱에 비례: T ∝ f²
 * 반환값: 0-150 (%). 100 초과 시 베스트보다 높은 텐션 (재스트링 후).
 */
export function calculateTensionRetention(centroidBest: number, centroidCurrent: number): number {
  if (centroidBest === 0) return 0
  const ratio = centroidCurrent / centroidBest
  return Math.round(Math.min(ratio * ratio * 100, 150))
}

/**
 * 텐션 상태 UI 문구 생성
 */
export function formatTensionMessage(
  tensionPct: number,
  hzBest: number,
  hzCurrent: number
): { primary: string; secondary: string } {
  const hzDiff = Math.round(hzCurrent - hzBest)
  const tensionDiff = Math.abs(100 - tensionPct)

  if (tensionPct > 105) {
    return {
      primary: `베스트보다 높은 텐션입니다 (${tensionPct}%)`,
      secondary: `스펙트럼 중심 +${Math.abs(hzDiff)}Hz — 재녹음을 권장합니다`,
    }
  }
  if (tensionPct >= 98) {
    return {
      primary: `베스트 텐션 유지 중입니다`,
      secondary: `스펙트럼 중심 변화 ${hzDiff > 0 ? '+' : ''}${hzDiff}Hz`,
    }
  }
  return {
    primary: `현재 텐션은 베스트 텐션의 ${tensionPct}% 수준입니다`,
    secondary: `스펙트럼 중심 ${hzDiff}Hz (텐션 약 ${tensionDiff}% 하락)`,
  }
}
