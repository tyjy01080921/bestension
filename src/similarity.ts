/**
 * Cosine similarity between two FFT bin vectors.
 * Returns 0-100 (percent).
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
  // clamp to [0, 1] (cosine similarity is -1..1 but FFT dB values are negative,
  // so products are positive and result is always 0..1 in practice)
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100)
}
